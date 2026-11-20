/**
 * Round-end summary layout. Pure numbers so we can verify overflow and
 * render previews without the explorer.
 */
import { PLAYING_TEAMS, leadingTeams, rankedTeams, type PlayingTeam, type TeamCoverage } from './team'

export const SUMMARY_K_MAX = 1.6
export const SUMMARY_PILL_W = 720
export const SUMMARY_PILL_H = 48
export const SUMMARY_TITLE_FONT = 72
export const SUMMARY_HEAD_H = 110
export const SUMMARY_GAP = 32
export const SUMMARY_SUB_FONT = 18
export const SUMMARY_PILL_FONT = 30
export const SUMMARY_CARD_W = 580
export const SUMMARY_CARD_GAP = 40
export const SUMMARY_ROW_H = 44
export const SUMMARY_ROW_FONT = 22
export const SUMMARY_HEAD_FONT = 15
export const SUMMARY_FONT_MIN = 12
export const SUMMARY_FIT = 0.94
export const SUMMARY_K_READ = 0.75
/** Tight gap between title words (em), so "BLUE WINS!" stays together. */
export const TITLE_WORD_GAP = 0.08
export const SUMMARY_BOLD_PX = 0.035
/** Server buildStandings keeps the payload under 12 KB with this many rows total. */
export const SUMMARY_OWNERS_MAX = 60
/** Fixed unscaled height of every team card, empty or full. */
export const SUMMARY_CARD_H = 300
export const SUMMARY_CARD_PAD_Y = 24
export const SUMMARY_CARD_HEAD_H = 40
export const SUMMARY_CARD_BODY_H = SUMMARY_CARD_H - SUMMARY_CARD_PAD_Y - SUMMARY_CARD_HEAD_H
/** Switch a team's roster to two compact columns above this many players. */
export const SUMMARY_TWO_COL_AFTER = 6
/** Smallest single-column row that stays readable. */
export const SUMMARY_ROW_MIN_H = 22
/** Smallest two-column compact row; below this the body scrolls. */
export const SUMMARY_COMPACT_MIN_H = 18

export type SummaryRow = { id: string; name: string; team: number; cells: number; kos: number; deaths: number; painted: number }

export const textW = (t: string, f: number) => t.length * f * 0.62
export const textWSafe = (t: string, f: number) => t.length * f * 0.8

/** Title font: the older 72 px look, shrunk so the words plus a tight gap fit one line. */
export function titleFontFor(words: string[], k: number, availW: number): number {
  const em = words.reduce((s, w) => s + textWSafe(w, 1), 0) + Math.max(0, words.length - 1) * TITLE_WORD_GAP
  return Math.min(SUMMARY_TITLE_FONT * k, availW / Math.max(em, 0.01))
}

export type RosterLayout = { columns: 1 | 2; rowH: number; font: number; scroll: boolean }

/**
 * Fit every player into the card body. Rows shrink as the team grows.
 * Above SUMMARY_TWO_COL_AFTER the roster becomes two compact columns
 * (name + tiles). Scrolling is only used when even the compact minimum
 * cannot fit the max cap.
 */
export function rosterLayout(count: number, bodyH: number = SUMMARY_CARD_BODY_H): RosterLayout {
  const n = Math.max(1, count)
  if (n <= SUMMARY_TWO_COL_AFTER) {
    const rowH = Math.min(SUMMARY_ROW_H + 6, bodyH / n)
    const font = Math.max(SUMMARY_FONT_MIN, Math.min(SUMMARY_ROW_FONT, rowH * 0.5))
    return { columns: 1, rowH, font, scroll: rowH < SUMMARY_ROW_MIN_H && n * SUMMARY_ROW_MIN_H > bodyH }
  }
  const rows = Math.ceil(n / 2)
  const fitH = bodyH / rows
  if (fitH >= SUMMARY_COMPACT_MIN_H) {
    const rowH = Math.min(SUMMARY_ROW_H, fitH)
    const font = Math.max(SUMMARY_FONT_MIN, Math.min(SUMMARY_ROW_FONT * 0.85, rowH * 0.55))
    return { columns: 2, rowH, font, scroll: false }
  }
  return { columns: 2, rowH: SUMMARY_COMPACT_MIN_H, font: SUMMARY_FONT_MIN, scroll: true }
}

