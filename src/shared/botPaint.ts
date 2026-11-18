/**
 * botPaint.ts — cells a bot paints underfoot. Walking uses a 3x3 stamp around
 * the stepped cell (the same footprint a player's paintTick sends). A ground
 * dash moves too far in one tick to rely on that, so the path is sampled and
 * each grounded sample gets the same stamp. Air, void, and recovery dashes
 * over the void add nothing.
 */
import { graphFloorAt } from './anvilSim'
import type { WalkableGraph } from './mazeGraph'
import type { Placed } from '../maze/generator'

const SAMPLE_M = 1
const FLOOR_UP = 0.6

export type Feet = { x: number; y: number; z: number }

/** 3x3 walkable stamp around a graph cell, same footprint as a player paintTick. */
export function stampAround(graph: WalkableGraph, stepId: string): string[] {
  const colonIdx = stepId.indexOf(':')
  if (colonIdx < 0) return graph.nodes.has(stepId) ? [stepId] : []
  const prefix = stepId.slice(0, colonIdx + 1)
  const [colStr, rowStr] = stepId.slice(colonIdx + 1).split(',')
  const col = parseInt(colStr, 10)
  const row = parseInt(rowStr, 10)
  if (!Number.isFinite(col) || !Number.isFinite(row)) return []
  const stamp: string[] = []
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const nid = `${prefix}${col + dc},${row + dr}`
      if (graph.nodes.has(nid)) stamp.push(nid)
    }
  }
  return stamp
}

/** Nearest walkable cell on this level, or null if none are close enough. */
export function cellAt(graph: WalkableGraph, p: Feet, maxD = 1.25): string | null {
  let best: string | null = null, bestD = maxD
  for (const [id, q] of graph.worldPos) {
    if (Math.abs(q[1] - p.y) > 1.5) continue
    const d = Math.hypot(q[0] - p.x, q[2] - p.z)
    if (d < bestD) { bestD = d; best = id }
  }
  return best
}

/**
 * 3x3 stamps along a movement segment. Samples only count when the feet are
 * on a walkable floor, so a dash that leaves the arena stops painting.
 */
export function cellsAlongPath(graph: WalkableGraph, rampTiles: Placed[], from: Feet, to: Feet): string[] {
  const out = new Set<string>()
  const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  const steps = Math.max(1, Math.ceil(dist / SAMPLE_M))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    }
    if (graphFloorAt(graph, rampTiles, p.x, p.z, p.y, 0.99, FLOOR_UP) === null) continue
    const id = cellAt(graph, p)
    if (!id) continue
    for (const c of stampAround(graph, id)) out.add(c)
  }
  return [...out]
}
