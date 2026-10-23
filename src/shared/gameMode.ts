/**
 * gameMode.ts — Pixelwars vs Corruption (Ooze) mode ids + vote resolution.
 *
 * Shared by client splash UI and server lock logic. Corruption/Ooze is
 * playable when OOZE_READY is true; otherwise an Ooze vote falls back to
 * Pixelwars via modeVoteLocked.fallback.
 */

export const GameMode = {
  Pixelwars: 0,
  Ooze: 1,
} as const

export type GameModeId = (typeof GameMode)[keyof typeof GameMode]

/** Flip to true when Corruption (Ooze) rounds are implemented. */
export const OOZE_READY = true

export const MODE_LABEL: Record<GameModeId, string> = {
  [GameMode.Pixelwars]: 'PIXELWARS',
  [GameMode.Ooze]: 'CORRUPTION',
}

export const MODE_SUB: Record<GameModeId, string> = {
  [GameMode.Pixelwars]: 'TEAM PAINT PVP',
  [GameMode.Ooze]: 'PVE ERADICATION',
}

/** Longer blurbs for the mode-confirm splash step. */
export const MODE_DESC: Record<GameModeId, string> = {
  [GameMode.Pixelwars]: 'Team paint PvP. Cover the maze in your colour before time runs out.',
  [GameMode.Ooze]: 'Paint to eradicate the spreading black. Clear every corrupted tile to win.',
}

/** Vote window after the round-end summary closes (Luke: 10 s MAX).
 * Server ends early once every present player has voted.
 */
export const MODE_VOTE_MS = 10_000

// ─── Corruption (Ooze) cadence / budget ───────────────────────────────
/** Growth pulse interval (~6–7s; was 10s). */
export const CORRUPTION_PULSE_MS = 6_500
/** Outbreak every N pulses (telegraphed burst, not constant spam). */
export const CORRUPTION_OUTBREAK_EVERY = 3
/** Visible warning before an outbreak converts cells. */
export const CORRUPTION_TELEGRAPH_MS = 1_500
/** Seed foci at round start (mid-map). */
export const CORRUPTION_SEED_FOCI = 3
/** Soft BFS radius (steps) around each seed focus. */
export const CORRUPTION_SEED_RADIUS = 2
/** Max cells an outbreak blob may claim (seed + adjacent spill). */
export const CORRUPTION_OUTBREAK_BLOB = 8

/**
 * Shared expansion budget per pulse — sublinear in player count so solo
 * stays fair and a full lobby doesn't instantly flood the map.
 *   budget = 10 + 5 * sqrt(n)   (n = present humans, min 1; was 6+4*sqrt)
 */
export function corruptionPulseBudget(playerCount: number): number {
  const n = Math.max(1, playerCount)
  return Math.max(6, Math.round(10 + 5 * Math.sqrt(n)))
}

/**
 * Pick the winning mode from tallies.
 * - Strict majority wins.
 * - Tie (including 0–0): keep `previous` (or Pixelwars if none).
 * - Ooze wins but !OOZE_READY → Pixelwars with fallback=true.
 */
export function resolveModeVote(
  pixelwars: number,
  ooze: number,
  previous: GameModeId = GameMode.Pixelwars,
): { mode: GameModeId; wanted: GameModeId; fallback: boolean } {
  let wanted: GameModeId
  if (ooze > pixelwars) wanted = GameMode.Ooze
  else if (pixelwars > ooze) wanted = GameMode.Pixelwars
  else wanted = previous

  if (wanted === GameMode.Ooze && !OOZE_READY) {
    return { mode: GameMode.Pixelwars, wanted, fallback: true }
  }
  return { mode: wanted, wanted, fallback: false }
}
