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
const cellTeam = new Map<string, number>()

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
export function applyPaint(id: string, team: number): boolean {
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

/** Live coverage counters. Called by the 5s log tick. */
export function coverage(): { red: number; blue: number; total: number } {
  let red = 0, blue = 0
  for (const t of cellTeam.values()) {
    if (t === 1) red++
    else if (t === 2) blue++
  }
  return { red, blue, total: cellTeam.size }
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

/** Round reset (Step 6 will call this). */
export function clearAll(): void {
  cellTeam.clear()
  dirty.clear()
}
