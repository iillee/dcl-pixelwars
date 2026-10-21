/**
 * anvilSim.ts — server-authoritative anvil dummies (LUNGE_TEST_DUMMY), pure logic shared by the
 * server (server/anvils.ts runs it) and verify-lunge. Clients only render server snapshots
 * (client/lungeDummy.ts).
 *
 * Placement: LUNGE_DUMMY_COUNT anvils, each at the exact centre of a distinct random tile, any
 * level. Base tiles and teleporter tiles (whole grid square) are skipped; flat tiles first, ramps
 * only if there aren't enough flat ones. Random 0/90/180/270° yaw per anvil, rolled only when that
 * anvil (re)spawns. A fallen anvil respawns alone after LUNGE_DUMMY_RESPAWN_S.
 *
 * Knockback: v += impulse × LUNGE_DUMMY_UNIT, held force for LUNGE_KNOCK_FORCE_S, gravity, ground
 * friction; floor = highest walkable cell within ~1 cell under it (ramps: continuous slope height
 * via rampSurfaceY), grounded anvils snap down ≤ SNAP_DOWN (down-ramps), none → it falls.
 */
import {
  LUNGE_DUMMY_COUNT, LUNGE_DUMMY_UNIT, LUNGE_DUMMY_GRAVITY, LUNGE_DUMMY_FRICTION,
  LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S, LUNGE_DUMMY_RESPAWN_S,
  ANVIL_PUSH_HOLD_S,
} from './pvp'
import { WalkableGraph, rampSurfaceY } from './mazeGraph'
import { baseTeamOfTile, MIN_Y, CELL, MAZE_ORIGIN, STEP, Placed } from '../maze/generator'
import { TILES } from '../maze/tiles'
import { FALL_RESPAWN_DROP } from '../maze/level'

type V3 = { x: number; y: number; z: number }
export type Anvil = {
  pos: V3 // feet
  vel: V3
  forceLeft: number
  forceDir: { x: number; z: number }
  alive: boolean
  tracking: boolean // sliding from a knock
  hitFrom: { x: number; z: number }
  respawnIn: number // s until auto-respawn after a fall (< 0 = none)
  yaw: number
  slide: number // bumps on every accepted hit / respawn (client launch dedupe key)
  push: { x: number; z: number; left: number } // slow player push (m/s), active while left > 0
}

/** worldPos y of a walkable cell sits FLAT_OFFSET (0.55) above the tile; slab top ≈ +0.5. */
const FLOOR_FROM_NODE = -0.05
const STEP_UP = 0.6
const SNAP_DOWN = 0.6
const CELL_SIZE = 2 // CELL 32 / SIZE 16

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

export class AnvilWorld {
  anvils: Anvil[] = []
  private graph: WalkableGraph | null = null
  private tiles: Placed[] = []
  private rampTiles: Placed[] = []
  private noSpawn = new Set<string>()
  log: (s: string) => void = () => {}

  constructor(count = LUNGE_DUMMY_COUNT) {
    for (let i = 0; i < count; i++) this.anvils.push({
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, forceLeft: 0, forceDir: { x: 0, z: 0 },
      alive: false, tracking: false, hitFrom: { x: 0, z: 0 }, respawnIn: -1, yaw: 0, slide: 0, push: { x: 0, z: 0, left: 0 },
    })
  }

  /** New maze: graph + tiles + teleporter tiles (never spawn there), then re-roll all. */
  setMaze(graph: WalkableGraph | null, tiles: Placed[], teleporters: Placed[], respawn = true): void {
    this.graph = graph
    this.tiles = tiles
    this.rampTiles = tiles.filter(t => TILES[t.type].isRamp)
    this.noSpawn = new Set(teleporters.map(t => `${t.x},${t.z}`))
    if (respawn) this.respawnAll() // clients (prediction only) pass false
  }

