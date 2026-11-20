/**
 * Paint tank for the Prototype lobby mode. Numbers and pure ordering only.
 * The server spends. Bot Fight and Team Fight do not read this.
 *
 * A flip is a neutral or enemy cell becoming yours. A cell you already own
 * is free. Area paints that cost more than the tank take the nearest flips
 * first and leave the rest unchanged. Combat does not consult the tank.
 *
 * All Prototype paint-economy balance knobs live in this file.
 */

import { baseTeamOfCellId } from '../maze/generator'
import type { WalkableGraph } from './mazeGraph'

/** How Prototype refills the tank. `'depot'` is the live checkpoint setup.
 *  Flip to `'territory'` to park depots and restore cured-ground recharge. */
export type PaintRefillMode = 'depot' | 'territory'
export const PAINT_REFILL_MODE: PaintRefillMode = 'depot'

export function refillAtDepot(): boolean {
  return PAINT_REFILL_MODE === 'depot'
}

export function refillOnTerritory(): boolean {
  return PAINT_REFILL_MODE === 'territory'
}

export const PAINT_CAPACITY = PAINT_REFILL_MODE === 'depot' ? 280 : 80
/** Paint spent per cell that actually changes ownership. */
export const PAINT_COST = 1
/** Paint regained each second at a friendly depot, or on cured friendly ground in territory mode. */
export const PAINT_REFILL_PER_SEC = PAINT_REFILL_MODE === 'depot' ? 56 : 10
/** Seconds a newly captured cell must wait before it can refill paint (territory mode). */
export const PAINT_CURE_S = 5
/** Feet must be this close to the cell's walkable Y to count as on that tile. */
export const PAINT_GROUND_TOLERANCE = 0.4

/** Tile-column plane of a cell id, so two cells on neighbouring tiles still sort. */
export function cellPlane(id: string): { x: number; z: number } | null {
  const colon = id.indexOf(':')
  if (colon < 0) return null
  const head = id.slice(0, colon).split(',')
  const tail = id.slice(colon + 1).split(',')
  const tx = Number(head[0])
  const tz = Number(head[1])
  const col = Number(tail[0])
  const row = Number(tail[1])
  if (![tx, tz, col, row].every(n => Number.isFinite(n))) return null
  return { x: tx * 16 + col, z: tz * 16 + row }
}

/** Unique ids, nearest to `origin` first. No origin keeps the input order. Ties break on the id. */
export function orderNearest(ids: readonly string[], origin: string | null): string[] {
  const seen = new Set<string>()
  const uniq: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    uniq.push(id)
  }
  const o = origin ? cellPlane(origin) : null
  if (!o) return uniq
  return uniq.sort((a, b) => {
    const pa = cellPlane(a)
    const pb = cellPlane(b)
    const da = pa ? Math.hypot(pa.x - o.x, pa.z - o.z) : Infinity
    const db = pb ? Math.hypot(pb.x - o.x, pb.z - o.z) : Infinity
    if (da !== db) return da - db
    return a < b ? -1 : a > b ? 1 : 0
  })
}

export type TankOp = { id: string; flip: boolean }

/**
 * One pass. `flip` is computed before any of these cells change.
 * Non-flips are kept (they are free). Flips past an empty tank are denied.
 */
export function applyTank(ops: readonly TankOp[], tank: number): { taken: string[]; denied: string[]; tank: number } {
  const taken: string[] = []
  const denied: string[] = []
  let left = tank
  for (const op of ops) {
    if (!op.flip) { taken.push(op.id); continue }
    if (left < PAINT_COST) { denied.push(op.id); continue }
    left -= PAINT_COST
    taken.push(op.id)
  }
  return { taken, denied, tank: left }
}

/** Wallet echoes stay under this gap unless the tank hits empty, full, or a cell was refused. */
export const WALLET_MIN_MS = 200
/** Standing still reports the cell underfoot at this gap. A cell change sends at once. */
export const FEET_IDLE_MS = 500
/** A depot feet sample stays valid this long. Must outlast both the idle
 *  feet interval and a slow hosted tick (~500–900 ms), or standing still
 *  never refills and the next wallet echo snaps the bar down. */
