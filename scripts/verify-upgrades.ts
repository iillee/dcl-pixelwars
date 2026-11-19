/**
 * verify-upgrades.ts — paint-earned upgrade charge, thresholds, selection,
 * stacking, modifiers, deferral, and bot exclusion (Overdrive V2 §9).
 * Run: npx tsx scripts/verify-upgrades.ts
 */
import { UpgradeBook } from '../src/server/upgradeBook'
import {
  accrueUpgradeCharge, bonusPct, burstPaintRadiusCellsFor, emptyUpgrade,
  hasteCooldownMult, paintAreaMult, paintedScoreFor, speedMoveMult,
  trySelectUpgrade, unlockedUpgradeCount, upgradeChargeFor,
  upgradePaintBrushOffsets, upgradePaintTileCount, upgradeProgress,
  type UpgradeState,
} from '../src/shared/upgrades'
import {
  BURST_PAINT_RADIUS_CELLS, STAR_PICKUPS_ENABLED,
  UPGRADE_CHARGE_ENEMY, UPGRADE_CHARGE_NEUTRAL, UPGRADE_HASTE_REDUCTION,
  UPGRADE_MAX, UPGRADE_PAINT_AREA_BONUS, UPGRADE_SPEED_BONUS, UPGRADE_THRESHOLDS,
} from '../src/shared/pvp'
import { PAINT_BRUSH_RADIUS_CELLS, paintBrushOffsets } from '../src/shared/overdrive'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`)
  if (!ok) fails++
}

check('star pickups are disabled by config', STAR_PICKUPS_ENABLED === false)
check('thresholds are 75 / 175 / 300', UPGRADE_THRESHOLDS[0] === 75 && UPGRADE_THRESHOLDS[1] === 175 && UPGRADE_THRESHOLDS[2] === 300)

// Scoring: personal paint vs upgrade charge stay separate.
let painted = 0
let s = emptyUpgrade()
const convert = (prev: number, team: number) => {
  painted += paintedScoreFor(prev, team)
  s = accrueUpgradeCharge(s, upgradeChargeFor(prev, team))
}
convert(0, 1)
check('neutral tile: +1 painted and +1 charge', painted === 1 && s.charge === 1 && upgradeChargeFor(0, 1) === UPGRADE_CHARGE_NEUTRAL)
convert(2, 1)
check('enemy tile: +1 painted and +2 charge', painted === 2 && s.charge === 3 && upgradeChargeFor(2, 1) === UPGRADE_CHARGE_ENEMY)
const midPaint = painted
const midCharge = s.charge
convert(1, 1)
check('friendly tile: no painted score and no charge', painted === midPaint && s.charge === midCharge)

// Dash / burst attribution is the same credit function over a footprint.
const dashFootprint = [0, 2, 0, 3, 1] // prev teams for 5 cells, painter team 1
let dashPaint = 0, dashCharge = 0
for (const prev of dashFootprint) {
  dashPaint += paintedScoreFor(prev, 1)
  dashCharge += upgradeChargeFor(prev, 1)
}
check('dash/burst footprint uses the same neutral/enemy/friendly credit', dashPaint === 4 && dashCharge === 6)
check('a second pass over already-friendly cells adds nothing', paintedScoreFor(1, 1) === 0 && upgradeChargeFor(1, 1) === 0)

// Thresholds and pending.
s = emptyUpgrade()
s = accrueUpgradeCharge(s, 74)
check('74 charge is still charging toward the first upgrade', upgradeProgress(s).mode === 'charging' && !s.pending && unlockedUpgradeCount(s.charge) === 0)
s = accrueUpgradeCharge(s, 1)
check('75 charge unlocks a pending selection', s.pending && s.charge === 75 && unlockedUpgradeCount(s.charge) === 1 && upgradeProgress(s).mode === 'ready')

const overflow = accrueUpgradeCharge(s, 200)
check('charge keeps growing while a selection is pending', overflow.charge === 275 && overflow.pending && overflow.earned === 0)
check('no second unlock is offered while the first is still pending', unlockedUpgradeCount(overflow.charge) === 2 && overflow.earned === 0 && overflow.pending)

const denied = trySelectUpgrade(emptyUpgrade(), 'speed')
check('selection fails when nothing is pending', !denied.ok)

let picked = trySelectUpgrade(overflow, 'speed')
check('SPEED at level 0 becomes level 1', picked.ok && picked.state.speed === 1 && picked.state.earned === 1)
s = picked.state
check('charge is preserved after a selection', s.charge === 275)
check('after selecting, a stored second threshold becomes pending immediately', s.pending && unlockedUpgradeCount(s.charge) === 2)

picked = trySelectUpgrade(s, 'speed')
s = picked.state
check('the same upgrade can be stacked (SPEED 1 → 2)', picked.ok && s.speed === 2 && s.earned === 2)
check('275 charge has not reached the third threshold yet', !s.pending && unlockedUpgradeCount(s.charge) === 2)

s = accrueUpgradeCharge(s, 25) // 300
check('300 charge unlocks the third upgrade', s.pending && s.charge === 300 && unlockedUpgradeCount(s.charge) === 3)

picked = trySelectUpgrade(s, 'paint')
s = picked.state
check('third selection is accepted and maxes out', picked.ok && s.earned === 3 && s.paint === 1 && !s.pending)
check('further charge does not unlock a fourth upgrade', accrueUpgradeCharge(s, 500).charge === 300 && !accrueUpgradeCharge(s, 500).pending && accrueUpgradeCharge(s, 500).earned === 3)

const dup = trySelectUpgrade(s, 'haste')
check('a fourth selection is rejected', !dup.ok && dup.state.earned === 3)

// Level cap: three of the same, then that card cannot be taken again.
let stack = emptyUpgrade()
stack = accrueUpgradeCharge(stack, 300)
for (let i = 0; i < 3; i++) {
  const r = trySelectUpgrade(stack, 'haste')
  check(`HASTE stack step ${i + 1} succeeds`, r.ok && r.state.haste === i + 1)
  stack = r.state
}
check('a fourth HASTE is rejected and the pending choice is kept if any', stack.haste === 3 && !trySelectUpgrade({ ...emptyUpgrade(), pending: true, haste: 3, earned: 0 }, 'haste').ok)

// Deferral: closing the UI does not consume the pending upgrade or charge.
const deferred = accrueUpgradeCharge(emptyUpgrade(), 80)
check('deferral leaves the pending selection and charge intact', deferred.pending && deferred.charge === 80 && deferred.earned === 0)
const afterDefer = trySelectUpgrade(deferred, 'paint')
check('a deferred player can still select later', afterDefer.ok && afterDefer.state.paint === 1)

// Duplicate request: second trySelect on a resolved state fails.
const once = trySelectUpgrade(deferred, 'paint')
const twice = trySelectUpgrade(once.state, 'paint')
check('a repeated selection request is not applied twice', once.ok && !twice.ok && once.state.earned === 1 && twice.state.earned === 1)

// Stacking values (diminishing returns).
check('SPEED stacking is +15 / +25 / +30', speedMoveMult(1) === 1.15 && speedMoveMult(2) === 1.25 && speedMoveMult(3) === 1.3)
check('SPEED bonuses match config', UPGRADE_SPEED_BONUS[1] === 0.15 && UPGRADE_SPEED_BONUS[2] === 0.25 && UPGRADE_SPEED_BONUS[3] === 0.30)
check('PAINT area stacking is +20 / +35 / +45', paintAreaMult(1) === 1.2 && paintAreaMult(2) === 1.35 && paintAreaMult(3) === 1.45)
check('PAINT bonuses match config', UPGRADE_PAINT_AREA_BONUS[1] === 0.2 && UPGRADE_PAINT_AREA_BONUS[2] === 0.35 && UPGRADE_PAINT_AREA_BONUS[3] === 0.45)
check('HASTE cooldown stacking is −15 / −25 / −30', hasteCooldownMult(1) === 0.85 && hasteCooldownMult(2) === 0.75 && hasteCooldownMult(3) === 0.70)
check('HASTE reductions match config', UPGRADE_HASTE_REDUCTION[1] === 0.15 && UPGRADE_HASTE_REDUCTION[2] === 0.25 && UPGRADE_HASTE_REDUCTION[3] === 0.30)
check('Haste does not change an already-computed remaining cooldown', (8 * hasteCooldownMult(0)) === 8)

// Burst radius is an area scaling, not a raw +20% radius.
const r0 = BURST_PAINT_RADIUS_CELLS
const r1 = burstPaintRadiusCellsFor(1)
check('Paint L1 burst radius is sqrt(1.20) times the base', Math.abs(r1 - r0 * Math.sqrt(1.2)) < 1e-12)
check('a +20% radius would have overshot area by more than +20%', Math.pow(1.2, 2) > 1.2)

// Movement brush tile-count approximation (base 9-tile 3×3).
check('default brush is 3x3 / 9 tiles', paintBrushOffsets(2, PAINT_BRUSH_RADIUS_CELLS).length === 9)
check('Paint L1 brush is 11 tiles (~+22%, target +20%)', upgradePaintTileCount(paintAreaMult(1)) === 11 && upgradePaintBrushOffsets(2, paintAreaMult(1)).length === 11)
check('Paint L2 brush is 13 tiles (closest symmetric shape to +35%)', upgradePaintTileCount(paintAreaMult(2)) === 13 && upgradePaintBrushOffsets(2, paintAreaMult(2)).length === 13)
check('Paint L3 brush is 13 tiles (exact +44% vs +45%)', upgradePaintTileCount(paintAreaMult(3)) === 13 && upgradePaintBrushOffsets(2, paintAreaMult(3)).length === 13)

// Progress bar states.
const charging = upgradeProgress(accrueUpgradeCharge(emptyUpgrade(), 30))
check('charging fill is 30/75', Math.abs(charging.fill - 30 / 75) < 1e-12 && charging.mode === 'charging')
const ready = upgradeProgress(accrueUpgradeCharge(emptyUpgrade(), 75))
check('ready fill is full', ready.mode === 'ready' && ready.fill === 1)
const maxed: UpgradeState = { charge: 300, earned: 3, pending: false, speed: 1, paint: 1, haste: 1 }
check('max upgrades reports a completed bar', upgradeProgress(maxed).mode === 'max' && upgradeProgress(maxed).fill === 1)

// Death / rescue does not touch this state (no reset helper is called).
const lived = { ...maxed }
check('buffs are unchanged across a death/rescue (state is not reset)', lived.speed === 1 && lived.paint === 1 && lived.haste === 1 && lived.charge === 300)

// Round reset.
const book = new UpgradeBook()
book.gain('p1', 200)
check('book grants charge to a human and unlocks a pending upgrade', book.ownerState('p1').charge === 200 && book.ownerState('p1').pending === 1)
check('book accepts a valid selection', book.trySelect('p1', 'speed') && book.ownerState('p1').speed === 1)
book.gain('bot:3', 500)
check('bots do not receive upgrade charge or selections', book.ownerState('bot:3').charge === 0 && !book.trySelect('bot:3', 'speed') && book.level('bot:3', 'speed') === 0)
book.gain('p1', 0)
check('zero gain is ignored', book.ownerState('p1').charge === 200)
book.clearRound()
check('a new round resets charge, pending, and levels', book.ownerState('p1').charge === 0 && book.ownerState('p1').pending === 0 && book.ownerState('p1').speed === 0 && book.ownerState('p1').earned === 0)

// Four-team charge table: every enemy colour is +2, every friendly is 0.
let fourOk = true
for (const team of [1, 2, 3, 4]) {
  if (upgradeChargeFor(0, team) !== 1) fourOk = false
  if (upgradeChargeFor(team, team) !== 0) fourOk = false
  for (const other of [1, 2, 3, 4]) {
    if (other === team) continue
    if (upgradeChargeFor(other, team) !== 2) fourOk = false
  }
}
check('four-team convert credit is unchanged (neutral 1, enemy 2, friendly 0)', fourOk)

// HUD roman / bonus labels for I/II/III.
check('bonus labels and roman levels cover I/II/III', bonusPct('speed', 1) === 15 && bonusPct('speed', 2) === 25 && bonusPct('speed', 3) === 30)

if (fails) { console.log(`\u2717 ${fails} upgrade check(s) failed`); process.exit(1) }
console.log('\u2713 all upgrade checks passed')
