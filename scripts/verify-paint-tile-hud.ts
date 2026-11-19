import { paintTileCap, paintTileFill, PAINT_TILE_CAP_MIN } from '../src/client/paintScore'
import { readFileSync } from 'node:fs'

function check(ok: boolean, msg: string): void {
  if (!ok) {
    console.error('✗ ' + msg)
    process.exit(1)
  }
}

check(PAINT_TILE_CAP_MIN === 25, 'soft cap starts at 25 tiles')
check(paintTileCap(0) === 25 && paintTileFill(0) === 0, 'empty bar is 0 at the 25-tile cap')
check(paintTileCap(25) === 25 && paintTileFill(25) === 1, 'a full first tank is 25/25')
check(paintTileCap(26) === 50 && Math.abs(paintTileFill(26) - 26 / 50) < 1e-9, 'the cap doubles once you pass 25')
check(paintTileCap(100) === 100 && paintTileFill(51) === 51 / 100, 'the cap keeps doubling (50 → 100)')
check(paintTileCap(200) === 200, 'long rounds keep growing the cap (200)')

const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
check(!ui.includes('PAINTED:'), 'the top PAINTED: N pill is gone')
check(ui.includes('function SideFillTrack') && ui.includes('function PaintTankBar') && ui.includes('function PaintedHud'), 'the tile tracker reuses the economy side-track style')
check(ui.includes('position: { top, left:') && ui.includes('position: { top, right:'), 'tile tracker is on the left; the paint tank stays on the right')
check(ui.includes('paintTileFill(') && ui.includes('barColor(team)') && ui.includes('countText'), 'the bar uses team color fill and always shows the number')
check(ui.includes('plusText') && ui.includes('SUMMARY_MVP'), 'the +N pop sits next to the number')
check(!ui.includes('value={`${n`}'), 'the paint tank still has no numeric readout')

console.log('✓ side tile tracker: growing soft cap (25, 50, 100, …) and left-side bar')
