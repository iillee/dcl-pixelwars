/**
 * botBody.ts — a ghost bot's physical body, run by the server.
 *
 * Modes:
 *   walk    the bot's legs (server/bots/bot.ts path stepping) drive the position.
 *   knock   a hit landed (shared/knocks.ts, same numbers a human victim gets): velocity,
 *           a held force, gravity and floor friction, exactly like the anvils. No floor
 *           under it = it falls. Back on a floor and slow = walk again.
 *           When that flight is over a gap or heading off the level, the bot may spend a
 *           jump, a double jump, and a glide to get back. The attempt is late and sloppy
 *           on purpose (shared/pvp.ts BOT_RECOVER_*).
 *   rescue  crossed the fall line: rides the Lakitu cloud home along the shared path
 *           (shared/rescuePath.ts) that every client draws for it.
 *   drop    the cloud let go above the base: falls onto it, then a land hold and
 *           respawn immunity, like a human arriving home.
 */
import { WalkableGraph, leapPlan } from './mazeGraph'
import { graphFloorAt } from './anvilSim'
import { Placed } from '../maze/generator'
import { fallTriggerY } from './swell'
import {
  RESPAWN_IMMUNITY_S, BOT_KNOCK_UNIT, BOT_GRAVITY, BOT_FRICTION, BOT_RECOVER_SPEED, AIR_SPIKE_GLIDE_LOCK_S,
  BOT_RECOVER_CHANCE, BOT_RECOVER_REACT_MIN_S, BOT_RECOVER_REACT_MAX_S, BOT_RECOVER_SKIP_DOUBLE_CHANCE,
  BOT_RECOVER_MISJUDGE_CHANCE, BOT_RECOVER_MISJUDGE_M, BOT_RECOVER_STEER_ACCEL,
  BOT_RECOVER_EDGE_SPEED, BOT_RECOVER_RUN_JUMP_AT, BOT_RECOVER_GIVE_UP_M, BOT_GLIDE_TURN,
  BOT_RECOVER_MAX_S, BOT_RECOVER_MAX_SEEK_M, BOT_JUMP_V, botJumpSpeed,
  HUMAN_JUMP_HEIGHT, HUMAN_RUN_JUMP_HEIGHT, HUMAN_DOUBLE_JUMP_HEIGHT, HUMAN_GLIDE_SPEED, HUMAN_GLIDE_FALL,
  AIR_SPIKE_DIVE_IMPULSE, AIR_SPIKE_DIVE_FORWARD, AIR_SPIKE_DIVE_FORCE, AIR_SPIKE_DIVE_FORCE_S,
  LUNGE_ACTIVE_S, LUNGE_DISTANCE, LUNGE_COOLDOWN_S,
} from './pvp'
import { BOT_ANIM_DOUBLE, BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP, BOT_ANIM_LOCO, BOT_ANIM_SLIDE } from './botAnim'
import { KnockSpec, KnockTrace, KNOCK_TRACE } from './knocks'
import { RESCUE_PATH, rescueCloudPose, RescueVec } from './rescuePath'

type V3 = RescueVec
export type BotBodyMode = 'walk' | 'knock' | 'rescue' | 'drop'
export type BotBodyEvent =
  | { type: 'settled' }              // knock over, standing on a floor: re-seat on the graph
  | { type: 'fell'; catch: V3 }      // crossed the fall line: the cloud trip starts here
  | { type: 'landed' }               // home on the base after the cloud
  | { type: 'trace'; line: string }  // KNOCK_TRACE result
  | { type: 'recover'; how: 'jump' | 'double' | 'glide' }
export type BotWorld = { graph: WalkableGraph; rampTiles: Placed[]; base: V3 }

const SUBSTEP_S = 0.05
const SNAP_DOWN = 0.6

