/**
 * Round-end summary layout. Run: npx tsx scripts/verify-summary.ts
 */
import { readFileSync } from 'node:fs'
import {
  areaPct, cardFrameH, pickWalkableTotal, rosterLayout, sortTeamRows, summaryPcts, summaryRank,
  standingsLayout, tablesLayout, titleFontFor,
  STANDINGS_BOTTOM, STANDINGS_MAX_W,
  SUMMARY_CARD_BODY_H, SUMMARY_CARD_H, SUMMARY_CARD_W, SUMMARY_COMPACT_MIN_H,
  SUMMARY_FIT, SUMMARY_FONT_MIN, SUMMARY_GAP, SUMMARY_HEAD_H, SUMMARY_K_READ,
  SUMMARY_OWNERS_MAX, SUMMARY_PILL_H, SUMMARY_ROW_MIN_H, SUMMARY_TWO_COL_AFTER,
  TITLE_WORD_GAP,
} from '../src/shared/summaryLayout'
import { Team } from '../src/shared/team'

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

const titleF = titleFontFor(['YELLOW', 'WINS!'], 1, 1200)
if (titleF <= SUMMARY_FONT_MIN || TITLE_WORD_GAP >= 0.16) {
  console.error('✗ the title should stay one tight, large line')
  process.exit(1)
}

const yellowWins = { red: 2200, blue: 1800, green: 1400, yellow: 2955, total: 12000 }
const pcts = summaryPcts(yellowWins)
const painted = yellowWins.red + yellowWins.blue + yellowWins.green + yellowWins.yellow
if (Math.abs(pcts.red + pcts.blue + pcts.green + pcts.yellow + pcts.white - 100) > 1e-6) {
  console.error(`✗ 4-team shares plus unpainted must add to 100, got ${JSON.stringify(pcts)}`)
  process.exit(1)
}
if (pcts.white <= 0 || Math.abs(pcts.white - ((12000 - painted) / 12000) * 100) > 1e-6) {
  console.error(`✗ the bar must keep the unpainted remainder, white=${pcts.white}`)
  process.exit(1)
}
if (areaPct(2955, 12000) !== Math.round(2955 / 12000 * 100) || areaPct(2130, 0) !== 0) {
  console.error('✗ area % should be owned cells over the walkable total')
  process.exit(1)
}
const ranked = summaryRank(yellowWins)
if (ranked.order[0] !== Team.Yellow || ranked.order[1] !== Team.Red || ranked.order[2] !== Team.Blue || ranked.order[3] !== Team.Green) {
  console.error(`✗ cards should sort by owned cells, YELLOW first, got ${ranked.order.join(',')}`)
  process.exit(1)
}
if (ranked.leaders.length !== 1 || ranked.leaders[0] !== Team.Yellow) {
  console.error(`✗ only the winner should be flagged, got ${ranked.leaders.join(',')}`)
  process.exit(1)
}
if (summaryRank({ red: 0, blue: 0, green: 0, yellow: 0, total: 12000 }).leaders.length !== 0) {
  console.error('✗ a zero-score board should not mark every card as the winner')
  process.exit(1)
}
if (pickWalkableTotal(12000, 0, painted, painted) !== 12000) {
  console.error('✗ the walkable total should come from the in-match snapshot after the lobby swap')
  process.exit(1)
}
if (pickWalkableTotal(0, 0, painted, painted) !== 0) {
  console.error("✗ a painted-only server total must not be used as the walkable denominator")
  process.exit(1)
}
if (summaryPcts({ ...yellowWins, total: 0 }).yellow !== 0) {
  console.error('✗ a missing walkable total should not invent 0% from a bad divide, but also must not renormalize to 100')
  process.exit(1)
}

