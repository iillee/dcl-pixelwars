/**
 * verify-overdrive.ts — star-power charge, activation, touch, immunity, brush, reset.
 * Run: npx tsx scripts/verify-overdrive.ts
 */
import { OverdriveBook } from '../src/server/overdriveBook'
import {
  accrueOverdriveCharge, emptyOverdrive, expireOverdrive, isOverdriveActive, isOverdriveReady,
  overdriveCanTouch, overdrivePaintRadiusCells, overdriveTouchDir, paintBrushOffsets,
  resetOverdriveOnDeath, tryActivateOverdrive, PAINT_BRUSH_RADIUS_CELLS,
} from '../src/shared/overdrive'
import {
  OVERDRIVE_TILES, OVERDRIVE_MS, OVERDRIVE_TOUCH_RADIUS, OVERDRIVE_TOUCH_MAX_DY,
  OVERDRIVE_HIT_WINDOW_MS, OVERDRIVE_PAINT_RADIUS_MULT, OVERDRIVE_KNOCK, OVERDRIVE_LIFT,
  ANVIL_HIT_KNOCK, ANVIL_HIT_LIFT,
} from '../src/shared/pvp'
import { overdriveKnock } from '../src/shared/knocks'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`)
  if (!ok) fails++
}

const t0 = 1_000_000
let painted = 0
const addPaint = (n: number) => { painted += n }

let s = emptyOverdrive()
s = accrueOverdriveCharge(s, 1, t0)
addPaint(1)
check('neutral/enemy conversion adds one charge', s.charge === 1 && painted === 1)

s = accrueOverdriveCharge(s, OVERDRIVE_TILES - 1, t0)
addPaint(OVERDRIVE_TILES - 1)
check('charge reaches the threshold and becomes READY', isOverdriveReady(s, t0) && s.charge === OVERDRIVE_TILES)
const capped = accrueOverdriveCharge(s, 20, t0)
check('charge does not grow past one stored Overdrive', capped.charge === OVERDRIVE_TILES)

const denied = tryActivateOverdrive(emptyOverdrive(), t0)
check('activation fails below the threshold', !denied.ok)
const fired = tryActivateOverdrive(s, t0)
check('activation succeeds at the threshold', fired.ok && isOverdriveActive(fired.state, t0 + 1))
s = fired.state
check('charge clears on activation', s.charge === 0)
check('star lasts OVERDRIVE_MS', s.activeUntil === t0 + OVERDRIVE_MS)
const during = accrueOverdriveCharge(s, 40, t0 + 100)
check('charge does not accumulate while active', during.charge === 0 && isOverdriveActive(during, t0 + 100))

const midPaint = painted
const died = resetOverdriveOnDeath(during)
check('death resets charge and ends the star', died.charge === 0 && !isOverdriveActive(died, t0 + 200))
check('painted total does not reset on death', painted === midPaint)

s = accrueOverdriveCharge(emptyOverdrive(), OVERDRIVE_TILES, t0)
s = tryActivateOverdrive(s, t0).state
check('active player is knock-immune', isOverdriveActive(s, t0 + 10))
s = expireOverdrive(s, t0 + OVERDRIVE_MS + 1)
check('star expires after OVERDRIVE_MS', !isOverdriveActive(s, t0 + OVERDRIVE_MS + 1) && s.charge === 0)

s = accrueOverdriveCharge(emptyOverdrive(), 80, t0)
addPaint(80)
s = resetOverdriveOnDeath(s)
check('death mid-charge clears charge only', s.charge === 0 && painted === midPaint + 80)

const book = new OverdriveBook()
book.paintedGain('bot:3', 500, t0)
check('bots do not receive Overdrive charge', book.ownerState('bot:3', t0).charge === 0 && !book.tryUse('bot:3', t0))
book.paintedGain('p1', OVERDRIVE_TILES, t0)
check('book activates a ready human', book.tryUse('p1', t0) && book.isActive('p1', t0 + 1))

const touchBase = {
  attacker: 'a', victim: 'b', attackerTeam: 1, victimTeam: 2,
  distH: 1, distY: 0.2, lastHitAt: 0, now: t0, attackerActive: true, victimImmune: false,
}
check('touch in range is accepted', overdriveCanTouch(touchBase))
check('touch out of range is not', !overdriveCanTouch({ ...touchBase, distH: OVERDRIVE_TOUCH_RADIUS + 0.1 }))
check('touch too high is not', !overdriveCanTouch({ ...touchBase, distY: OVERDRIVE_TOUCH_MAX_DY + 0.1 }))
check('teammates are not launched', !overdriveCanTouch({ ...touchBase, victimTeam: 1 }))
check('self is not launched', !overdriveCanTouch({ ...touchBase, victim: 'a' }))
check('inactive star does not launch', !overdriveCanTouch({ ...touchBase, attackerActive: false }))
check('immune victim is not launched', !overdriveCanTouch({ ...touchBase, victimImmune: true }))
check('same victim is not relaunched inside the window', !overdriveCanTouch({ ...touchBase, lastHitAt: t0 - OVERDRIVE_HIT_WINDOW_MS + 1 }))
check('same victim can be launched after the window', overdriveCanTouch({ ...touchBase, lastHitAt: t0 - OVERDRIVE_HIT_WINDOW_MS }))
const dir = overdriveTouchDir(0, 0, 4, 0)
check('knock direction is away from the star', Math.abs(dir.x - 1) < 1e-9 && Math.abs(dir.z) < 1e-9)

const kn = overdriveKnock(1, 0)
check('overdrive knock reuses anvil tunables along +X', kn.kind === 'overdrive' && kn.impulse.x === OVERDRIVE_KNOCK && kn.impulse.y === OVERDRIVE_LIFT && OVERDRIVE_KNOCK === ANVIL_HIT_KNOCK && OVERDRIVE_LIFT === ANVIL_HIT_LIFT)

check('default brush is 3x3', paintBrushOffsets(2, PAINT_BRUSH_RADIUS_CELLS).length === 9)
check('overdrive brush uses OVERDRIVE_PAINT_RADIUS_MULT', overdrivePaintRadiusCells(true) === PAINT_BRUSH_RADIUS_CELLS * OVERDRIVE_PAINT_RADIUS_MULT)
const wide = paintBrushOffsets(2, overdrivePaintRadiusCells(true))
check('active brush is wider than the default 3x3', wide.length === 25 && paintBrushOffsets(2, overdrivePaintRadiusCells(false)).length === 9)

book.clearRound()
check('round reset clears charge and the star', book.ownerState('p1', t0).charge === 0 && !book.isActive('p1', t0))

if (fails) { console.log(`\u2717 ${fails} overdrive check(s) failed`); process.exit(1) }
console.log('\u2713 all overdrive checks passed')
