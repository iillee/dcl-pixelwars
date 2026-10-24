/**
 * burst.ts — pure Paint Burst logic shared by server.ts, client/paintBurst.ts
 * and scripts/verify-burst.ts. No engine imports.
 */
import {
  BURST_RADIUS, BURST_HIT_MAX_DY, BURST_PAINT_SHAPE, BURST_PAINT_RADIUS_CELLS, BURST_PAINT_MAX_DY,
  SERVER_BURST_HIT_WINDOW_S,
  AIR_SPIKE_RADIUS, AIR_SPIKE_DEPTH, AIR_SPIKE_MIN_ABOVE,
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

/** Outward horizontal unit direction (fallback = facing when on top of each other). */
export function burstDir(origin: V3, t: V3, fx: number, fz: number): { x: number; z: number } {
  const dx = t.x - origin.x, dz = t.z - origin.z
  const l = Math.hypot(dx, dz)
  if (l < 0.2) { const fl = Math.hypot(fx, fz) || 1; return { x: fx / fl, z: fz / fl } }
  return { x: dx / l, z: dz / l }
}

/**
 * Targets a ground shockwave hits. Used for a grounded press and for the landing
 * of an air miss — same radius, same outward direction. `id` is whatever the
 * caller knocks (player address, bot id, anvil index).
 */
export function shockwaveHits<T extends V3 & { id: string | number }>(
  origin: V3, targets: readonly T[], fx: number, fz: number, radius = BURST_RADIUS,
): Array<{ id: T['id']; x: number; z: number; at: T }> {
  const out: Array<{ id: T['id']; x: number; z: number; at: T }> = []
  for (const t of targets) {
    if (!inBurst(origin, t, radius)) continue
    const d = burstDir(origin, t, fx, fz)
    out.push({ id: t.id, x: d.x, z: d.z, at: t })
  }
  return out
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
  private last = new Map<string, {
    id: number; at: number; hits: Set<string>; air: number; painted: boolean
    fx: number; fz: number; landed: boolean; landAt: number
  }>()
  /** `air`: 0 ground radial (painted on burstUse), 1 airborne spike (painted once on landing).
   *  `fx, fz` is the press facing, kept for the landing shockwave's overlap fallback. */
  start(from: string, id: number, now: number, air = 0, fx = 0, fz = 1): void {
    this.last.set(from, { id, at: now, hits: new Set(), air, painted: false, fx, fz, landed: false, landAt: now })
  }
  /** 0 when this burst is the grounded radial (or unknown). Non-zero means the downward spike.
   *  Stays the press mode after the landing opens, so an air paint retry is not treated as a ground replay. */
  mode(from: string, id: number): number {
    const l = this.last.get(from)
    return l && l.id === id ? l.air : 0
  }
  /** Press facing. Overlap knockback falls back to this, on the ground and on landing. */
  facing(from: string, id: number): { x: number; z: number } {
    const l = this.last.get(from)
    return l && l.id === id ? { x: l.fx, z: l.fz } : { x: 0, z: 1 }
  }
  /** The air miss has opened its ground shockwave. Once. Paint is separate. */
  landed(from: string, id: number): boolean {
    const l = this.last.get(from)
    return !!l && l.id === id && l.landed
  }
  /** burstImpact.air. Downward spike until the landing shockwave opens, then the ground radial. */
  impactAir(from: string, id: number): number {
    const l = this.last.get(from)
    if (!l || l.id !== id) return 0
    return l.air !== 0 && !l.landed ? 1 : 0
  }
  /** First accepted landing of an airborne burst, inside the land window.
   *  Once. Starts the same hit window a ground burst has (measured from the landing,
   *  so a dive longer than that window can still knock). Does not consume the paint. */
  openLanding(from: string, id: number, now: number, windowS: number): boolean {
    const l = this.last.get(from)
    if (!l || l.id !== id || l.air === 0 || l.landed) return false
    if (now - l.at > windowS * 1000) return false
    l.landed = true
    l.landAt = now
    return true
  }
  /** Target already accepted for this burst (the spike, or an earlier landing hit). */
  hasHit(from: string, id: number, target: string): boolean {
    const l = this.last.get(from)
    return !!l && l.id === id && l.hits.has(target.toLowerCase())
  }
  /** This attacker's live burst is `id` (a retry of the same press, not a new one). */
  matches(from: string, id: number): boolean {
    const l = this.last.get(from)
    return !!l && l.id === id
  }
  /** The footprint for this id was already applied. An empty centre does not set this. */
  hasPaint(from: string, id: number): boolean {
    const l = this.last.get(from)
    return !!l && l.id === id && l.painted
  }
  /** Landing may paint: airborne, same id, inside `windowS`, not yet painted. Does not consume. */
  paintReady(from: string, id: number, now: number, windowS: number): boolean {
    const l = this.last.get(from)
    if (!l || l.id !== id || l.air === 0) return false
    if (now - l.at > windowS * 1000) return false
    return !l.painted
  }
  /** Mark the footprint applied. Once. Ground and landing both use this. */
  commitPaint(from: string, id: number): boolean {
    const l = this.last.get(from)
    if (!l || l.id !== id || l.painted) return false
    l.painted = true
    return true
  }
  /** One landing footprint for an airborne burst, inside `windowS`. Ground bursts and a second call are rejected. */
  claimPaint(from: string, id: number, now: number, windowS: number): boolean {
    if (!this.paintReady(from, id, now, windowS)) return false
    return this.commitPaint(from, id)
  }
  hit(from: string, id: number, target: string, now: number): 'ok' | 'unknown' | 'stale' | 'dup' {
    const l = this.last.get(from)
    if (!l || l.id !== id) return 'unknown'
    // Ground: window runs from the press. Landing: the same window runs from the shockwave open.
    const anchor = l.landed ? l.landAt : l.at
    if (now - anchor > SERVER_BURST_HIT_WINDOW_S * 1000) return 'stale'
    const k = target.toLowerCase()
    if (l.hits.has(k)) return 'dup'
    l.hits.add(k)
    return 'ok'
  }
  forget(from: string): void { this.last.delete(from) }
}
