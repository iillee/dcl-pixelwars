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

import { getRoundEndMs, SUMMARY_GROW_S, SUMMARY_HOLD_S, SUMMARY_SHRINK_S, summaryProgressAt } from './shared/roundTiming'
import { type RoundFormat } from './shared/pvp'
import { loadSplashCovering } from './client/splash'

export function getCountdownSeconds(): number {
  return Math.max(0, Math.floor((getRoundEndMs() - Date.now()) / 1000))
}

export function formatMMSS(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Round-end banner state ──────────────────────────────────────────
// Set when a round ends; read by ui.tsx. Scores on the banner are a snapshot
// of that round, so they stay put when the lobby swap clears live coverage.
// The overlay stays up until the player clicks it away or the next match starts
// (not on a timer, and not when the floor goes back to the lobby).

/** Kept for older call sites; the summary is no longer dismissed by this duration. */
export const BANNER_DURATION_MS = (SUMMARY_GROW_S + SUMMARY_HOLD_S + SUMMARY_SHRINK_S) * 1000

let dismissedAtMs = 0

/** Click on the summary: shrink it away now. Does nothing if it is not up. */
export function dismissSummary(nowMs: number = Date.now()): void {
  if (banner.shownAtMs === 0 || dismissedAtMs > 0) return
  dismissedAtMs = nowMs
}

/** Whole seconds until a timed close (none — the summary stays until click or the next round). */
export function summarySecondsLeft(_nowMs: number = Date.now()): number {
  return 0
}

export function getSummaryProgress(nowMs: number = Date.now()): number {
  return summaryProgressAt(nowMs, banner.shownAtMs, dismissedAtMs)
}

/** Drop the overlay immediately. Next-round start uses this; the lobby swap must not. */
export function clearSummary(): void {
  banner.visible = false
  banner.shownAtMs = 0
  dismissedAtMs = 0
}

function openBannerClock(): void {
  banner.visible = true
  banner.shownAtMs = Date.now()
  dismissedAtMs = 0
}

interface BannerState {
  visible: boolean
  /** Owned cells at round end, used to rank cards and compute shares. */
  red: number
  blue: number
  green: number
  yellow: number
  redPct: number
  bluePct: number
  greenPct: number
  yellowPct: number
  /** RED / BLUE / GREEN / YELLOW or TIE. */
  winner: string
  /** Full title: 'RED WINS!', 'RED & BLUE TIE!', or "IT'S A TIE!". */
  headline: string
  victorName: string
  kind: 'paint'
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
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  redPct: 0,
  bluePct: 0,
  greenPct: 0,
  yellowPct: 0,
  winner: 'TIE',
  headline: "IT'S A TIE!",
  victorName: '',
  kind: 'paint',
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
  const label = isPlayingTeam(team) ? teamName(team) : 'YOUR TEAM'
  const share = teamCells > 0 ? Math.round((cells / teamCells) * 100) : 0
  pendingCells = cells
  pendingPersonal = `YOU PAINTED ${cells} CELLS  ·  ${share}% OF ${label}`
  pendingAtMs = Date.now()
  // If the banner is already up (message order flipped), show it now.
  if (banner.visible) { banner.personal = pendingPersonal; banner.myCells = cells; pendingPersonal = '' }
}

export function showRoundEndBanner(red: number, blue: number, total: number, green = 0, yellow = 0): void {
  const cov: TeamCoverage = { red, blue, green, yellow, total }
  const pcts = summaryPcts(cov)
  banner.visible = true
  banner.red = red
  banner.blue = blue
  banner.green = green
  banner.yellow = yellow
  banner.redPct = Number(pcts.red.toFixed(1))
  banner.bluePct = Number(pcts.blue.toFixed(1))
  banner.greenPct = Number(pcts.green.toFixed(1))
  banner.yellowPct = Number(pcts.yellow.toFixed(1))
  const headline = winnerHeadline(cov)
  banner.headline = headline
  banner.winner = headline.endsWith(' WINS!') ? headline.slice(0, -6) : 'TIE'
  banner.victorName = ''
  banner.kind = 'paint'
  openBannerClock()
  // Only use a result from this boundary (guards against a stale one).
  banner.personal = pendingPersonal && Date.now() - pendingAtMs < 10000 ? pendingPersonal : ''
  banner.myCells = banner.personal ? pendingCells : 0
  banner.total = total
  pendingPersonal = ''
  banner.owners = Date.now() - pendingOwnersAtMs < 10000 ? pendingOwners : []
  pendingOwners = []
}

export function getBanner(): BannerState {
  // Stay visible until the shrink-on-click finishes or clearSummary() runs.
  if (banner.visible && dismissedAtMs > 0 && getSummaryProgress() < 0) {
    banner.visible = false
  }
  return banner
}

// ─── Server event subscriber ────────────────────────────────────
import { events } from './shared/events'
import { coverage, lastMatchCoverage } from './paint'
import { TEAM_NAME, coveragePct, isPlayingTeam, teamName, winnerHeadline, type TeamCoverage } from './shared/team'
import { pickWalkableTotal, summaryPcts } from './shared/summaryLayout'

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
  // Scores arrive on round:ended and are frozen on the banner. The lobby
  // roundReset that follows swaps the floor and must not dismiss this screen
  // or rewrite those scores.
  events.on('round:ended', ({ finalRed, finalBlue, finalGreen, finalYellow, finalTotal }) => {
    const snap = lastMatchCoverage()
    const red = finalRed
    const blue = finalBlue
    const green = finalGreen ?? 0
    const yellow = finalYellow ?? 0
    const painted = red + blue + green + yellow
    const walkable = pickWalkableTotal(snap?.total ?? 0, coverage().total, finalTotal ?? 0, painted)
    console.log(
      `[Client] roundEnded final red=${red} blue=${blue} green=${green} yellow=${yellow} ` +
      `serverTotal=${finalTotal} localTotal=${coverage().total} matchTotal=${snap?.total ?? 0} walkable=${walkable}`
    )
    showRoundEndBanner(red, blue, walkable, green, yellow)
  })
  events.on('round:clock', ({ idx, active, format }) => {
    // Late join into a round already running (no roundReset for them). Resyncs of the same idx do not replay.
    if (active) armFormatSplash(format, idx, false)
  })
  events.on('round:reset', ({ seed, format, layout }) => {
    console.log(`[Client] roundReset seed=${seed} format=${format} layout=${layout ?? 'arena'}`)
    if (layout === 'lobby') return
    clearSummary()
    armFormatSplash(format, seed, true)
  })
}

// ─── Format splash (playtest) ────────────────────────────────────────
// Big centered banner for ~2.5s when a round starts, and when a late joiner
// enters a round already running. No countdown and no input lock — the round
// is already going. The load splash can cover the first seconds, so the
// timer starts once that cover is gone.
export const FORMAT_SPLASH_MS = 2500

let currentFormat: RoundFormat = 'pvp'
let shownIdx = -1
let armedFormat: RoundFormat | null = null
let formatStartedAt = 0

function armFormatSplash(format: RoundFormat, idx: number, fromReset: boolean): void {
  currentFormat = format
  if (!fromReset && shownIdx === idx) return
  shownIdx = idx
  armedFormat = format
  formatStartedAt = 0
}

/** The round that just finished (or is live). Summary uses this for "Next round". */
export function nextRoundBlurb(): string {
  return 'Next round: Pick your team'
}

/** The PIXELWARS / Classic pop-up at round start is retired. currentFormat is still set by armFormatSplash. */
export function getFormatSplash(): { format: RoundFormat; title: string; sub: string } | null {
  return null
}
