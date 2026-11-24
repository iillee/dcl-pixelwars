/**
 * verify-bridges.ts — stacked underpasses stay common and legal.
 *
 * Generates 80 seeds (seed = round index), asserts at least half have a
 * true underpass, and checks the 6f557ac rules: a lower walkable tile in
 * the same (x, z) one STEP below, always the simple slab, never on a base
 * or spawn cell, and bots can path through the lower corridor.
 *
 * Run: npx tsx scripts/verify-bridges.ts
 */
import {
  generateWithRetry, getPlacedTilesInOrder, baseCells, STEP, fairness, FAIR_TOL,
  lastLayoutUsedFallback, GRID_W, GRID_H,
} from '../src/maze/generator'
import { tileModel, openingsAt } from '../src/maze/tiles'
import { buildWalkableGraph, walkableCellsForTile, findPath, cellId } from '../src/shared/mazeGraph'

const N = 80
const MIN_RATE = 0.5
const PATH_SEEDS = 16

let failed = 0
function fail(msg: string): void { console.error('✗ ' + msg); failed++ }
function ok(msg: string): void { console.log('✓ ' + msg) }

const isBase = (x: number, z: number): boolean => {
  for (const team of [1, 2, 3, 4]) {
    for (const [bx, bz] of baseCells(team)) if (bx === x && bz === z) return true
  }
  return false
}

if (GRID_W !== 5 || GRID_H !== 5) fail(`expected a 5×5 play grid, got ${GRID_W}×${GRID_H}`)

let withBridge = 0
let tilesSum = 0
let fallbacks = 0
const examples: string[] = []
const t0 = Date.now()

for (let s = 0; s < N; s++) {
  const won = generateWithRetry(s)
  if (won !== s) fail(`seed ${s} retried as ${won}`)
  const tiles = getPlacedTilesInOrder()
  tilesSum += tiles.length
  if (lastLayoutUsedFallback()) fallbacks++
  const f = fairness()
  if (f && (f.centre > FAIR_TOL || f.high > FAIR_TOL || f.tele > FAIR_TOL)) {
    fail(`seed ${s} unfair after underpass: centre ${f.centre}, L+1 ${f.high}, tele ${f.tele}`)
  }
  const bridges = tiles.filter(p => p.bridge)
  const byXZ = new Map<string, typeof tiles>()
  for (const p of tiles) {
    const k = `${p.x},${p.z}`
    const list = byXZ.get(k) ?? []
    list.push(p)
    byXZ.set(k, list)
  }
  for (const [k, list] of byXZ) {
    if (list.length < 2) continue
    if (list.length !== 2) { fail(`seed ${s}: ${list.length} tiles stacked at ${k}`); continue }
    const [a, b] = list[0].y < list[1].y ? list : [list[1], list[0]]
    if (Math.abs(b.y - a.y - STEP) > 0.01) fail(`seed ${s}: stacked tiles at ${k} not one STEP apart`)
    if (!b.bridge) fail(`seed ${s}: upper tile at ${k} is not a no-base bridge`)
  }
  if (!bridges.length) continue
  withBridge++
  if (examples.length < 8) examples.push(`${s} (${bridges.map(u => `${u.x},${u.z}`).join('; ')})`)
  for (const u of bridges) {
    const low = tiles.find(q => q !== u && q.x === u.x && q.z === u.z && Math.abs(u.y - q.y - STEP) < 0.05)
    if (!low) { fail(`seed ${s}: bridge at ${u.x},${u.z} has no lower tile one STEP below`); continue }
    if (isBase(u.x, u.z) || isBase(low.x, low.z)) fail(`seed ${s}: bridge on a base/spawn cell ${u.x},${u.z}`)
    const model = tileModel(u)
    if (!model.includes('bridgesimple')) fail(`seed ${s}: expected simple slab, got ${model}`)
    if (openingsAt(low.type, low.r).size < 2) fail(`seed ${s}: lower tile at ${u.x},${u.z} is not a through-path`)
  }
}

const ms = (Date.now() - t0) / N
const rate = withBridge / N
if (rate < MIN_RATE) fail(`underpass rate ${(rate * 100).toFixed(1)}% over ${N} seeds is below ${MIN_RATE * 100}%`)
else ok(`${withBridge}/${N} seeds (${(rate * 100).toFixed(1)}%) have a true underpass; avg ${ (tilesSum / N).toFixed(1)} tiles, ${ms.toFixed(1)} ms/seed, fallback ${fallbacks}×`)
ok(`examples: ${examples.join(', ')}`)

let pathed = 0
for (let s = 0; pathed < PATH_SEEDS && s < N; s++) {
  generateWithRetry(s)
  const tiles = getPlacedTilesInOrder()
  const bridges = tiles.filter(p => p.bridge)
  if (!bridges.length) continue
  const graph = buildWalkableGraph(tiles)
  const red = tiles.find(p => isBase(p.x, p.z) && p.x === baseCells(1)[0][0] && p.z === baseCells(1)[0][1]) ?? tiles.find(p => isBase(p.x, p.z))
  const startCell = red ? walkableCellsForTile(red)[0] : undefined
  if (!startCell) { fail(`seed ${s}: no walkable cell on RED base`); continue }
  const start = cellId(startCell.tx, startCell.tz, startCell.ty, startCell.col, startCell.row)
  for (const u of bridges) {
    const low = tiles.find(q => q !== u && q.x === u.x && q.z === u.z && Math.abs(u.y - q.y - STEP) < 0.05)
    if (!low) continue
    const cells = walkableCellsForTile(low)
    const okCell = cells.some(c => {
      const path = findPath(graph, start, cellId(c.tx, c.tz, c.ty, c.col, c.row))
      return !!(path && path.length)
    })
    if (!okCell) fail(`seed ${s}: bots cannot path through the underpass at ${u.x},${u.z}`)
  }
  pathed++
}
if (pathed === PATH_SEEDS) ok(`bots path through the lower corridor on ${PATH_SEEDS} underpass seeds`)
else fail(`only ${pathed}/${PATH_SEEDS} underpass seeds were available to path-check`)

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nverify-bridges: all checks passed')
