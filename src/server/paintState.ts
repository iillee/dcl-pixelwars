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

/** Apply a paint from a validated sender. Overwrites existing color. */
export function applyPaint(id: string, team: number): void {
  cellTeam.set(id, team)
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

/** Round reset (Step 6 will call this). */
export function clearAll(): void {
  cellTeam.clear()
}
