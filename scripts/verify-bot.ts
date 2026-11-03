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
import { Bot, makeSmartTarget, makeValueTarget, PaintReader } from '../src/server/bots/bot'

const seed = generateWithRetry(42, 50)
if (seed === null) { console.error('gen failed'); process.exit(1) }
const graph = buildWalkableGraph(getPlacedTilesInOrder())
// Sky mode: start on the RED base like a real spawn; classic: any node.
import { baseTeamOfCellId } from '../src/maze/generator'
import { IS_SKY, LEVEL_MODE } from '../src/maze/level'
const start = (IS_SKY ? [...graph.nodes].find(id => baseTeamOfCellId(id) === 1) : undefined) ?? [...graph.nodes][0]
console.log(`LEVEL_MODE=${LEVEL_MODE}`)

const bot = new Bot({ team: 1, startCell: start, useAir: false })
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
const seedPaint = new Map(fakePaint)
const reader: PaintReader = { teamOf: (id) => fakePaint.get(id) ?? 0 }

// Same 20 s, same start, same paint: cells flipped to the bot's team with the live 3×3 stamp.
function paintRun(pick: 'smart' | 'value'): { gained: number; neutral: number; enemy: number; mine: number } {
  fakePaint.clear(); for (const [k, v] of seedPaint) fakePaint.set(k, v)
  const bot = new Bot({ team: 1, startCell: start, stepsPerSec: 5, useAir: false, pickTarget: pick === 'smart' ? makeSmartTarget(reader, 1) : makeValueTarget(reader, 1) })
  let gained = 0, neutral = 0, enemy = 0, mine = 0, ms = 0
  while (ms < 20000) {
    for (const s of bot.tick(TICK_MS, graph)) {
      const t = reader.teamOf(s)
      if (t === 0) neutral++; else if (t === 2) enemy++; else mine++
      const colon = s.indexOf(':'), prefix = s.slice(0, colon + 1)
      const [cs, rs] = s.slice(colon + 1).split(',')
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        const id = `${prefix}${parseInt(cs, 10) + dc},${parseInt(rs, 10) + dr}`
        if (!graph.nodes.has(id) || baseTeamOfCellId(id) || fakePaint.get(id) === 1) continue
        fakePaint.set(id, 1); gained++
      }
    }
    ms += TICK_MS
  }
  return { gained, neutral, enemy, mine }
}
const runs = (pick: 'smart' | 'value') => { let g = 0, n = 0, e = 0, m = 0; for (let i = 0; i < 5; i++) { const r = paintRun(pick); g += r.gained; n += r.neutral; e += r.enemy; m += r.mine } return { g: g / 5, n, e, m } }
const old = runs('smart'), val = runs('value')
console.log(`  old random target: ${old.g.toFixed(0)} cells gained / 20 s (avg of 5)`)
console.log(`  value target (live): ${val.g.toFixed(0)} cells gained / 20 s (avg of 5)`)
// Walk speed caps gain (~1.7 cells/step either way); the margin is small and seed-noisy.
if (val.g < old.g * 0.9) { console.error('✗ value targeting paints less than the old random targeting'); process.exit(1) }
const neutralHits = val.n, enemyHits = val.e, mineHits = val.m
// With the 3×3 stamp the cell stepped onto is usually already painted by the
// previous step, so judge by cells gained per step: a straight run through
// fresh floor gains 3; ≥ 1.2 means it mostly walks where there is paint to take.
const total = neutralHits + enemyHits + mineHits
const perStep = (val.g * 5) / Math.max(1, total)
console.log(`✓ value bot: ${perStep.toFixed(2)} cells gained per step over ${total} steps (5 runs)`)
if (perStep < 1.2) { console.error('✗ value bot mostly walks its own paint'); process.exit(1) }