export const tablesW = (stacked: boolean) => stacked ? SUMMARY_CARD_W : SUMMARY_CARD_W * 2 + SUMMARY_CARD_GAP

/**
 * Scale + arrangement for the four equal-height team cards under `top` px
 * (unscaled) of other content. A 2×2 grid whenever the canvas is wide
 * enough to stay readable; phones and narrow windows stack.
 */
export function tablesLayout(
  _all: { team: number }[],
  cv: { w: number; h: number },
  top: number,
): { k: number; stacked: boolean } {
  const gridW = Math.max(SUMMARY_CARD_W * 2 + SUMMARY_CARD_GAP, SUMMARY_PILL_W)
  const gridH = SUMMARY_CARD_H * 2 + SUMMARY_GAP * 0.6
  const stackH = top + SUMMARY_CARD_H * PLAYING_TEAMS.length + SUMMARY_GAP * 0.6 * 3
  const kGrid = Math.min(cv.w * SUMMARY_FIT / gridW, cv.h * SUMMARY_FIT / (top + gridH))
  const kStack = Math.min(cv.w * SUMMARY_FIT / Math.max(SUMMARY_CARD_W, SUMMARY_PILL_W), cv.h * SUMMARY_FIT / stackH)
  const canGrid = cv.w * SUMMARY_FIT >= gridW * SUMMARY_K_READ
  const stacked = !canGrid
  const k = Math.min(SUMMARY_K_MAX, stacked ? kStack : kGrid)
  return { k, stacked }
}

/** Sort a team's rows by territory, then tiles painted. Everyone is kept. */
export function sortTeamRows<T extends { cells: number; painted?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    if (b.cells !== a.cells) return b.cells - a.cells
    return (b.painted ?? 0) - (a.painted ?? 0)
  })
}

/** Cell counts plus the walkable denominator used for area % and the overall bar. */
export type TeamShareInput = Pick<TeamCoverage, 'red' | 'blue' | 'green' | 'yellow' | 'total'>

/**
 * Prefer the in-match walkable snapshot. The live total is next, but only
 * while it still looks like the arena (not 0 after the lobby swap). The
 * server's finalTotal is painted-only today, so it is used only when it is
 * clearly larger than the painted sum (a true walkable count).
 */
export function pickWalkableTotal(matchTotal: number, localTotal: number, serverTotal: number, painted: number): number {
  if (matchTotal > 0) return matchTotal
  if (localTotal > 0) return localTotal
  if (serverTotal > painted) return serverTotal
  return 0
}

/** Team shares and the unpainted remainder, as percents of the walkable total. */
export function summaryPcts(input: TeamShareInput): { red: number; blue: number; green: number; yellow: number; white: number } {
  const red = Math.max(0, input.red)
  const blue = Math.max(0, input.blue)
  const green = Math.max(0, input.green)
  const yellow = Math.max(0, input.yellow)
  const t = Math.max(0, input.total)
  if (t <= 0) return { red: 0, blue: 0, green: 0, yellow: 0, white: 0 }
  const white = Math.max(0, t - red - blue - green - yellow)
  return {
    red: (red / t) * 100,
    blue: (blue / t) * 100,
    green: (green / t) * 100,
    yellow: (yellow / t) * 100,
    white: (white / t) * 100,
  }
}

export function areaPct(cells: number, total: number): number {
  return total > 0 ? Math.round((Math.max(0, cells) / total) * 100) : 0
}

/** Rank teams by owned cells. No leaders when every team is at 0, so a missing total cannot paint every card as the winner. */
export function summaryRank(input: TeamShareInput): { order: PlayingTeam[]; leaders: PlayingTeam[] } {
  const cov: TeamCoverage = {
    red: input.red,
    blue: input.blue,
    green: input.green,
    yellow: input.yellow,
    total: input.total,
  }
  const max = Math.max(input.red, input.blue, input.green, input.yellow)
  return { order: rankedTeams(cov), leaders: max > 0 ? leadingTeams(cov) : [] }
}

/** Mid-game standings: a compact centered panel that does not grow with ultrawide canvases. */
export const STANDINGS_MAX_W = 1000
export const STANDINGS_K_MAX = 1
export const STANDINGS_SIDE = 24
export const STANDINGS_BOTTOM = 20