export class BotBody {
  mode: BotBodyMode = 'walk'
  pos: V3
  private vel: V3 = { x: 0, y: 0, z: 0 }
  private force: V3 = { x: 0, y: 0, z: 0 } // m/s² while forceLeft > 0
  private forceLeft = 0
  private lockLeft = 0
  private grounded = true
  private rescueAge = 0
  private catchP: V3 = { x: 0, y: 0, z: 0 }
  private base: V3 = { x: 0, y: 0, z: 0 }
  private holdLeft = 0
  private immuneLeft = 0
  private trace: KnockTrace | null = null
  /** This knock: trying to get back, and which part of the attempt is in the air. */
  private willRecover = false
  private phase: 'idle' | 'jump' | 'glide' = 'idle'
  /** Seconds of control lock (and a spike's glide lock) still blocking the attempt. */
  private noJumpLeft = 0
  /** This bot's reaction, rolled once. null until the first attempt that needs it. */
  private reactS: number | null = null
  private reactLeft = 0
  private allowDouble = true
  private misjudge = false
  private didDouble = false
  /** The knock already spent its jump. Landing does not grant another. */
  private jumped = false
  private jumpTime = 0
  private glideTime = 0
  private recoverTo: V3 | null = null
  /** Player lunge while the glider is open: same length and cooldown, aimed at the floor. */
  private glideDashLeft = 0
  private glideDashCd = 0
  private glideDashDir: V3 = { x: 0, y: 0, z: 0 }
  /** Random source for the recover roll (scripts pass a fixed one). */
  rng: () => number = Math.random

  constructor(pos: V3, rng?: () => number) {
    this.pos = { ...pos }
    if (rng) this.rng = rng
  }

  /** Gliding back toward a floor right now. */
  isGliding(): boolean { return this.mode === 'knock' && this.phase === 'glide' && !this.grounded }

  /**
   * Pose for the client. Does not affect the integrator.
   * A dash keeps locomotion: the lunge is its own tell. A hit that is still
   * on the floor slides. Rising is a jump (the knock's lift, a hop, a leap).
   * Coming down without a glide is a fall.
   */
  animCode(): number {
    if (this.mode === 'drop') return this.grounded ? BOT_ANIM_LOCO : BOT_ANIM_FALL
    if (this.mode !== 'knock') return BOT_ANIM_LOCO
    if (this.isDashing()) return BOT_ANIM_LOCO
    if (this.phase === 'glide' && !this.grounded) return BOT_ANIM_GLIDE
    if (this.phase === 'jump' && !this.grounded) return this.didDouble ? BOT_ANIM_DOUBLE : BOT_ANIM_JUMP
    if (!this.grounded) return this.vel.y > 0.4 ? BOT_ANIM_JUMP : BOT_ANIM_FALL
    if (this.forceLeft > 0 || this.lockLeft > 0 || Math.hypot(this.vel.x, this.vel.z) >= BOT_RECOVER_SPEED) return BOT_ANIM_SLIDE
    return BOT_ANIM_LOCO
  }
  /** Jump or double jump of the current attempt, not yet gliding. */
  isRecoveryJump(): boolean { return this.mode === 'knock' && this.phase === 'jump' && !this.grounded }

  /** Open to hits: walking or already flying from one, and not inside respawn immunity. */
  canBeHit(): boolean { return (this.mode === 'walk' || this.mode === 'knock') && this.immuneLeft <= 0 }
  /** On a floor right now (a spike launches instead of driving down). */
  isGrounded(): boolean { return this.mode === 'walk' || (this.mode === 'knock' && this.grounded) }
  /** The legs may step: walking and not in the post-landing hold. */
  canWalk(): boolean { return this.mode === 'walk' && this.holdLeft <= 0 }
  /** Riding or dropping from the cloud. */
  inRescue(): boolean { return this.mode === 'rescue' || this.mode === 'drop' }

  /** Walking: the legs put the body here. */
  follow(p: V3): void { if (this.mode === 'walk') this.pos = { ...p } }

  /** Round reset / respawn: stand here, no motion, no rescue. */
  reset(p: V3): void {
    this.mode = 'walk'
    this.pos = { ...p }
    this.vel = { x: 0, y: 0, z: 0 }
    this.forceLeft = 0; this.lockLeft = 0; this.holdLeft = 0; this.immuneLeft = 0
    this.grounded = true
    this.trace = null
    this.clearRecovery()
  }

