/**
 * Paint tank and territory-regen rules for Prototype.
 * Run: npx tsx scripts/verify-territory.ts
 *
 * Spend: 1 per flip, free on your own cells, stop at 0, nearest first.
 * Live refill is checkpoint depots. Cured-ground recharge stays parked
 * behind PAINT_REFILL_MODE = 'territory'.
 */
import { readFileSync } from 'node:fs'
import { LOBBY_MODES } from '../src/shared/lobby'
import {
  PAINT_CAPACITY, PAINT_COST, PAINT_REFILL_MODE, PAINT_REFILL_PER_SEC, PAINT_CURE_S, PAINT_GROUND_TOLERANCE,
  DEPOT_NEUTRAL_COUNT, DEPOT_FEET_MS, WALLET_MIN_MS, FEET_IDLE_MS, depotFeetFresh,
  WalletGate, accruePaint, applyTank, feetDue, isCuredSince, isRegenEligible,
  nearestNode, onDepot, orderNearest, placeDepots,
} from '../src/shared/territory'
import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, baseTeamOfCellId } from '../src/maze/generator'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { applyPaint, clearAll, ownedSince, seedOwned, teamOfCell } from '../src/server/paintState'
import { refillWallet, resetWallets, setWallet, walletOf } from '../src/server/paintWallet'

if (PAINT_REFILL_MODE !== 'depot') {
  console.error(`✗ live Prototype refill should be depots, got ${PAINT_REFILL_MODE}`)
  process.exit(1)
}
if (PAINT_CAPACITY !== 280) {
  console.error(`✗ paint capacity should be 280 in depot mode, got ${PAINT_CAPACITY}`)
  process.exit(1)
}
if (PAINT_COST !== 1 || PAINT_REFILL_PER_SEC !== 56 || PAINT_CURE_S !== 5) {
  console.error(`✗ expected cost 1, depot refill 56/s, cure 5s; got ${PAINT_COST}, ${PAINT_REFILL_PER_SEC}, ${PAINT_CURE_S}`)
  process.exit(1)
}
for (const m of LOBBY_MODES) {
  const want = m.id === 'prototype'
  if (m.economy !== want) {
    console.error(`✗ ${m.id} economy should be ${want}`)
    process.exit(1)
  }
}

const own = '2,2,0:8,8'
const near = '2,2,0:8,9'
const far = '2,2,0:1,1'
const other = '3,2,0:0,0'

function run(ids: string[], origin: string, tank: number, mine: Set<string>) {
  const ordered = orderNearest(ids, origin)
  const plan = applyTank(ordered.map(id => ({ id, flip: !mine.has(id) })), tank)
  for (const id of plan.taken) mine.add(id)
  return plan
}

const mine = new Set<string>([own])
const first = run([far, own, near], own, 1, mine)
if (first.taken.join() !== [own, near].join() || first.denied.join() !== far || first.tank !== 0) {
  console.error(`✗ nearest flip should spend the last point, got taken=${first.taken} denied=${first.denied} tank=${first.tank}`)
  process.exit(1)
}
if (!mine.has(near) || mine.has(far)) {
  console.error('✗ the denied cell must stay unpainted')
  process.exit(1)
}
const again = run([far, near, own], own, 0, mine)
if (again.taken.join() !== [own, near].join() || again.denied.join() !== far || again.tank !== 0) {
  console.error('✗ an empty tank paints nothing new and still accepts cells you already own')
  process.exit(1)
}

const full = applyTank([{ id: 'a', flip: false }, { id: 'b', flip: true }, { id: 'c', flip: true }], 5)
if (full.tank !== 3 || full.denied.length !== 0 || full.taken.join() !== 'a,b,c') {
  console.error('✗ a friendly cell is free and each flip costs 1')
  process.exit(1)
}

