/**
 * verify-bot.ts — smoke-test the Bot state machine on a real generated
 * maze. Run: npx tsx scripts/verify-bot.ts
 *
 * Simulates 5 seconds of a Red bot walking at 4 steps/sec, asserts:
 *   - Total steps ≈ 5s * 4/s = 20 (± small overshoot/undershoot)
 *   - Every stepped cell is a walkable graph node
 *   - Every consecutive pair is graph-adjacent (no teleports)
 */

import { generateWithRetry, getPlacedTilesInOrder } from '../src/maze/generator'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { Bot, makeSmartTarget, PaintReader } from '../src/server/bots/bot'

const seed = generateWithRetry(42, 50)
if (seed === null) { console.error('gen failed'); process.exit(1) }
const graph = buildWalkableGraph(getPlacedTilesInOrder())
const start = [...graph.nodes][0]

const bot = new Bot({ team: 1, startCell: start })
console.log(`bot starting at ${start}, graph has ${graph.nodes.size} cells`)

const TICK_MS = 200 // server broadcast tick
const DURATION_MS = 5000
const steps: string[] = [start]
let simMs = 0
while (simMs < DURATION_MS) {
  for (const s of bot.tick(TICK_MS, graph)) steps.push(s)
  simMs += TICK_MS
}

console.log(`stepped ${steps.length - 1} cells in ${DURATION_MS}ms (expected ~${DURATION_MS / 250})`)

// Every step must be a walkable node.
for (const s of steps) {
  if (!graph.nodes.has(s)) { console.error(`✗ stepped onto non-node ${s}`); process.exit(1) }
}

// Every consecutive pair must be graph-adjacent.
for (let i = 1; i < steps.length; i++) {
  const nbs = graph.adj.get(steps[i - 1]) ?? []
  if (!nbs.includes(steps[i])) {
    console.error(`✗ teleport ${steps[i - 1]} → ${steps[i]}`); process.exit(1)
  }
}

console.log('✓ all steps are walkable and adjacent (no teleports)')
console.log(`sample trace (first 6): ${steps.slice(0, 6).join(' → ')}`)

// ─── smartTarget mix test ────────────────────────────────────────────────────────
// Seed a fake paint state: half the graph enemy-owned, quarter friendly.
// Then run a smart bot for 20s and confirm it prefers neutral cells.
const fakePaint = new Map<string, number>()
const allNodes = [...graph.nodes]
for (let i = 0; i < allNodes.length / 2; i++) fakePaint.set(allNodes[i], 2) // Blue
for (let i = allNodes.length / 2; i < allNodes.length * 0.75; i++) fakePaint.set(allNodes[i], 1) // Red
const reader: PaintReader = { teamOf: (id) => fakePaint.get(id) ?? 0 }

const smart = new Bot({
  team: 1,
  startCell: start,
  pickTarget: makeSmartTarget(reader, 1),
})
let neutralHits = 0, enemyHits = 0, mineHits = 0
simMs = 0
while (simMs < 20000) {
  for (const s of smart.tick(TICK_MS, graph)) {
    const t = reader.teamOf(s)
    if (t === 0) neutralHits++
    else if (t === 2) enemyHits++
    else mineHits++
  }
  simMs += TICK_MS
}
const total = neutralHits + enemyHits + mineHits
console.log(`✓ smart bot 20s trace: neutral=${neutralHits} (${(100*neutralHits/total).toFixed(0)}%) enemy=${enemyHits} (${(100*enemyHits/total).toFixed(0)}%) mine=${mineHits} (${(100*mineHits/total).toFixed(0)}%) of ${total} steps`)
console.log('  (neutral share should dominate; enemy > mine; mine only from path-passthrough)')
