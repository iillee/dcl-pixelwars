/**
 * lungeDummy.ts — client-local Lunge test dummies (LUNGE_TEST_DUMMY,
 * LUNGE_DUMMY_COUNT in shared/pvp.ts). No server, nobody else sees them.
 *
 * Placement: LUNGE_DUMMY_COUNT anvils (Luke's Creator Hub asset
 * assets/asset-packs/anvil/Anvil_01/Anvil_01.glb, ×ANVIL_SCALE, no collider),
 * each at the exact centre of a distinct random tile, any level. Base
 * tiles (where players spawn) are skipped; flat tiles first, ramps only if
 * there aren't enough flat ones; a tile whose centre has no walkable cell
 * is skipped. Floor y = the walkable cell at the centre (shared/mazeGraph,
 * same graph the server bots use). Re-rolled to NEW random tiles on maze
 * rebuild, team change and key 2. A dummy that falls off respawns on its own
 * after LUNGE_DUMMY_RESPAWN_S at a random free tile centre (same picker).
 *
 * Knockback: client/lunge.ts hits each dummy once per lunge like a real
 * target; each gets the SAME LUNGE_KNOCK* values the victim client would
 * apply, through a small kinematic sim:
 *   v += impulse × LUNGE_DUMMY_UNIT (assumed m/s per impulse unit),
 *   held force → acceleration force × LUNGE_DUMMY_UNIT for LUNGE_KNOCK_FORCE_S,
 *   gravity, ground friction while grounded; floor = highest walkable cell
 *   within ~1 cell under it, none → it falls. Below the fall-respawn height
 *   a dummy hides, then auto-respawns. Logs travel distance per hit.
 */

import { engine, Entity, GltfContainer, ColliderLayer, Transform, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { Team } from '../shared/team'
import {
  LUNGE_TEST_DUMMY, LUNGE_DUMMY_COUNT, LUNGE_DUMMY_UNIT, LUNGE_DUMMY_GRAVITY, LUNGE_DUMMY_FRICTION,
  LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S, LUNGE_DUMMY_RESPAWN_S,
} from '../shared/pvp'
import { buildWalkableGraph, WalkableGraph, rampSurfaceY } from '../shared/mazeGraph'
import { getPlacedTilesInOrder, baseTeamOfTile, MIN_Y, CELL, MAZE_ORIGIN, STEP, Placed } from '../maze/generator'
import { TILES } from '../maze/tiles'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'
import { localTeam } from './knockback'
import { teleporterTiles } from '../teleportOrbs'

/** Anvil model (Creator Hub asset pack). GLB bounds: x −0.50…0.63, y 0…0.77 (origin at its
 *  base), z ±0.35 m. Scaled ×ANVIL_SCALE → ≈1.7 × 1.15 × 1.06 m; ANVIL_OFFSET_X centres the
 *  horn-heavy x extent on the dummy's feet point. The hit point (feet) is unchanged. */
const ANVIL_SRC = 'assets/asset-packs/anvil/Anvil_01/Anvil_01.glb'
const ANVIL_SCALE = 1.5
const ANVIL_OFFSET_X = -0.07 * ANVIL_SCALE
const HIDDEN = Vector3.create(8, -50, 8)
/** worldPos y of a walkable cell sits FLAT_OFFSET (0.55) above the tile; slab top ≈ +0.5. */
const FLOOR_FROM_NODE = -0.05
const STEP_UP = 0.6
const SNAP_DOWN = 0.6 // grounded dummy sticks to a floor up to this far below (down-ramps)
const CELL_SIZE = 2 // shared/mazeGraph: CELL 32 / SIZE 16

type Dummy = {
  ent: Entity
  pos: { x: number; y: number; z: number } // feet
  vel: { x: number; y: number; z: number }
  forceLeft: number
  forceDir: { x: number; z: number }
  alive: boolean
  tracking: boolean
  hitFrom: { x: number; z: number }
  respawnIn: number // s until auto-respawn after a fall (< 0 = none)
  yaw: number // this dummy's own 0/90/180/270° roll; changes only when THIS dummy (re)spawns
}
const dummies: Dummy[] = []
let graph: WalkableGraph | null = null
let graphSeed = -1
let rampTiles: Placed[] = []
let graphTeam: Team = Team.None

export function isDummyEnabled(): boolean { return LUNGE_TEST_DUMMY }

/** Live dummies' feet positions (lunge.ts boxHit targets). */
export function getDummyTargets(): Array<{ i: number; pos: { x: number; y: number; z: number } }> {
  const out: Array<{ i: number; pos: { x: number; y: number; z: number } }> = []
  dummies.forEach((d, i) => { if (d.alive) out.push({ i, pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z } }) })
  return out
}