  /** The bot's own lunge: hold `speed` along (dx, dz) for `s`, then brake to `keep` of it.
   *  Floors and falls apply as in a knock, so it can dash itself off an edge like a player. */
  dash(dx: number, dz: number, speed: number, s: number, keep: number): boolean {
    if (this.mode !== 'walk' || this.holdLeft > 0) return false
    this.mode = 'knock'
    this.grounded = true
    this.dashDir = { x: dx, y: 0, z: dz }
    this.dashSpeed = speed
    this.dashLeft = s
    this.dashKeep = keep
    this.vel = { x: dx * speed, y: 0, z: dz * speed }
    this.forceLeft = 0
    this.lockLeft = 0
    this.armRecovery(0)
    return true
  }
  private dashDir: V3 = { x: 0, y: 0, z: 0 }
  private dashSpeed = 0
  private dashLeft = 0
  private dashKeep = 0
  /** Mid-dash (its own lunge). */
  isDashing(): boolean { return this.mode === 'knock' && this.dashLeft > 0 }
  /** In the air and not inside its own dash. A spike can fire here. */
  isAirborne(): boolean { return this.mode === 'knock' && !this.grounded && this.dashLeft <= 0 }
  verticalSpeed(): number { return this.vel.y }

  /** Leave the floor on a planned drop or jump. The existing knock physics lands it. */
  leap(target: V3): boolean {
    if (this.mode !== 'walk' || this.holdLeft > 0) return false
    const plan = leapPlan([this.pos.x, this.pos.y, this.pos.z], [target.x, target.y, target.z])
    if (!plan) return false
    this.beginAir(plan.vx, plan.vy, plan.vz)
    return true
  }

  /** Ground hop toward (dx, dz), the wind-up of a spike. Short drift so the cylinder can cover the target. */
  jump(dx: number, dz: number): boolean {
    if (this.mode !== 'walk' || this.holdLeft > 0) return false
    const l = Math.hypot(dx, dz)
    const s = l > 1e-3 ? 3 / l : 0
    this.beginAir(dx * s, BOT_JUMP_V, dz * s)
    return true
  }

  /** The attacker's dive. Same impulse the player's airborne Burst applies, through BOT_KNOCK_UNIT. */
  dive(fx: number, fz: number): void {
    if (this.mode !== 'knock' || this.grounded) return
    const u = BOT_KNOCK_UNIT
    const fl = Math.hypot(fx, fz) || 1
    this.vel.x += (fx / fl) * AIR_SPIKE_DIVE_FORWARD * u
    this.vel.y = -AIR_SPIKE_DIVE_IMPULSE * u
    this.vel.z += (fz / fl) * AIR_SPIKE_DIVE_FORWARD * u
    this.force = { x: 0, y: -AIR_SPIKE_DIVE_FORCE * u, z: 0 }
    this.forceLeft = AIR_SPIKE_DIVE_FORCE_S
    this.dashLeft = 0
    this.clearRecovery()
  }

  private beginAir(vx: number, vy: number, vz: number): void {
    this.mode = 'knock'
    this.grounded = false
    this.vel = { x: vx, y: vy, z: vz }
    this.forceLeft = 0
    this.lockLeft = 0
    this.dashLeft = 0
    this.clearRecovery()
  }

  /** Apply a hit. Returns false if the body can't be hit right now. */
  knock(spec: KnockSpec): boolean {
    if (!this.canBeHit()) return false
    const u = BOT_KNOCK_UNIT
    this.vel = { x: this.vel.x + spec.impulse.x * u, y: this.vel.y + spec.impulse.y * u, z: this.vel.z + spec.impulse.z * u }
    if (spec.force > 0 && spec.forceS > 0) {
      const a = spec.force * u
      this.force = { x: spec.forceDir.x * a, y: spec.forceDir.y * a, z: spec.forceDir.z * a }
      this.forceLeft = spec.forceS
    }
    this.lockLeft = Math.max(this.lockLeft, spec.lockS)
    this.dashLeft = 0
    // Each hit starts a new attempt. The reaction delay stays the one this bot rolled.
    this.armRecovery(Math.max(spec.lockS, spec.kind === 'spike' ? AIR_SPIKE_GLIDE_LOCK_S : 0))
    if (this.mode === 'walk') this.grounded = true
    this.mode = 'knock'
    if (KNOCK_TRACE) this.trace = new KnockTrace(spec.kind, 'bot', this.pos)
    return true
  }

