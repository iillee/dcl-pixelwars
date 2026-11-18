/**
 * Round-end summary layout. Pure numbers so we can verify overflow and
 * render previews without the explorer.
 */
import { PLAYING_TEAMS } from './team'

export const SUMMARY_K_MAX = 1.6
export const SUMMARY_PILL_W = 720
export const SUMMARY_PILL_H = 48
export const SUMMARY_TITLE_FONT = 72
export const SUMMARY_HEAD_H = 184
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
export const TITLE_WORD_GAP = 0.22
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