  floorAt(x: number, z: number, y: number, r = CELL_SIZE * 0.6, maxUp = STEP_UP): number | null {
    if (!this.graph) return null
    let best: number | null = null
    for (const p of this.graph.worldPos.values()) {
      if (Math.abs(p[0] - x) > r || Math.abs(p[2] - z) > r) continue
      // Ramp node: continuous slope height at (x, z), not the stepped cell height.
      const ramp = this.rampTiles.find(t => p[1] > t.y && p[1] < t.y + STEP + 1 &&
        Math.abs(p[0] - (t.x * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2 && Math.abs(p[2] - (t.z * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2)
      const fy = (ramp ? rampSurfaceY(ramp, x, z) : p[1]) + FLOOR_FROM_NODE
      if (fy > y + maxUp) continue
      if (best === null || fy > best) best = fy
    }
    return best
  }

  private centreFloor(cx: number, cz: number, tileY: number, ramp: boolean): number | null {
    if (!this.graph) return null
    let best: number | null = null, bestD = CELL_SIZE * 1.1
    for (const p of this.graph.worldPos.values()) {
      if (!ramp && Math.abs(p[1] - tileY) > 1.5) continue
      const d = Math.hypot(p[0] - cx, p[2] - cz)
      if (d < bestD) { bestD = d; best = p[1] + FLOOR_FROM_NODE }
    }
    return best
  }

  /** Distinct random tile centres (flat first; no bases, no teleporter squares). */
  pickSpots(): V3[] {
    const flat: V3[] = [], ramps: V3[] = []
    const seen = new Set(this.noSpawn)
    for (const p of this.tiles) {
      const k = `${p.x},${p.z}`
      if (seen.has(k)) continue
      if (baseTeamOfTile(p.x, p.z, p.y) !== 0) continue
      const ramp = !!TILES[p.type].isRamp
      const cx = p.x * CELL + MAZE_ORIGIN + CELL / 2, cz = p.z * CELL + MAZE_ORIGIN + CELL / 2
      const fy = this.centreFloor(cx, cz, p.y + 0.55, ramp)
      if (fy === null) continue
      seen.add(k)
      ;(ramp ? ramps : flat).push({ x: cx, y: fy, z: cz })
    }
    return [...shuffle(flat), ...shuffle(ramps)]
  }

  private place(a: Anvil, s: V3 | undefined): void {
    a.vel = { x: 0, y: 0, z: 0 }; a.forceLeft = 0; a.tracking = false; a.respawnIn = -1; a.push.left = 0
    a.alive = !!s
    if (s) a.pos = { x: s.x, y: s.y, z: s.z }
    a.yaw = 90 * Math.floor(Math.random() * 4) // this anvil's own roll
    a.slide++
  }

  /** Key 2 / new maze: every anvil to a new random tile, independent yaw each. */
  respawnAll(): void {
    const spots = this.pickSpots()
    this.anvils.forEach((a, i) => this.place(a, spots[i]))
    this.log(`[Anvil] respawned ${this.anvils.filter(a => a.alive).length}`)
  }

  respawnOne(i: number): void {
    const others = this.anvils.filter((o, j) => j !== i && o.alive)
    const spots = this.pickSpots()
    const s = spots.find(p => others.every(o => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) > CELL)) ?? spots[0]
    this.place(this.anvils[i], s)
    this.log(`[Anvil ${i}] auto-respawned yaw ${this.anvils[i].yaw}°`)
  }

  /** Accepted hit (lunge mult 1; burst BURST_KNOCKBACK / LUNGE_KNOCKBACK). */
  hit(i: number, dx: number, dz: number, mult = 1): boolean {
    const a = this.anvils[i]
    if (!a || !a.alive) return false
    const k = LUNGE_DUMMY_UNIT * mult
    a.vel.x += dx * LUNGE_KNOCKBACK * k
    a.vel.z += dz * LUNGE_KNOCKBACK * k
    a.vel.y += LUNGE_KNOCK_LIFT * k
    a.forceDir = { x: dx, z: dz }
    a.forceLeft = LUNGE_KNOCK_FORCE > 0 ? LUNGE_KNOCK_FORCE_S : 0
    a.hitFrom = { x: a.pos.x, z: a.pos.z }
    a.tracking = true
    a.slide++
    return true
  }

  /** Slow push (vx, vz in m/s): held for ANVIL_PUSH_HOLD_S. Ignored while a knock slide is running. */
  push(i: number, vx: number, vz: number): boolean {
    const a = this.anvils[i]
    if (!a || !a.alive || a.tracking || a.forceLeft > 0) return false
    a.push = { x: vx, z: vz, left: ANVIL_PUSH_HOLD_S }
    return true
  }

  /** Horizontal velocity including an active push (for snapshots / extrapolation). */
  pushVel(a: Anvil): { x: number; z: number } { return a.push.left > 0 ? { x: a.push.x, z: a.push.z } : { x: 0, z: 0 } }

  isMoving(a: Anvil): boolean { return a.alive && (a.forceLeft > 0 || a.tracking || a.vel.y !== 0 || a.push.left > 0) }

  /** Advance all anvils by dt (sub-stepped ≤ 50 ms). Handles falls and timed respawns. */
  tick(dt: number): void {
    this.anvils.forEach((a, i) => {
      if (a.respawnIn >= 0) { a.respawnIn -= dt; if (a.respawnIn < 0) this.respawnOne(i) }
    })
    for (let left = Math.min(Number.isFinite(dt) ? dt : 0, 1), n = 0; left > 1e-6 && n < 40; left -= 0.05, n++) {
      const sdt = Math.min(left, 0.05)
      this.anvils.forEach((a, i) => this.step(a, i, sdt))
    }
  }

  private step(a: Anvil, i: number, dt: number): void {
    if (!this.isMoving(a)) return
    if (a.forceLeft > 0) {
      const acc = LUNGE_KNOCK_FORCE * LUNGE_DUMMY_UNIT
      a.vel.x += a.forceDir.x * acc * dt
      a.vel.z += a.forceDir.z * acc * dt
      a.forceLeft -= dt
    }
    let px = 0, pz = 0
    if (a.push.left > 0) {
      a.push.left -= dt
      // Wall check: the anvil's leading edge (≈0.9 m ahead) must not meet a floor higher than a step.
      const pl = Math.hypot(a.push.x, a.push.z)
      if (pl > 1e-4 && a.vel.y === 0) {
        const lx = a.pos.x + a.push.x / pl * 0.9, lz = a.pos.z + a.push.z / pl * 0.9
        const high = this.floorAt(lx, lz, a.pos.y, 0.6, 100)
        if (high === null || high <= a.pos.y + STEP_UP) { px = a.push.x * dt; pz = a.push.z * dt }
      }
    }
    const wasGrounded = a.vel.y === 0
    a.vel.y -= LUNGE_DUMMY_GRAVITY * dt
    const nx = a.pos.x + a.vel.x * dt + px, nz = a.pos.z + a.vel.z * dt + pz
    let ny = a.pos.y + a.vel.y * dt
    const floor = this.floorAt(nx, nz, a.pos.y)
    let grounded = false
    if (floor !== null && (ny <= floor || (wasGrounded && ny - floor <= SNAP_DOWN))) { ny = floor; a.vel.y = 0; grounded = true }
    a.pos = { x: nx, y: ny, z: nz }
    if (grounded) {
      const h = Math.hypot(a.vel.x, a.vel.z)
      const nh = Math.max(0, h - LUNGE_DUMMY_FRICTION * dt)
      if (h > 1e-4) { a.vel.x *= nh / h; a.vel.z *= nh / h } else { a.vel.x = 0; a.vel.z = 0 }
      if (a.tracking && nh === 0 && a.forceLeft <= 0) {
        a.tracking = false
        this.log(`[Anvil ${i}] stopped after ${Math.hypot(a.pos.x - a.hitFrom.x, a.pos.z - a.hitFrom.z).toFixed(2)} m`)
      }
    }
    if (a.pos.y < MIN_Y - FALL_RESPAWN_DROP) {
      a.alive = false
      a.tracking = false
      a.vel = { x: 0, y: 0, z: 0 }
      a.respawnIn = LUNGE_DUMMY_RESPAWN_S
      this.log(`[Anvil ${i}] fell off — respawning in ${LUNGE_DUMMY_RESPAWN_S} s`)
    }
  }
}
