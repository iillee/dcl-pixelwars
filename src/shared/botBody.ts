/**
 * botBody.ts — a ghost bot's physical body, run by the server.
 *
 * Modes:
 *   walk    the bot's legs (server/bots/bot.ts path stepping) drive the position.
 *   knock   a hit landed (shared/knocks.ts, same numbers a human victim gets): velocity,
 *           a held force, gravity and floor friction, exactly like the anvils. No floor
 *           under it = it falls. Back on a floor and slow = walk again.
 *   rescue  crossed the fall line: rides the Lakitu cloud home along the shared path
 *           (shared/rescuePath.ts) that every client draws for it.
 *   drop    the cloud let go above the base: falls onto it, then a land hold and
 *           respawn immunity, like a human arriving home.
 */
import { WalkableGraph, leapPlan } from './mazeGraph'
import { graphFloorAt } from './anvilSim'
import { MIN_Y, Placed } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import {
  RESPAWN_IMMUNITY_S, BOT_KNOCK_UNIT, BOT_GRAVITY, BOT_FRICTION, BOT_RECOVER_SPEED, AIR_SPIKE_GLIDE_LOCK_S,
  BOT_RECOVER_CHANCE, BOT_RECOVER_REACT_S, BOT_AIR_ACCEL, BOT_GLIDE_SPEED, BOT_GLIDE_FALL, BOT_AIR_JUMP_V,
  BOT_JUMP_V, AIR_SPIKE_DIVE_IMPULSE, AIR_SPIKE_DIVE_FORWARD, AIR_SPIKE_DIVE_FORCE, AIR_SPIKE_DIVE_FORCE_S,
} from './pvp'
import { KnockSpec, KnockTrace, KNOCK_TRACE } from './knocks'
import { RESCUE_PATH, rescueCloudPose, RescueVec } from './rescuePath'

type V3 = RescueVec
export type BotBodyMode = 'walk' | 'knock' | 'rescue' | 'drop'
export type BotBodyEvent =
  | { type: 'settled' }              // knock over, standing on a floor: re-seat on the graph
  | { type: 'fell'; catch: V3 }      // crossed the fall line: the cloud trip starts here
  | { type: 'landed' }               // home on the base after the cloud
  | { type: 'trace'; line: string }  // KNOCK_TRACE result
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
  /** This knock: will the bot try to glide back, after how long, toward which floor point. */
  private willRecover = false
  private reactLeft = 0
  private recoverTo: V3 | null = null
  /** Random source for the recover roll (scripts pass a fixed one). */
  rng: () => number = Math.random

  constructor(pos: V3) { this.pos = { ...pos } }

  /** Gliding back toward a floor right now. */
  isGliding(): boolean { return this.mode === 'knock' && this.recoverTo !== null && !this.grounded }

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
    this.willRecover = this.rng() < BOT_RECOVER_CHANCE
    this.reactLeft = BOT_RECOVER_REACT_S
    this.recoverTo = null
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
    this.willRecover = false
    this.recoverTo = null
  }

  private beginAir(vx: number, vy: number, vz: number): void {
    this.mode = 'knock'
    this.grounded = false
    this.vel = { x: vx, y: vy, z: vz }
    this.forceLeft = 0
    this.lockLeft = 0
    this.dashLeft = 0
    this.willRecover = false
    this.recoverTo = null
    this.reactLeft = 0
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
    // Each hit re-rolls the attempt and restarts the reaction, like a player re-reacting.
    this.willRecover = this.rng() < BOT_RECOVER_CHANCE
    this.reactLeft = Math.max(spec.lockS, spec.kind === 'spike' ? AIR_SPIKE_GLIDE_LOCK_S : 0) + BOT_RECOVER_REACT_S
    this.recoverTo = null
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
        } else if (this.reactLeft > 0) this.reactLeft -= dt
        this.steerRecovery(dt, world)
        this.physics(dt, world)
        if (this.lockLeft > 0) this.lockLeft -= dt
        if (this.pos.y < MIN_Y - FALL_RESPAWN_DROP) {
          this.mode = 'rescue'
          this.rescueAge = 0
          this.catchP = { ...this.pos }
          this.base = { ...world.base }
          this.vel = { x: 0, y: 0, z: 0 }; this.forceLeft = 0
          out.push({ type: 'fell', catch: { ...this.catchP } })
          return
        }
        if (this.grounded) this.recoverTo = null
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

  /** Player-style recovery: over the void, once the reaction is up, spend the air jump,
   *  open the glider (fall capped at BOT_GLIDE_FALL) and steer toward the nearest floor.
   *  Gives up once it has sunk below that floor; then it just falls. */
  private steerRecovery(dt: number, world: BotWorld): void {
    if (!this.willRecover || this.reactLeft > 0 || this.grounded) return
    if (!this.recoverTo) {
      if (graphFloorAt(world.graph, world.rampTiles, this.pos.x, this.pos.z, this.pos.y, 1.2, 0) !== null) return
      this.recoverTo = this.nearestFloor(world)
      if (!this.recoverTo) { this.willRecover = false; return }
      this.vel.y = Math.max(this.vel.y, BOT_AIR_JUMP_V)
    }
    const t = this.recoverTo
    if (this.pos.y < t.y - 1.5) { this.willRecover = false; this.recoverTo = null; return }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d > 0.05) {
      // Desired velocity toward the floor point; air control closes the gap at BOT_AIR_ACCEL.
      const want = Math.min(BOT_GLIDE_SPEED, d * 3)
      const ex = (dx / d) * want - this.vel.x, ez = (dz / d) * want - this.vel.z
      const el = Math.hypot(ex, ez)
      const a = Math.min(el, BOT_AIR_ACCEL * dt)
      if (el > 1e-4) { this.vel.x += (ex / el) * a; this.vel.z += (ez / el) * a }
    }
    if (this.vel.y < -BOT_GLIDE_FALL) this.vel.y = -BOT_GLIDE_FALL
  }

  /** Nearest deep walkable cell not above the air-jump apex. */
  private nearestFloor(world: BotWorld): V3 | null {
    const apex = (BOT_AIR_JUMP_V * BOT_AIR_JUMP_V) / (2 * BOT_GRAVITY)
    let best: V3 | null = null, bestD = Infinity
    for (const id of world.graph.deepNodes) {
      const p = world.graph.worldPos.get(id)
      if (!p || p[1] > this.pos.y + apex - 0.2) continue
      const d = Math.hypot(p[0] - this.pos.x, p[2] - this.pos.z)
      if (d < bestD) { bestD = d; best = { x: p[0], y: p[1], z: p[2] } }
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
