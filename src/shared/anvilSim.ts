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
 * via rampSurfaceY), grounded anvils snap down ≤ SNAP_DOWN (down-ramps). The tile's non-walkable
 * margin is a wall only where the next tile is floor or a taller side: a step into that is stopped,
 * and a body that has sunk through the slab (less than a level) is snapped back up. The outer lip,
 * where nothing at this height continues, is a drop — knocked bodies fly off and fall. Already
 * below the fall line → it falls.
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

/** How far below a walkable surface still counts as "inside the slab", not the next level (~10.8 m). */
const RECOVER_UP = 2.5
/** Above a wall top by this much, a body may fly over the margin instead of being stopped. */
const WALL_OVER = 0.4
/** A walkable node covers its own 2 m cell (centre to edge is 1 m). Past that is the wall margin. */
const WALL_REACH = 1.05

/** Highest walkable floor within `r` of (x, z) that is no more than `maxUp` above `y`, or null over the void.
 *  Shared by the anvils and the bot bodies (shared/botBody.ts). */
export function graphFloorAt(graph: WalkableGraph, rampTiles: Placed[], x: number, z: number, y: number,
  r = CELL_SIZE * 0.6, maxUp = STEP_UP): number | null {
  let best: number | null = null
  for (const p of graph.worldPos.values()) {
    if (Math.abs(p[0] - x) > r || Math.abs(p[2] - z) > r) continue
    // Ramp node: continuous slope height at (x, z), not the stepped cell height.
    const ramp = rampTiles.find(t => p[1] > t.y && p[1] < t.y + STEP + 1 &&
      Math.abs(p[0] - (t.x * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2 && Math.abs(p[2] - (t.z * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2)
    const fy = (ramp ? rampSurfaceY(ramp, x, z) : p[1]) + FLOOR_FROM_NODE
    if (fy > y + maxUp) continue
    if (best === null || fy > best) best = fy
  }
  return best
}

/** Walkable-surface Y of a tile at (x, z): flat slab top, or the ramp slope. Feet frame (FLOOR_FROM_NODE). */
function tileSurfaceY(tile: Placed, x: number, z: number): number {
  const nodeY = TILES[tile.type].isRamp ? rampSurfaceY(tile, x, z) : tile.y + 0.55
  return nodeY + FLOOR_FROM_NODE
}

/** Tile whose footprint contains (x, z) and whose slab could still contain a body at `y`.
 *  Highest such tile. Null in the void and when `y` is clearly above that slab (flying over). */
function tileContaining(tiles: Placed[], x: number, z: number, y: number): Placed | null {
  let best: Placed | null = null
  for (const t of tiles) {
    const x0 = t.x * CELL + MAZE_ORIGIN
    const z0 = t.z * CELL + MAZE_ORIGIN
    if (x < x0 || x >= x0 + CELL || z < z0 || z >= z0 + CELL) continue
    const top = tileSurfaceY(t, x, z)
    if (y > top + WALL_OVER) continue
    if (y < t.y - 2) continue
    if (!best || t.y > best.y) best = t
  }
  return best
}

/** Closest walkable node within `r` whose feet are near `y`. Null out in the void. */
function nearestFloorNode(graph: WalkableGraph, x: number, z: number, y: number, r: number): { x: number; z: number; y: number } | null {
  let best: { x: number; z: number; y: number } | null = null
  let bestD = r * r
  for (const p of graph.worldPos.values()) {
    const d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z)
    if (d > bestD) continue
    const fy = p[1] + FLOOR_FROM_NODE
    if (fy > y + RECOVER_UP || fy < y - 1.5) continue
    bestD = d
    best = { x: p[0], z: p[2], y: fy }
  }
  return best
}

/** Tile whose walkable surface is the floor under (x, z) at `y`. */
function tileAtFeet(tiles: Placed[], x: number, z: number, y: number): Placed | null {
  let best: Placed | null = null
  for (const t of tiles) {
    const x0 = t.x * CELL + MAZE_ORIGIN
    const z0 = t.z * CELL + MAZE_ORIGIN
    if (x < x0 || x >= x0 + CELL || z < z0 || z >= z0 + CELL) continue
    if (Math.abs(tileSurfaceY(t, x, z) - y) > 2.5) continue
    if (!best || t.y > best.y) best = t
  }
  return best
}

/** Neighbour grid cell has a floor at or above `floorY` (same deck, or a taller tile's side). */
function neighborSolid(tiles: Placed[], gx: number, gz: number, floorY: number): boolean {
  const sx = gx * CELL + MAZE_ORIGIN + CELL / 2
  const sz = gz * CELL + MAZE_ORIGIN + CELL / 2
  for (const t of tiles) {
    if (t.x !== gx || t.z !== gz) continue
    if (tileSurfaceY(t, sx, sz) >= floorY - 1) return true
  }
  return false
}

/**
 * Past the walkable cell, and the next tile outward is void or a lower level.
 * That lip is a drop-off: don't stop on it and don't snap back onto it.
 * An interior margin (floor or a taller tile in the next cell) is not a drop.
 */
function dropLip(graph: WalkableGraph, rampTiles: Placed[], tiles: Placed[], x: number, z: number, y: number): boolean {
  if (!tiles.length) return false
  if (graphFloorAt(graph, rampTiles, x, z, y, WALL_REACH, RECOVER_UP) !== null) return false
  const node = nearestFloorNode(graph, x, z, y, 12)
  if (!node) return true
  const home = tileAtFeet(tiles, node.x, node.z, node.y)
  if (!home) return true
  const dx = x - node.x, dz = z - node.z
  let backed = false
  if (Math.abs(dx) > 0.4) backed = neighborSolid(tiles, home.x + Math.sign(dx), home.z, node.y)
  if (!backed && Math.abs(dz) > 0.4) backed = neighborSolid(tiles, home.x, home.z + Math.sign(dz), node.y)
  return !backed
}

/** Wall margin: inside a tile, at or below its top, not on a walkable cell, and backed by
 *  floor or a taller tile. A perimeter lip (nothing at this height beyond) is not a wall.
 *  Returns the lip height, or null when the body may occupy this point. */
function wallTopAt(graph: WalkableGraph, rampTiles: Placed[], tiles: Placed[], x: number, z: number, y: number): number | null {
  if (!tiles.length) return null
  const tile = tileContaining(tiles, x, z, y)
  if (!tile) return null
  // Still on a walkable cell (the node covers the whole 2 m cell). Not a wall.
  if (graphFloorAt(graph, rampTiles, x, z, y, WALL_REACH, RECOVER_UP) !== null) return null
  if (dropLip(graph, rampTiles, tiles, x, z, y)) return null
  return tileSurfaceY(tile, x, z)
}

/** Stop a horizontal step at the corridor wall. Axis slide, so a graze keeps the free component.
 *  Already inside the margin: hold the previous XZ and let gravity carry the body out (rescue). */
function clampWall(graph: WalkableGraph, rampTiles: Placed[], tiles: Placed[],
  prev: { x: number; y: number; z: number }, nx: number, nz: number): { x: number; z: number } {
  const blocked = (x: number, z: number) => wallTopAt(graph, rampTiles, tiles, x, z, prev.y) !== null
  if (!blocked(nx, nz)) return { x: nx, z: nz }
  if (!blocked(nx, prev.z)) return { x: nx, z: prev.z }
  if (!blocked(prev.x, nz)) return { x: prev.x, z: nz }
  return { x: prev.x, z: prev.z }
}

/**
 * One integration step for a server body (bot or anvil), after velocity was updated.
 * Lands on the walkable surface, refuses an interior wall (the next tile is floor or
 * a taller side), and snaps a body that has sunk through a slab (less than a level)
 * back onto it. A perimeter lip is not a wall and is not snapped back onto, so a knock
 * flies off and falls. A floor a full level up is out of RECOVER_UP, so an open gap
 * under a bridge is still a fall.
 */
export function resolveSupport(graph: WalkableGraph, rampTiles: Placed[], tiles: Placed[],
  prev: { x: number; y: number; z: number }, nx: number, ny: number, nz: number, velY: number, wasGrounded: boolean,
): { x: number; y: number; z: number; velY: number; grounded: boolean } {
  const stopped = clampWall(graph, rampTiles, tiles, prev, nx, nz)
  let y = ny
  let vy = velY
  let grounded = false
  // A floor found just past a drop lip is the deck we are leaving, not support.
  const lip = (at: number) => dropLip(graph, rampTiles, tiles, stopped.x, stopped.z, at)
  let floor = graphFloorAt(graph, rampTiles, stopped.x, stopped.z, prev.y)
  if (floor !== null && lip(floor)) floor = null
  if (floor !== null && (y <= floor || (wasGrounded && y - floor <= SNAP_DOWN))) {
    y = floor
    if (vy < 0) vy = 0
    grounded = true
  } else {
    // Below a surface we should be standing on. The 0.6 m step limit hides it once
    // a step has already dropped through; a level gap is still too far to grab.
    // Not past a drop lip — that nearby floor is behind us, and pulling back up
    // would pin a knock to the outer edge.
    let overhead = graphFloorAt(graph, rampTiles, stopped.x, stopped.z, y, CELL_SIZE * 0.6, RECOVER_UP)
    if (overhead !== null && lip(overhead)) overhead = null
    if (overhead !== null && overhead > y && vy <= 0) {
      y = overhead
      vy = 0
      grounded = true
    }
  }
  return { x: stopped.x, y, z: stopped.z, velY: vy, grounded }
}

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
    return this.graph ? graphFloorAt(this.graph, this.rampTiles, x, z, y, r, maxUp) : null
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
    const ny = a.pos.y + a.vel.y * dt
    let grounded = false
    if (this.graph) {
      const hit = resolveSupport(this.graph, this.rampTiles, this.tiles, a.pos, nx, ny, nz, a.vel.y, wasGrounded)
      a.pos = { x: hit.x, y: hit.y, z: hit.z }
      a.vel.y = hit.velY
      grounded = hit.grounded
    } else {
      a.pos = { x: nx, y: ny, z: nz }
    }
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