const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (uiSrc.includes('uiBackground={{ color: SUMMARY_TITLE_BG }}') || uiSrc.includes('FINAL TERRITORY') || uiSrc.includes('nextRoundBlurb()')) {
  console.error('✗ the title should be just TEAM WINS!, with no black strip or subtext')
  process.exit(1)
}
if (!uiSrc.includes('wordRow(3, true)') || !uiSrc.includes('wordRow(0, false)')) {
  console.error('✗ the title should use a subtle drop shadow, not a solid panel')
  process.exit(1)
}
if (!uiSrc.includes('showUnpainted={b.kind !== \'bases\'}') && !uiSrc.includes('showUnpainted={b.kind !== "bases"}')) {
  // allow either quote style
  if (!uiSrc.includes('showUnpainted={b.kind !==')) {
    console.error('✗ the end-screen bar should use real shares plus the unpainted remainder')
    process.exit(1)
  }
}
if ((!uiSrc.includes('height: ch * 2 + vgap') && !uiSrc.includes('height: rh0 + vgap + rh1')) || !uiSrc.includes('flexShrink: 0')) {
  console.error('✗ team cards need explicit heights so the 2×2 rows do not overlap')
  process.exit(1)
}
if (uiSrc.includes('<FormatSplash') || uiSrc.includes('function FormatSplash')) {
  console.error('✗ the PIXELWARS CLASSIC round-start pop-up should be gone')
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

const STANDINGS_TOP = 84
const midCounts = [4, 3, 2, 1]
const s16 = standingsLayout(midCounts, { w: 1920, h: 1080 }, STANDINGS_TOP)
const s21 = standingsLayout(midCounts, { w: 3440, h: 1440 }, STANDINGS_TOP)
const s21b = standingsLayout(midCounts, { w: 2560, h: 1080 }, STANDINGS_TOP)
const s720 = standingsLayout(midCounts, { w: 1280, h: 720 }, STANDINGS_TOP)
const sPhone = standingsLayout(midCounts, { w: 390, h: 844 }, STANDINGS_TOP)
for (const [name, cv, lay] of [
  ['16:9 1920×1080', { w: 1920, h: 1080 }, s16],
  ['21:9 3440×1440', { w: 3440, h: 1440 }, s21],
  ['21:9 2560×1080', { w: 2560, h: 1080 }, s21b],
  ['16:9 1280×720', { w: 1280, h: 720 }, s720],
  ['phone 390×844', { w: 390, h: 844 }, sPhone],
] as const) {
  if (lay.panelW > STANDINGS_MAX_W + 0.5) {
    console.error(`✗ ${name}: standings width ${lay.panelW} exceeds max ${STANDINGS_MAX_W}`)
    process.exit(1)
  }
  if (lay.panelW > cv.w - 48 + 0.5) {
    console.error(`✗ ${name}: standings width ${lay.panelW} overflows the canvas`)
    process.exit(1)
  }
  if (STANDINGS_TOP + lay.panelH > cv.h - STANDINGS_BOTTOM + 0.5) {
    console.error(`✗ ${name}: standings panel (top ${STANDINGS_TOP} + h ${lay.panelH}) leaves the screen`)
    process.exit(1)
  }
  if (lay.pillW > lay.panelW + 0.5) {
    console.error(`✗ ${name}: territory bar ${lay.pillW} is wider than the panel ${lay.panelW}`)
    process.exit(1)
  }
}
if (s16.stacked || s21.stacked || s21b.stacked || s720.stacked) {
  console.error('✗ mid-game standings should stay 2×2 on desktop 16:9 and 21:9')
  process.exit(1)
}
if (!sPhone.stacked) {
  console.error('✗ mid-game standings should stack on a phone-width canvas')
  process.exit(1)
}
if (Math.abs(s16.k - s21.k) > 0.01 || Math.abs(s16.panelW - s21.panelW) > 1) {
  console.error(`✗ ultrawide should not scale the mid-game panel up, 16:9 k=${s16.k} w=${s16.panelW} vs 21:9 k=${s21.k} w=${s21.panelW}`)
  process.exit(1)
}
if (s21.panelW > 3440 * 0.45) {
  console.error(`✗ the mid-game panel should stay compact on ultrawide, width=${s21.panelW}`)
  process.exit(1)
}
if (cardFrameH(1) >= cardFrameH(4) - 1) {
  console.error(`✗ a 1-player card should be shorter than a 4-player card, 1=${cardFrameH(1)} 4=${cardFrameH(4)}`)
  process.exit(1)
}
if (s16.rowHs[0] <= s16.rowHs[1]) {
  console.error(`✗ the row with more players should be taller, rowHs=${s16.rowHs.join(',')}`)
  process.exit(1)
}
const packed = standingsLayout([60, 60, 60, 60], { w: 1920, h: 1080 }, STANDINGS_TOP)
if (STANDINGS_TOP + packed.panelH > 1080 - STANDINGS_BOTTOM + 0.5) {
  console.error(`✗ a full 60-player board must still fit under the HUD, h=${packed.panelH}`)
  process.exit(1)
}
if (!uiSrc.includes('standingsLayout(') || !uiSrc.includes('fitContent={true}') && !uiSrc.includes('fitContent={true}')) {
  console.error('✗ StandingsPopup should use the compact standingsLayout and content-sized cards')
  process.exit(1)
}
if (uiSrc.includes('tablesLayout(rows, { w: cv.w, h: cv.h - STANDINGS_TOP_PX }')) {
  console.error('✗ mid-game standings must not reuse the end-screen tablesLayout scale')
  process.exit(1)
}
if (uiSrc.includes('mix(barColor(team), Color4.Black()') || /inkTeam\s*=\s*\([^)]*\)\s*=>\s*mix\(/.test(uiSrc)) {
  console.error('✗ panel team text should use the exact TEAM_RGB palette, not a darkened shade')
  process.exit(1)
}
if (!uiSrc.includes('TEAM_RGB[Team.Red]') || !uiSrc.includes('TEAM_RGB[Team.Blue]') || !uiSrc.includes('TEAM_RGB[Team.Green]') || !uiSrc.includes('TEAM_RGB[Team.Yellow]')) {
  console.error('✗ bar and team colours should come from TEAM_RGB, not one-off hexes')
  process.exit(1)
}
if (uiSrc.includes('tablesLayout(b.owners') || !uiSrc.includes('standingsLayout(counts, cv, SUMMARY_HEAD_H')) {
  console.error('✗ the end-screen team panels should use the compact mid-game standings layout')
  process.exit(1)
}
const end16 = standingsLayout(midCounts, { w: 1920, h: 1080 }, SUMMARY_HEAD_H)
const end21 = standingsLayout(midCounts, { w: 3440, h: 1440 }, SUMMARY_HEAD_H)
const end720 = standingsLayout(midCounts, { w: 1280, h: 720 }, SUMMARY_HEAD_H)
for (const [name, cv, lay] of [
  ['end 16:9 1920×1080', { w: 1920, h: 1080 }, end16],
  ['end 21:9 3440×1440', { w: 3440, h: 1440 }, end21],
  ['end 16:9 1280×720', { w: 1280, h: 720 }, end720],
] as const) {
  if (lay.panelW > STANDINGS_MAX_W + 0.5) {
    console.error(`✗ ${name}: panel width ${lay.panelW} exceeds max ${STANDINGS_MAX_W}`)
    process.exit(1)
  }
  if (SUMMARY_HEAD_H + lay.panelH > cv.h - STANDINGS_BOTTOM + 0.5) {
    console.error(`✗ ${name}: title + panel leaves the screen, h=${SUMMARY_HEAD_H + lay.panelH}`)
    process.exit(1)
  }
}
if (Math.abs(end16.panelW - end21.panelW) > 1 || Math.abs(end16.k - s16.k) > 0.01) {
  console.error(`✗ the end-screen panel should match the mid-game size, end=${end16.panelW}/${end16.k} mid=${s16.panelW}/${s16.k}`)
  process.exit(1)
}

console.log(`✓ summary shows everyone, compact rows, 2×2 on desktop, stacked on phones; 4-team shares, rank, and winner flags; max ${SUMMARY_OWNERS_MAX} rows (scroll only then); mid-game and end-screen panels capped at ${STANDINGS_MAX_W}px (16:9 and 21:9)`)