/** Unscaled body height that tightly wraps this many players (at least one row). */
export function cardBodyContentH(count: number, bodyCap: number = SUMMARY_CARD_BODY_H): { lay: RosterLayout; bodyH: number } {
  const n = Math.max(1, count)
  const lay = rosterLayout(n, bodyCap)
  const rows = lay.columns === 2 ? Math.ceil(n / 2) : n
  const bodyH = Math.min(bodyCap, rows * lay.rowH)
  return { lay, bodyH }
}

/** Unscaled frame height: padding + header + fitted body. */
export function cardFrameH(count: number, bodyCap: number = SUMMARY_CARD_BODY_H): number {
  return SUMMARY_CARD_PAD_Y + SUMMARY_CARD_HEAD_H + cardBodyContentH(count, bodyCap).bodyH
}

export type StandingsLayout = {
  k: number
  stacked: boolean
  bodyCap: number
  cardW: number
  gridW: number
  pillW: number
  pillH: number
  panelW: number
  panelH: number
  rowHs: number[]
}

/**
 * Mid-game player panel. Width is capped (not 94% of the canvas), cards
 * shrink to their rosters, and the whole block is guaranteed to sit below
 * `topPx` and above a bottom margin on both 16:9 and 21:9.
 */
export function standingsLayout(
  teamCounts: number[],
  cv: { w: number; h: number },
  topPx: number,
  opts?: { hidePill?: boolean },
): StandingsLayout {
  const counts = [0, 1, 2, 3].map(i => Math.max(0, teamCounts[i] ?? 0))
  const gridW1 = SUMMARY_CARD_W * 2 + SUMMARY_CARD_GAP
  const availW = Math.max(160, cv.w - STANDINGS_SIDE * 2)
  const availH = Math.max(160, cv.h - topPx - STANDINGS_BOTTOM)
  const stacked = availW < gridW1 * SUMMARY_K_READ
  const widthUnit = stacked ? SUMMARY_CARD_W : gridW1
  let k = Math.min(STANDINGS_K_MAX, STANDINGS_MAX_W / gridW1, availW / widthUnit)

  const vgapU = SUMMARY_GAP * 0.6
  const chromeU = opts?.hidePill ? 0 : SUMMARY_PILL_H + SUMMARY_GAP

  const measure = (bodyCap: number, scale: number) => {
    const frames = counts.map(c => cardFrameH(Math.max(1, c), bodyCap) * scale)
    if (stacked) {
      const rowHs = frames
      const panelH = (chromeU * scale) + rowHs.reduce((a, b) => a + b, 0) + vgapU * scale * Math.max(0, frames.length - 1)
      const gridW = SUMMARY_CARD_W * scale
      return { rowHs, panelH, gridW }
    }
    const rowHs = [Math.max(frames[0], frames[1]), Math.max(frames[2], frames[3])]
    const panelH = (chromeU * scale) + rowHs[0] + vgapU * scale + rowHs[1]
    const gridW = gridW1 * scale
    return { rowHs, panelH, gridW }
  }

  let bodyCap = SUMMARY_CARD_BODY_H
  let m = measure(bodyCap, k)
  if (m.panelH > availH) {
    k = Math.max(0.6, k * (availH / m.panelH))
    m = measure(bodyCap, k)
  }
  if (m.panelH > availH + 0.5) {
    const chrome = chromeU * k + (stacked ? vgapU * k * 3 : vgapU * k)
    const rowsRoom = Math.max(SUMMARY_COMPACT_MIN_H * 2 * k, availH - chrome)
    const unscaledRows = rowsRoom / k
    const padHead = SUMMARY_CARD_PAD_Y + SUMMARY_CARD_HEAD_H
    const rowBudget = stacked
      ? (unscaledRows - vgapU * 3) / 4 - padHead
      : (unscaledRows - vgapU) / 2 - padHead
    bodyCap = Math.max(SUMMARY_COMPACT_MIN_H * 2, Math.min(bodyCap, rowBudget))
    m = measure(bodyCap, k)
  }

  return {
    k,
    stacked,
    bodyCap,
    cardW: SUMMARY_CARD_W * k,
    gridW: m.gridW,
    pillW: m.gridW,
    pillH: SUMMARY_PILL_H * k,
    panelW: m.gridW,
    panelH: m.panelH,
    rowHs: m.rowHs,
  }
}
