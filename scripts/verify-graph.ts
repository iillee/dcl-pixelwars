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

import { generateWithRetry, getPlacedTilesInOrder } from '../src/maze/generator'
import { buildWalkableGraph, reachableCount, findPath } from '../src/shared/mazeGraph'

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
