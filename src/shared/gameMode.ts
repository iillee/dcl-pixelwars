/**
 * gameMode.ts — Pixelwars vs Corruption (Ooze) mode ids + vote resolution.
 *
 * Shared by client splash UI and server lock logic. Corruption/Ooze is not playable yet
 * (OOZE_READY = false): if it wins a vote we fall back to Pixelwars and tell
 * clients via modeVoteLocked.fallback.
 */

export const GameMode = {
  Pixelwars: 0,
  Ooze: 1,
} as const

export type GameModeId = (typeof GameMode)[keyof typeof GameMode]

/** Flip to true when Corruption (Ooze) rounds are implemented. */
export const OOZE_READY = false

export const MODE_LABEL: Record<GameModeId, string> = {
  [GameMode.Pixelwars]: 'PIXELWARS',
  [GameMode.Ooze]: 'CORRUPTION',
}

export const MODE_SUB: Record<GameModeId, string> = {
  [GameMode.Pixelwars]: 'TEAM PAINT PVP',
  [GameMode.Ooze]: 'PVE ERADICATION',
}

/** Vote window after the round-end summary closes (Luke: 10 s MAX).
 * Server ends early once every present player has voted.
 */
export const MODE_VOTE_MS = 10_000

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