  tick(dt: number, world: BotWorld): BotBodyEvent[] {
    const out: BotBodyEvent[] = []
    let left = Math.min(Number.isFinite(dt) ? dt : 0, 1)
    while (left > 1e-6) {
      const s = Math.min(left, SUBSTEP_S)
      left -= s
      this.step(s, world, out)
      if (this.trace) {
        const line = this.trace.sample(s, this.pos)
        if (line) { out.push({ type: 'trace', line }); this.trace = null }
      }
    }
    return out
  }

  private step(dt: number, world: BotWorld, out: BotBodyEvent[]): void {
    if (this.immuneLeft > 0) this.immuneLeft -= dt
    if (this.glideDashCd > 0) this.glideDashCd = Math.max(0, this.glideDashCd - dt)
    switch (this.mode) {
      case 'walk':
        if (this.holdLeft > 0) this.holdLeft -= dt
        return
      case 'knock':
        if (this.dashLeft > 0) {
          this.dashLeft -= dt
          if (this.dashLeft > 0) {
            this.vel.x = this.dashDir.x * this.dashSpeed
            this.vel.z = this.dashDir.z * this.dashSpeed
          } else {
            this.vel.x = this.dashDir.x * this.dashSpeed * this.dashKeep
            this.vel.z = this.dashDir.z * this.dashSpeed * this.dashKeep
          }
        } else if (this.noJumpLeft > 0) this.noJumpLeft -= dt
        else if (this.reactLeft > 0) this.reactLeft -= dt
        this.steerRecovery(dt, world, out)
        this.physics(dt, world)
        if (this.lockLeft > 0) this.lockLeft -= dt
        if (this.pos.y < fallTriggerY(this.pos.x, this.pos.z)) {
          this.mode = 'rescue'
          this.rescueAge = 0
          this.catchP = { ...this.pos }
          this.base = { ...world.base }
          this.vel = { x: 0, y: 0, z: 0 }; this.forceLeft = 0
          out.push({ type: 'fell', catch: { ...this.catchP } })
          return
        }
        if (this.grounded) this.phase = 'idle'
        if (this.grounded && this.forceLeft <= 0 && this.lockLeft <= 0 && Math.hypot(this.vel.x, this.vel.z) < BOT_RECOVER_SPEED) {
          this.mode = 'walk'
          this.vel = { x: 0, y: 0, z: 0 }
          out.push({ type: 'settled' })
        }
        return
      case 'rescue': {
        this.rescueAge += dt
        const pose = rescueCloudPose(this.catchP, this.base, this.rescueAge)
        if (this.rescueAge >= RESCUE_PATH.GRAB_S) this.pos = { x: pose.pos.x, y: pose.pos.y - RESCUE_PATH.HANG_Y, z: pose.pos.z }
        if (pose.done) {
          this.mode = 'drop'
          this.vel = { x: 0, y: 0, z: 0 }
          this.grounded = false
        }
        return
      }
      case 'drop':
        this.physics(dt, world)
        if (this.grounded) {
          this.mode = 'walk'
          this.vel = { x: 0, y: 0, z: 0 }
          this.holdLeft = RESCUE_PATH.LAND_LOCK_S
          this.immuneLeft = RESPAWN_IMMUNITY_S
          out.push({ type: 'landed' })
        }
        return
    }
  }

  /** Roll (or refuse) an attempt. `blockS` is how long jump and glide stay unavailable. */
  private armRecovery(blockS: number): void {
    this.phase = 'idle'
    this.recoverTo = null
    this.didDouble = false
    this.jumped = false
    this.jumpTime = 0
    this.glideTime = 0
    this.noJumpLeft = blockS
    this.willRecover = this.rng() < BOT_RECOVER_CHANCE
    if (!this.willRecover) { this.reactLeft = 0; return }
    if (this.reactS === null) {
      const span = BOT_RECOVER_REACT_MAX_S - BOT_RECOVER_REACT_MIN_S
      this.reactS = BOT_RECOVER_REACT_MIN_S + this.rng() * span
    }
    this.reactLeft = this.reactS
    this.allowDouble = this.rng() >= BOT_RECOVER_SKIP_DOUBLE_CHANCE
    this.misjudge = this.rng() < BOT_RECOVER_MISJUDGE_CHANCE
  }

