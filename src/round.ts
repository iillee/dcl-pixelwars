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
  SUMMARY_GROW_S,
  SUMMARY_HOLD_S,
  SUMMARY_SHRINK_S,
  getRoundIndex,
  getRoundEndMs,
} from './shared/roundTiming'

import { getRoundEndMs, SUMMARY_GROW_S, SUMMARY_HOLD_S, SUMMARY_SHRINK_S } from './shared/roundTiming'

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


// Round-end summary timing lives in shared/roundTiming (server waits the same SUMMARY_MS).
/** Dim backdrop + banner state live exactly as long as the summary animation. */
export const BANNER_DURATION_MS = (SUMMARY_GROW_S + SUMMARY_HOLD_S + SUMMARY_SHRINK_S) * 1000

/** Click on the summary: skip the rest of the hold and shrink away now. */
export function dismissSummary(nowMs: number = Date.now()): void {
  const holdEnd = banner.shownAtMs + (SUMMARY_GROW_S + SUMMARY_HOLD_S) * 1000
  if (banner.shownAtMs > 0 && nowMs < holdEnd) banner.shownAtMs -= holdEnd - Math.max(nowMs, banner.shownAtMs + SUMMARY_GROW_S * 1000)
}

/** Whole seconds until the summary closes (for the "back in Ns" line). */
export function summarySecondsLeft(nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((banner.shownAtMs + BANNER_DURATION_MS - nowMs) / 1000))
}

/** 0 = normal bar, 1 = fully expanded square; -1 = summary not running. Ease-in-out. */
export function getSummaryProgress(nowMs: number = Date.now()): number {
  if (banner.shownAtMs === 0) return -1
  const t = (nowMs - banner.shownAtMs) / 1000
  const total = SUMMARY_GROW_S + SUMMARY_HOLD_S + SUMMARY_SHRINK_S
  if (t < 0 || t >= total) return -1
  const lin = t < SUMMARY_GROW_S ? t / SUMMARY_GROW_S
    : t < SUMMARY_GROW_S + SUMMARY_HOLD_S ? 1
    : 1 - (t - SUMMARY_GROW_S - SUMMARY_HOLD_S) / SUMMARY_SHRINK_S
  return lin * lin * (3 - 2 * lin)
}

interface BannerState {
  visible: boolean
  redPct: number
  bluePct: number
  winner: 'RED' | 'BLUE' | 'TIE'
  shownAtMs: number
  /** Personal line, e.g. "YOU PAINTED 124 CELLS · 38% OF RED". '' if none. */
  personal: string
  /** Walkable cells on the map (territory % denominator) and our own cells painted this round. */
  total: number
  myCells: number
  /** Owned cells per painter at round end (roundOwners). Empty if it didn't arrive. */
  owners: Array<{ id: string; name: string; team: number; cells: number; kos: number; deaths: number; painted: number }>
}

const banner: BannerState = {
  visible: false,
  redPct: 0,
  bluePct: 0,
  winner: 'TIE',
  shownAtMs: 0,
  personal: '',
  total: 0,
  myCells: 0,
  owners: [],
}

// Personal result for the round that just ended. Arrives (roundResult)
// just before roundReset; consumed when the banner opens.
let pendingPersonal = ''
let pendingAtMs = 0
let pendingCells = 0
let pendingOwners: Array<{ id: string; name: string; team: number; cells: number; kos: number; deaths: number; painted: number }> = []
let pendingOwnersAtMs = 0

export function setRoundResult(cells: number, teamCells: number, team: number): void {
  const teamName = team === 1 ? 'RED' : team === 2 ? 'BLUE' : 'YOUR TEAM'
  const share = teamCells > 0 ? Math.round((cells / teamCells) * 100) : 0
  pendingCells = cells
  pendingPersonal = `YOU PAINTED ${cells} CELLS  ·  ${share}% OF ${teamName}`
  pendingAtMs = Date.now()
  // If the banner is already up (message order flipped), show it now.
  if (banner.visible) { banner.personal = pendingPersonal; banner.myCells = cells; pendingPersonal = '' }
}

export function showRoundEndBanner(red: number, blue: number, total: number): void {
  const redPct  = total > 0 ? (red  / total) * 100 : 0
  const bluePct = total > 0 ? (blue / total) * 100 : 0
  banner.visible = true
  banner.redPct = redPct
  banner.bluePct = bluePct
  banner.winner = redPct > bluePct ? 'RED' : bluePct > redPct ? 'BLUE' : 'TIE'
  banner.shownAtMs = Date.now()
  // Only use a result from this boundary (guards against a stale one).
  banner.personal = pendingPersonal && Date.now() - pendingAtMs < 10000 ? pendingPersonal : ''
  banner.myCells = banner.personal ? pendingCells : 0
  banner.total = total
  pendingPersonal = ''
  banner.owners = Date.now() - pendingOwnersAtMs < 10000 ? pendingOwners : []
  pendingOwners = []
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
  events.on('round:owners', ({ owners }) => {
    pendingOwners = owners; pendingOwnersAtMs = Date.now()
    if (banner.visible && banner.owners.length === 0) banner.owners = owners
  })
  events.on('round:result', ({ cells, teamCells, team }) => setRoundResult(cells, teamCells, team))
  // Scores arrive on round:ended (summary). round:reset rebuilds the maze after the summary wait.
  events.on('round:ended', ({ finalRed, finalBlue, finalTotal }) => {
    const localTotal = coverage().total
    console.log(
      `[Client] roundEnded final red=${finalRed} blue=${finalBlue} ` +
      `serverTotal=${finalTotal} localTotal=${localTotal}`
    )
    showRoundEndBanner(finalRed, finalBlue, localTotal)
  })
  events.on('round:reset', ({ seed }) => {
    console.log(`[Client] roundReset seed=${seed} (maze rebuild after summary)`)
  })
}