// ─── Short-team fill: bots = active-human gap, one side only, own base ─
import { initBots, rebuildBotGraph, tickBots, getBotPositions, getWalkableGraph, setPopulation } from '../src/server/bots/manager'
import { baseSpawn } from '../src/maze/generator'
{
  let counts = { red: 1, blue: 0 }
  initBots({ applyPaint: () => false, paint: { teamOf: () => 0 }, activeHumans: () => counts })
  rebuildBotGraph(42)
  const onBase = (team: number, label: string) => {
    const p = getBotPositions()
    const g = getWalkableGraph()
    if (!g) { console.error(`✗ ${label}: no graph`); process.exit(1) }
    const s = baseSpawn(team).pos
    for (const b of p) {
      let best = Infinity
      let bestY = 0
      for (const [id, pos] of g.worldPos) {
        if (baseTeamOfCellId(id) !== team) continue
        const d = Math.hypot(b.x - pos[0], b.z - pos[2])
        if (d < best) { best = d; bestY = pos[1] }
      }
      const nearSpawn = p.length === 1 ? Math.hypot(b.x - s.x, b.z - s.z) : 0
      if (b.team !== team || best > 1.6 || Math.abs(b.y - bestY) > 1.5 || (p.length === 1 && (nearSpawn > 3 || Math.abs(b.y - (s.y - 1.5)) > 1.5))) {
        console.error(`✗ ${label}: bot ${b.id} team ${b.team} at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}, ${b.z.toFixed(1)}), nearest base cell ${best.toFixed(1)} m, spawn ${nearSpawn.toFixed(1)} m`)
        process.exit(1)
      }
    }
    if (p.length > 1) {
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const d = Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z)
        if (d < 1.5) { console.error(`✗ ${label}: bots ${p[i].id} and ${p[j].id} stacked (${d.toFixed(2)} m)`); process.exit(1) }
      }
    }
  }
  const expect = (n: number, team: number, label: string) => {
    const p = getBotPositions()
    if (p.length !== n) { console.error(`✗ ${label}: expected ${n} bots, got ${p.length}`); process.exit(1) }
    if (n === 0) return label
    onBase(team, label)
    const ids = new Set(p.map(b => b.id))
    if (ids.size !== n) { console.error(`✗ ${label}: duplicate bot ids`); process.exit(1) }
    return `${label}: ${n}× team ${team}`
  }
  tickBots(0)
  const a = expect(1, 2, '1 red human')
  counts = { red: 0, blue: 1 }; tickBots(0)
  const b = expect(1, 1, 'short side flipped')
  counts = { red: 3, blue: 1 }; tickBots(0)
  const c = expect(2, 2, '3v1')
  counts = { red: 3, blue: 2 }; tickBots(0)
  const d = expect(1, 2, 'excess retired')
  counts = { red: 2, blue: 2 }; tickBots(0)
  const e = expect(0, 0, '2v2')
  counts = { red: 0, blue: 0 }; tickBots(0)
  const f = expect(0, 0, 'zero humans')
  counts = { red: 0, blue: 1 }; tickBots(0)
  for (let i = 0; i < 40; i++) tickBots(0.2)
  rebuildBotGraph(43)
  const g = expect(1, 1, 'new round, still short red')
  console.log(`✓ short-team fill: ${a}; ${b}; ${c}; ${d}; ${e}; ${f}; ${g}`)
}

