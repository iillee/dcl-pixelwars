// ─── UTC-boundary round timer ────────────────────────────────────────
// Rounds align to wall-clock UTC boundaries so every client — no matter
// when they joined, no matter their network state — computes the same
// roundIndex and the same nextBoundary. Zero CRDT sync required for the
// timer itself; the seed used for maze regen is derived deterministically
// from roundIndex, so all clients converge on the same maze at the same
// instant just by reading Date.now().
//
// Cadence + pure helpers live in src/shared/roundTiming.ts so the server
// (headless runtime) can import them too. This file adds client-only
// concerns: countdown formatting and the round-end banner state.

export {
  ROUND_LENGTH_MINUTES,
  ROUND_INTERVAL_MS,
  getRoundIndex,
  getRoundEndMs,
} from './shared/roundTiming'

import { getRoundEndMs } from './shared/roundTiming'

export function getCountdownSeconds(): number {
  return Math.max(0, Math.floor((getRoundEndMs() - Date.now()) / 1000))
}

export function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Round-end banner state ──────────────────────────────────────────
// Set by index.ts when a round boundary is crossed; read by ui.tsx. The
// banner shows the just-finished round's coverage % for BANNER_DURATION_MS,
// which overlaps the maze grow-in so the transition reads as "results →
// new arena" rather than a dead pause.

export const BANNER_DURATION_MS = 6000

interface BannerState {
  visible: boolean
  redPct: number
  bluePct: number
  winner: 'RED' | 'BLUE' | 'TIE'
  shownAtMs: number
}

const banner: BannerState = {
  visible: false,
  redPct: 0,
  bluePct: 0,
  winner: 'TIE',
  shownAtMs: 0,
}

export function showRoundEndBanner(red: number, blue: number, total: number): void {
  const redPct  = total > 0 ? (red  / total) * 100 : 0
  const bluePct = total > 0 ? (blue / total) * 100 : 0
  banner.visible = true
  banner.redPct = redPct
  banner.bluePct = bluePct
  banner.winner = redPct > bluePct ? 'RED' : bluePct > redPct ? 'BLUE' : 'TIE'
  banner.shownAtMs = Date.now()
}

export function getBanner(): BannerState {
  // Auto-hide after the display window.
  if (banner.visible && Date.now() - banner.shownAtMs > BANNER_DURATION_MS) {
    banner.visible = false
  }
  return banner
}

// ─── Server event subscriber ────────────────────────────────────
import { events } from './shared/events'
import { coverage } from './paint'

/**
 * initRoundNet — shows the end-of-round banner when the server declares
 * a round boundary. Denominator uses the client's walkable-cell count
 * (from paint.coverage) rather than the server's painted-cell count —
 * otherwise a round where only one team painted would show 100%.
 */
export function initRoundNet(): void {
  events.on('round:reset', ({ seed, finalRed, finalBlue, finalTotal }) => {
    const localTotal = coverage().total
    console.log(
      `[Client] roundReset seed=${seed} final red=${finalRed} blue=${finalBlue} ` +
      `serverTotal=${finalTotal} localTotal=${localTotal}`
    )
    showRoundEndBanner(finalRed, finalBlue, localTotal)
  })
}
