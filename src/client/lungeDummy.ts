/**
 * lungeDummy.ts — client-local Lunge test dummy (LUNGE_TEST_DUMMY in
 * shared/pvp.ts). No server, nobody else sees it.
 *
 * An opponent-coloured 0.8 × 1.8 × 0.8 m box on an exposed L0 walkway
 * cell near our base (the cell with the fewest walkable neighbours ~5–14 m
 * from our spawn, so a hit can push it off). client/lunge.ts treats it as
 * an enemy in the same swept-hit check; on hit it gets the SAME LUNGE_KNOCK*
 * values the victim client would apply, run through a small kinematic sim:
 *   v += impulse × LUNGE_DUMMY_UNIT (assumed m/s per impulse unit),
 *   held force → acceleration force × LUNGE_DUMMY_UNIT for LUNGE_KNOCK_FORCE_S,
 *   gravity, ground friction while grounded,
 *   floor = highest walkable cell (shared/mazeGraph, same graph the server
 *   bots use) within ~1 cell under it; no cell → it falls.
 * Below the fall-respawn height it is hidden until "Respawn dummy" (UI chip
 * next to the hotbar, or key 2 on desktop). Logs travel distance per hit.
 */

import { engine, Entity, Material, MeshRenderer, Transform, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  LUNGE_TEST_DUMMY, LUNGE_DUMMY_UNIT, LUNGE_DUMMY_GRAVITY, LUNGE_DUMMY_FRICTION,
  LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S,
} from '../shared/pvp'
import { buildWalkableGraph, WalkableGraph } from '../shared/mazeGraph'
import { getPlacedTilesInOrder, baseSpawn, MIN_Y } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'
import { localTeam } from './knockback'

const SIZE = Vector3.create(0.8, 1.8, 0.8)
const HIDDEN = Vector3.create(8, -50, 8)
/** worldPos y of a walkable cell sits FLAT_OFFSET (0.55) above the tile; slab top ≈ +0.5. */
const FLOOR_FROM_NODE = -0.05
const STEP_UP = 0.6
const CELL_SIZE = 2 // shared/mazeGraph: CELL 32 / SIZE 16

let ent: Entity = 0 as Entity
let graph: WalkableGraph | null = null
let graphSeed = -1
let graphTeam: Team = Team.None
let home: Vector3 | null = null
const pos = { x: 0, y: 0, z: 0 } // feet
const vel = { x: 0, y: 0, z: 0 }
let forceLeft = 0
let forceDir = { x: 0, z: 0 }
let alive = false
let tracking = false
let hitFrom = { x: 0, z: 0 }

export function isDummyEnabled(): boolean { return LUNGE_TEST_DUMMY }

/** Feet position if the dummy is up (lunge.ts sweptHit target), else null. */
export function getDummyTarget(): { x: number; y: number; z: number } | null {
  return alive ? { x: pos.x, y: pos.y, z: pos.z } : null
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

function pickHome(): Vector3 | null {
  if (!graph) return null
  const team = localTeam() === Team.Blue ? 2 : 1
  const s = baseSpawn(team).pos
  let best: { id: string; score: number } | null = null
  for (const id of graph.nodes) {
    const p = graph.worldPos.get(id)!
    if (Math.abs(p[1] - (s.y - 1.5)) > 1.2) continue // L0 only
    const d = Math.hypot(p[0] - s.x, p[2] - s.z)
    if (d < 5 || d > 14) continue
    const n = graph.adj.get(id)?.length ?? 8
    const score = n * 10 + Math.abs(d - 8) // fewest neighbours = exposed edge, then ~8 m out
    if (!best || score < best.score) best = { id, score }
  }
  if (!best) return null
  const p = graph.worldPos.get(best.id)!
  return Vector3.create(p[0], p[1] + FLOOR_FROM_NODE, p[2])
}

function place(): void {
  if (!ent) return
  Transform.getMutable(ent).position = alive ? Vector3.create(pos.x, pos.y + SIZE.y / 2, pos.z) : HIDDEN
}

function paint(): void {
  const c = TEAM_RGB[enemyOf(localTeam())] ?? { r: 1, g: 1, b: 1 }
  Material.setPbrMaterial(ent, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: Color4.create(c.r, c.g, c.b, 1), emissiveIntensity: 0.4 })
}

