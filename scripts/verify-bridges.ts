/**
 * verify-bridges.ts — stacked underpasses stay common, legal, and through-paths.
 *
 * Generates 100 seeds (seed = round index), asserts a true perpendicular
 * crossover appears (regression floor 50%; crossover-first planting),
 * and checks:
 *   1. Each bridge is a straight or ramp whose both ends connect on its level.
 *   2. The tile one STEP below is a straight (or ramp) whose axis is
 *      perpendicular, with both ends connected. A ramp lower is allowed
 *      by the geometry rule but rejected in practice: its deck would rise
 *      into the slab.
 *   3. No dead-end or end tiles anywhere. Every walkable tile has ≥2 openings.
 * Plus the 6f557ac rules: simple slab only, never on a base or spawn cell,
 * and bots can path through the lower corridor.
 *
 * Run: npx tsx scripts/verify-bridges.ts
 */
import {
  generateWithRetry, getPlacedTilesInOrder, baseCells, STEP, fairness, FAIR_TOL,
  lastLayoutUsedFallback, GRID_W, GRID_H,
} from '../src/maze/generator'
import { tileModel, openingsAt, DX, DZ, OPP, Dir } from '../src/maze/tiles'
import { buildWalkableGraph, walkableCellsForTile, findPath, cellId } from '../src/shared/mazeGraph'

const N = 100
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

type P = ReturnType<typeof getPlacedTilesInOrder>[number]

const axisOf = (p: P): 0 | 1 | null => {
  const opens = [...openingsAt(p.type, p.r)]
  if (opens.length !== 2 || opens[0] % 2 !== opens[1] % 2) return null
  return (opens[0] % 2) as 0 | 1
}

const bothConnected = (p: P, tiles: P[]): boolean => {
  const opens = openingsAt(p.type, p.r)
  if (opens.size < 2) return false
  for (const d of opens) {
    const myY = p.type === 'ramp' && p.r === d ? p.y + STEP : p.y
    const nx = p.x + DX[d], nz = p.z + DZ[d]
    const back = OPP[d] as Dir
    const ok = tiles.some(q => {
      if (q.x !== nx || q.z !== nz) return false
      if (!openingsAt(q.type, q.r).has(back)) return false
      const theirY = q.type === 'ramp' && q.r === back ? q.y + STEP : q.y
      return Math.abs(myY - theirY) < 0.05
    })
    if (!ok) return false
  }
  return true
}

if (GRID_W !== 5 || GRID_H !== 5) fail(`expected a 5×5 play grid, got ${GRID_W}×${GRID_H}`)

let withBridge = 0
let bridgeSum = 0
let multi = 0
let tilesSum = 0
let fallbacks = 0
let ends = 0
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
  const endTiles = tiles.filter(p => p.type === 'end' || openingsAt(p.type, p.r).size < 2)
  ends += endTiles.length
  for (const p of endTiles) fail(`seed ${s}: dead end or end tile at (${p.x},${p.z}) type=${p.type}`)

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
  bridgeSum += bridges.length
  if (bridges.length > 1) multi++
  if (examples.length < 8) examples.push(`${s} (${bridges.map(u => `${u.x},${u.z}:${u.type}`).join('; ')})`)
  for (const u of bridges) {
    const low = tiles.find(q => q !== u && q.x === u.x && q.z === u.z && Math.abs(u.y - q.y - STEP) < 0.05)
    if (!low) { fail(`seed ${s}: bridge at ${u.x},${u.z} has no lower tile one STEP below`); continue }
    if (isBase(u.x, u.z) || isBase(low.x, low.z)) fail(`seed ${s}: bridge on a base/spawn cell ${u.x},${u.z}`)
    const model = tileModel(u)
    if (!model.includes('bridgesimple')) fail(`seed ${s}: expected simple slab, got ${model}`)
    if (u.type !== 'straight' && u.type !== 'ramp') fail(`seed ${s}: upper at ${u.x},${u.z} is a ${u.type}, not a straight or ramp`)
    if (!bothConnected(u, tiles)) fail(`seed ${s}: upper at ${u.x},${u.z} is not a through-path`)
    if (low.type !== 'straight' && low.type !== 'ramp') fail(`seed ${s}: lower at ${u.x},${u.z} is a ${low.type}, not a straight or ramp`)
    if (!bothConnected(low, tiles)) fail(`seed ${s}: lower at ${u.x},${u.z} is not a through-path`)
    const ua = axisOf(u), la = axisOf(low)
    if (ua === null || la === null || ua === la) {
      fail(`seed ${s}: stacked tiles at ${u.x},${u.z} are not a perpendicular crossover`)
    }
  }
}

const ms = (Date.now() - t0) / N
const rate = withBridge / N
if (rate < MIN_RATE) fail(`underpass rate ${(rate * 100).toFixed(1)}% over ${N} seeds is below ${MIN_RATE * 100}%`)
else ok(`${withBridge}/${N} seeds (${(rate * 100).toFixed(1)}%) have a true underpass; ${multi} with 2+; avg ${(bridgeSum / Math.max(1, withBridge)).toFixed(2)} bridges/underpass-seed, ${(tilesSum / N).toFixed(1)} tiles, ${ms.toFixed(1)} ms/seed, fallback ${fallbacks}×, end tiles ${ends}`)
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
