/**
 * verify-graph.ts — sanity check for shared/mazeGraph.ts
 *
 * Generates a real maze with seed 1, builds the walkable graph, then
 * runs BFS from an arbitrary node and asserts it reaches every other
 * node. The generator guarantees the maze is fully connected at the
 * tile level; the mask+cross-tile-edge logic in mazeGraph must
 * preserve that at the cell level.
 *
 * Run: npx tsx scripts/verify-graph.ts
 */

import {
  generateWithRetry, getPlacedTilesInOrder, baseCells, baseTeamOfCellId, mirrorCell,
  BASE_Y, STEP, MAX_Y, GRID_W, GRID_H, SCENE_SIZE,
} from '../src/maze/generator'
import { LEVEL_MODE, IS_SKY, SKY_LEVEL_COUNT } from '../src/maze/level'
import { buildWalkableGraph, reachableCount, findPath } from '../src/shared/mazeGraph'

console.log(`LEVEL_MODE=${LEVEL_MODE} grid=${GRID_W}x${GRID_H} scene=${SCENE_SIZE}m baseY=${BASE_Y} maxY=${MAX_Y.toFixed(2)}`)

const seed = generateWithRetry(1, 50)
if (seed === null) {
  console.error('generation failed for seed 1'); process.exit(1)
}
const placed = getPlacedTilesInOrder()
console.log(`tiles placed: ${placed.length}, seed: ${seed}`)

const t0 = Date.now()
const graph = buildWalkableGraph(placed)
const t1 = Date.now()
console.log(`graph built in ${t1 - t0}ms — nodes: ${graph.nodes.size}, edges: ${[...graph.adj.values()].reduce((s, a) => s + a.length, 0)}`)

// Pick any node
const start = graph.nodes.values().next().value as string
const reached = reachableCount(graph, start)
console.log(`BFS from ${start}: reached ${reached} / ${graph.nodes.size}`)

if (reached === graph.nodes.size) {
  console.log('✓ graph is fully connected')
} else {
  console.error(`✗ ${graph.nodes.size - reached} unreachable cells — mask or cross-tile edge bug`)
  process.exit(1)
}

// ─── Pathfinding smoke test ────────────────────────────────────────
// Pick two cells far apart in insertion order (roughly opposite ends of the
// maze, since generator BFS-grows outward from center). Time N random-pair
// pathfinds to bound worst-case bot planning cost.
const nodeArr = [...graph.nodes]
const first = nodeArr[0]
const last = nodeArr[nodeArr.length - 1]

const tp0 = Date.now()
const path = findPath(graph, first, last)
const tp1 = Date.now()
if (!path) { console.error(`✗ no path between ${first} and ${last}`); process.exit(1) }
console.log(`✓ path ${first} → ${last}: ${path.length} steps in ${tp1 - tp0}ms`)

// Timing profile: 100 random pairs (approximates bot re-planning load)
const N_TESTS = 100
let totalMs = 0
let totalSteps = 0
for (let i = 0; i < N_TESTS; i++) {
  const a = nodeArr[Math.floor(Math.random() * nodeArr.length)]
  const b = nodeArr[Math.floor(Math.random() * nodeArr.length)]
  const t0 = Date.now()
  const p = findPath(graph, a, b)
  totalMs += Date.now() - t0
  if (p) totalSteps += p.length
}
console.log(`✓ ${N_TESTS} random pathfinds: avg ${(totalMs / N_TESTS).toFixed(2)}ms, avg ${(totalSteps / N_TESTS).toFixed(0)} steps`)

// ─── Sky-mode checks ────────────────────────────────────────────────
if (IS_SKY) {
  const fail = (m: string) => { console.error(`✗ ${m}`); process.exit(1) }
  // Levels: every tile within SKY_LEVEL_COUNT levels above BASE_Y.
  const levels = new Map<number, number>()
  for (const p of placed) {
    const l = Math.round((p.y - BASE_Y) / STEP)
    if (l < 0 || l >= SKY_LEVEL_COUNT) fail(`tile (${p.x},${p.z}) at level ${l}`)
    levels.set(l, (levels.get(l) ?? 0) + 1)
  }
  console.log(`✓ levels within 0..${SKY_LEVEL_COUNT - 1}: ${[...levels].sort().map(([l, n]) => `L${l}=${n}`).join(' ')}`)

  // 180° symmetry: every tile has a mirrored twin with rotation r+2.
  const byKey = new Map(placed.map(p => [`${p.x},${p.z},${p.y.toFixed(3)}`, p]))
  for (const p of placed) {
    const [mx, mz] = mirrorCell(p.x, p.z)
    const m = byKey.get(`${mx},${mz},${p.y.toFixed(3)}`)
    if (!m || m.type !== p.type || m.r !== (p.r + 2) % 4) fail(`asymmetric tile (${p.x},${p.z},${p.y}) ${p.type} r${p.r}`)
  }
  console.log('✓ layout is 180° point-symmetric (RED half == BLUE half)')

  // Bases present + connected at the cell level (what players/bots walk).
  const redCells = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 1)
  const blueCells = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 2)
  if (!redCells.length || !blueCells.length) fail(`base cells missing (red=${redCells.length} blue=${blueCells.length})`)
  const bp = findPath(graph, redCells[0], blueCells[0])
  if (!bp) fail('no path RED base → BLUE base')
  console.log(`✓ bases ${JSON.stringify(baseCells(1))} ↔ ${JSON.stringify(baseCells(2))} connected: ${bp!.length} steps (${redCells.length}+${blueCells.length} locked base cells)`)

  // Generation robustness / cost over many seeds.
  let ok = 0, worst = 0, tiles = 0, cells = 0
  const N = 30
  const tg = Date.now()
  for (let i = 0; i < N; i++) {
    const s0 = 1000 + i * 7919
    const w = generateWithRetry(s0, 500)
    if (w === null) continue
    ok++; worst = Math.max(worst, w - s0 + 1)
    const P = getPlacedTilesInOrder(); tiles += P.length
    cells += buildWalkableGraph(P).nodes.size
  }
  const ms = (Date.now() - tg) / N
  if (ok !== N) fail(`${N - ok}/${N} start seeds found no valid connected level`)
  console.log(`✓ ${N}/${N} seeds valid; worst ${worst} attempt(s); avg ${(tiles / N).toFixed(0)} tiles, ${(cells / N).toFixed(0)} paint cells; ${ms.toFixed(1)} ms per round (gen+graph)`)
}