  private clearRecovery(): void {
    this.willRecover = false
    this.phase = 'idle'
    this.recoverTo = null
    this.reactLeft = 0
    this.noJumpLeft = 0
    this.didDouble = false
    this.jumped = false
    this.jumpTime = 0
    this.glideTime = 0
    this.glideDashLeft = 0
  }

  /**
   * Over a gap, or the knock's remaining slide reaches a point with no floor.
   * Grounded, that distance is the friction stop, so a shove that dies on the
   * slab does not jump. Airborne, it is where the hop comes back down to the floor.
   */
  private threatened(world: BotWorld): boolean {
    if (this.dashLeft > 0 || this.noJumpLeft > 0 || this.reactLeft > 0) return false
    const sp = Math.hypot(this.vel.x, this.vel.z)
    const under = graphFloorAt(world.graph, world.rampTiles, this.pos.x, this.pos.z, this.pos.y, 1.2, 0.6)
    if (under === null) return true
    if (sp < BOT_RECOVER_EDGE_SPEED) return false
    const reach = this.grounded ? (sp * sp) / (2 * BOT_FRICTION) : this.hopReach(under)
    if (reach < 0.45) return false
    const x = this.pos.x + (this.vel.x / sp) * Math.min(reach, 14)
    const z = this.pos.z + (this.vel.z / sp) * Math.min(reach, 14)
    return graphFloorAt(world.graph, world.rampTiles, x, z, this.grounded ? this.pos.y : under, 1.2, 0.8) === null
  }

  /** Horizontal metres until an airborne hop is back down at `floorY`. */
  private hopReach(floorY: number): number {
    const A = 0.5 * BOT_GRAVITY
    const B = -this.vel.y
    const C = floorY - this.pos.y
    const disc = B * B - 4 * A * C
    if (!(disc > 0) || A <= 0) return 8
    const s = Math.sqrt(disc)
    const ts = [(-B + s) / (2 * A), (-B - s) / (2 * A)].filter(t => t > 0.05)
    const t = ts.length ? Math.max(...ts) : 0.4
    return Math.hypot(this.vel.x, this.vel.z) * Math.min(t, 1.6)
  }

  /** Jump, then a double jump if the glide from here still misses, then steer the glide. */
  private steerRecovery(dt: number, world: BotWorld, out: BotBodyEvent[]): void {
    if (!this.willRecover || this.dashLeft > 0) return
    if (this.phase === 'idle') {
      // Touching the lip clears the phase. Slipping off again keeps the glide; it does not grant a second jump.
      if (this.jumped) {
        if (!this.grounded && this.recoverTo && this.glideTime > 0 && this.glideTime < BOT_RECOVER_MAX_S) this.phase = 'glide'
        else return
      } else {
        if (!this.threatened(world)) return
        const floor = this.nearestFloor(world)
        if (!floor) { this.willRecover = false; return }
        this.recoverTo = floor
        const h = Math.hypot(this.vel.x, this.vel.z) >= BOT_RECOVER_RUN_JUMP_AT ? HUMAN_RUN_JUMP_HEIGHT : HUMAN_JUMP_HEIGHT
        this.vel.y = botJumpSpeed(h)
        this.grounded = false
        this.jumped = true
        this.phase = 'jump'
        this.jumpTime = 0
        out.push({ type: 'recover', how: 'jump' })
        return
      }
    }
    const t = this.recoverTo
    if (!t) { this.clearRecovery(); return }
    if (this.pos.y < t.y - BOT_RECOVER_GIVE_UP_M) { this.abortGlide(); return }
    if (this.phase === 'glide') this.steerGlide(t, dt)
    else this.steerToward(t, dt)
    if (this.phase === 'jump') {
      this.jumpTime += dt
      const apex = this.vel.y <= 0.4 || this.jumpTime > 0.55
      if (!apex) return
      if (!this.didDouble && this.allowDouble && this.stillShort(t)) {
        this.vel.y = botJumpSpeed(HUMAN_DOUBLE_JUMP_HEIGHT)
        this.didDouble = true
        this.jumpTime = 0
        out.push({ type: 'recover', how: 'double' })
        return
      }
      this.phase = 'glide'
      this.glideTime = 0
      out.push({ type: 'recover', how: 'glide' })
      return
    }
    this.glideTime += dt
    if (this.glideTime > BOT_RECOVER_MAX_S) this.abortGlide()
  }