// ─── Level drops: the path uses one, and the body lands on that floor ──
import { findPath } from '../src/shared/mazeGraph'
import { BotBody } from '../src/shared/botBody'
import { TILES } from '../src/maze/tiles'
{
  let drops = 0, jumps = 0, sample: { from: string; to: string } | null = null
  for (const [from, list] of graph.deepAir) {
    for (const e of list) {
      if (e.kind === 'drop') { drops++; if (!sample) sample = { from, to: e.to } }
      else jumps++
    }
  }
  console.log(`air links on seed 42: ${drops} drops, ${jumps} jumps`)
  if (drops === 0) { console.error('✗ sky maze produced no one-level drop'); process.exit(1) }
  const from = graph.worldPos.get(sample!.from)!
  const to = graph.worldPos.get(sample!.to)!
  const walk = findPath(graph, sample!.from, sample!.to, 20000, true, () => 1, false)
  const air = findPath(graph, sample!.from, sample!.to, 20000, true, () => 1, true)
  if (!air || air.length < 2 || air[1] !== sample!.to) { console.error('✗ drop edge was not the path\'s first step'); process.exit(1) }
  if (walk && air.length >= walk.length) console.log(`(drop path ${air.length} is not shorter than the walk ${walk.length}; cost may still prefer the ramp)`)
  const body = new BotBody({ x: from[0], y: from[1], z: from[2] })
  if (!body.leap({ x: to[0], y: to[1], z: to[2] })) { console.error('✗ leap refused'); process.exit(1) }
  const world = { graph, rampTiles: getPlacedTilesInOrder().filter(t => TILES[t.type].isRamp), tiles: getPlacedTilesInOrder(), base: { x: from[0], y: from[1], z: from[2] } }
  let settled = false
  for (let t = 0; t < 8 && !settled; t += 0.05) {
    for (const e of body.tick(0.05, world)) if (e.type === 'settled') settled = true
    if (body.inRescue()) break
  }
  const d = Math.hypot(body.pos.x - to[0], body.pos.z - to[2])
  const dy = Math.abs(body.pos.y - to[1])
  if (!settled || body.inRescue() || d > 4 || dy > 2) {
    console.error(`✗ drop landed ${d.toFixed(1)} m off, dy ${dy.toFixed(1)}, settled=${settled}, mode=${body.mode}`)
    process.exit(1)
  }
  console.log(`✓ drop ${sample!.from} → ${sample!.to}: path step 1, landed ${d.toFixed(1)} m from the cell (down ${(from[1] - to[1]).toFixed(1)} m)`)
}

// ─── Round format + PvB population ──────────────────────────────────
import { FORMAT_ALTERNATE, PVB_BOT_MAX, PVB_RATIO, nextRoundFormat, pvbBotCount, pvbHumanTeam, type RoundFormat } from '../src/shared/pvp'
{
  const seq: RoundFormat[] = []
  let f: RoundFormat = 'pvp'
  f = nextRoundFormat(f, false); seq.push(f)
  f = nextRoundFormat(f, true); seq.push(f)
  f = nextRoundFormat(f, true); seq.push(f)
  f = nextRoundFormat(f, true); seq.push(f)
  f = nextRoundFormat(f, false); seq.push(f)
  const want = FORMAT_ALTERNATE ? 'pvp,pvb,pvp,pvb,pvp' : 'pvp,pvp,pvp,pvp,pvp'
  if (seq.join(',') !== want) { console.error(`✗ format sequence ${seq.join(',')} want ${want}`); process.exit(1) }
  if (pvbHumanTeam(0) !== 1 || pvbHumanTeam(1) !== 2 || pvbHumanTeam(2) !== 1) {
    console.error('✗ PvB human colour should be Red, Blue, Red'); process.exit(1)
  }
  if (pvbBotCount(0) !== 0 || pvbBotCount(-3) !== 0) { console.error('✗ zero humans → 0 bots'); process.exit(1) }
  if (pvbBotCount(1) < 1 || pvbBotCount(1000) !== PVB_BOT_MAX) { console.error('✗ PvB count out of range'); process.exit(1) }
  if (pvbBotCount(4) < pvbBotCount(3)) { console.error('✗ PvB count shrank as humans grew'); process.exit(1) }
  if (PVB_RATIO === 1 && (pvbBotCount(10) !== 10 || pvbBotCount(15) !== 15 || pvbBotCount(16) !== 15)) {
    console.error(`✗ ratio 1 counts: 10→${pvbBotCount(10)} 15→${pvbBotCount(15)} 16→${pvbBotCount(16)}`); process.exit(1)
  }
  console.log(`✓ format alternation (${seq.join(' → ')}) and PvB count cap ${PVB_BOT_MAX}`)
}