export const DEPOT_FEET_MS = 2500

export function depotFeetFresh(sampledAt: number, now = Date.now()): boolean {
  return now - sampledAt <= DEPOT_FEET_MS
}

export type WalletMsg = { tank: number; denied: string[]; regen: number }

/**
 * One player's paintWallet traffic. `offer` remembers the latest tank.
 * A send goes out immediately for a denial or for 0 / full, otherwise at
 * most once per WALLET_MIN_MS, and never when the tank has not changed.
 */
export class WalletGate {
  private last = new Map<string, { tank: number; at: number; regen: number }>()
  private pending = new Map<string, WalletMsg>()

  offer(id: string, tank: number, denied: readonly string[], now: number, capacity: number, regen = 0): WalletMsg | null {
    const prev = this.pending.get(id)
    this.pending.set(id, { tank, denied: [...(prev?.denied ?? []), ...denied], regen })
    return this.take(id, now, capacity)
  }

  /** Pending echoes whose quiet window has elapsed. */
  due(now: number, capacity: number): Array<{ id: string } & WalletMsg> {
    const out: Array<{ id: string } & WalletMsg> = []
    for (const id of [...this.pending.keys()]) {
      const msg = this.take(id, now, capacity)
      if (msg) out.push({ id, ...msg })
    }
    return out
  }

  reset(): void {
    this.last.clear()
    this.pending.clear()
  }

  private take(id: string, now: number, capacity: number): WalletMsg | null {
    const msg = this.pending.get(id)
    if (!msg) return null
    const sent = this.last.get(id)
    const urgent = msg.denied.length > 0 || msg.tank <= 0 || msg.tank >= capacity || (!!sent && sent.regen !== msg.regen)
    const changed = !sent || sent.tank !== msg.tank || msg.denied.length > 0 || sent.regen !== msg.regen
    if (!changed) {
      this.pending.delete(id)
      return null
    }
    if (!urgent && sent && now - sent.at < WALLET_MIN_MS) return null
    this.pending.delete(id)
    this.last.set(id, { tank: msg.tank, at: now, regen: msg.regen })
    return msg
  }
}

/** True when an idle feet sample should go out. Real paint ids always send. */
export function feetDue(cell: string, lastCell: string, lastMs: number, now: number, hasIds: boolean): boolean {
  if (hasIds) return true
  if (!cell) return false
  if (cell !== lastCell) return true
  return now - lastMs >= FEET_IDLE_MS
}

/** Neutral depots in addition to the two team bases. Unused in Prototype. 2, or 3–4. */
export const DEPOT_NEUTRAL_COUNT = 2
/** Metres between depot anchors. Relaxed once if the maze is too tight. */
export const DEPOT_MIN_SEPARATION_M = 40
/** Standing this close to an anchor counts as being on it. */
export const DEPOT_STAND_M = 4
/** Bots head for a friendly depot below this share of a full tank. */
export const BOT_REFILL_FRAC = 0.25

export type DepotAnchor = { id: string; owner: 0 | 1 | 2 }

export function graphHops(graph: WalkableGraph, start: string): Map<string, number> {
  const dist = new Map<string, number>()
  if (!graph.nodes.has(start)) return dist
  const q = [start]
  dist.set(start, 0)
  for (let i = 0; i < q.length; i++) {
    const id = q[i]
    const d = dist.get(id) ?? 0
    for (const n of graph.adj.get(id) ?? []) {
      if (dist.has(n)) continue
      dist.set(n, d + 1)
      q.push(n)
    }
  }
  return dist
}

export function nearestNode(graph: WalkableGraph, x: number, y: number, z: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const id of graph.nodes) {
    const p = graph.worldPos.get(id)
    if (!p) continue
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2
    if (d < bestD) { bestD = d; best = id }
  }
  return best
}

function apart(graph: WalkableGraph, a: string, b: string): number {
  const pa = graph.worldPos.get(a)
  const pb = graph.worldPos.get(b)
  if (!pa || !pb) return Infinity
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
}

