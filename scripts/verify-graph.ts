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
  generateWithRetry, getPlacedTilesInOrder, baseCells, baseTeamOfCellId, mirrorCell, baseLineCells, baseLinePathCells, lastLayoutUsedFallback, layFallback, MIN_Y,
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

// ─── Sky bases + 4 seeded paths ─────────────────────────────────────
if (IS_SKY && SKY_BASES_ONLY && SKY_BASE_LINE) {
  const fail = (m: string) => { console.error(`✗ ${m}`); process.exit(1) }
  if (Math.abs(MIN_Y - (BASE_Y - STEP)) > 0.01) fail(`MIN_Y ${MIN_Y} != BASE_Y - STEP`)
  const OPENS: Record<string, number[]> = { end: [0], straight: [0, 2], turn: [0, 1], fork: [0, 2, 3], cross: [0, 1, 2, 3], ramp: [0, 2] }
  const DXZ = [[0, 1], [1, 0], [0, -1], [-1, 0]]
  const lvl = (y: number) => Math.round((y - BASE_Y) / STEP)
  type P = ReturnType<typeof getPlacedTilesInOrder>[number]
  const opensOf = (p: P) => new Set(OPENS[p.type].map(d => (d + p.r) % 4))
  const isBase = (x: number, z: number) => baseCells(1).concat(baseCells(2)).some(([a, b]) => a === x && b === z)

  /** All rule checks on the current layout; returns an error string or null. */
  function check(): string | null {
    const placed = getPlacedTilesInOrder()
    const byXZ = new Map<string, P>()
    for (const p of placed) {
      if (byXZ.has(`${p.x},${p.z}`)) return `two tiles stacked at (${p.x},${p.z})`
      byXZ.set(`${p.x},${p.z}`, p)
    }
    const at = (x: number, z: number) => byXZ.get(`${x},${z}`)
    if (placed.length !== 8 + baseLineCells().length) return `tile count ${placed.length} != 8 + ${baseLineCells().length}`
    for (const p of placed) {
      const l = lvl(p.y)
      if (l < -1 || l > 1 || Math.abs(p.y - (BASE_Y + l * STEP)) > 0.01) return `tile (${p.x},${p.z}) off-level y=${p.y}`
      if (isBase(p.x, p.z) && (l !== 0 || p.type === 'ramp')) return `base tile (${p.x},${p.z}) not flat L0`
      if (p.type === 'end') return `dead end at (${p.x},${p.z})`
      // Every opening lands on a tile that opens back at the right height.
      for (const d of opensOf(p)) {
        const n = at(p.x + DXZ[d][0], p.z + DXZ[d][1])
        if (!n) return `(${p.x},${p.z}) opens onto nothing`
        if (!opensOf(n).has((d + 2) % 4)) return `(${n.x},${n.z}) doesn't open back to (${p.x},${p.z})`
        const myY = p.type === 'ramp' && p.r === d ? p.y + STEP : p.y
        const theirY = n.type === 'ramp' && n.r === (d + 2) % 4 ? n.y + STEP : n.y
        if (Math.abs(myY - theirY) > 0.01) return `height mismatch (${p.x},${p.z})→(${n.x},${n.z})`
      }
    }
    // Ramps: ±1 level, flat at both ends, never adjacent to another ramp.
    let ramps = 0
    for (const p of placed.filter(q => q.type === 'ramp')) {
      ramps++
      for (const d of [0, 1, 2, 3]) {
        const n = at(p.x + DXZ[d][0], p.z + DXZ[d][1])
        if (n?.type === 'ramp') return `ramps adjacent (${p.x},${p.z}) (${n.x},${n.z})`
      }
      const hi = at(p.x + DXZ[p.r][0], p.z + DXZ[p.r][1]), lo = at(p.x + DXZ[(p.r + 2) % 4][0], p.z + DXZ[(p.r + 2) % 4][1])
      if (!hi || !lo || Math.abs(hi.y - p.y - STEP) > 0.01 || Math.abs(lo.y - p.y) > 0.01) return `ramp (${p.x},${p.z}) ends don't join flat tiles at ±1 level`
    }
    // 180° symmetry (type, height, openings).
    for (const p of placed) {
      const [mx, mz] = mirrorCell(p.x, p.z)
      const q = at(mx, mz)
      if (!q || q.type !== p.type || Math.abs(q.y - p.y) > 0.01) return `180° twin of (${p.x},${p.z}) differs`
      if ([...opensOf(p)].map(d => (d + 2) % 4).sort().join() !== [...opensOf(q)].sort().join()) return `180° openings differ at (${p.x},${p.z})`
    }
    // Bases: closed rings (every ring tile still links its two ring neighbours) + equal exits.
    const exits: number[] = []
    for (const team of [1, 2]) {
      const ring = baseCells(team)
      let ex = 0
      for (const [x, z] of ring) {
        const o = opensOf(at(x, z)!)
        const inner = [0, 1, 2, 3].filter(d => ring.some(([a, b]) => a === x + DXZ[d][0] && b === z + DXZ[d][1]))
        if (inner.some(d => !o.has(d))) return `base ${team} ring broken at (${x},${z})`
        ex += [...o].filter(d => !inner.includes(d)).length
      }
      exits.push(ex)
    }
    if (exits[0] !== exits[1] || exits[0] < 4) return `exits RED=${exits[0]} BLUE=${exits[1]} (want equal, ≥4)`
    // 4 paths, each going up and down by single levels.
    const paths = baseLinePathCells()
    if (paths.length !== 4) return `expected 4 paths, got ${paths.length}`
    for (const [i, path] of paths.entries()) {
      let up = 0, down = 0
      const ys = [0, ...path.map(c => c[2]), 0]
      for (let k = 0; k < path.length; k++) {
        const c = path[k]
        if (c[3] === undefined) continue
        const prev = k === 0 ? null : path[k - 1]
        const goingTo = k + 1 < path.length ? path[k + 1] : null
        const travel = goingTo ? [0, 1, 2, 3].find(d => c[0] + DXZ[d][0] === goingTo[0] && c[1] + DXZ[d][1] === goingTo[1]) : null
        if (travel === c[3]) up++; else down++
        void prev
      }
      if (!up || !down) return `path ${i + 1} lacks an up or a down`
      void ys
    }
    // Cell graph: every cell reachable, RED reaches BLUE.
    const g = buildWalkableGraph(placed)
    const red = [...g.nodes].filter(id => baseTeamOfCellId(id) === 1)
    const blue = [...g.nodes].filter(id => baseTeamOfCellId(id) === 2)
    if (red.length !== blue.length || !red.length) return `base cell counts differ ${red.length}/${blue.length}`
    if (reachableCount(g, red[0]) !== g.nodes.size) return 'cell graph not fully connected'
    if (!findPath(g, red[0], blue[0])) return 'no path RED → BLUE'
    void ramps
    return null
  }

  function ascii(): string[] {
    const placed = getPlacedTilesInOrder()
    const rows: string[] = []
    for (let z = GRID_H - 1; z >= 0; z--) {
      let row = ''
      for (let x = 0; x < GRID_W; x++) {
        const p = placed.find(q => q.x === x && q.z === z)
        if (!p) { row += ' . '; continue }
        if (baseTeamOfCellId(`${p.x},${p.z},${p.y}:0,0`) !== 0) { row += baseTeamOfCellId(`${p.x},${p.z},${p.y}:0,0`) === 1 ? ' R ' : ' B '; continue }
        if (p.type === 'ramp') { row += ' ' + '^>v<'[p.r] + ['-', '0'][lvl(p.y) + 1]; continue }
        row += ' ' + ['-', '0', '+'][lvl(p.y) + 1] + (p.type === 'cross' ? '+' : p.type === 'fork' ? 'T' : ' ')
      }
      rows.push(row)
    }
    return rows
  }

  layFallback()
  { const e = check(); if (e) fail(`fallback layout: ${e}`) }
  console.log('✓ fallback layout passes all rules')
  const N = 250
  let pass = 0, fallbacks = 0, attempts = 0
  const shapes = new Set<string>(), cellSets = new Set<string>()
  let tiles = 0, ramps = 0, junctions = 0, cells = 0, minT = 99, maxT = 0, minR = 99, maxR = 0
  const levelUse = [0, 0, 0]
  const tg = Date.now()
  const samples: number[] = [1, 2, 3]
  for (let i = 1; i <= N; i++) {
    const s0 = i * 7919
    const w = generateWithRetry(s0, 20)
    if (w === null) { console.error(`✗ seed ${s0}: no layout`); continue }
    attempts += w - s0 + 1
    if (lastLayoutUsedFallback()) fallbacks++
    const err = check()
    if (err) { console.error(`✗ seed ${s0}: ${err}`); continue }
    pass++
    const P = getPlacedTilesInOrder()
    const sig = P.map(p => `${p.x},${p.z},${lvl(p.y)},${p.type},${p.r}`).sort().join('|')
    shapes.add(sig); cellSets.add(P.map(p => `${p.x},${p.z}`).sort().join('|'))
    const nr = P.filter(p => p.type === 'ramp').length
    tiles += P.length; ramps += nr; minT = Math.min(minT, P.length); maxT = Math.max(maxT, P.length); minR = Math.min(minR, nr); maxR = Math.max(maxR, nr)
    junctions += P.filter(p => !isBase(p.x, p.z) && (p.type === 'fork' || p.type === 'cross')).length
    for (const p of P) levelUse[lvl(p.y) + 1]++
    cells += buildWalkableGraph(P).nodes.size
    if (samples.includes(i)) {
      console.log(`\nseed ${s0}: ${P.length} tiles, ${nr} ramps  (top = north/+Z; R/B base, -0+ = L-1/L0/L+1, ^>v< ramp rising N/E/S/W + its low level, + cross, T fork)`)
      for (const r of ascii()) console.log('   ' + r)
    }
  }
  const ms = (Date.now() - tg) / N
  console.log('')
  console.log(`seeds: ${pass}/${N} pass all rules (${(100 * pass / N).toFixed(1)}%); fallback used ${fallbacks}×; avg ${(attempts / N).toFixed(2)} outer attempt(s); ${ms.toFixed(1)} ms/round`)
  console.log(`variety: ${shapes.size} distinct layouts, ${cellSets.size} distinct footprints; tiles ${minT}–${maxT} (avg ${(tiles / Math.max(1, pass)).toFixed(1)}), ramps ${minR}–${maxR} (avg ${(ramps / Math.max(1, pass)).toFixed(1)}), avg ${(junctions / Math.max(1, pass)).toFixed(1)} path junctions (fork/cross), avg ${(cells / Math.max(1, pass)).toFixed(0)} cells`)
  console.log(`level use (tiles): L-1 ${levelUse[0]}  L0 ${levelUse[1]}  L+1 ${levelUse[2]}`)
  if (pass !== N) fail(`${N - pass} seeds failed`)
  if (shapes.size < N * 0.9) fail(`low variety: ${shapes.size}/${N}`)
  console.log('✓ every seed: 8×8, L0 closed-ring bases with equal exits (4 each), 4 paths each with up+down, ±1 ramps never adjacent and flat at both ends, heights match at every join, 180° symmetric, fully connected')
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
