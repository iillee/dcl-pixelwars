/**
 * Paint tank rules for Prototype. Run: npx tsx scripts/verify-territory.ts
 *
 * Depots, territory respawn, and elimination are later steps. This covers
 * the spend: 1 per flip, free on your own cells, stop at 0, nearest first.
 */
import { readFileSync } from 'node:fs'
import { LOBBY_MODES } from '../src/shared/lobby'
import { PAINT_CAPACITY, PAINT_REFILL_PER_SEC, DEPOT_NEUTRAL_COUNT, WALLET_MIN_MS, FEET_IDLE_MS, WalletGate, applyTank, feetDue, nearestNode, onDepot, orderNearest, placeDepots } from '../src/shared/territory'
import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, baseTeamOfCellId } from '../src/maze/generator'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { refillWallet, resetWallets, setWallet, walletOf } from '../src/server/paintWallet'

if (PAINT_CAPACITY !== 280) {
  console.error(`✗ paint capacity should be 280, got ${PAINT_CAPACITY}`)
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
const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!ui.includes('function PaintTankBar') || !ui.includes('paintEconomyOn()') || !ui.includes("position: { top, right:")) {
  console.error('✗ Prototype needs a vertical paint bar on the right')
  process.exit(1)
}

if (Math.abs(PAINT_REFILL_PER_SEC * 5 - PAINT_CAPACITY) > 1) {
  console.error(`✗ a full refill should take about 5s (${PAINT_REFILL_PER_SEC}/s vs ${PAINT_CAPACITY})`)
  process.exit(1)
}
generateWithRetry(1, 40)
const maze = buildWalkableGraph(getPlacedTilesInOrder())
const redAt = baseSpawn(1).pos
const blueAt = baseSpawn(2).pos
const red = nearestNode(maze, redAt.x, redAt.y, redAt.z)
const blue = nearestNode(maze, blueAt.x, blueAt.y, blueAt.z)
if (!red || !blue) {
  console.error('✗ could not anchor depots on the team bases')
  process.exit(1)
}
const depots = placeDepots(maze, red, blue)
if (depots.length !== 2 + DEPOT_NEUTRAL_COUNT) {
  console.error(`✗ expected ${2 + DEPOT_NEUTRAL_COUNT} depots, got ${depots.length}`)
  process.exit(1)
}
if (depots[0].owner !== 1 || depots[1].owner !== 2 || depots[0].id !== red || depots[1].id !== blue) {
  console.error('✗ the first two depots should be the red and blue bases')
  process.exit(1)
}
for (const d of depots.slice(2)) {
  if (d.owner !== 0 || baseTeamOfCellId(d.id) !== 0) {
    console.error(`✗ neutral depot ${d.id} is on a base or pre-owned`)
    process.exit(1)
  }
  if (!onDepot(maze, d.id, d.id)) {
    console.error('✗ standing on a depot anchor should count')
    process.exit(1)
  }
}
const placedAgain = placeDepots(maze, red, blue).map(d => `${d.owner}:${d.id}`).join()
if (placedAgain !== depots.map(d => `${d.owner}:${d.id}`).join()) {
  console.error('✗ depot placement is not stable')
  process.exit(1)
}
const botSrc = readFileSync(new URL('../src/server/bots/manager.ts', import.meta.url), 'utf8')
if (!botSrc.includes('b.stay(cell)') || !botSrc.includes('economyOn?.()')) {
  console.error('✗ Prototype bots should walk to a friendly depot when their tank is low')
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
const depotSrc = readFileSync(new URL('../src/client/depots.ts', import.meta.url), 'utf8')
if (depotSrc.includes('getMutable') || !depotSrc.includes('shown !== post.team') || !depotSrc.includes('Tween.createOrReplace')) {
  console.error('✗ depot posts should write material only when ownership changes')
  process.exit(1)
}

console.log(`✓ paint tank, depots, empty-tank effects; wallet ${walletSends}/s refill, feet ${feetSends}/10s idle`)
