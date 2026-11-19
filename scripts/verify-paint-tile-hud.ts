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
check(ui.includes('<PaintedHud />') && ui.includes('id="ui_top_mute"') && ui.includes('id="ui_match_mute"'), 'the tile count is mounted next to the match mute buttons')
check(ui.includes('position: { top: 0, left }') && ui.includes('TOP_BTN + TOP_GAP'), 'the tile pill is absolutely parked to the right of mute')
check(ui.includes('countText') && !ui.includes('plusText'), 'the pill shows the tile number and no longer has the +N pop')
check(ui.includes('textWSafe(countText, font)') && ui.includes('const left = TOP_BTN + TOP_GAP'), 'the pill is anchored to mute and grows right with the digit count')
check(!ui.includes('value={`${n`}'), 'the paint tank still has no numeric readout')
check(!ui.includes('<PaintedHud />\n') || ui.split('<PaintedHud />').length === 3, 'PaintedHud is only mounted beside the two match mute buttons')

console.log('✓ painted-tile count is a top pill to the right of mute; the timer does not shift')