  /** First jump's arc, then a 1 m/s glide, does not cover the floor before the give-up line. */
  private stillShort(t: V3): boolean {
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d < 1.2 && this.pos.y + 0.4 >= t.y) return false
    const toward = d > 1e-3 ? (this.vel.x * dx + this.vel.z * dz) / d : 0
    const outward = Math.max(0, -toward)
    const killT = outward / Math.max(0.5, BOT_RECOVER_STEER_ACCEL)
    const back = d + outward * killT * 0.5
    const time = killT + back / Math.max(0.5, HUMAN_GLIDE_SPEED)
    const vy = Math.max(0, this.vel.y)
    const apex = this.pos.y + (vy * vy) / (2 * BOT_GRAVITY)
    // Land on the floor, not at the give-up line. The snap only catches a body just above it.
    const budget = apex - (t.y + 0.25)
    return budget <= 0 || time > budget / Math.max(0.25, HUMAN_GLIDE_FALL)
  }

  /**
   * Glide like a player who is steering home. The open glider caps speed near
   * HUMAN_GLIDE_SPEED and the heading turns toward the floor, so a hard knock
   * arcs back instead of keeping its launch direction. A lunge (the player's
   * dash) fires toward that floor on the same cooldown and active time, and
   * only when the floor is still out of a plain glide's reach.
   */
  private steerGlide(t: V3, dt: number): void {
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d <= 0.3) return
    const wantX = dx / d, wantZ = dz / d
    if (this.glideDashLeft > 0) {
      this.glideDashLeft -= dt
      const sp = LUNGE_DISTANCE / LUNGE_ACTIVE_S
      this.vel.x = this.glideDashDir.x * sp
      this.vel.z = this.glideDashDir.z * sp
      return
    }
    const toward = (this.vel.x * wantX + this.vel.z * wantZ)
    // Same window a player has: one lunge, then LUNGE_COOLDOWN_S. Skip it when
    // the floor is already coming in, or so far that the boost cannot matter.
    if (this.glideDashCd <= 0 && d > 6 && d < 20 && toward < HUMAN_GLIDE_SPEED) {
      this.glideDashLeft = LUNGE_ACTIVE_S
      this.glideDashCd = LUNGE_COOLDOWN_S
      this.glideDashDir = { x: wantX, y: 0, z: wantZ }
      const sp = LUNGE_DISTANCE / LUNGE_ACTIVE_S
      this.vel.x = wantX * sp
      this.vel.z = wantZ * sp
      return
    }
    let vx = this.vel.x, vz = this.vel.z
    let sp = Math.hypot(vx, vz)
    const dirx = sp > 0.4 ? vx / sp : wantX
    const dirz = sp > 0.4 ? vz / sp : wantZ
    const ang = Math.atan2(dirx * wantZ - dirz * wantX, dirx * wantX + dirz * wantZ)
    const step = Math.max(-BOT_GLIDE_TURN * dt, Math.min(BOT_GLIDE_TURN * dt, ang))
    const c = Math.cos(step), s = Math.sin(step)
    const ndx = dirx * c - dirz * s
    const ndz = dirx * s + dirz * c
    const spWant = d < 2.5 ? Math.min(HUMAN_GLIDE_SPEED, d * 2) : HUMAN_GLIDE_SPEED
    // Excess over the glide cap decays like the player's external-velocity drag.
    const excess = sp - spWant
    sp = excess > 0 ? spWant + excess * Math.exp(-1.5 * dt) : sp + (spWant - sp) * Math.min(1, 8 * dt)
    this.vel.x = ndx * sp
    this.vel.z = ndz * sp
  }

  private steerToward(t: V3, dt: number): void {
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d <= 0.2) return
    const want = Math.min(HUMAN_GLIDE_SPEED, d * 2)
    const ex = (dx / d) * want - this.vel.x
    const ez = (dz / d) * want - this.vel.z
    const el = Math.hypot(ex, ez)
    const a = Math.min(el, BOT_RECOVER_STEER_ACCEL * dt)
    if (el > 1e-4) { this.vel.x += (ex / el) * a; this.vel.z += (ez / el) * a }
  }

  private abortGlide(): void {
    this.willRecover = false
    this.phase = 'idle'
    this.recoverTo = null
    this.glideDashLeft = 0
  }

  /**
   * Nearest walkable cell they might still reach. Deep cells win when one is in range,
   * so the aim sits off the lip. A misjudge shifts it sideways and can miss the floor.
   */
  private nearestFloor(world: BotWorld): V3 | null {
    const rise = HUMAN_RUN_JUMP_HEIGHT + HUMAN_DOUBLE_JUMP_HEIGHT + 1
    const pick = (pool: Set<string>): V3 | null => {
      let best: V3 | null = null, bestD = BOT_RECOVER_MAX_SEEK_M
      for (const id of pool) {
        const p = world.graph.worldPos.get(id)
        if (!p || p[1] > this.pos.y + rise) continue
        const d = Math.hypot(p[0] - this.pos.x, p[2] - this.pos.z)
        if (d > BOT_RECOVER_MAX_SEEK_M) continue
        const pen = Math.max(0, this.pos.y - p[1]) * 0.35
        // A knock's nearest cell is often the lip still ahead. Prefer floor
        // back along the launch, which is the level they just left.
        const sp = Math.hypot(this.vel.x, this.vel.z)
        const align = sp > 1 && d > 0.5
          ? -((p[0] - this.pos.x) * this.vel.x + (p[2] - this.pos.z) * this.vel.z) / (d * sp)
          : 0
        const score = d + pen - Math.max(0, align) * 8
        if (score < bestD) { bestD = score; best = { x: p[0], y: p[1], z: p[2] } }
      }
      return best
    }
    let best = pick(world.graph.deepNodes) ?? pick(world.graph.nodes)
    if (best && this.misjudge) {
      const dx = best.x - this.pos.x, dz = best.z - this.pos.z
      const d = Math.hypot(dx, dz) || 1
      best = { x: best.x + (-dz / d) * BOT_RECOVER_MISJUDGE_M, y: best.y, z: best.z + (dx / d) * BOT_RECOVER_MISJUDGE_M }
    }
    return best
  }

  /** Anvil-style integration: held force, gravity, floor snap, floor friction. */
  private physics(dt: number, world: BotWorld): void {
    if (this.forceLeft > 0) {
      this.vel.x += this.force.x * dt
      this.vel.y += this.force.y * dt
      this.vel.z += this.force.z * dt
      this.forceLeft -= dt
    }
    const wasGrounded = this.grounded && this.vel.y <= 0
    this.vel.y -= BOT_GRAVITY * dt
    if (this.phase === 'glide' && this.vel.y < -HUMAN_GLIDE_FALL) this.vel.y = -HUMAN_GLIDE_FALL
    const nx = this.pos.x + this.vel.x * dt
    const nz = this.pos.z + this.vel.z * dt
    let ny = this.pos.y + this.vel.y * dt
    const floor = graphFloorAt(world.graph, world.rampTiles, nx, nz, this.pos.y)
    this.grounded = false
    if (floor !== null && (ny <= floor || (wasGrounded && ny - floor <= SNAP_DOWN))) {
      ny = floor
      if (this.vel.y < 0) this.vel.y = 0
      this.grounded = true
    }
    this.pos = { x: nx, y: ny, z: nz }
    if (this.grounded) {
      const h = Math.hypot(this.vel.x, this.vel.z)
      const nh = Math.max(0, h - BOT_FRICTION * dt)
      if (h > 1e-4) { this.vel.x *= nh / h; this.vel.z *= nh / h } else { this.vel.x = 0; this.vel.z = 0 }
    }
  }
}
