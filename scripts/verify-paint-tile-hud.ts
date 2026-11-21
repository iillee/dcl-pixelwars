import { readFileSync } from 'node:fs'

function check(ok: boolean, msg: string): void {
  if (!ok) {
    console.error('✗ ' + msg)
    process.exit(1)
  }
}

const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
const score = readFileSync(new URL('../src/client/paintScore.ts', import.meta.url), 'utf8')

check(!ui.includes('PAINTED:'), 'the old PAINTED: N pill under the territory bar is gone')
check(!ui.includes('paintTileFill('), 'the side-bar fill scale is gone')
check(!score.includes('PAINT_TILE_CAP_MIN') && !score.includes('paintTileCap'), 'paintScore no longer carries the side-bar cap')
check(ui.includes('function PaintedHud') && ui.includes('function SideFillTrack') && ui.includes('function PaintTankBar'), 'the paint tank still uses the side track; the tile count is its own HUD')
check(ui.includes('position: { top, right:'), 'the paint tank stays on the right')
check(!ui.includes('position: { top, left:'), 'the tile tracker is no longer a left-side bar')
check(ui.includes('<PaintedHud />') && ui.includes('id="ui_top_mute"') && ui.includes('id="ui_match_mute"'), 'the tile count is mounted in both match top rows')
check(ui.includes('SCORE_PILL_W = TOP_BTN + TOP_GAP + TOP_BTN'), 'the score pill is a fixed width equal to the eye and mute together')
check(ui.includes('const width = SCORE_PILL_W') && ui.includes('function scorePillFont'), 'the score pill no longer grows with the digit count; the font shrinks to fit')
check(ui.includes('TOP_BTN + TOP_GAP + TOP_BTN + TOP_GAP + MATCH_TIMER_W + TOP_GAP + SCORE_PILL_W'), 'the match row is eye, mute, timer, then the score pill')
check(ui.includes('const BAR_W = MATCH_TOP_W') && ui.includes('const barW = () => MATCH_TOP_W'), 'the territory bar spans the full match row, not the buff icons')
check(ui.includes('countText') && !ui.includes('plusText'), 'the pill shows the tile number and no longer has the +N pop')
check(!ui.includes('value={`${n`}'), 'the paint tank still has no numeric readout')
check(!ui.includes('<PaintedHud />\n') || ui.split('<PaintedHud />').length === 3, 'PaintedHud is only mounted in the two match top rows')
check(!ui.includes('const left = TOP_BTN + TOP_GAP'), 'the pill is no longer absolutely parked to the right of mute')

const mobileStart = ui.indexOf('{isMobile() ? (')
const mobileEnd = ui.indexOf(') : lobby ? (')
const mobileHud = ui.slice(mobileStart, mobileEnd)
const matchBlock = mobileHud.slice(mobileHud.indexOf(') : ('))
const eyeM = matchBlock.indexOf('<OverviewEye')
const muteM = matchBlock.search(/id="ui_(top|match)_mute"/)
const timerM = matchBlock.indexOf('MATCH_TIMER_W')
const pillM = matchBlock.indexOf('<PaintedHud')
check(eyeM >= 0 && muteM > eyeM && timerM > muteM && pillM > timerM, 'mobile match order is eye, mute, timer, score pill')

const deskStart = ui.indexOf(') : lobby ? (')
const desk = ui.slice(deskStart)
// desktop match is the second MATCH_TOP_W row after the lobby branch
const deskMatch = desk.slice(desk.indexOf('width: MATCH_TOP_W'))
const eyeD = deskMatch.indexOf('<OverviewEye')
const muteD = deskMatch.search(/id="ui_match_mute"/)
const timerD = deskMatch.indexOf('MATCH_TIMER_W')
const pillD = deskMatch.indexOf('<PaintedHud')
check(eyeD >= 0 && muteD > eyeD && timerD > muteD && pillD > timerD, 'desktop match order is eye, mute, timer, score pill')

const paintedFn = ui.slice(ui.indexOf('function PaintedHud()'), ui.indexOf('function PaintTankBar()'))
check(paintedFn.includes('inLobby()') && paintedFn.includes('getSummaryProgress()') && !paintedFn.includes('standingsOpen'), 'the score pill and buff icons stay visible while mid-round standings are open')

console.log('✓ painted-tile pill is a fixed-width slot after the timer; the territory bar matches the row')