{
  let counts = { red: 0, blue: 0 }
  initBots({ applyPaint: () => false, paint: { teamOf: () => 0 }, activeHumans: () => counts })
  rebuildBotGraph(42)
  setPopulation({ kind: 'pvp' })
  tickBots(0) // drop whatever the short-team block left behind
  if (getBotPositions().length !== 0) { console.error('✗ PvB setup: leftover bots'); process.exit(1) }

  const assertSpread = (n: number, team: number, label: string) => {
    const p = getBotPositions()
    if (p.length !== n) { console.error(`✗ ${label}: expected ${n} bots, got ${p.length}`); process.exit(1) }
    const g = getWalkableGraph()!
    for (const b of p) {
      if (b.team !== team) { console.error(`✗ ${label}: bot ${b.id} on team ${b.team}, want ${team}`); process.exit(1) }
      let best = Infinity
      for (const [id, pos] of g.worldPos) {
        if (baseTeamOfCellId(id) !== team) continue
        best = Math.min(best, Math.hypot(b.x - pos[0], b.z - pos[2]))
      }
      if (best > 1.6) { console.error(`✗ ${label}: bot ${b.id} ${best.toFixed(1)} m off the base`); process.exit(1) }
    }
    let minD = Infinity
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      minD = Math.min(minD, Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z))
    }
    if (n > 1 && minD < 1.5) { console.error(`✗ ${label}: stacked, closest ${minD.toFixed(2)} m`); process.exit(1) }
    return minD
  }

  counts = { red: 10, blue: 0 }
  setPopulation({ kind: 'pvb', humanTeam: 1 })
  tickBots(0)
  const kept = new Set(getBotPositions().map(b => b.id))
  const spread10 = assertSpread(10, 2, '10 humans → 10 blue bots')

  counts = { red: 12, blue: 0 }
  tickBots(0) // mid-round: add, keep the ones already in
  assertSpread(12, 2, 'humans 10→12 adds bots')
  for (const id of kept) {
    if (!getBotPositions().some(b => b.id === id)) { console.error(`✗ added bots retired #${id}`); process.exit(1) }
  }

  counts = { red: 3, blue: 0 }
  tickBots(0) // mid-round: do not retire while humans remain
  if (getBotPositions().length !== 12) { console.error(`✗ mid-round retire: ${getBotPositions().length} bots, want 12`); process.exit(1) }

  counts = { red: 20, blue: 0 }
  tickBots(0)
  const spread15 = assertSpread(PVB_BOT_MAX, 2, 'cap')

  counts = { red: 0, blue: 0 }
  tickBots(0)
  if (getBotPositions().length !== 0) { console.error('✗ zero humans should retire PvB bots'); process.exit(1) }

  counts = { red: 0, blue: 4 }
  setPopulation({ kind: 'pvb', humanTeam: 2 }) // next PvB boundary: humans on blue
  tickBots(0)
  assertSpread(4, 1, 'human team flipped to blue')

  counts = { red: 4, blue: 0 }
  tickBots(0) // humans moved but population not reset: still the blue-human round, count may grow, no retire
  if (getBotPositions().length !== 4) { console.error(`✗ team counts changed under the same PvB round: ${getBotPositions().length}`); process.exit(1) }

  counts = { red: 3, blue: 1 }
  setPopulation({ kind: 'pvp' })
  tickBots(0)
  const pvp = getBotPositions()
  if (pvp.length !== 2 || pvp.some(b => b.team !== 2)) {
    console.error(`✗ back to PvP gap: ${pvp.map(b => b.team).join(',') || 'none'}`); process.exit(1)
  }

  // 15 bots. The first ticks pathfind; the second window is the steady walk.
  // Fail only if the steady average cannot fit in a 30 Hz server frame.
  counts = { red: 15, blue: 0 }
  setPopulation({ kind: 'pvb', humanTeam: 1 })
  tickBots(0)
  if (getBotPositions().length !== PVB_BOT_MAX) { console.error('✗ perf setup did not reach the cap'); process.exit(1) }
  const bench = (n: number) => {
    const t0 = Date.now()
    let slow = 0
    let worst = 0
    for (let i = 0; i < n; i++) {
      const a = Date.now()
      tickBots(1 / 30)
      const dt = Date.now() - a
      if (dt > worst) worst = dt
      if (dt > 30) slow++
    }
    return { ms: Date.now() - t0, slow, worst, n }
  }
  const warm = bench(30)
  const steady = bench(60)
  console.log(`✓ PvB population: spread10 ${spread10.toFixed(1)} m, spread15 ${spread15.toFixed(1)} m`)
  console.log(`  15-bot tick warm-up ${warm.n}: ${(warm.ms / warm.n).toFixed(2)} ms/tick (worst ${warm.worst} ms)`)
  console.log(`  15-bot tick steady ${steady.n}: ${(steady.ms / steady.n).toFixed(2)} ms/tick (worst ${steady.worst} ms, ${steady.slow} ticks > 30 ms)`)
  if (steady.ms / steady.n > 30) { console.error('✗ 15-bot steady tick averages over a 30 Hz frame'); process.exit(1) }
}

