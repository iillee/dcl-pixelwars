/**
 * burst.ts — pure Paint Burst logic shared by server.ts, client/paintBurst.ts
 * and scripts/verify-burst.ts. No engine imports.
 */
import {
  BURST_RADIUS, BURST_HIT_MAX_DY, BURST_PAINT_SHAPE, BURST_PAINT_RADIUS_CELLS, BURST_PAINT_MAX_DY,
  SERVER_BURST_HIT_WINDOW_S,
  AIR_SPIKE_RADIUS, AIR_SPIKE_DEPTH, AIR_SPIKE_MIN_ABOVE, AIR_SPIKE_MIN_DROP,
} from './pvp'
import type { WalkableGraph } from './mazeGraph'

export type V3 = { x: number; y: number; z: number }
const CELL_M = 2 // CELL / SIZE

/** Is target inside the shockwave? Horizontal feet-to-feet distance (like the paint footprint)
 *  within `radius`, and within BURST_HIT_MAX_DY in height. */
export function inBurst(origin: V3, t: V3, radius = BURST_RADIUS): boolean {
  return Math.hypot(t.x - origin.x, t.z - origin.z) <= radius && Math.abs(t.y - origin.y) <= BURST_HIT_MAX_DY
}

/** Air spike volume: attacker is clearly above the target, inside a short vertical cylinder.
 *  Same-height sideways targets fail the drop gate. */
export function inAirSpike(origin: V3, t: V3, radius = AIR_SPIKE_RADIUS, depth = AIR_SPIKE_DEPTH, minAbove = AIR_SPIKE_MIN_ABOVE): boolean {
  const drop = origin.y - t.y
  return Math.hypot(t.x - origin.x, t.z - origin.z) <= radius && drop >= minAbove && drop <= depth
}

/** First walkable cell the spike meets under `p`: within the cylinder radius, between
 *  AIR_SPIKE_MIN_DROP and `depth` below the attacker. Higher surfaces win; ties go to the
 *  closer cell. Null when the ground is out of reach (no paint). */
export function airSpikeLanding(graph: WalkableGraph, p: V3, depth = AIR_SPIKE_DEPTH, radius = AIR_SPIKE_RADIUS): string | null {
  let best: string | null = null
  let bestDrop = Infinity
  let bestD = Infinity
  for (const [id, q] of graph.worldPos) {
    if (!graph.nodes.has(id)) continue
    const drop = p.y - q[1]
    if (drop < AIR_SPIKE_MIN_DROP || drop > depth) continue
    const d = Math.hypot(q[0] - p.x, q[2] - p.z)
    if (d > radius) continue
    if (drop < bestDrop - 0.05 || (Math.abs(drop - bestDrop) <= 0.05 && d < bestD)) {
      best = id; bestDrop = drop; bestD = d
    }
  }
  return best
}

/** Outward horizontal unit direction (fallback = facing when on top of each other). */
export function burstDir(origin: V3, t: V3, fx: number, fz: number): { x: number; z: number } {
  const dx = t.x - origin.x, dz = t.z - origin.z
  const l = Math.hypot(dx, dz)
  if (l < 0.2) { const fl = Math.hypot(fx, fz) || 1; return { x: fx / fl, z: fz / fl } }
  return { x: dx / l, z: dz / l }
}

/**
 * Footprint cells around `center` on the walkable graph: BFS over walkable
 * adjacency that only steps through cells inside the shape (square: |dx|,|dz|
 * ≤ R cells; cross: |dx|+|dz| ≤ R cells; circle: centre distance ≤ R cells), each step within
 * BURST_PAINT_MAX_DY of the cell it steps from (not of the centre, so a whole ramp run is
 * included: ramp cells climb ~0.7 m each). Because it walks adjacency, it never jumps a gap, a disconnected
 * walkway or onto another level. Base lock is applied later by applyPaint.
 */
export function burstFootprint(graph: WalkableGraph, center: string,
  shape: 'circle' | 'square' | 'cross' = BURST_PAINT_SHAPE, r = BURST_PAINT_RADIUS_CELLS): string[] {
  const c = graph.worldPos.get(center)
  if (!c || !graph.nodes.has(center)) return []
  const lim = r * CELL_M + 0.5
  const circ = r * CELL_M + 0.05 // circle: cell centres within R cells
  const inside = (id: string, from: string): boolean => {
    const p = graph.worldPos.get(id), q = graph.worldPos.get(from)
    if (!p || !q) return false
    const dx = Math.abs(p[0] - c[0]), dz = Math.abs(p[2] - c[2])
    if (Math.abs(p[1] - q[1]) > BURST_PAINT_MAX_DY) return false // per walk edge
    if (shape === 'circle') return Math.hypot(dx, dz) <= circ
    return shape === 'square' ? dx <= lim && dz <= lim : dx + dz <= lim
  }
  const out = [center]
  const seen = new Set([center])
  let frontier = [center]
  const maxSteps = Math.ceil(shape === 'cross' ? r : 2 * r)
  for (let s = 0; s < maxSteps && frontier.length; s++) {
    const nextF: string[] = []
    for (const id of frontier) {
      for (const n of graph.adj.get(id) ?? []) {
        if (seen.has(n)) continue
        if (!inside(n, id)) continue
        seen.add(n)
        out.push(n); nextF.push(n)
      }
    }
    frontier = nextF
  }
  return out
}

/** Footprint centre: the reported cell if it's a walkable node near p, else the
 *  nearest walkable cell to p on p's level (within 3 m horizontally). */
export function burstCentre(graph: WalkableGraph, cell: string, p: V3): string | null {
  const c = cell ? graph.worldPos.get(cell) : undefined
  if (c && graph.nodes.has(cell) && Math.hypot(c[0] - p.x, c[2] - p.z) <= 3 && Math.abs(c[1] - p.y) <= BURST_PAINT_MAX_DY + 1) return cell
  let best: string | null = null, bd = 3
  for (const [id, q] of graph.worldPos) {
    if (Math.abs(q[1] - p.y) > BURST_PAINT_MAX_DY + 1) continue
    const d = Math.hypot(q[0] - p.x, q[2] - p.z)
    if (d < bd) { bd = d; best = id }
  }
  return best
}

/** Server: one live burst per attacker; each target accepted once, within the hit window. */
export class BurstLedger {
  private last = new Map<string, { id: number; at: number; hits: Set<string>; air: number }>()
  /** `air`: 0 ground radial, 1 airborne combat/whiff (no paint), 2 airborne miss that paints a cross. */
  start(from: string, id: number, now: number, air = 0): void {
    this.last.set(from, { id, at: now, hits: new Set(), air })
  }
  /** 0 when this burst is the grounded radial (or unknown). Non-zero means the downward spike. */
  mode(from: string, id: number): number {
    const l = this.last.get(from)
    return l && l.id === id ? l.air : 0
  }
  hit(from: string, id: number, target: string, now: number): 'ok' | 'unknown' | 'stale' | 'dup' {
    const l = this.last.get(from)
    if (!l || l.id !== id) return 'unknown'
    if (now - l.at > SERVER_BURST_HIT_WINDOW_S * 1000) return 'stale'
    const k = target.toLowerCase()
    if (l.hits.has(k)) return 'dup'
    l.hits.add(k)
    return 'ok'
  }
  forget(from: string): void { this.last.delete(from) }
}
