/**
 * roundTiming.ts — shared UTC-boundary round timer.
 *
 * Pure functions over Date.now(). No engine, no CRDT, no runtime-specific
 * imports — safe to import from BOTH the client (browser QuickJS) and the
 * server (headless hammurabi-server).
 *
 * This is the single source of truth for round cadence. Previously the
 * constant was duplicated in src/round.ts (client) and src/server/server.ts
 * (server), which silently drifted if only one side was edited.
 *
 * Chosen cadence: 3 minutes (was 5; Luke, Oct 2026). Splatoon Turf War
 * for comparison also runs 3 min.
 */

export const ROUND_LENGTH_MINUTES = 3
export const ROUND_INTERVAL_MS = ROUND_LENGTH_MINUTES * 60 * 1000

// Round-end summary open/close motion. The server does not wait this long:
// the lobby floor is swapped on roundEnded. Clients keep the win screen up
// until the player dismisses it or the next match starts, not for SUMMARY_MS.

const ease = (lin: number): number => {
  const x = Math.max(0, Math.min(1, lin))
  return x * x * (3 - 2 * x)
}

/** 0 = just opening, 1 = fully open; -1 = summary not showing. Ease-in-out. */
export function summaryProgressAt(nowMs: number, shownAtMs: number, closedAtMs: number): number {
  if (shownAtMs === 0) return -1
  const grown = ease(Math.min(1, Math.max(0, (Math.max(closedAtMs || nowMs, shownAtMs) - shownAtMs) / 1000 / SUMMARY_GROW_S)))
  if (closedAtMs > 0) {
    const s = (nowMs - closedAtMs) / 1000 / SUMMARY_SHRINK_S
    if (s >= 1) return -1
    return grown * (1 - ease(s))
  }
  const elapsed = (nowMs - shownAtMs) / 1000
  if (elapsed < 0) return -1
  return elapsed < SUMMARY_GROW_S ? ease(elapsed / SUMMARY_GROW_S) : 1
}
export const SUMMARY_GROW_S = 0.4
export const SUMMARY_HOLD_S = 10
export const SUMMARY_SHRINK_S = 0.4
export const SUMMARY_MS = (SUMMARY_GROW_S + SUMMARY_HOLD_S + SUMMARY_SHRINK_S) * 1000

// Round-on-join: the SERVER owns the round (counter + end time). It starts a round when a player joins
// while idle, chains rounds while anyone is connected, and goes idle when a round ends with nobody there.
// Clients mirror it from the 'roundClock' message (remaining ms, so local clock skew doesn't matter).
// Readers keep calling getRoundIndex() / getRoundEndMs().
let roundIdx = Math.floor(Date.now() / ROUND_INTERVAL_MS) // starting counter (varies the first maze seed)
let roundEnd = 0
let roundActive = false

export function getRoundIndex(): number {
  return roundIdx
}

/** End of the running round (local ms). Idle: now, so the countdown reads 0. */
export function getRoundEndMs(): number {
  return roundActive ? roundEnd : Date.now()
}

export function isRoundActive(): boolean {
  return roundActive
}

export function setRoundState(idx: number, endMs: number, active: boolean): void {
  roundIdx = idx; roundEnd = endMs; roundActive = active
}