const stableA = orderNearest([far, near, other, own], own).join()
const stableB = orderNearest([other, far, own, near, near], own).join()
if (stableA !== stableB) {
  console.error('✗ nearest-first order should ignore duplicates and input order')
  process.exit(1)
}

resetWallets()
if (walletOf('p1') !== PAINT_CAPACITY) {
  console.error('✗ a new painter starts full')
  process.exit(1)
}
setWallet('p1', 0)
if (walletOf('p1') !== 0) {
  console.error('✗ the wallet should hold an empty tank')
  process.exit(1)
}
refillWallet('p1')
if (walletOf('p1') !== PAINT_CAPACITY) {
  console.error('✗ respawn should refill the tank')
  process.exit(1)
}
setWallet('p1', 10)
resetWallets()
if (walletOf('p1') !== PAINT_CAPACITY) {
  console.error('✗ a new round should forget the old tank')
  process.exit(1)
}

const msgs = readFileSync(new URL('../src/shared/messages.ts', import.meta.url), 'utf8')
const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
if (!msgs.includes('dry: Schemas.Int')) {
  console.error('✗ lunge and burst broadcasts should carry an empty-tank flag')
  process.exit(1)
}
const lungeSrc = readFileSync(new URL('../src/client/lunge.ts', import.meta.url), 'utf8')
const burstSrc = readFileSync(new URL('../src/client/paintBurst.ts', import.meta.url), 'utf8')
if (!lungeSrc.includes('localDry') || !burstSrc.includes('vfxTeam') || !server.includes('paintDry')) {
  console.error('✗ an empty tank should turn Dash and Burst effects white')
  process.exit(1)
}
if (!server.includes('economyOn()') || !server.includes('refillWallet(')) {
  console.error('✗ the server should spend only while the economy is on, and refill on respawn')
  process.exit(1)
}
const burst = server.slice(server.indexOf('const paintBurstFootprint'), server.indexOf('const commitBurstPaint'))
if (!burst.includes('return fp')) {
  console.error('✗ a short tank must not shrink the burst knockback footprint')
  process.exit(1)
}
if (!burst.includes('paintDry') || !burst.includes('paintCells')) {
  console.error('✗ an empty tank must skip burst paint, and a short tank must still spend')
  process.exit(1)
}
if ((server.split('if (!paintDry(by))').length - 1) < 2) {
  console.error('✗ empty-tank bot Burst and landing must not paint cells')
  process.exit(1)
}
const paintSrc = readFileSync(new URL('../src/paint.ts', import.meta.url), 'utf8')
if (paintSrc.includes('forceCell(id, paintUndo.get(id) ?? Team.None)') || !paintSrc.includes('paintUndo.get(id)')) {
  console.error('✗ a denied cell must revert only predicted paint, not bleach to empty')
  process.exit(1)
}
const rippleSrc = readFileSync(new URL('../src/client/burstRipple.ts', import.meta.url), 'utf8')
if (rippleSrc.includes('team === Team.None && !inLobby()')) {
  console.error('✗ empty-tank Burst and Dash should show the same white floor effect as Balloon Battle')
  process.exit(1)
}
if (!rippleSrc.includes('cellMaterial(s.team)') || rippleSrc.includes('noteLocalPaintCandidate') || rippleSrc.includes('applyRemotePaint') || rippleSrc.includes('forceCell')) {
  console.error('✗ the white Burst and Dash slabs must be temporary visuals, not paint-grid writes')
  process.exit(1)
}
const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!ui.includes('function PaintTankBar') || !ui.includes('paintEconomyOn()') || !ui.includes("position: { top, right:")) {
  console.error('✗ Prototype needs a vertical paint bar on the right')
  process.exit(1)
}
if (!ui.includes('NO PAINT') || !ui.includes('REFILL') || !ui.includes('RECHARGE') || !ui.includes('Date.now() / 180')) {
  console.error('✗ the paint bar should show REFILL at a depot, keep RECHARGE for territory mode, pulse while filling, and show NO PAINT when empty')
  process.exit(1)
}
if (!ui.includes('painterTeam()') || !ui.includes('borderRadius: radius') || !ui.includes('borderRadius: innerR') || !ui.includes('Team.Blue ? BLUE_COLOR : RED_COLOR')) {
  console.error('✗ the paint bar should be a team-colored pill with rounded ends on the track and the fill')
  process.exit(1)
}

