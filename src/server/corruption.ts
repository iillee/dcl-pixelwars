/**
 * corruption.ts — Corruption (Ooze) PvE mode: seed, pulse spread, outbreaks, eradicate win.
 *
 * Server-only. Uses the same walkable graph as bots (getWalkableGraph) and
 * paints via applyPaint with Team.Corruption (3). Player paint (1/2) overwrites.
 *
 * Growth: shared expansion budget per pulse (sublinear in player count),
 * adjacent frontier only. Outbreaks: every few pulses, telegraph then burst.
 * No bots in this mode (caller skips tickBots).
 */

import { Team } from '../shared/team'
import { WalkableGraph } from '../shared/mazeGraph'
import { baseTeamOfCellId } from '../maze/generator'
import { BASE_PAINT_LOCK } from '../maze/level'
import {
  CORRUPTION_PULSE_MS,
  CORRUPTION_OUTBREAK_EVERY,
  CORRUPTION_TELEGRAPH_MS,
  CORRUPTION_SEED_FOCI,
  CORRUPTION_SEED_RADIUS,
  CORRUPTION_OUTBREAK_BLOB,
  corruptionPulseBudget,
} from '../shared/gameMode'

export type CorruptionDeps = {
  applyPaint: (cellId: string, team: number, painter: string) => boolean
  teamOf: (cellId: string) => number
  /** Clear a cell back to unpainted (player paint overwrites via applyPaint; this is for internal resets only). */
  getGraph: () => WalkableGraph | null
  /** Present human count for budget scaling. */
  playerCount: () => number
  /** Broadcast telegraph cell ids before an outbreak converts. */
  sendWarn: (cells: string[], remainingMs: number) => void
  /** Called once when the last corruption tile is cleared (eradication win). */
  onCleared: () => void
}

const PAINTER = 'corruption'

let deps: CorruptionDeps | null = null
let active = false
let pulseClockMs = 0
let pulseIndex = 0
let pendingOutbreak: { cells: string[]; atMs: number } | null = null
let seeded = false
let clearedFired = false
/** Wall-clock ms since round start (for telegraph timing). */
let roundElapsedMs = 0

export function initCorruption(d: CorruptionDeps): void {
  deps = d
}

export function isCorruptionActive(): boolean {
  return active
}

/** Begin a Corruption round after maze graph rebuild + paint clear. */
export function startCorruptionRound(): void {
  if (!deps) return
  active = true
  pulseClockMs = 0
  pulseIndex = 0
  pendingOutbreak = null
  seeded = false
  clearedFired = false
  roundElapsedMs = 0
  seedInitial()
  console.log(`[Corruption] round started (budget≈${corruptionPulseBudget(deps.playerCount())}/pulse)`)
}

export function stopCorruption(): void {
  active = false
  pendingOutbreak = null
  seeded = false
  clearedFired = false
}

/** Count cells currently held by Corruption. */
export function countCorruption(): number {
  if (!deps) return 0
  const g = deps.getGraph()
  if (!g) return 0
  let n = 0
  for (const id of g.nodes) {
    if (deps.teamOf(id) === Team.Corruption) n++
  }
  return n
}

/**
 * Tick while a Corruption round is live. Call from the server broadcast
 * system (same cadence as bots) with dt in seconds.
 */
export function tickCorruption(dtSec: number): void {
  if (!active || !deps) return
  const dtMs = dtSec * 1000
  roundElapsedMs += dtMs

  // Resolve pending outbreak first so convert lands on this tick's paintDelta.
  if (pendingOutbreak && roundElapsedMs >= pendingOutbreak.atMs) {
    const cells = pendingOutbreak.cells
    pendingOutbreak = null
    let gained = 0
    for (const id of cells) {
      if (canCorrupt(id) && deps.applyPaint(id, Team.Corruption, PAINTER)) gained++
    }
    // Small adjacent spill from each outbreak seed.
    for (const id of cells) {
      const g = deps.getGraph()
      if (!g) break
      const nbrs = g.adj.get(id) ?? []
      for (const n of nbrs) {
        if (gained >= CORRUPTION_OUTBREAK_BLOB) break
        if (canCorrupt(n) && deps.applyPaint(n, Team.Corruption, PAINTER)) gained++
      }
    }
    console.log(`[Corruption] outbreak converted +${gained} cell(s)`)
  }

  pulseClockMs += dtMs
  if (pulseClockMs >= CORRUPTION_PULSE_MS) {
    pulseClockMs -= CORRUPTION_PULSE_MS
    pulseIndex++
    runPulse()
  }

  checkCleared()
}

function seedInitial(): void {
  if (!deps) return
  const g = deps.getGraph()
  if (!g || g.nodes.size === 0) {
    console.log('[Corruption] seed skipped: no walkable graph')
    return
  }

  const foci = pickFoci(g, CORRUPTION_SEED_FOCI)
  let painted = 0
  for (const focus of foci) {
    painted += floodCorrupt(g, focus, CORRUPTION_SEED_RADIUS)
  }
  seeded = painted > 0
  console.log(`[Corruption] seeded ${painted} cell(s) from ${foci.length} focus/foci`)
  if (!seeded) {
    // Fallback: paint any deep (or any) cell so the mode is never empty.
    const pool = g.deepNodes.size > 0 ? [...g.deepNodes] : [...g.nodes]
    for (const id of pool) {
      if (canCorrupt(id) && deps.applyPaint(id, Team.Corruption, PAINTER)) {
        seeded = true
        console.log('[Corruption] fallback single-cell seed')
        break
      }
    }
  }
}

