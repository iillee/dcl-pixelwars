/**
 * lobbyHoldFloor.ts — an immediate primitive floor under the lobby spawn.
 *
 * The lobby tiles are GLBs whose physics colliders can arrive a second or
 * more after the explorer has already placed the avatar at scene.json's
 * spawn. On desktop the rest of the client usually boots in time; on
 * mobile the bundle import itself is often still in flight, so the player
 * falls through empty space. These MeshCollider boxes are created from
 * main() before that import, so a floor exists as soon as JS runs.
 *
 * The top of each box matches the existing spawn-pad slab (BASE_Y + 0.5).
 * They are thick downward so a late boot still catches a player who has
 * already started to drop. Invisible: no mesh renderer.
 */

import { engine, Entity, Transform, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { earlySpawnPads, type SpawnPad } from './shared/lobby'
import { BASE_Y, CELL, MAZE_ORIGIN, baseSpawn } from './maze/generator'
import { IS_SKY } from './maze/level'

const THICK = 32

let floors: Entity[] = []
let pads: SpawnPad[] = []

function thickFrom(p: SpawnPad): { pos: Vector3; scale: Vector3; rot: Quaternion } {
  const top = p.y + p.sy / 2
  return {
    pos: Vector3.create(p.x, top - THICK / 2, p.z),
    scale: Vector3.create(p.sx, THICK, p.sz),
    rot: Quaternion.fromEulerDegrees(0, p.yaw, 0),
  }
}

export function installLobbyHoldFloor(force = false): void {
  if (!IS_SKY) return
  if (floors.length && !force) return
  if (floors.length) clearLobbyHoldFloor()
  pads = earlySpawnPads(MAZE_ORIGIN, CELL, BASE_Y, [1, 2, 3, 4].map(t => baseSpawn(t).pos))
  for (const p of pads) {
    const e = engine.addEntity()
    const t = thickFrom(p)
    Transform.create(e, { position: t.pos, rotation: t.rot, scale: t.scale })
    MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
    floors.push(e)
  }
  console.log(`[Lobby] hold floor up (${floors.length} slabs, ${THICK} m thick)`)
}

export function clearLobbyHoldFloor(): void {
  if (!floors.length) return
  for (const e of floors) {
    try { engine.removeEntity(e) } catch { /* already gone */ }
  }
  floors = []
  pads = []
}

/** True when (x, z) sits on one of the installed hold slabs. */
export function lobbyHoldContains(x: number, z: number): boolean {
  for (const p of pads) {
    const dx = x - p.x
    const dz = z - p.z
    const rad = p.yaw * Math.PI / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= p.sx / 2 + 1e-4 && Math.abs(lz) <= p.sz / 2 + 1e-4) return true
  }
  return false
}

export function lobbyHoldActive(): boolean {
  return floors.length > 0
}