if (Math.abs(PAINT_REFILL_PER_SEC * 5 - PAINT_CAPACITY) > 1) {
  console.error(`✗ a full depot refill should take about 5s (${PAINT_REFILL_PER_SEC}/s vs ${PAINT_CAPACITY})`)
  process.exit(1)
}
generateWithRetry(1, 40)
const maze = buildWalkableGraph(getPlacedTilesInOrder())
const redAt = baseSpawn(1).pos
const blueAt = baseSpawn(2).pos
const red = nearestNode(maze, redAt.x, redAt.y, redAt.z)
const blue = nearestNode(maze, blueAt.x, blueAt.y, blueAt.z)
if (!red || !blue) {
  console.error('✗ could not anchor team bases')
  process.exit(1)
}
const depots = placeDepots(maze, red, blue)
if (depots.length !== 2 + DEPOT_NEUTRAL_COUNT) {
  console.error(`✗ expected ${2 + DEPOT_NEUTRAL_COUNT} depot helper anchors, got ${depots.length}`)
  process.exit(1)
}
if (depots[0].owner !== 1 || depots[1].owner !== 2 || depots[0].id !== red || depots[1].id !== blue) {
  console.error('✗ the first two depot helper anchors should be the red and blue bases')
  process.exit(1)
}
for (const d of depots.slice(2)) {
  if (d.owner !== 0 || baseTeamOfCellId(d.id) !== 0) {
    console.error(`✗ neutral depot helper ${d.id} is on a base or pre-owned`)
    process.exit(1)
  }
  if (!onDepot(maze, d.id, d.id)) {
    console.error('✗ standing on a depot anchor should still count in the unused helper')
    process.exit(1)
  }
}
const placedAgain = placeDepots(maze, red, blue).map(d => `${d.owner}:${d.id}`).join()
if (placedAgain !== depots.map(d => `${d.owner}:${d.id}`).join()) {
  console.error('✗ depot placement is not stable')
  process.exit(1)
}
const botSrc = readFileSync(new URL('../src/server/bots/manager.ts', import.meta.url), 'utf8')
if (!botSrc.includes('b.stay(cell)') || !botSrc.includes('economyOn?.()') || !botSrc.includes('friendlyDepot')) {
  console.error('✗ Prototype bots should walk to a friendly depot when their tank is low')
  process.exit(1)
}
if (!server.includes('seedDepots(') || !server.includes('tickDepotRefill(') || !server.includes('noteDepotFeet(') || !server.includes('friendlyDepotCell')) {
  console.error('✗ Prototype should seed depots and tick depot refill')
  process.exit(1)
}
if (!server.includes('refillAtDepot()') || !server.includes('refillOnTerritory()')) {
  console.error('✗ depot and territory refill must be selected by the shared toggle')
  process.exit(1)
}
if (!server.includes('tickTerritoryRegen') || !server.includes('seedStartTerritory') || !server.includes('nearestCuredCell')) {
  console.error('✗ cured-ground recharge should stay parked behind the territory toggle')
  process.exit(1)
}
if (!server.includes('economyOn()') || !/if \(refillAtDepot\(\)\) \{[\s\S]*tickDepotRefill/.test(server)) {
  console.error('✗ depot refill must stay inside the Prototype economy gate')
  process.exit(1)
}
if (DEPOT_FEET_MS < 2000) {
  console.error(`✗ depot feet must stay valid longer than a slow host tick, got ${DEPOT_FEET_MS}ms`)
  process.exit(1)
}
if (!depotFeetFresh(0, 600) || !depotFeetFresh(0, 1500) || depotFeetFresh(0, DEPOT_FEET_MS + 1)) {
  console.error('✗ standing still at a depot should still count as present after a delayed tick')
  process.exit(1)
}
const depotTickSrc = readFileSync(new URL('../src/server/depots.ts', import.meta.url), 'utf8')
if (!depotTickSrc.includes('depotFeetFresh') || !depotTickSrc.includes('lastGrant') || depotTickSrc.includes('s.t > 500')) {
  console.error('✗ depot refill should keep late feet and accrue with wall-clock time')
  process.exit(1)
}
if (!paintSrc.includes('adoptWallet') || !paintSrc.includes('serverTank') || !paintSrc.includes('serverTankAt')) {
  console.error('✗ the paint bar should climb from the last server wallet, not a runaway local value')
  process.exit(1)
}

const gate = new WalletGate()
let walletSends = 0
for (let i = 1; i <= PAINT_REFILL_PER_SEC; i++) {
  const t = Math.round((i / PAINT_REFILL_PER_SEC) * 1000)
  if (gate.offer('p', i, [], t, PAINT_CAPACITY)) walletSends++
}
for (const msg of gate.due(1000, PAINT_CAPACITY)) if (msg) walletSends++
if (walletSends > 1000 / WALLET_MIN_MS + 1) {
  console.error(`✗ refill wallet echo ran at ${walletSends}/s; cap is ${1000 / WALLET_MIN_MS}/s`)
  process.exit(1)
}
const deniedNow = gate.offer('p', 3, ['cell'], 1001, PAINT_CAPACITY)
if (!deniedNow || deniedNow.denied.length !== 1) {
  console.error('✗ a refused cell should echo immediately')
  process.exit(1)
}
const emptyNow = gate.offer('p', 0, [], 1002, PAINT_CAPACITY)
if (!emptyNow || emptyNow.tank !== 0) {
  console.error('✗ an empty tank should echo immediately')
  process.exit(1)
}
if (gate.offer('p', 0, [], 1003, PAINT_CAPACITY)) {
  console.error('✗ a repeated empty tank should not echo again')
  process.exit(1)
}
const regenStart = gate.offer('p', 1, [], 1004, PAINT_CAPACITY, 1)
if (!regenStart || regenStart.regen !== 1) {
  console.error('✗ starting regen should echo immediately')
  process.exit(1)
}
if (gate.offer('p', 1, [], 1005, PAINT_CAPACITY, 1)) {
  console.error('✗ a repeated regen state should not echo again')
  process.exit(1)
}
const regenStop = gate.offer('p', 1, [], 1006, PAINT_CAPACITY, 0)
if (!regenStop || regenStop.regen !== 0) {
  console.error('✗ stopping regen should echo immediately')
  process.exit(1)
}
let feetSends = 0
let lastCell = ''
let lastMs = 0
for (let i = 0; i < 100; i++) {
  const now = i * 100
  if (!feetDue('2,2,0:8,8', lastCell, lastMs, now, false)) continue
  feetSends++
  lastCell = '2,2,0:8,8'
  lastMs = now
}
if (feetSends > 1000 / FEET_IDLE_MS * 10 + 2) {
  console.error(`✗ standing still sent feet ${feetSends} times in 10s`)
  process.exit(1)
}
if (!feetDue('2,2,0:9,8', lastCell, lastMs, lastMs + 10, false)) {
  console.error('✗ stepping onto a new cell should report immediately')
  process.exit(1)
}
if (!feetDue('2,2,0:9,8', lastCell, lastMs, lastMs + 10, true)) {
  console.error('✗ a grounded flip should force a feet report')
  process.exit(1)
}
const depotSrc = readFileSync(new URL('../src/client/depots.ts', import.meta.url), 'utf8')
const initBlock = depotSrc.slice(depotSrc.indexOf('export function initDepots'), depotSrc.indexOf('export function initDepots') + 400)
if (!initBlock.includes('ensurePosts()') || !initBlock.includes('predictDepotRefill') || !initBlock.includes('recolor(')) {
  console.error('✗ Prototype client should spawn depot posts and refill from them')
  process.exit(1)
}
if (!depotSrc.includes("PAINT_REFILL_MODE !== 'depot'") || !depotSrc.includes('if (posts.length) clearPosts()')) {
  console.error('✗ depot posts should only spawn in depot mode, and leftover posts should clear otherwise')
  process.exit(1)
}
if (!depotSrc.includes('TEAM_RGB[team]') || !depotSrc.includes('NEUTRAL')) {
  console.error('✗ depot cylinders should use the team paint color, with off-white for unowned posts')
  process.exit(1)
}
const ownedGlow = Number((depotSrc.match(/OWNED_GLOW\s*=\s*([0-9.]+)/) || [])[1])
const neutralGlow = Number((depotSrc.match(/NEUTRAL_GLOW\s*=\s*([0-9.]+)/) || [])[1])
if (!(ownedGlow <= 0.3) || !(neutralGlow <= 0.15) || depotSrc.includes('1.4') && depotSrc.includes('emissiveIntensity')) {
  if (!(Number.isFinite(ownedGlow) && ownedGlow <= 0.3 && Number.isFinite(neutralGlow) && neutralGlow <= 0.15)) {
    console.error(`✗ depot emission should stay low so the team paint color is not washed out (owned=${ownedGlow}, neutral=${neutralGlow})`)
    process.exit(1)
  }
}

// ── Curing, regen eligibility, spend, start territory ──────────────
const t0 = 1_000_000
if (!isCuredSince(0, t0) || !isCuredSince(-1, t0)) {
  console.error('✗ starting territory (since <= 0) must already be cured')
  process.exit(1)
}
if (isCuredSince(t0, t0 + PAINT_CURE_S * 1000 - 1)) {
  console.error('✗ a fresh capture must not be cured before the delay')
  process.exit(1)
}
if (!isCuredSince(t0, t0 + PAINT_CURE_S * 1000)) {
  console.error('✗ a capture should become cured after the delay')
  process.exit(1)
}

const grounded = { team: 1, cellTeam: 1, ownedSince: 0, now: t0, grounded: true, feetY: 10, cellY: 10 }
if (!isRegenEligible(grounded)) {
  console.error('✗ cured friendly ground should refill')
  process.exit(1)
}
if (isRegenEligible({ ...grounded, grounded: false })) {
  console.error('✗ airborne players must not refill')
  process.exit(1)
}
if (isRegenEligible({ ...grounded, feetY: 10 + PAINT_GROUND_TOLERANCE + 0.01 })) {
  console.error('✗ a different elevation must not refill')
  process.exit(1)
}
if (isRegenEligible({ ...grounded, cellTeam: 2 })) {
  console.error('✗ enemy territory must not refill')
  process.exit(1)
}
if (isRegenEligible({ ...grounded, cellTeam: 0 })) {
  console.error('✗ neutral territory must not refill')
  process.exit(1)
}
if (isRegenEligible({ ...grounded, ownedSince: t0, now: t0 + 1000 })) {
  console.error('✗ freshly painted friendly ground must not refill')
  process.exit(1)
}
if (!isRegenEligible({ ...grounded, ownedSince: t0, now: t0 + PAINT_CURE_S * 1000 })) {
  console.error('✗ friendly ground should refill once cured')
  process.exit(1)
}

const tick = accruePaint(0, 0, 1, 10, 80)
if (tick.tank !== 10 || tick.gained !== 10) {
  console.error(`✗ 1s of territory regen should grant 10 paint, got ${tick.tank}`)
  process.exit(1)
}
const cap = accruePaint(80 - 3, 0, 1, 10, 80)
if (cap.tank !== 80 || cap.gained !== 3) {
  console.error('✗ regen must stop at max paint')
  process.exit(1)
}
const frac = accruePaint(0, 0, 0.04, 10, 80)
if (frac.tank !== 0 || !(frac.frac > 0)) {
  console.error('✗ sub-unit regen should carry a fraction and not over-spend')
  process.exit(1)
}
const nextFrac = accruePaint(0, frac.frac, 0.08, 10, 80)
if (nextFrac.tank !== 1) {
  console.error(`✗ carried fraction plus 0.08s should grant 1 paint, got ${nextFrac.tank}`)
  process.exit(1)
}
const depotTick = accruePaint(0, 0, 1, 56, 280)
if (depotTick.tank !== 56 || depotTick.gained !== 56) {
  console.error(`✗ 1s at a depot should grant 56 paint, got ${depotTick.tank}`)
  process.exit(1)
}

clearAll()
seedOwned('start', 1, 'base', 0)
if (teamOfCell('start') !== 1 || ownedSince('start') !== 0 || !isCuredSince(ownedSince('start'), Date.now())) {
  console.error('✗ seeded start territory must be owned and pre-cured')
  process.exit(1)
}
if (!applyPaint('fresh', 1, 'p1')) {
  console.error('✗ the first capture of a cell should change ownership')
  process.exit(1)
}
const firstSince = ownedSince('fresh')
if (!Number.isFinite(firstSince) || firstSince <= 0 || isCuredSince(firstSince, firstSince + 1000)) {
  console.error('✗ a newly captured cell must start a curing timer')
  process.exit(1)
}
if (applyPaint('fresh', 1, 'p1')) {
  console.error('✗ repainting your own cell must not spend or reset the cure timer')
  process.exit(1)
}
if (ownedSince('fresh') !== firstSince) {
  console.error('✗ a same-team repaint must not reset ownedSince')
  process.exit(1)
}
while (Date.now() <= firstSince) { /* clock must move so a flip can retimestamp */ }
if (!applyPaint('fresh', 2, 'p2')) {
  console.error('✗ flipping a cell should change ownership')
  process.exit(1)
}
const flipped = ownedSince('fresh')
if (flipped <= firstSince) {
  console.error('✗ flipping a cell must reset the curing timer')
  process.exit(1)
}
if (ownedSince('ghost') !== Number.POSITIVE_INFINITY || isCuredSince(ownedSince('ghost'), Date.now())) {
  console.error('✗ a cell with no ownership time must not count as cured')
  process.exit(1)
}
clearAll()

const handlerSrc = readFileSync(new URL('../src/client/clientHandler.ts', import.meta.url), 'utf8')
if (!handlerSrc.includes('g: grounded ? 1 : 0') || !msgs.includes('y: Schemas.Number') || !msgs.includes('regen: Schemas.Int')) {
  console.error('✗ paintTick should report feet height and grounded, and paintWallet should carry regen')
  process.exit(1)
}
if (!paintSrc.includes('tickLocalPaintRegen') || !paintSrc.includes('cellSince') || !paintSrc.includes('predictTerritoryRefill') || !paintSrc.includes('refillOnTerritory()')) {
  console.error('✗ cured-ground client regen should stay parked behind the territory toggle')
  process.exit(1)
}
const regenSrc = readFileSync(new URL('../src/server/territoryRegen.ts', import.meta.url), 'utf8')
if (!regenSrc.includes('seedOwned(id, team,') || !regenSrc.includes('pushWallet(id, walletOf(id), 0)')) {
  console.error('✗ start territory should be pre-cured and regen-stop should echo once')
  process.exit(1)
}

console.log(`✓ paint tank 280 / 5s depot refill, parked territory regen, empty-tank combat; wallet ${walletSends}/s refill, feet ${feetSends}/10s idle`)