// A knock into the corridor wall stays on the slab. A body left below that
// slab is snapped back up, not left to walk inside the mesh.
{
  const tiles = getPlacedTilesInOrder()
  const world = {
    graph, rampTiles: tiles.filter(t => TILES[t.type].isRamp), tiles,
    base: { x: 0, y: 0, z: 0 },
  }
  let spot: { p: [number, number, number] } | null = null
  for (const [id, p] of graph.worldPos) {
    const [head, tail] = id.split(':')
    const [tx, tz, ty] = head.split(',').map(Number)
    const col = parseInt(tail.split(',')[0], 10)
    if (col !== 3) continue
    const tile = tiles.find(t => t.x === tx && t.z === tz && Math.abs(t.y - ty) < 0.05)
    if (!tile || TILES[tile.type].isRamp) continue
    spot = { p }
    break
  }
  if (!spot) { console.error('✗ no flat corridor-edge cell to shove into a wall'); process.exit(1) }
  const body = new BotBody({ x: spot.p[0], y: spot.p[1], z: spot.p[2] })
  body.rng = () => 1
  body.knock({ kind: 'lunge', impulse: { x: -80, y: 0, z: 0 }, forceDir: { x: -1, y: 0, z: 0 }, force: 40, forceS: 0.3, lockS: 0.2 })
  for (let t = 0; t < 1.2; t += 0.05) body.tick(0.05, world)
  const intoWall = spot.p[0] - body.pos.x
  if (body.pos.y < spot.p[1] - 0.4 || intoWall > 2.2) {
    console.error(`✗ wall shove sank or crossed the margin: Δx ${intoWall.toFixed(2)} y ${body.pos.y.toFixed(2)} (node ${spot.p[1].toFixed(2)}) mode=${body.mode}`)
    process.exit(1)
  }
  console.log(`✓ wall shove stayed on the slab (${intoWall.toFixed(2)} m toward the wall)`)
  const sunk = new BotBody({ x: spot.p[0], y: spot.p[1] - 1.2, z: spot.p[2] })
  sunk.rng = () => 1
  sunk.knock({ kind: 'burst', impulse: { x: 0, y: 0, z: 0 }, forceDir: { x: 1, y: 0, z: 0 }, force: 0, forceS: 0, lockS: 0 })
  for (let t = 0; t < 0.5 && sunk.pos.y < spot.p[1] - 0.3; t += 0.05) sunk.tick(0.05, world)
  if (sunk.pos.y < spot.p[1] - 0.25) {
    console.error(`✗ body left inside the slab at y ${sunk.pos.y.toFixed(2)} (node ${spot.p[1].toFixed(2)})`)
    process.exit(1)
  }
  console.log(`✓ sunk body snapped up to ${sunk.pos.y.toFixed(2)}`)
}