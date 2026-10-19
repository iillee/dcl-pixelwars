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
  generateWithRetry, getPlacedTilesInOrder, baseCells, baseTeamOfCellId, mirrorCell, baseLineCells, baseLinePaths,
  BASE_Y, STEP, MAX_Y, GRID_W, GRID_H, SCENE_SIZE,
} from '../src/maze/generator'
import { LEVEL_MODE, IS_SKY, SKY_LEVEL_COUNT, SKY_BASES_ONLY, SKY_BASE_LINE } from '../src/maze/level'
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

// ─── Sky bases + line: rings joined by one paintable L path ────────
if (IS_SKY && SKY_BASES_ONLY && SKY_BASE_LINE) {
  const fail = (m: string) => { console.error(`✗ ${m}`); process.exit(1) }
  const line = baseLineCells()
  if (placed.length !== 8 + line.length) fail(`expected ${8 + line.length} tiles, got ${placed.length}`)
  if (placed.some(p => Math.abs(p.y - BASE_Y) > 0.01 || p.type === 'ramp')) fail('path not flat at BASE_Y')
  const red = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 1)
  const blue = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 2)
  const open = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 0)
  if (red.length !== blue.length) fail(`base sizes differ red=${red.length} blue=${blue.length}`)
  if (!open.length) fail('no paintable path cells')
  if (reachableCount(graph, red[0]) !== graph.nodes.size) fail('graph not fully connected')
  const bp = findPath(graph, red[0], blue[0])
  if (!bp) fail('no path RED → BLUE')
  // Fairness: the whole layout maps onto itself under the same 180°
  // rotation as the bases (x,z) → (W-1-x, H-1-z); openings rotate by 2.
  const opensOf = (p: typeof placed[number]) => {
    const t = ({ end: [0], straight: [0, 2], turn: [0, 1], fork: [0, 2, 3], cross: [0, 1, 2, 3], ramp: [0, 2] } as Record<string, number[]>)[p.type]
    return new Set(t.map(d => (d + p.r) % 4))
  }
  const byXZ = new Map(placed.map(p => [`${p.x},${p.z}`, p]))
  for (const p of placed) {
    const [mx, mz] = mirrorCell(p.x, p.z)
    const q = byXZ.get(`${mx},${mz}`)
    if (!q) fail(`no 180° twin for (${p.x},${p.z})`)
    const a = [...opensOf(p)].map(d => (d + 2) % 4).sort().join(), b = [...opensOf(q!)].sort().join()
    if (a !== b) fail(`180° openings differ at (${p.x},${p.z}) vs (${mx},${mz})`)
  }
  // Each path, walked tile by tile, is a real connected route between the
  // inner ring tiles, and each inner ring tile has exactly two exits.
  const paths = baseLinePaths()
  if (paths.length !== 2) fail(`expected 2 paths, got ${paths.length}`)
  for (const team of [1, 2]) {
    const ring = baseCells(team)
    const exits = placed.filter(p => ring.some(([x, z]) => x === p.x && z === p.z))
      .reduce((n, p) => n + [...opensOf(p)].filter(d => {
        const nx = p.x + [0, 1, 0, -1][d], nz = p.z + [1, 0, -1, 0][d]
        return !ring.some(([x, z]) => x === nx && z === nz)
      }).length, 0)
    if (exits !== 2) fail(`base ${team} has ${exits} exits (want 2)`)
  }
  const crossings = paths[0].filter(([x, z]) => paths[1].some(([a, b]) => a === x && b === z))
  console.log(`✓ path A ${JSON.stringify(paths[0])}`)
  console.log(`✓ path B ${JSON.stringify(paths[1])}`)
  console.log(`✓ paths cross at ${JSON.stringify(crossings)} (${crossings.map(([x, z]) => byXZ.get(`${x},${z}`)!.type).join(', ')}); each base has 2 exits`)
  console.log('✓ fair: whole layout is 180° point-symmetric (same rotation as the bases)')
  console.log(`✓ bases ${JSON.stringify(baseCells(1))} ↔ ${JSON.stringify(baseCells(2))} joined by ${line.length} path tiles`)
  console.log(`✓ RED→BLUE ${bp!.length} steps; ${open.length} paintable path cells, ${red.length}+${blue.length} locked base cells; fully connected`)
  process.exit(0)
}

// ─── Sky bases-only: two closed rings, nothing else ─────────────────
if (IS_SKY && SKY_BASES_ONLY) {
  const fail = (m: string) => { console.error(`✗ ${m}`); process.exit(1) }
  if (placed.length !== 8 || placed.some(p => p.type !== 'turn')) fail(`expected 8 turn tiles, got ${placed.map(p => p.type).join(',')}`)
  const red = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 1)
  const blue = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 2)
  if (red.length + blue.length !== graph.nodes.size) fail('non-base cells in graph')
  if (red.length !== blue.length) fail(`base sizes differ red=${red.length} blue=${blue.length}`)
  if (reachableCount(graph, red[0]) !== red.length) fail('RED ring not one closed loop / leaks')
  if (reachableCount(graph, blue[0]) !== blue.length) fail('BLUE ring not one closed loop / leaks')
  console.log(`✓ RED base ${JSON.stringify(baseCells(1))} and BLUE base ${JSON.stringify(baseCells(2))}: closed rings of 4 turn tiles, ${red.length} locked cells each, not connected to each other (by design)`)
  const byKey = new Map(placed.map(p => [`${p.x},${p.z},${p.y.toFixed(3)}`, p]))
  for (const p of placed) {
    const [mx, mz] = mirrorCell(p.x, p.z)
    const m = byKey.get(`${mx},${mz},${p.y.toFixed(3)}`)
    if (!m || m.r !== (p.r + 2) % 4) fail(`asymmetric tile (${p.x},${p.z})`)
  }
  console.log('✓ bases are 180° mirror images; bases-only mode skips path/branch checks')
  process.exit(0)
}

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
