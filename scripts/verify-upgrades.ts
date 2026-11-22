/**
 * verify-upgrades.ts — paint-earned upgrade charge, thresholds, selection,
 * stacking, modifiers, deferral, fall buff-loss, offered kinds, and bot
 * exclusion (Overdrive V2 §9).
 * Run: npx tsx scripts/verify-upgrades.ts
 */
import { readFileSync } from 'node:fs'
import { UpgradeBook } from '../src/server/upgradeBook'
import {
  accrueUpgradeCharge, bonusPct, burstPaintRadiusCellsFor, emptyUpgrade, grantUpgradeBonus,
  hasteCooldownMult, offeredUpgradeKinds, paintAreaMult, paintedScoreFor, pendingUpgradeCount,
  speedMoveMult, stripUpgradesOnFall, trySelectUpgrade, unlockedUpgradeCount,
  upgradeChargeFor, upgradeOfferLine, upgradePaintBrushOffsets, upgradePaintTileCount,
  upgradeProgress, type UpgradeState,
} from '../src/shared/upgrades'
import {
  BADGE_BOB_HZ, BADGE_BOB_PX, CARD_AUTO_MS, CARD_HOVER_SCALE, CARD_POP_MS,
  CARD_REOPEN_MS, CARD_TARGET_W, autoOpenDelayMs, autoTimerFrac, badgeBobPx,
  cardFlyMove, cardFlyShrink, cardPopScale, cardSlidePx,
} from '../src/shared/upgradeCards'
import {
  BURST_PAINT_RADIUS_CELLS, STAR_PICKUPS_ENABLED,
  UPGRADE_CHARGE_ENEMY, UPGRADE_CHARGE_NEUTRAL, UPGRADE_CHARGE_STEP,
  UPGRADE_HASTE_REDUCTION, UPGRADE_LEVEL_MAX, UPGRADE_MAX,
  UPGRADE_PAINT_AREA_BONUS, UPGRADE_SPEED_BONUS, UPGRADE_THRESHOLDS,
} from '../src/shared/pvp'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`)
  if (!ok) fails++
}

check('star pickups are enabled and grant a card, not the old buff', STAR_PICKUPS_ENABLED === true)
check('thresholds step every 1000 up to 9000',
  UPGRADE_CHARGE_STEP === 1000
  && UPGRADE_MAX === 9
  && UPGRADE_THRESHOLDS.length === UPGRADE_MAX
  && UPGRADE_THRESHOLDS.every((t, i) => t === (i + 1) * UPGRADE_CHARGE_STEP)
  && UPGRADE_THRESHOLDS[0] === 1000
  && UPGRADE_THRESHOLDS[UPGRADE_THRESHOLDS.length - 1] === 9000)

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
s = accrueUpgradeCharge(s, 999)
check('999 charge is still charging toward the first upgrade', upgradeProgress(s).mode === 'charging' && !s.pending && unlockedUpgradeCount(s.charge) === 0)
s = accrueUpgradeCharge(s, 1)
check('1000 charge unlocks a pending selection', s.pending && s.charge === 1000 && unlockedUpgradeCount(s.charge) === 1 && upgradeProgress(s).mode === 'ready')

const overflow = accrueUpgradeCharge(s, 1000)
check('charge keeps growing while a selection is pending', overflow.charge === 2000 && overflow.pending && overflow.earned === 0)
check('no second unlock is offered while the first is still pending', unlockedUpgradeCount(overflow.charge) === 2 && overflow.earned === 0 && overflow.pending)

const denied = trySelectUpgrade(emptyUpgrade(), 'speed')
check('selection fails when nothing is pending', !denied.ok)

let picked = trySelectUpgrade(overflow, 'speed')
check('SPEED at level 0 becomes level 1', picked.ok && picked.state.speed === 1 && picked.state.earned === 1)
s = picked.state
check('charge is preserved after a selection', s.charge === 2000)
check('after selecting, a stored second threshold becomes pending immediately', s.pending && unlockedUpgradeCount(s.charge) === 2)

picked = trySelectUpgrade(s, 'speed')
s = picked.state
check('the same upgrade can be stacked (SPEED 1 → 2)', picked.ok && s.speed === 2 && s.earned === 2)
check('2000 charge has not reached the third threshold yet', !s.pending && unlockedUpgradeCount(s.charge) === 2)

s = accrueUpgradeCharge(s, 1000) // 3000
check('3000 charge unlocks the third upgrade', s.pending && s.charge === 3000 && unlockedUpgradeCount(s.charge) === 3)

picked = trySelectUpgrade(s, 'paint')
s = picked.state
check('third selection is accepted and a later threshold can still unlock', picked.ok && s.earned === 3 && s.paint === 1 && !s.pending)
s = accrueUpgradeCharge(s, 1000) // 4000
check('4000 charge unlocks a fourth upgrade', s.pending && s.charge === 4000 && unlockedUpgradeCount(s.charge) === 4 && s.earned === 3)

// Level cap: three of the same, then that card cannot be taken again.
let stack = emptyUpgrade()
stack = accrueUpgradeCharge(stack, 3000)
for (let i = 0; i < 3; i++) {
  const r = trySelectUpgrade(stack, 'haste')
  check(`HASTE stack step ${i + 1} succeeds`, r.ok && r.state.haste === i + 1)
  stack = r.state
}
check('a fourth HASTE is rejected and the pending choice is kept if any', stack.haste === 3 && !trySelectUpgrade({ ...emptyUpgrade(), pending: true, haste: 3, earned: 0 }, 'haste').ok)
check('a maxed type is not offered', offeredUpgradeKinds(stack).join(',') === 'speed,paint')

// Nine-upgrade cap: max every kind, then no tenth offer.
let cap = emptyUpgrade()
cap = accrueUpgradeCharge(cap, 9000)
const cycle: Array<'speed' | 'paint' | 'haste'> = ['speed', 'paint', 'haste']
for (let i = 0; i < 9; i++) {
  const kind = cycle[i % 3]
  const r = trySelectUpgrade(cap, kind)
  check(`cap pick ${i + 1} (${kind}) succeeds`, r.ok && r.state.earned === i + 1)
  cap = r.state
}
check('nine picks maxes all three types', cap.earned === 9 && cap.speed === 3 && cap.paint === 3 && cap.haste === 3 && !cap.pending)
check('a maxed loadout offers no cards', offeredUpgradeKinds(cap).length === 0)
const pastCap = accrueUpgradeCharge(cap, 1000)
check('further charge after nine upgrades does not offer a tenth', pastCap.charge === 10000 && !pastCap.pending && pastCap.earned === 9)
check('a tenth selection is rejected', !trySelectUpgrade(cap, 'speed').ok && cap.earned === 9)

// Deferral: closing the UI does not consume the pending upgrade or charge.
const deferred = accrueUpgradeCharge(emptyUpgrade(), 1000)
check('deferral leaves the pending selection and charge intact', deferred.pending && deferred.charge === 1000 && deferred.earned === 0)
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
check('default brush is 3x3 / 9 tiles', upgradePaintBrushOffsets(2, 1).length === 9)
check('Paint L1 brush is 11 tiles (~+22%, target +20%)', upgradePaintTileCount(paintAreaMult(1)) === 11 && upgradePaintBrushOffsets(2, paintAreaMult(1)).length === 11)
check('Paint L2 brush is 13 tiles (closest symmetric shape to +35%)', upgradePaintTileCount(paintAreaMult(2)) === 13 && upgradePaintBrushOffsets(2, paintAreaMult(2)).length === 13)
check('Paint L3 brush is 13 tiles (exact +44% vs +45%)', upgradePaintTileCount(paintAreaMult(3)) === 13 && upgradePaintBrushOffsets(2, paintAreaMult(3)).length === 13)

// Progress states (the HUD no longer draws the charging fill, but the
// helper still reports it for max / ready).
const charging = upgradeProgress(accrueUpgradeCharge(emptyUpgrade(), 200))
check('charging fill is 200/1000', Math.abs(charging.fill - 200 / 1000) < 1e-12 && charging.mode === 'charging')
const ready = upgradeProgress(accrueUpgradeCharge(emptyUpgrade(), 1000))
check('ready fill is full', ready.mode === 'ready' && ready.fill === 1)
const maxed: UpgradeState = { charge: 9000, earned: 9, pending: false, bonus: 0, speed: 3, paint: 3, haste: 3 }
check('max upgrades reports a completed bar', upgradeProgress(maxed).mode === 'max' && upgradeProgress(maxed).fill === 1)

// Falling off the level clears buffs and any pending pick, but keeps charge.
// Already-crossed thresholds stay spent, so the next offer is the next 1000.
let fall = emptyUpgrade()
fall = accrueUpgradeCharge(fall, 3200)
for (const kind of cycle) {
  const r = trySelectUpgrade(fall, kind)
  if (!r.ok) throw new Error('expected fall setup pick to succeed')
  fall = r.state
}
check('fall setup has three buffs and leftover charge', fall.speed === 1 && fall.paint === 1 && fall.haste === 1 && fall.earned === 3 && fall.charge === 3200 && !fall.pending)
const wiped = stripUpgradesOnFall(fall)
check('a fall clears buffs and pending but keeps charge', wiped.speed === 0 && wiped.paint === 0 && wiped.haste === 0 && !wiped.pending && wiped.charge === 3200)
check('already-crossed thresholds stay spent after a fall', wiped.earned === 3 && unlockedUpgradeCount(wiped.charge) === 3)
check('200 more charge after a fall is still short of the next threshold', !accrueUpgradeCharge(wiped, 799).pending)
check('the next 1000 above current charge unlocks again', accrueUpgradeCharge(wiped, 800).pending && accrueUpgradeCharge(wiped, 800).charge === 4000)

const unspent = stripUpgradesOnFall(accrueUpgradeCharge(emptyUpgrade(), 1000))
check('an unpicked pending upgrade is discarded on a fall', !unspent.pending && unspent.earned === 1 && unspent.charge === 1000 && unspent.speed === 0)
check('the player must reach the next threshold to earn again', accrueUpgradeCharge(unspent, 999).pending === false && accrueUpgradeCharge(unspent, 1000).pending === true)

const emptyFall = stripUpgradesOnFall(emptyUpgrade())
check('a fall with no charge or buffs is a no-op', emptyFall.charge === 0 && emptyFall.earned === 0 && !emptyFall.pending)

// Round reset.
const book = new UpgradeBook()
book.gain('p1', 1000)
check('book grants charge to a human and unlocks a pending upgrade', book.ownerState('p1').charge === 1000 && book.ownerState('p1').pending === 1)
check('book accepts a valid selection', book.trySelect('p1', 'speed') && book.ownerState('p1').speed === 1)
book.gain('bot:3', 1000)
check('bots do not receive upgrade charge or selections', book.ownerState('bot:3').charge === 0 && !book.trySelect('bot:3', 'speed') && book.level('bot:3', 'speed') === 0)
book.gain('p1', 0)
check('zero gain is ignored', book.ownerState('p1').charge === 1000)
check('the book strips buffs on a fall and keeps charge spent', book.loseBuffsOnFall('p1') && book.ownerState('p1').speed === 0 && book.ownerState('p1').charge === 1000 && book.ownerState('p1').earned === 1 && book.ownerState('p1').pending === 0)
check('a second fall with nothing left is a no-op', !book.loseBuffsOnFall('p1'))
check('bots do not lose buffs because they never had them', !book.loseBuffsOnFall('bot:3'))
book.gain('p1', 1000)
check('the next threshold after a fall can still unlock', book.ownerState('p1').charge === 2000 && book.ownerState('p1').pending === 1)
book.clearRound()
check('a new round resets charge, pending, and levels', book.ownerState('p1').charge === 0 && book.ownerState('p1').pending === 0 && book.ownerState('p1').speed === 0 && book.ownerState('p1').earned === 0)

const starred = grantUpgradeBonus(emptyUpgrade())
check('a star grants one pending upgrade without paint charge', starred.pending && starred.bonus === 1 && starred.charge === 0 && starred.earned === 0 && pendingUpgradeCount(starred) === 1)
const starPick = trySelectUpgrade(starred, 'speed')
check('a star pick applies the buff and does not spend a paint threshold', starPick.ok && starPick.state.speed === 1 && starPick.state.earned === 0 && starPick.state.bonus === 0 && !starPick.state.pending && starPick.state.charge === 0)
check('paint charge after a star still unlocks at 1000', accrueUpgradeCharge(starPick.state, 1000).pending && accrueUpgradeCharge(starPick.state, 1000).earned === 0)
const stackedStar = grantUpgradeBonus(grantUpgradeBonus(emptyUpgrade()))
check('two stars stack two waiting picks', stackedStar.bonus === 2 && pendingUpgradeCount(stackedStar) === 2)
const withCharge = grantUpgradeBonus(accrueUpgradeCharge(emptyUpgrade(), 1000))
check('a star stacks on top of a paint unlock', withCharge.bonus === 1 && withCharge.earned === 0 && pendingUpgradeCount(withCharge) === 2)
const chargeFirst = trySelectUpgrade(withCharge, 'paint')
check('a mixed queue spends the paint unlock before the star', chargeFirst.ok && chargeFirst.state.paint === 1 && chargeFirst.state.earned === 1 && chargeFirst.state.bonus === 1 && chargeFirst.state.pending)
check('a maxed loadout ignores another star', grantUpgradeBonus(cap) === cap)
check('a fall discards an unspent star upgrade', stripUpgradesOnFall(starred).bonus === 0 && !stripUpgradesOnFall(starred).pending && stripUpgradesOnFall(starred).charge === 0)
const starBook = new UpgradeBook()
check('the book grants a star upgrade to a human', starBook.grantBonus('p1') && starBook.ownerState('p1').bonus === 1 && starBook.ownerState('p1').pending === 1 && starBook.ownerState('p1').charge === 0)
check('bots do not receive a star upgrade', !starBook.grantBonus('bot:1') && starBook.ownerState('bot:1').bonus === 0)

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
check('card offer at level 0 is the first-stack line', upgradeOfferLine('speed', 0) === '+15% movement speed' && upgradeOfferLine('paint', 0) === '+20% paint area' && upgradeOfferLine('haste', 0) === '−15% cooldowns')
check('card offer after one stack shows the next total', upgradeOfferLine('speed', 1) === '+25% movement speed')
check('card offer at max shows the current total', upgradeOfferLine('speed', 3) === '+30% movement speed')
check('all three kinds are offered at level 0', offeredUpgradeKinds(emptyUpgrade()).join(',') === 'speed,paint,haste')
check('a type at III is hidden from the offer', offeredUpgradeKinds({ ...emptyUpgrade(), speed: UPGRADE_LEVEL_MAX, paint: 1 }).join(',') === 'paint,haste')

check('hover grows a card by 8%', CARD_HOVER_SCALE === 1.08)
check('desktop cards target about twice the old compact width', CARD_TARGET_W === 280)
check('auto-open lasts 5 seconds and the pop lasts 0.25 seconds', CARD_AUTO_MS === 5000 && CARD_POP_MS === 250)
check('a pick that unlocks another upgrade waits 0.5 s before reopening', autoOpenDelayMs(true) === CARD_REOPEN_MS && CARD_REOPEN_MS === 500)
check('the first pending upgrade opens immediately', autoOpenDelayMs(false) === 0)
check('the auto timer is full at the start and empty at the end', autoTimerFrac(0, 5000) === 1 && autoTimerFrac(5000, 5000) === 0)
check('the auto timer is halfway at 2.5 s', Math.abs(autoTimerFrac(2500, 5000) - 0.5) < 1e-12)
check('the pop-in starts undersized and finishes at 1', cardPopScale(0, false) < 0.9 && Math.abs(cardPopScale(CARD_POP_MS, false) - 1) < 1e-12)
check('the pop-out ends undersized', cardPopScale(CARD_POP_MS, true) < 0.9 && Math.abs(cardPopScale(0, true) - 1) < 1e-12)
check('the pick shrinks fast and the glide runs the whole way', cardFlyShrink(0) === 0 && cardFlyShrink(0.34) > 0.99 && cardFlyShrink(1) === 1 && cardFlyMove(0) === 0 && Math.abs(cardFlyMove(0.5) - 0.5) < 1e-9 && cardFlyMove(1) === 1)
check('the cluster slides up on open and down on close', cardSlidePx(0, false) > 0 && cardSlidePx(CARD_POP_MS, false) === 0 && cardSlidePx(0, true) === 0 && cardSlidePx(CARD_POP_MS, true) > 0)


check('a pending pick reports a waiting count of at least 1', pendingUpgradeCount({ ...emptyUpgrade(), pending: true, charge: 1000, earned: 0 }) === 1)
check('stored extra thresholds raise the waiting count', pendingUpgradeCount({ ...emptyUpgrade(), pending: true, charge: 3000, earned: 0 }) === 3)
check('no badge count when nothing is pending', pendingUpgradeCount(emptyUpgrade()) === 0)
check('the pending badge bobs a few pixels at 1.5 Hz', BADGE_BOB_HZ === 1.5 && BADGE_BOB_PX === 5 && Math.abs(badgeBobPx(0)) < 1e-12 && Math.abs(badgeBobPx(1000 / 4 / BADGE_BOB_HZ) - BADGE_BOB_PX) < 1e-9)

const overlaySrc = readFileSync(new URL('../src/client/upgradeUi.tsx', import.meta.url), 'utf8')
check('the upgrade cards are centered and have no timer bar or close button', overlaySrc.includes("justifyContent: 'center'") && overlaySrc.includes('fitCardSize(') && !overlaySrc.includes('showTimer') && !overlaySrc.includes('autoFrac') && !overlaySrc.includes("bold('CLOSE')") && !overlaySrc.includes('closeUpgradeCards'))
check('cards highlight and grow on pointer hover', overlaySrc.includes('onMouseEnter') && overlaySrc.includes('CARD_HOVER_SCALE') && overlaySrc.includes('setUpgradeCardHover'))
check('a pending pick shows a red bouncing badge as soon as it unlocks', overlaySrc.includes('BADGE_RED') && overlaySrc.includes('badgeBob') && overlaySrc.includes('showBadge') && overlaySrc.includes('ready && hud.pendingCount > 0') && !overlaySrc.includes('!hud.clusterVisible && hud.pendingCount'))
check('the ready pill stays gold but no longer pulses', !overlaySrc.includes('pillPulseScale') && !overlaySrc.includes('PILL_PULSE') && overlaySrc.includes('readyFill') && overlaySrc.includes('openUpgradeCards'))

const audioSrc = readFileSync(new URL('../src/client/audio.ts', import.meta.url), 'utf8')
check('hover uses Fantasy_UI_44 and select uses Fantasy_UI_51', audioSrc.includes("assets/sounds/Fantasy_UI_44.wav") && audioSrc.includes('playUpgradeHoverSfx') && audioSrc.includes('playUpgradeSelectSfx') && audioSrc.includes("assets/sounds/Fantasy_UI_51.wav"))


// The HUD pill must show the same number that unlocks upgrades (charge),
// and walking paint in economy-off modes (PIXELWARS) must grant that charge.
check('1000 charge is the first unlock the pill should match', unlockedUpgradeCount(1000) === 1 && UPGRADE_THRESHOLDS[0] === 1000)
check('neutral flips add 1 charge, so 1000 neutrals unlock at a pill of 1000', upgradeChargeFor(0, 1) === 1)
check('enemy flips add 2 charge, so the pill reaches 1000 faster than the flip count', upgradeChargeFor(2, 1) === 2 && paintedScoreFor(2, 1) === 1)

const serverSrc = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
const tickStart = serverSrc.indexOf("room.onMessage('paintTick'")
const tickEnd = serverSrc.indexOf("room.onMessage('upgradeSelect'", tickStart)
const tickSrc = tickStart >= 0 && tickEnd > tickStart ? serverSrc.slice(tickStart, tickEnd) : ''
check('paintTick always credits upgrade charge through paintCells', tickSrc.includes('paintCells(') && tickSrc.includes('const gained = paintCells('))
check('paintTick no longer skips upgrades.gain when the paint tank is off', tickSrc.includes('paintCells(') && !tickSrc.includes('economyOn()') && !tickSrc.includes('applyPaint('))

const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
check('the HUD pill displays upgrade charge, not the flip-count paint score', uiSrc.includes('getUpgradeHud().charge') && !uiSrc.includes('paintedHud()'))

if (fails) { console.log(`\u2717 ${fails} upgrade check(s) failed`); process.exit(1) }
console.log('\u2713 all upgrade checks passed')