/** Reset to the start spot (UI chip / key 2). */
export function respawnDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  if (!home) home = pickHome()
  if (!home) { console.log('[Dummy] no spot yet (maze not built?)'); return }
  pos.x = home.x; pos.y = home.y; pos.z = home.z
  vel.x = vel.y = vel.z = 0
  forceLeft = 0
  alive = true
  tracking = false
  paint()
  place()
  console.log(`[Dummy] respawned at ${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`)
}

/** Lunge hit: same values the victim client gets, converted with LUNGE_DUMMY_UNIT. */
export function hitDummy(dx: number, dz: number): void {
  if (!alive) return
  const k = LUNGE_DUMMY_UNIT
  vel.x += dx * LUNGE_KNOCKBACK * k
  vel.z += dz * LUNGE_KNOCKBACK * k
  vel.y += LUNGE_KNOCK_LIFT * k
  forceDir = { x: dx, z: dz }
  forceLeft = LUNGE_KNOCK_FORCE > 0 ? LUNGE_KNOCK_FORCE_S : 0
  hitFrom = { x: pos.x, z: pos.z }
  tracking = true
  console.log(`[Dummy] hit: v0 ${(Math.hypot(vel.x, vel.z)).toFixed(1)} m/s horizontal, ${vel.y.toFixed(1)} up (unit ${k})`)
}

function step(dt: number): void {
  if (!alive) return
  if (forceLeft > 0) {
    const a = LUNGE_KNOCK_FORCE * LUNGE_DUMMY_UNIT
    vel.x += forceDir.x * a * dt
    vel.z += forceDir.z * a * dt
    forceLeft -= dt
  }
  vel.y -= LUNGE_DUMMY_GRAVITY * dt
  const nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt
  let ny = pos.y + vel.y * dt
  const floor = floorAt(nx, nz, pos.y)
  let grounded = false
  if (floor !== null && ny <= floor) { ny = floor; vel.y = 0; grounded = true }
  pos.x = nx; pos.y = ny; pos.z = nz
  if (grounded) {
    const h = Math.hypot(vel.x, vel.z)
    const nh = Math.max(0, h - LUNGE_DUMMY_FRICTION * dt)
    if (h > 1e-4) { vel.x *= nh / h; vel.z *= nh / h }
    if (tracking && nh === 0 && forceLeft <= 0) {
      tracking = false
      console.log(`[Dummy] stopped after ${Math.hypot(pos.x - hitFrom.x, pos.z - hitFrom.z).toFixed(2)} m`)
    }
  }
  if (pos.y < MIN_Y - FALL_RESPAWN_DROP) {
    alive = false
    console.log(`[Dummy] fell off after ${Math.hypot(pos.x - hitFrom.x, pos.z - hitFrom.z).toFixed(2)} m horizontal — "Respawn dummy" to reset`)
  }
  place()
}

export function initLungeDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  ent = engine.addEntity()
  Transform.create(ent, { position: HIDDEN, scale: SIZE })
  MeshRenderer.setBox(ent)
  engine.addSystem((dt: number) => {
    const seed = getCurrentSeed()
    const team = localTeam()
    if (!isRebuilding() && seed !== graphSeed && getPlacedTilesInOrder().length > 0) {
      graph = buildWalkableGraph(getPlacedTilesInOrder())
      graphSeed = seed
      home = null
      if (team !== Team.None) respawnDummy()
    }
    if (team !== graphTeam && graph) {
      graphTeam = team
      home = null
      if (team !== Team.None) respawnDummy()
    }
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) respawnDummy()
    step(Math.min(dt, 0.05))
  })
}
