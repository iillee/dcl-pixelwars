/**
 * lungeDummy.ts — client-local Lunge test dummies (LUNGE_TEST_DUMMY,
 * LUNGE_DUMMY_COUNT in shared/pvp.ts). No server, nobody else sees them.
 *
 * Placement: LUNGE_DUMMY_COUNT opponent-coloured 0.8 × 1.8 × 0.8 m boxes,
 * each at the exact centre of a distinct random tile, any level. Base
 * tiles (where players spawn) are skipped; flat tiles first, ramps only if
 * there aren't enough flat ones; a tile whose centre has no walkable cell
 * is skipped. Floor y = the walkable cell at the centre (shared/mazeGraph,
 * same graph the server bots use). Re-rolled to NEW random tiles on maze
 * rebuild, team change and "Respawn dummy" (UI chip / key 2).
 *
 * Knockback: client/lunge.ts hits each dummy once per lunge like a real
 * target; each gets the SAME LUNGE_KNOCK* values the victim client would
 * apply, through a small kinematic sim:
 *   v += impulse × LUNGE_DUMMY_UNIT (assumed m/s per impulse unit),
 *   held force → acceleration force × LUNGE_DUMMY_UNIT for LUNGE_KNOCK_FORCE_S,
 *   gravity, ground friction while grounded; floor = highest walkable cell
 *   within ~1 cell under it, none → it falls. Below the fall-respawn height
 *   a dummy hides until respawn. Logs travel distance per hit.
 */

import { engine, Entity, Material, MeshRenderer, Transform, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  LUNGE_TEST_DUMMY, LUNGE_DUMMY_COUNT, LUNGE_DUMMY_UNIT, LUNGE_DUMMY_GRAVITY, LUNGE_DUMMY_FRICTION,
  LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S,
} from '../shared/pvp'
import { buildWalkableGraph, WalkableGraph } from '../shared/mazeGraph'
import { getPlacedTilesInOrder, baseTeamOfTile, MIN_Y, CELL, MAZE_ORIGIN } from '../maze/generator'
import { TILES } from '../maze/tiles'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'
import { localTeam } from './knockback'

const SIZE = Vector3.create(0.8, 1.8, 0.8)
const HIDDEN = Vector3.create(8, -50, 8)
/** worldPos y of a walkable cell sits FLAT_OFFSET (0.55) above the tile; slab top ≈ +0.5. */
const FLOOR_FROM_NODE = -0.05
const STEP_UP = 0.6
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
}
const dummies: Dummy[] = []
let graph: WalkableGraph | null = null
let graphSeed = -1
let graphTeam: Team = Team.None

export function isDummyEnabled(): boolean { return LUNGE_TEST_DUMMY }

/** Live dummies' feet positions (lunge.ts boxHit targets). */
export function getDummyTargets(): Array<{ i: number; pos: { x: number; y: number; z: number } }> {
  const out: Array<{ i: number; pos: { x: number; y: number; z: number } }> = []
  dummies.forEach((d, i) => { if (d.alive) out.push({ i, pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z } }) })
  return out
}

function enemyOf(t: Team): Team { return t === Team.Blue ? Team.Red : Team.Blue }

function floorAt(x: number, z: number, y: number): number | null {
  if (!graph) return null
  let best: number | null = null
  for (const p of graph.worldPos.values()) {
    if (Math.abs(p[0] - x) > CELL_SIZE * 0.6 || Math.abs(p[2] - z) > CELL_SIZE * 0.6) continue
    const fy = p[1] + FLOOR_FROM_NODE
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
  const seen = new Set<string>()
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

function place(d: Dummy): void {
  Transform.getMutable(d.ent).position = d.alive ? Vector3.create(d.pos.x, d.pos.y + SIZE.y / 2, d.pos.z) : HIDDEN
}

/** Re-roll every dummy onto new random tile centres (UI chip / key 2 / rebuild). */
export function respawnDummy(): void {
  if (!LUNGE_TEST_DUMMY || dummies.length === 0) return
  if (!graph) { console.log('[Dummy] no maze yet'); return }
  const spots = pickSpots()
  const c = TEAM_RGB[enemyOf(localTeam())] ?? { r: 1, g: 1, b: 1 }
  dummies.forEach((d, i) => {
    const s = spots[i]
    d.vel = { x: 0, y: 0, z: 0 }
    d.forceLeft = 0
    d.tracking = false
    d.alive = !!s
    if (s) d.pos = { x: s.x, y: s.y, z: s.z }
    Material.setPbrMaterial(d.ent, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: Color4.create(c.r, c.g, c.b, 1), emissiveIntensity: 0.4 })
    place(d)
  })
  console.log(`[Dummy] respawned ${spots.length}: ${spots.map(s => `${s.x.toFixed(0)},${s.y.toFixed(1)},${s.z.toFixed(0)}`).join('  ')}`)
}

/** Lunge hit on dummy i: same values the victim client gets, × LUNGE_DUMMY_UNIT. */
export function hitDummy(i: number, dx: number, dz: number): void {
  const d = dummies[i]
  if (!d || !d.alive) return
  const k = LUNGE_DUMMY_UNIT
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
  d.vel.y -= LUNGE_DUMMY_GRAVITY * dt
  const nx = d.pos.x + d.vel.x * dt, nz = d.pos.z + d.vel.z * dt
  let ny = d.pos.y + d.vel.y * dt
  const floor = floorAt(nx, nz, d.pos.y)
  let grounded = false
  if (floor !== null && ny <= floor) { ny = floor; d.vel.y = 0; grounded = true }
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
    console.log(`[Dummy ${i}] fell off after ${Math.hypot(d.pos.x - d.hitFrom.x, d.pos.z - d.hitFrom.z).toFixed(2)} m horizontal — "Respawn dummy" to reset`)
  }
  place(d)
}

export function initLungeDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  for (let i = 0; i < LUNGE_DUMMY_COUNT; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN, scale: SIZE })
    MeshRenderer.setBox(ent)
    dummies.push({ ent, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, forceLeft: 0, forceDir: { x: 0, z: 0 },
      alive: false, tracking: false, hitFrom: { x: 0, z: 0 } })
  }
  engine.addSystem((dt: number) => {
    const seed = getCurrentSeed()
    const team = localTeam()
    if (!isRebuilding() && seed !== graphSeed && getPlacedTilesInOrder().length > 0) {
      graph = buildWalkableGraph(getPlacedTilesInOrder())
      graphSeed = seed
      if (team !== Team.None) respawnDummy()
    }
    if (team !== graphTeam && graph) {
      graphTeam = team
      if (team !== Team.None) respawnDummy()
    }
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) respawnDummy()
    const sdt = Math.min(dt, 0.05)
    dummies.forEach((d, i) => step(d, i, sdt))
  })
}
