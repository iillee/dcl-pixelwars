/**
 * Round-end summary layout. Run: npx tsx scripts/verify-summary.ts
 */
import { readFileSync } from 'node:fs'
import {
  rosterLayout, sortTeamRows, tablesLayout, titleFontFor,
  SUMMARY_CARD_BODY_H, SUMMARY_CARD_H, SUMMARY_CARD_W, SUMMARY_COMPACT_MIN_H,
  SUMMARY_FIT, SUMMARY_FONT_MIN, SUMMARY_GAP, SUMMARY_HEAD_H, SUMMARY_K_READ,
  SUMMARY_OWNERS_MAX, SUMMARY_PILL_H, SUMMARY_ROW_MIN_H, SUMMARY_TWO_COL_AFTER,
  TITLE_WORD_GAP,
} from '../src/shared/summaryLayout'

const top = SUMMARY_HEAD_H + SUMMARY_PILL_H + SUMMARY_GAP
const desk = tablesLayout([], { w: 1280, h: 720 }, top)
const deskTall = tablesLayout([], { w: 1280, h: 1080 }, top)
const deskWide = tablesLayout([], { w: 1920, h: 1080 }, top)
const phone = tablesLayout([], { w: 390, h: 844 }, top)
if (desk.stacked || deskTall.stacked || deskWide.stacked) {
  console.error(`✗ a desktop / landscape canvas should use a 2×2 grid, got stacked desk=${desk.stacked} tall=${deskTall.stacked} wide=${deskWide.stacked}`)
  process.exit(1)
}
if (!phone.stacked) {
  console.error('✗ a phone-width canvas should stack the four team cards')
  process.exit(1)
}
if (desk.k < SUMMARY_K_READ * 0.95) {
  console.error(`✗ 1280×720 should stay readable, k=${desk.k}`)
  process.exit(1)
}

const one = rosterLayout(1)
const four = rosterLayout(4)
const six = rosterLayout(SUMMARY_TWO_COL_AFTER)
const eight = rosterLayout(8)
const max = rosterLayout(SUMMARY_OWNERS_MAX)
if (one.columns !== 1 || four.columns !== 1 || six.columns !== 1 || one.scroll || four.scroll || six.scroll) {
  console.error('✗ teams of 1–6 should stay a single column without scrolling')
  process.exit(1)
}
if (eight.columns !== 2 || eight.scroll) {
  console.error(`✗ a team of 8 should use two compact columns, no scroll, got ${JSON.stringify(eight)}`)
  process.exit(1)
}
if (max.columns !== 2 || !max.scroll || max.rowH !== SUMMARY_COMPACT_MIN_H) {
  console.error(`✗ the 60-player cap should two-column scroll at the compact minimum, got ${JSON.stringify(max)}`)
  process.exit(1)
}
if (!(one.rowH > four.rowH - 1e-6) || !(four.rowH >= six.rowH - 1e-6) || eight.rowH < SUMMARY_COMPACT_MIN_H) {
  console.error(`✗ rows should compact as the team grows, got 1=${one.rowH} 4=${four.rowH} 6=${six.rowH} 8=${eight.rowH}`)
  process.exit(1)
}

function fits(n: number): boolean {
  const lay = rosterLayout(n)
  const rows = lay.columns === 2 ? Math.ceil(n / 2) : Math.max(1, n)
  return lay.scroll || rows * lay.rowH <= SUMMARY_CARD_BODY_H + 1e-6
}
for (const n of [1, 4, 8, 16, 24, SUMMARY_OWNERS_MAX]) {
  if (!fits(n)) {
    console.error(`✗ ${n} players overflow the card body without scrolling`)
    process.exit(1)
  }
}

const meLast = Array.from({ length: 12 }, (_, i) => ({ id: i === 11 ? 'me' : `p${i}`, cells: 12 - i, painted: 12 - i }))
const sorted = sortTeamRows(meLast)
if (sorted.length !== 12 || sorted[11].id !== 'me' || sorted[0].id !== 'p0') {
  console.error('✗ every player must stay in the sorted roster, including the local player')
  process.exit(1)
}

const titleF = titleFontFor(['BLUE', 'WINS!'], 1, 1200)
if (titleF <= SUMMARY_FONT_MIN || TITLE_WORD_GAP >= 0.5) {
  console.error('✗ the title should stay one tight, large line')
  process.exit(1)
}

const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!uiSrc.includes('SUMMARY_TITLE_BG') || !uiSrc.includes('uiBackground={{ color: SUMMARY_TITLE_BG }}') || !uiSrc.includes('color={SUMMARY_TITLE_FG}')) {
  console.error('✗ the title, subtitle, and next-round line should sit on an opaque dark strip')
  process.exit(1)
}
if (uiSrc.includes('+N MORE') || uiSrc.includes('+N more') || uiSrc.includes('SUMMARY_CARD_ROWS') || uiSrc.includes('rows.slice(0, cap)')) {
  console.error('✗ the summary should show every player, not a top-N cut with "+K more"')
  process.exit(1)
}
if (!uiSrc.includes("overflow: lay.scroll ? 'scroll'")) {
  console.error('✗ the roster should scroll only when the compact layout still cannot fit')
  process.exit(1)
}
if (!uiSrc.includes('selfOf')) {
  console.error("✗ the local player's row should stay highlighted")
  process.exit(1)
}
if (SUMMARY_CARD_H < 200 || SUMMARY_ROW_MIN_H < 16 || SUMMARY_TWO_COL_AFTER !== 6) {
  console.error('✗ card height, compact threshold, or minimum row is off')
  process.exit(1)
}
if (1280 * SUMMARY_FIT < (SUMMARY_CARD_W * 2 + 40) * SUMMARY_K_READ) {
  console.error('✗ 1280-wide desktop should have room for the 2×2 grid')
  process.exit(1)
}

console.log(`✓ summary shows everyone, compact rows, 2×2 on desktop, stacked on phones; max ${SUMMARY_OWNERS_MAX} rows (scroll only then)`)
