/**
 * paintState.ts — authoritative paint map.
 *
 * Phase 4 Step 3: server owns the paint state; client sends cell ids it
 * has painted (paintTick), we apply them here and expose coverage counters.
 * No broadcast yet — Step 4 adds paintDelta.
 *
 * Storage: Map<cellId, team> for now. Compact Uint8Array + numeric cellId
 * indexing arrives in Step 5 when snapshot bandwidth matters. Map is fine
 * for a few thousand cells and keeps this step's diff small.
 *
 * Round resets: clearAll() called from roundLoop (Step 6). Not called yet.
 */

// team values match Team enum in src/paint.ts: 1 = Red, 2 = Blue.
import { baseTeamOfCellId } from '../maze/generator'
import { BASE_PAINT_LOCK } from '../maze/level'

const cellTeam = new Map<string, number>()
// Owner of each painted cell = its last painter (player address, or `bot:<id>`). Round summary shades.
const cellPainter = new Map<string, string>()

// Changes accumulated since the last drainDelta(). Map (not array) so
// last-write-wins within a tick — if Red then Blue paint the same cell
// in the same 200ms window, only Blue ends up in the broadcast.
const dirty = new Map<string, number>()

/**
 * Apply a paint from a validated sender. Overwrites existing color.
 * Returns true only when the cell actually changed team (unpainted →
 * this team, or enemy → this team). Callers use the return value to
 * attribute leaderboard credit only to real "gained" cells, so a player
 * standing still on their own paint doesn't inflate their score by
 * ~90/sec (9-cell footprint × 10 Hz outbox flush).
 */
export function applyPaint(id: string, team: number, painter: string): boolean {
  // Sky-mode bases are locked to their team colour: not paintable, not counted.
  if (BASE_PAINT_LOCK && baseTeamOfCellId(id) !== 0) return false
  // Last painter owns the cell, even a teammate re-painting our own colour (no score credit for that).
  cellPainter.set(id, painter)
  const prev = cellTeam.get(id)
  if (prev === team) return false
  cellTeam.set(id, team)
  dirty.set(id, team)
  return true
}

/**
 * Drain the dirty buffer for broadcast. Called by the 5Hz server tick.
 * Returns [] when nothing changed (broadcast skipped, save the bandwidth).
 */
export function drainDelta(): Array<{ id: string; team: number }> {
  if (dirty.size === 0) return []
  const out: Array<{ id: string; team: number }> = []
  for (const [id, team] of dirty) out.push({ id, team })
  dirty.clear()
  return out
}

/**
 * Point lookup by cellId. Used by bot smart-targeting (samples ~48
 * cells per target selection); would be O(N) if we scanned getFullState.
 * Returns 0 when unpainted so callers can treat "team 0 = neutral".
 */
export function teamOfCell(id: string): number {
  return cellTeam.get(id) ?? 0
}

/** Owned cells per painter (last painter of each painted cell), largest first. */
export function ownerCounts(): Array<{ id: string; team: number; cells: number }> {
  const m = new Map<string, { id: string; team: number; cells: number }>()
  for (const [cell, team] of cellTeam) {
    const id = cellPainter.get(cell) ?? '?'
    const k = id + '|' + team
    const e = m.get(k)
    if (e) e.cells++
    else m.set(k, { id, team, cells: 1 })
  }
  return [...m.values()].sort((a, b) => b.cells - a.cells)
}

/** Live coverage counters. Called by the 5s log tick. */
export function coverage(): { red: number; blue: number; corruption: number; total: number } {
  let red = 0, blue = 0, corruption = 0
  for (const t of cellTeam.values()) {
    if (t === 1) red++
    else if (t === 2) blue++
    else if (t === 3) corruption++
  }
  return { red, blue, corruption, total: cellTeam.size }
}

/**
 * Full state dump for the snapshot message. Returns every painted cell
 * as a fresh array so the caller can serialize without touching internal
 * state. Empty when nothing's been painted this round.
 */
export function getFullState(): Array<{ id: string; team: number }> {
  const out: Array<{ id: string; team: number }> = []
  for (const [id, team] of cellTeam) out.push({ id, team })
  return out
}

/**
 * Reservoir-sample up to `k` cellIds currently painted by any team
 * OTHER than `myTeam` (i.e. enemy cells; neutral/unpainted cells are
 * excluded). Used by the bot's smart-target picker to bias movement
 * toward contested territory instead of blank floor.
 *
 * Reservoir sampling (Algorithm R): single O(N) pass with no
 * intermediate array of enemy ids, so it scales cleanly even when the
 * map is mostly enemy paint. Empty result = no enemy paint exists;
 * caller falls back to the neutral-cell strategy.
 */
export function sampleEnemyCells(myTeam: number, k: number): string[] {
  const out: string[] = []
  let seen = 0
  for (const [id, t] of cellTeam) {
    if (t === 0 || t === myTeam) continue
    if (out.length < k) {
      out.push(id)
    } else {
      const j = Math.floor(Math.random() * (seen + 1))
      if (j < k) out[j] = id
    }
    seen++
  }
  return out
}

/** Round reset (Step 6 will call this). */
export function clearAll(): void {
  cellTeam.clear()
  cellPainter.clear()
  dirty.clear()
}