/** Mid-map foci: prefer deepNodes near scene centre (tile coords). */
function pickFoci(g: WalkableGraph, n: number): string[] {
  const pool = g.deepNodes.size > 0 ? [...g.deepNodes] : [...g.nodes]
  if (pool.length === 0) return []

  // Score by distance to mean tile centre of the pool.
  let sx = 0, sz = 0, c = 0
  for (const id of pool) {
    const p = parseTileXZ(id)
    if (!p) continue
    sx += p.tx; sz += p.tz; c++
  }
  const cx = c > 0 ? sx / c : 0
  const cz = c > 0 ? sz / c : 0

  const ranked = pool
    .map(id => {
      const p = parseTileXZ(id)
      const d = p ? (p.tx - cx) ** 2 + (p.tz - cz) ** 2 : 999
      return { id, d }
    })
    .sort((a, b) => a.d - b.d)

  const out: string[] = []
  const used = new Set<string>()
  // Spread foci: take nearest, then skip cells within ~2 tiles of a chosen focus.
  for (const { id } of ranked) {
    if (out.length >= n) break
    const p = parseTileXZ(id)
    if (!p) continue
    let near = false
    for (const u of used) {
      const q = parseTileXZ(u)
      if (!q) continue
      if (Math.abs(p.tx - q.tx) + Math.abs(p.tz - q.tz) < 2) { near = true; break }
    }
    if (near) continue
    if (!canCorrupt(id)) continue
    out.push(id)
    used.add(id)
  }
  // If we couldn't space them, just take the closest n corruptible.
  if (out.length < n) {
    for (const { id } of ranked) {
      if (out.length >= n) break
      if (out.includes(id)) continue
      if (canCorrupt(id)) out.push(id)
    }
  }
  return out
}

function parseTileXZ(cellId: string): { tx: number; tz: number } | null {
  const comma1 = cellId.indexOf(',')
  const comma2 = cellId.indexOf(',', comma1 + 1)
  if (comma1 < 0 || comma2 < 0) return null
  const tx = parseInt(cellId.slice(0, comma1), 10)
  const tz = parseInt(cellId.slice(comma1 + 1, comma2), 10)
  if (!isFinite(tx) || !isFinite(tz)) return null
  return { tx, tz }
}

/** BFS from focus, corrupt up to `radius` steps of cells (node count soft cap). */
function floodCorrupt(g: WalkableGraph, focus: string, radius: number): number {
  if (!deps) return 0
  const cap = Math.max(1, radius * radius * 2)
  const seen = new Set<string>()
  const q: Array<{ id: string; d: number }> = [{ id: focus, d: 0 }]
  seen.add(focus)
  let painted = 0
  while (q.length > 0 && painted < cap) {
    const { id, d } = q.shift()!
    if (d > radius) continue
    if (canCorrupt(id) && deps.applyPaint(id, Team.Corruption, PAINTER)) painted++
    if (d === radius) continue
    for (const n of g.adj.get(id) ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      q.push({ id: n, d: d + 1 })
    }
  }
  return painted
}

function runPulse(): void {
  if (!deps) return
  const g = deps.getGraph()
  if (!g) return

  const budget = corruptionPulseBudget(deps.playerCount())
  const frontier = collectFrontier(g)
  // Shuffle frontier for less predictable growth direction.
  for (let i = frontier.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = frontier[i]; frontier[i] = frontier[j]; frontier[j] = t
  }

  let gained = 0
  for (const id of frontier) {
    if (gained >= budget) break
    if (canCorrupt(id) && deps.applyPaint(id, Team.Corruption, PAINTER)) gained++
  }
  console.log(`[Corruption] pulse #${pulseIndex}: +${gained}/${budget} (frontier ${frontier.length})`)

  // Schedule outbreak telegraph on every Nth pulse.
  if (pulseIndex > 0 && pulseIndex % CORRUPTION_OUTBREAK_EVERY === 0) {
    scheduleOutbreak(g)
  }
}

/** Adjacent non-corruption walkable cells bordering current corruption. */
function collectFrontier(g: WalkableGraph): string[] {
  if (!deps) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of g.nodes) {
    if (deps.teamOf(id) !== Team.Corruption) continue
    for (const n of g.adj.get(id) ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      if (canCorrupt(n)) out.push(n)
    }
  }
  return out
}

function scheduleOutbreak(g: WalkableGraph): void {
  if (!deps) return
  // Pick a deep uncorrupted cell away from existing corruption when possible.
  const pool: string[] = []
  const src = g.deepNodes.size > 0 ? g.deepNodes : g.nodes
  for (const id of src) {
    if (canCorrupt(id)) pool.push(id)
  }
  if (pool.length === 0) return
  const seed = pool[Math.floor(Math.random() * pool.length)]
  const cells = [seed]
  deps.sendWarn(cells, CORRUPTION_TELEGRAPH_MS)
  pendingOutbreak = { cells, atMs: roundElapsedMs + CORRUPTION_TELEGRAPH_MS }
  console.log(`[Corruption] outbreak telegraph (${CORRUPTION_TELEGRAPH_MS}ms) at ${seed}`)
}

function canCorrupt(id: string): boolean {
  if (!deps) return false
  if (BASE_PAINT_LOCK && baseTeamOfCellId(id) !== 0) return false
  const t = deps.teamOf(id)
  // Can expand onto unpainted or player paint (overwrites turf). Not onto itself.
  return t !== Team.Corruption
}

function checkCleared(): void {
  if (!deps || !seeded || clearedFired) return
  if (countCorruption() > 0) return
  // Don't fire during the brief window before seed lands on the first tick.
  if (roundElapsedMs < 500) return
  clearedFired = true
  console.log('[Corruption] ERADICATED — all corruption cleared')
  deps.onCleared()
}
