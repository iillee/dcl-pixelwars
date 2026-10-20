/**
 * paintBomb.ts — server-side geometry for the Paint Bomb prototype.
 *
 * The server already builds the round's walkable graph for the ghost bot
 * (bots/manager), including each cell's world-space centre. That lets the
 * server resolve the blast circle itself instead of trusting client cell
 * ids. Base lock is enforced downstream by paintState.applyPaint.
 */

import { getWalkableGraph } from './bots/manager'
import { BOMB_PAINT_RADIUS, BOMB_PAINT_MAX_DY, BOMB_SNAP_MAX_DROP } from '../shared/pvp'

/** Horizontal radius used to look for floor under the bomb (≈ one cell + slack). */
const SNAP_RADIUS = 1.5

/**
 * Floor height under (x, z): the highest walkable cell centre within
 * SNAP_RADIUS horizontally that is at most 1 m above y and no more than
 * BOMB_SNAP_MAX_DROP below it. Null = nothing underneath (mid-air off an
 * edge), and the bomb then detonates where it was dropped.
 */
export function bombFloorY(x: number, y: number, z: number): number | null {
  const graph = getWalkableGraph()
  if (!graph) return null
  let best: number | null = null
  for (const [, [cx, cy, cz]] of graph.worldPos) {
    if (cy > y + 1 || cy < y - BOMB_SNAP_MAX_DROP) continue
    if (Math.hypot(cx - x, cz - z) > SNAP_RADIUS) continue
    if (best === null || cy > best) best = cy
  }
  return best
}

/** Walkable cell ids painted by a bomb at (x, y, z). */
export function bombCells(x: number, y: number, z: number): string[] {
  const graph = getWalkableGraph()
  if (!graph) return []
  const out: string[] = []
  for (const [id, [cx, cy, cz]] of graph.worldPos) {
    if (Math.abs(cy - y) > BOMB_PAINT_MAX_DY) continue
    if (Math.hypot(cx - x, cz - z) > BOMB_PAINT_RADIUS) continue
    out.push(id)
  }
  return out
}
