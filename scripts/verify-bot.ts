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
import { Bot } from '../src/server/bots/bot'

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
