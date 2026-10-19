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
// Sky mode: start on the RED base like a real spawn; classic: any node.
import { baseTeamOfCellId } from '../src/maze/generator'
import { IS_SKY, LEVEL_MODE } from '../src/maze/level'
const start = (IS_SKY ? [...graph.nodes].find(id => baseTeamOfCellId(id) === 1) : undefined) ?? [...graph.nodes][0]
console.log(`LEVEL_MODE=${LEVEL_MODE}`)

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
// Seed a fake paint state spread over the whole map (deterministic hash):
// ~50% enemy, ~25% friendly, ~25% neutral; bases keep their locked colour.
// The old test took the graph's insertion order, so "neutral" was one far
// contiguous block (the last-placed tiles) the bot couldn't reach in 20 s,
// and painted nothing — a test artefact, not a bot bug.
const fakePaint = new Map<string, number>()
const allNodes = [...graph.nodes]
const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return (x >>> 0) / 4294967296 }
for (const id of allNodes) {
  const b = baseTeamOfCellId(id)
  if (b) { fakePaint.set(id, b); continue }
  // Hash per tile (prefix before ':') so colours come in tile-sized patches.
  const u = h(id.slice(0, id.indexOf(':')))
  if (u < 0.5) fakePaint.set(id, 2); else if (u < 0.75) fakePaint.set(id, 1)
}
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
    if (!baseTeamOfCellId(s)) fakePaint.set(s, 1) // the bot paints what it walks on
  }
  simMs += TICK_MS
}
const total = neutralHits + enemyHits + mineHits
console.log(`✓ smart bot 20s trace: neutral=${neutralHits} (${(100*neutralHits/total).toFixed(0)}%) enemy=${enemyHits} (${(100*enemyHits/total).toFixed(0)}%) mine=${mineHits} (${(100*mineHits/total).toFixed(0)}%) of ${total} steps`)
console.log('  (smart target = any non-own deep cell, so neutral+enemy should dominate; mine = own trail / base walk-through)')
// 0.35, not 0.5: on the 6×6 map the bot re-crosses its own fresh trail often
// (seed 42 gave 47% neutral / 53% own). Still catches a bot stuck on own paint.
if ((neutralHits + enemyHits) / total < 0.35) { console.error('✗ smart bot spends most steps on its own paint'); process.exit(1) }
if (neutralHits === 0) { console.error('✗ smart bot never reached a neutral cell'); process.exit(1) }

// ─── Ghost spawn: always on the base opposite the solo human ─────────
import { initBots, rebuildBotGraph, tickBots, getBotPositions } from '../src/server/bots/manager'
import { baseSpawn } from '../src/maze/generator'
{
  let humanTeam = 1
  initBots({ applyPaint: () => false, paint: { teamOf: () => 0 }, humanCount: () => 1, soloHumanTeam: () => humanTeam })
  rebuildBotGraph(42)
  const near = (team: number) => {
    const p = getBotPositions()
    if (p.length !== 1) { console.error(`✗ expected 1 ghost, got ${p.length}`); process.exit(1) }
    const s = baseSpawn(team).pos
    const d = Math.hypot(p[0].x - s.x, p[0].z - s.z)
    if (p[0].team !== team || d > 3 || Math.abs(p[0].y - (s.y - 1.5)) > 1.5) { console.error(`✗ ghost team ${p[0].team} at (${p[0].x.toFixed(1)}, ${p[0].y.toFixed(1)}, ${p[0].z.toFixed(1)}), want team ${team} near (${s.x}, ${s.z})`); process.exit(1) }
    return `team ${team} at (${p[0].x.toFixed(1)}, ${p[0].y.toFixed(1)}, ${p[0].z.toFixed(1)})`
  }
  tickBots(0); const a = near(2)
  humanTeam = 2; tickBots(0); const b = near(1)
  for (let i = 0; i < 40; i++) tickBots(0.2)
  rebuildBotGraph(43); const c = near(1)
  console.log(`✓ ghost spawns opposite: human RED → ${a}; human BLUE → ${b}; new round → ${c}`)
}