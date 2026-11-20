/**
 * botDash.ts — combat lunge aim for a ghost bot.
 *
 * Aim is the direction to the target plus a small error. A dash uses the
 * same length as a player lunge and is not clamped to the floor, so it can
 * already overshoot a near-edge target and leave the arena. When a drop lip
 * sits in a cone around that aim, a small chance yaws toward it — a
 * human-like misjudged dash near an edge. After the body leaves the floor,
 * recovery is the same as after any other knock (BotBody.dash arms it).
 */
import { Placed } from '../maze/generator'
import { graphFloorAt } from './anvilSim'
import { WalkableGraph } from './mazeGraph'
import {
  BOT_AIM_ERROR_DEG, BOT_DASH_SLIP_CHANCE, BOT_DASH_SLIP_CONE_DEG, BOT_DASH_SLIP_LOOK_M,
} from './pvp'

export type LungeAim = { dx: number; dz: number; slipped: boolean }

const FLOOR_XZ = 1.2
const FLOOR_Y = 2.5

function onFloor(
  graph: WalkableGraph,
  rampTiles: Placed[],
  x: number,
  z: number,
  y: number,
): boolean {
  return graphFloorAt(graph, rampTiles, x, z, y, FLOOR_XZ, FLOOR_Y) !== null
}

/** Unit heading toward the nearest drop in the aim cone, or null if the dash stays inland. */
export function lipInAimCone(
  graph: WalkableGraph,
  rampTiles: Placed[],
  pos: { x: number; y: number; z: number },
  dx: number,
  dz: number,
): { x: number; z: number; dist: number } | null {
  const cone = BOT_DASH_SLIP_CONE_DEG * Math.PI / 180
  const stepA = cone / 4
  let best: { x: number; z: number; dist: number } | null = null
  let bestScore = Infinity
  for (let a = -cone; a <= cone + 1e-9; a += stepA) {
    const cx = dx * Math.cos(a) - dz * Math.sin(a)
    const cz = dx * Math.sin(a) + dz * Math.cos(a)
    const cl = Math.hypot(cx, cz) || 1
    const ux = cx / cl, uz = cz / cl
    for (let d = 3; d <= BOT_DASH_SLIP_LOOK_M; d += 1) {
      const x = pos.x + ux * d, z = pos.z + uz * d
      if (onFloor(graph, rampTiles, x, z, pos.y)) continue
      const px = pos.x + ux * (d - 1), pz = pos.z + uz * (d - 1)
      if (d > 3 && !onFloor(graph, rampTiles, px, pz, pos.y)) continue
      const score = d + Math.abs(a) * 4
      if (score < bestScore) {
        bestScore = score
        best = { x: ux, z: uz, dist: d }
      }
      break
    }
  }
  return best
}

/** Combat lunge heading. Never shortens or refuses a dash that would leave the floor. */
export function planBotLungeAim(
  pos: { x: number; y: number; z: number },
  target: { x: number; z: number },
  graph: WalkableGraph,
  rampTiles: Placed[],
  rng: () => number,
): LungeAim {
  const best = Math.hypot(target.x - pos.x, target.z - pos.z)
  const ax = (target.x - pos.x) / Math.max(best, 1e-3)
  const az = (target.z - pos.z) / Math.max(best, 1e-3)
  const err = (rng() * 2 - 1) * BOT_AIM_ERROR_DEG * Math.PI / 180
  let dx = ax * Math.cos(err) - az * Math.sin(err)
  let dz = ax * Math.sin(err) + az * Math.cos(err)
  const n = Math.hypot(dx, dz) || 1
  dx /= n
  dz /= n
  const lip = lipInAimCone(graph, rampTiles, pos, dx, dz)
  if (!lip || rng() >= BOT_DASH_SLIP_CHANCE) return { dx, dz, slipped: false }
  // Blend toward the lip so a 9.2 m dash crosses it, without launching straight
  // off from deep inland — the cone already limits how far aside we look.
  dx = dx * 0.35 + lip.x * 0.65
  dz = dz * 0.35 + lip.z * 0.65
  const n2 = Math.hypot(dx, dz) || 1
  return { dx: dx / n2, dz: dz / n2, slipped: true }
}
