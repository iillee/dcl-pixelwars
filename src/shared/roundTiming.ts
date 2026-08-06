/**
 * roundTiming.ts — shared UTC-boundary round timer.
 *
 * Pure functions over Date.now(). No engine, no CRDT, no runtime-specific
 * imports — safe to import from BOTH the client (browser QuickJS) and the
 * server (headless hammurabi-server).
 *
 * This is the single source of truth for round cadence. Previously the
 * constant was duplicated in src/client/round.ts and src/server/server.ts
 * (server), which silently drifted if only one side was edited.
 *
 * Chosen cadence: 5 minutes. Long enough to explore the 176m maze with
 * verticality, short enough that respawning won't feel punishing.
 * Splatoon Turf War for comparison runs 3 min.
 */

export const ROUND_LENGTH_MINUTES = 5
export const ROUND_INTERVAL_MS = ROUND_LENGTH_MINUTES * 60 * 1000

export function getRoundIndex(): number {
  return Math.floor(Date.now() / ROUND_INTERVAL_MS)
}

export function getRoundEndMs(): number {
  return (getRoundIndex() + 1) * ROUND_INTERVAL_MS
}