function floorAt(x: number, z: number, y: number): number | null {
  if (!graph) return null
  let best: number | null = null
  for (const p of graph.worldPos.values()) {
    if (Math.abs(p[0] - x) > CELL_SIZE * 0.6 || Math.abs(p[2] - z) > CELL_SIZE * 0.6) continue
    // Ramp node: use the continuous slope height at (x, z), not the node's stepped cell height
    // (ramp nodes rise ~0.7 m per cell > STEP_UP, which made uphill slides pass through and fall).
    const ramp = rampTiles.find(t => p[1] > t.y && p[1] < t.y + STEP + 1 &&
      Math.abs(p[0] - (t.x * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2 && Math.abs(p[2] - (t.z * CELL + MAZE_ORIGIN + CELL / 2)) < CELL / 2)
    const fy = (ramp ? rampSurfaceY(ramp, x, z) : p[1]) + FLOOR_FROM_NODE
    if (fy > y + STEP_UP) continue
    if (best === null || fy > best) best = fy
  }
  return best
}

/** Floor at a tile centre: walkable cell nearest the centre, within ~1 cell, tile's own level. */
function centreFloor(cx: number, cz: number, tileY: number, ramp: boolean): number | null {
  if (!graph) return null
  let best: number | null = null, bestD = CELL_SIZE * 1.1
  for (const p of graph.worldPos.values()) {
    if (!ramp && Math.abs(p[1] - tileY) > 1.5) continue
    const d = Math.hypot(p[0] - cx, p[2] - cz)
    if (d < bestD) { bestD = d; best = p[1] + FLOOR_FROM_NODE }
  }
  return best
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Up to LUNGE_DUMMY_COUNT distinct random tile centres (flat first, no bases). */
function pickSpots(): Array<{ x: number; y: number; z: number }> {
  const flat: Array<{ x: number; y: number; z: number }> = []
  const ramps: Array<{ x: number; y: number; z: number }> = []
  // Never on a teleporter: skip its whole grid square (any level). The pad (1.2 m trigger at the
  // tile centre) can't overlap a neighbouring tile, so no neighbours need excluding.
  const seen = new Set<string>(teleporterTiles().map(t => `${t.x},${t.z}`))
  for (const p of getPlacedTilesInOrder()) {
    const k = `${p.x},${p.z}`
    if (seen.has(k)) continue // stacked tiles: one dummy per grid square
    if (baseTeamOfTile(p.x, p.z, p.y) !== 0) continue
    const ramp = !!TILES[p.type].isRamp
    const cx = p.x * CELL + MAZE_ORIGIN + CELL / 2
    const cz = p.z * CELL + MAZE_ORIGIN + CELL / 2
    const fy = centreFloor(cx, cz, p.y + 0.55, ramp)
    if (fy === null) continue
    seen.add(k)
    ;(ramp ? ramps : flat).push({ x: cx, y: fy, z: cz })
  }
  return [...shuffle(flat), ...shuffle(ramps)].slice(0, LUNGE_DUMMY_COUNT)
}

/** Random yaw in 90° steps, re-picked on every spawn. Rotates the root, so the anvil model and
 *  its collider (child, with the x offset in local space) turn together around the feet point,
 *  which stays the tile centre. Hitbox/physics use only position, so they are unchanged. */
function randomYaw(d: Dummy): void {
  d.yaw = 90 * Math.floor(Math.random() * 4)
}

function place(d: Dummy): void {
  const tr = Transform.getMutable(d.ent)
  tr.position = d.alive ? Vector3.create(d.pos.x, d.pos.y, d.pos.z) : HIDDEN // root at the feet; anvil base sits on the floor
  tr.rotation = Quaternion.fromEulerDegrees(0, d.yaw, 0) // per-dummy, stored, re-applied every placement
}

/** Re-roll every dummy onto new random tile centres (key 2 / rebuild / team change). */
export function respawnDummy(): void {
  if (!LUNGE_TEST_DUMMY || dummies.length === 0) return
  if (!graph) { console.log('[Dummy] no maze yet'); return }
  const spots = pickSpots()
  dummies.forEach((d, i) => {
    const s = spots[i]
    d.vel = { x: 0, y: 0, z: 0 }
    d.forceLeft = 0
    d.tracking = false
    d.respawnIn = -1
    d.alive = !!s
    randomYaw(d)
    console.log(`[Dummy ${i}] respawn yaw ${d.yaw}°`)
    if (s) d.pos = { x: s.x, y: s.y, z: s.z }
    place(d)
  })
  console.log(`[Dummy] respawned ${spots.length}: ${spots.map(s => `${s.x.toFixed(0)},${s.y.toFixed(1)},${s.z.toFixed(0)}`).join('  ')}`)
}

/** Auto-respawn one fallen dummy at a random tile centre (same picker), away from the others. */
function respawnOne(i: number): void {
  const d = dummies[i]
  d.respawnIn = -1
  if (!graph) return
  const others = dummies.filter((o, j) => j !== i && o.alive)
  const s = pickSpots().find(p => others.every(o => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) > CELL)) ?? pickSpots()[0]
  if (!s) return
  d.vel = { x: 0, y: 0, z: 0 }
  d.forceLeft = 0
  d.tracking = false
  d.pos = { x: s.x, y: s.y, z: s.z }
  d.alive = true
  randomYaw(d)
  place(d)
  console.log(`[Dummy ${i}] auto-respawned at ${s.x.toFixed(0)},${s.y.toFixed(1)},${s.z.toFixed(0)} yaw ${d.yaw}°`)
}

/** Lunge hit on dummy i: same values the victim client gets, × LUNGE_DUMMY_UNIT. */
export function hitDummy(i: number, dx: number, dz: number, mult = 1): void {
  const d = dummies[i]
  if (!d || !d.alive) return
  const k = LUNGE_DUMMY_UNIT * mult // mult: Paint Burst passes BURST_KNOCKBACK / LUNGE_KNOCKBACK
  d.vel.x += dx * LUNGE_KNOCKBACK * k
  d.vel.z += dz * LUNGE_KNOCKBACK * k
  d.vel.y += LUNGE_KNOCK_LIFT * k
  d.forceDir = { x: dx, z: dz }
  d.forceLeft = LUNGE_KNOCK_FORCE > 0 ? LUNGE_KNOCK_FORCE_S : 0
  d.hitFrom = { x: d.pos.x, z: d.pos.z }
  d.tracking = true
  console.log(`[Dummy ${i}] hit: v0 ${Math.hypot(d.vel.x, d.vel.z).toFixed(1)} m/s horizontal, ${d.vel.y.toFixed(1)} up (unit ${k})`)
}

function step(d: Dummy, i: number, dt: number): void {
  if (!d.alive) return
  if (d.forceLeft <= 0 && !d.tracking && d.vel.y === 0) return // resting
  if (d.forceLeft > 0) {
    const a = LUNGE_KNOCK_FORCE * LUNGE_DUMMY_UNIT
    d.vel.x += d.forceDir.x * a * dt
    d.vel.z += d.forceDir.z * a * dt
    d.forceLeft -= dt
  }
  const wasGrounded = d.vel.y === 0
  d.vel.y -= LUNGE_DUMMY_GRAVITY * dt
  const nx = d.pos.x + d.vel.x * dt, nz = d.pos.z + d.vel.z * dt
  let ny = d.pos.y + d.vel.y * dt
  const floor = floorAt(nx, nz, d.pos.y)
  let grounded = false
  if (floor !== null && (ny <= floor || (wasGrounded && ny - floor <= SNAP_DOWN))) { ny = floor; d.vel.y = 0; grounded = true }
  d.pos = { x: nx, y: ny, z: nz }
  if (grounded) {
    const h = Math.hypot(d.vel.x, d.vel.z)
    const nh = Math.max(0, h - LUNGE_DUMMY_FRICTION * dt)
    if (h > 1e-4) { d.vel.x *= nh / h; d.vel.z *= nh / h } else { d.vel.x = 0; d.vel.z = 0 }
    if (d.tracking && nh === 0 && d.forceLeft <= 0) {
      d.tracking = false
      console.log(`[Dummy ${i}] stopped after ${Math.hypot(d.pos.x - d.hitFrom.x, d.pos.z - d.hitFrom.z).toFixed(2)} m`)
    }
  }
  if (d.pos.y < MIN_Y - FALL_RESPAWN_DROP) {
    d.alive = false
    d.respawnIn = LUNGE_DUMMY_RESPAWN_S
    console.log(`[Dummy ${i}] fell off after ${Math.hypot(d.pos.x - d.hitFrom.x, d.pos.z - d.hitFrom.z).toFixed(2)} m horizontal — respawning in ${LUNGE_DUMMY_RESPAWN_S} s`)
  }
  place(d)
}

export function initLungeDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  for (let i = 0; i < LUNGE_DUMMY_COUNT; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN })
    const model = engine.addEntity()
    Transform.create(model, { parent: ent, position: Vector3.create(ANVIL_OFFSET_X, 0, 0), scale: Vector3.create(ANVIL_SCALE, ANVIL_SCALE, ANVIL_SCALE) })
    // Solid for players: the GLB's own invisible collision mesh (Anvil_01_collider) on CL_PHYSICS.
    // It is a child of the dummy root, so it moves with the dummy. The dummy's own motion uses the
    // walk graph (no raycasts), so it can't hit itself.
    GltfContainer.create(model, { src: ANVIL_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
    dummies.push({ ent, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, forceLeft: 0, forceDir: { x: 0, z: 0 },
      alive: false, tracking: false, hitFrom: { x: 0, z: 0 }, respawnIn: -1, yaw: 0 })
  }
  engine.addSystem((dt: number) => {
    const seed = getCurrentSeed()
    const team = localTeam()
    if (!isRebuilding() && seed !== graphSeed && getPlacedTilesInOrder().length > 0) {
      graph = buildWalkableGraph(getPlacedTilesInOrder())
      rampTiles = getPlacedTilesInOrder().filter(t => TILES[t.type].isRamp)
      graphSeed = seed
      if (team !== Team.None) respawnDummy()
    }
    if (team !== graphTeam && graph) {
      graphTeam = team
      if (team !== Team.None) respawnDummy()
    }
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) respawnDummy()
    const sdt = Math.min(dt, 0.05)
    dummies.forEach((d, i) => {
      if (d.respawnIn >= 0) { d.respawnIn -= dt; if (d.respawnIn < 0) respawnOne(i) }
      step(d, i, sdt)
    })
  })
}
