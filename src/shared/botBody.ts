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
import { WalkableGraph } from './mazeGraph'
import { graphFloorAt } from './anvilSim'
import { MIN_Y, Placed } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { RESPAWN_IMMUNITY_S, BOT_KNOCK_UNIT, BOT_GRAVITY, BOT_FRICTION, BOT_RECOVER_SPEED } from './pvp'
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

  constructor(pos: V3) { this.pos = { ...pos } }

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
