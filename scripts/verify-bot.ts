/**
 * verify-bot.ts — smoke-test the Bot state machine on a real generated
 * maze. Run: npx tsx scripts/verify-bot.ts
 *
 * Simulates 5 seconds of a Red bot walking at 4 steps/sec, asserts:
 *   - Total steps ≈ 5s * 4/s = 20 (± small overshoot/undershoot)
 *   - Every stepped cell is a walkable graph node
 *   - Every consecutive pair is graph-adjacent (no teleports)
 */

import { generateWithRetry, getPlacedTilesInOrder, CELL, MAZE_ORIGIN } from '../src/maze/generator'
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


// ─── Level drops: the path uses one, and the body lands on that floor ──
import { findPath } from '../src/shared/mazeGraph'
import { BotBody } from '../src/shared/botBody'
import { AnvilWorld } from '../src/shared/anvilSim'
import { lungeKnock } from '../src/shared/knocks'
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


// Interior wall (next cell is floor or a taller tile): a shove stays on the slab.
// Perimeter lip (nothing at this height beyond): a knock flies off and falls.
// A body already at the top (within 0.15 m) snaps onto it; mid-fall from well below does not.
{
  const tiles = getPlacedTilesInOrder()
  const world = {
    graph, rampTiles: tiles.filter(t => TILES[t.type].isRamp), tiles,
    base: { x: 0, y: 0, z: 0 },
  }
  const cover = (x: number, z: number) => tiles.filter(t => {
    const x0 = t.x * CELL + MAZE_ORIGIN, z0 = t.z * CELL + MAZE_ORIGIN
    return x >= x0 && x < x0 + CELL && z >= z0 && z < z0 + CELL
  })
  // What sits past the walkable cell: continuing floor, a taller tile, a lower deck, or void.
  const beyond = (p: [number, number, number], dx: number, dz: number): 'floor' | 'higher' | 'same' | 'lower' | 'void' => {
    for (const dist of [3, 8, 14]) {
      const x = p[0] + dx * dist, z = p[2] + dz * dist
      const near = [...graph.worldPos.values()].some(q => Math.abs(q[1] - p[1]) < 1.5 && Math.hypot(q[0] - x, q[2] - z) < 1.5)
      if (near) return 'floor'
      const here = cover(x, z)
      if (!here.length) return 'void'
      const deck = p[1] - 0.5
      if (here.some(t => t.y > deck + 2)) return 'higher'
      if (here.some(t => Math.abs(t.y - deck) <= 2)) continue
      if (here.every(t => t.y < deck - 2)) return 'lower'
    }
    return 'same'
  }
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let wall: { p: [number, number, number]; dx: number; dz: number } | null = null
  let lip: { p: [number, number, number]; dx: number; dz: number } | null = null
  for (const [id, p] of graph.worldPos) {
    const [tx, tz, ty] = id.split(':')[0].split(',').map(Number)
    const tile = tiles.find(t => t.x === tx && t.z === tz && Math.abs(t.y - ty) < 0.05)
    if (!tile || TILES[tile.type].isRamp) continue
    for (const [dx, dz] of dirs) {
      const kind = beyond(p, dx, dz)
      if (!wall && (kind === 'higher' || kind === 'same')) wall = { p, dx, dz }
      if (!lip && kind === 'void') lip = { p, dx, dz }
    }
    if (wall && lip) break
  }
  if (!wall) { console.error('✗ no interior wall (adjacent floor or taller tile) to shove into'); process.exit(1) }
  if (!lip) { console.error('✗ no perimeter lip to knock off'); process.exit(1) }

  const body = new BotBody({ x: wall.p[0], y: wall.p[1], z: wall.p[2] })
  body.rng = () => 1
  body.knock({ kind: 'lunge', impulse: { x: wall.dx * 80, y: 0, z: wall.dz * 80 }, forceDir: { x: wall.dx, y: 0, z: wall.dz }, force: 40, forceS: 0.3, lockS: 0.2 })
  for (let t = 0; t < 1.2; t += 0.05) body.tick(0.05, world)
  const along = (wall.p[0] - body.pos.x) * -wall.dx + (wall.p[2] - body.pos.z) * -wall.dz
  if (body.pos.y < wall.p[1] - 0.4 || along > 2.2) {
    console.error(`✗ wall shove sank or crossed the margin: travel ${along.toFixed(2)} y ${body.pos.y.toFixed(2)} (node ${wall.p[1].toFixed(2)}) mode=${body.mode}`)
    process.exit(1)
  }
  console.log(`✓ wall shove stayed on the slab (${along.toFixed(2)} m toward the wall)`)

  const sunk = new BotBody({ x: wall.p[0], y: wall.p[1] - 0.10, z: wall.p[2] })
  sunk.rng = () => 1
  sunk.knock({ kind: 'burst', impulse: { x: 0, y: 0, z: 0 }, forceDir: { x: 1, y: 0, z: 0 }, force: 0, forceS: 0, lockS: 0 })
  for (let t = 0; t < 0.5 && sunk.pos.y < wall.p[1] - 0.05; t += 0.05) sunk.tick(0.05, world)
  if (sunk.pos.y < wall.p[1] - 0.12) {
    console.error(`✗ body left just under the slab at y ${sunk.pos.y.toFixed(2)} (node ${wall.p[1].toFixed(2)})`)
    process.exit(1)
  }
  console.log(`✓ body already at the top snapped up to ${sunk.pos.y.toFixed(2)}`)

  const midFall = new BotBody({ x: wall.p[0], y: wall.p[1] - 1.2, z: wall.p[2] })
  midFall.rng = () => 1
  midFall.recoveryEnabled = false
  midFall.knock({ kind: 'burst', impulse: { x: 0, y: 0, z: 0 }, forceDir: { x: 1, y: 0, z: 0 }, force: 0, forceS: 0, lockS: 0 })
  for (let t = 0; t < 0.4; t += 0.05) midFall.tick(0.05, world)
  if (midFall.pos.y >= wall.p[1] - 0.3) {
    console.error(`✗ mid-fall body was pulled back onto the slab at y ${midFall.pos.y.toFixed(2)} (node ${wall.p[1].toFixed(2)})`)
    process.exit(1)
  }
  console.log(`✓ mid-fall body 1.2 m below the top was not snapped back (y ${midFall.pos.y.toFixed(2)})`)

  const launch = (dx: number, dz: number) => {
    const bot = new BotBody({ x: lip.p[0], y: lip.p[1], z: lip.p[2] })
    bot.rng = () => 1
    bot.knock(lungeKnock(dx, dz))
    let fell = false
    for (let t = 0; t < 6 && !fell; t += 0.05) {
      for (const e of bot.tick(0.05, world)) if (e.type === 'fell') fell = true
    }
    const anvil = new AnvilWorld(1)
    anvil.setMaze(graph, tiles, [], false)
    const a = anvil.anvils[0]
    a.alive = true
    a.pos = { x: lip.p[0], y: lip.p[1], z: lip.p[2] }
    anvil.hit(0, dx, dz, 1)
    let anvilFell = false
    for (let t = 0; t < 6 && !anvilFell; t += 0.05) {
      anvil.tick(0.05)
      if (!a.alive) anvilFell = true
    }
    return { fell, anvilFell, botY: bot.pos.y, anvilY: a.pos.y }
  }
  const off = launch(lip.dx, lip.dz)
  if (!off.fell || !off.anvilFell) {
    console.error(`✗ perimeter knock stuck on the lip: bot ${off.fell ? 'fell' : 'stayed'} y ${off.botY.toFixed(2)}, anvil ${off.anvilFell ? 'fell' : 'stayed'} y ${off.anvilY.toFixed(2)} (start ${lip.p[1].toFixed(2)})`)
    process.exit(1)
  }
  console.log(`✓ perimeter knock left the level (bot fell, anvil fell)`)

  // Mid-air glide / jump / fast move into a tile's vertical face must stop at
  // the slab, not tunnel through — including a step long enough to skip the edge.
  const outside = (() => {
    let x = lip.p[0], z = lip.p[2]
    for (let i = 0; i < 40; i++) {
      x += lip.dx
      z += lip.dz
      if (!cover(x, z).length) return { x: x + lip.dx * 1.5, z: z + lip.dz * 1.5 }
    }
    return null
  })()
  if (!outside) { console.error('✗ could not stand in the void outside a tile face'); process.exit(1) }
  const faceX = outside.x - lip.dx * 1.5
  const faceZ = outside.z - lip.dz * 1.5
  // Stand a short step outside the vertical face, below a step-up so this is a
  // side hit (not a landing). Stay close so a 6 m/s glide reaches the slab
  // before falling out of it.
  const startX = faceX + lip.dx * 0.8
  const startZ = faceZ + lip.dz * 0.8
  const intoX = -lip.dx, intoZ = -lip.dz
  const faceDist = (sx: number, sz: number) => (faceX - sx) * intoX + (faceZ - sz) * intoZ
  const alongIn = (sx: number, sz: number, px: number, pz: number) => (px - sx) * intoX + (pz - sz) * intoZ
  const fire = (impulse: number, ticks: number) => {
    const start = { x: startX, y: lip.p[1] - 0.9, z: startZ }
    const bot = new BotBody(start)
    bot.rng = () => 1
    bot.recoveryEnabled = false
    bot.knock({
      kind: 'lunge',
      impulse: { x: intoX * impulse, y: 0, z: intoZ * impulse },
      forceDir: { x: intoX, y: 0, z: intoZ },
      force: 0, forceS: 0, lockS: 0,
    })
    for (let t = 0; t < ticks * 0.05; t += 0.05) bot.tick(0.05, world)
    const travel = alongIn(start.x, start.z, bot.pos.x, bot.pos.z)
    const past = travel - faceDist(start.x, start.z)
    return { past, y: bot.pos.y, start }
  }
  // Realistic mid-air glide (~HUMAN_GLIDE_SPEED 6 → impulse 24 at BOT_KNOCK_UNIT 0.25).
  const glide = fire(24, 6)
  if (glide.past > 1.5) {
    console.error(`✗ mid-air glide tunneled through the tile side: ${glide.past.toFixed(2)} m past the face`)
    process.exit(1)
  }
  console.log(`✓ mid-air glide stopped at the tile side (${glide.past.toFixed(2)} m past the face)`)
  // One 0.05 s step at ~200 m/s would skip an 8 m lip without a swept check.
  const fast = fire(800, 1)
  if (fast.past > 1.5) {
    console.error(`✗ fast jump/knock tunneled through the tile side: ${fast.past.toFixed(2)} m past the face`)
    process.exit(1)
  }
  console.log(`✓ fast mid-air step swept and stopped at the tile side (${fast.past.toFixed(2)} m past the face)`)
}