export function onDepot(graph: WalkableGraph, fromCell: string, depotId: string, radius = DEPOT_STAND_M): boolean {
  if (fromCell === depotId) return true
  return apart(graph, fromCell, depotId) <= radius
}

/**
 * Team bases plus neutral anchors. Neutrals sit on deep cells, off bases,
 * spread out, and as even as the maze allows between the two teams.
 * Same graph, same result.
 */
export function placeDepots(
  graph: WalkableGraph,
  red: string,
  blue: string,
  neutralCount = DEPOT_NEUTRAL_COUNT,
  minSep = DEPOT_MIN_SEPARATION_M,
): DepotAnchor[] {
  const out: DepotAnchor[] = []
  if (graph.nodes.has(red)) out.push({ id: red, owner: 1 })
  if (graph.nodes.has(blue) && blue !== red) out.push({ id: blue, owner: 2 })
  const distR = graphHops(graph, red)
  const distB = graphHops(graph, blue)
  const cands: Array<{ id: string; score: number }> = []
  for (const id of graph.deepNodes) {
    if (out.some(d => d.id === id)) continue
    if (baseTeamOfCellId(id) !== 0) continue
    const dr = distR.get(id)
    const db = distB.get(id)
    if (dr === undefined || db === undefined) continue
    cands.push({ id, score: -Math.abs(dr - db) * 1000 + Math.min(dr, db) })
  }
  cands.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const pick = (sep: number) => {
    const chosen: string[] = []
    for (const c of cands) {
      if (chosen.length >= neutralCount) break
      if (out.some(d => apart(graph, c.id, d.id) < sep)) continue
      if (chosen.some(id => apart(graph, c.id, id) < sep)) continue
      chosen.push(c.id)
    }
    return chosen
  }
  let chosen = pick(minSep)
  if (chosen.length < neutralCount) chosen = pick(minSep * 0.5)
  if (chosen.length < neutralCount) chosen = pick(0)
  for (const id of chosen) out.push({ id, owner: 0 })
  return out
}

export type RegenQuery = {
  team: number
  cellTeam: number
  /** Last ownership-change time (ms). 0 = pre-cured starting territory. */
  ownedSince: number
  now: number
  grounded: boolean
  feetY: number
  cellY: number
  cureS?: number
  groundTol?: number
}

/** True once a cell has been held by its current team for the curing delay. */
export function isCuredSince(ownedSince: number, now: number, cureS: number = PAINT_CURE_S): boolean {
  if (ownedSince <= 0) return true
  return now - ownedSince >= cureS * 1000
}

/**
 * Regen only while grounded on a friendly cell that has finished curing,
 * at that cell's elevation. No regen in the air, on a different level,
 * or on neutral / enemy / fresh paint.
 */
export function isRegenEligible(q: RegenQuery): boolean {
  if (!q.grounded) return false
  if (q.team !== 1 && q.team !== 2) return false
  if (q.cellTeam !== q.team) return false
  if (!isCuredSince(q.ownedSince, q.now, q.cureS ?? PAINT_CURE_S)) return false
  if (!Number.isFinite(q.feetY) || !Number.isFinite(q.cellY)) return false
  if (Math.abs(q.feetY - q.cellY) > (q.groundTol ?? PAINT_GROUND_TOLERANCE)) return false
  return true
}

/** Whole-paint accrual. `frac` carries the leftover fraction into the next tick. */
export function accruePaint(tank: number, frac: number, dt: number, rate: number = PAINT_REFILL_PER_SEC, cap: number = PAINT_CAPACITY): { tank: number; frac: number; gained: number } {
  if (dt <= 0 || rate <= 0 || tank >= cap) return { tank: Math.min(Math.max(0, tank), cap), frac: 0, gained: 0 }
  const acc = Math.max(0, frac) + rate * dt
  const whole = Math.floor(acc)
  const next = Math.min(cap, tank + whole)
  return { tank: next, frac: acc - whole, gained: next - tank }
}

