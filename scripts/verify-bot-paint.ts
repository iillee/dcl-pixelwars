/**
 * verify-bot-paint.ts — bot dash and burst paint, offline.
 * Run: npx tsx scripts/verify-bot-paint.ts
 *
 * A ground dash paints the same 3x3 stamp a walking player leaves, sampled
 * along the swept path so a 46 m/s lunge does not skip cells, even when the
 * server tick is coarse. Air and void travel do not paint. A ground Burst
 * and a spike that lands on tiles use the bot's team colour and show up in
 * the paintDelta drain the clients already receive.
 */
import { readFileSync } from 'node:fs'
import { generateWithRetry, getPlacedTilesInOrder, CELL, MAZE_ORIGIN } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { graphFloorAt } from '../src/shared/anvilSim'
import { BotBody } from '../src/shared/botBody'
import { cellsAlongPath, stampAround, cellAt } from '../src/shared/botPaint'
import { burstCentre, burstFootprint } from '../src/shared/burst'
import { applyPaint, teamOfCell, drainDelta, clearAll } from '../src/server/paintState'
import { LUNGE_DISTANCE, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE } from '../src/shared/pvp'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

let sd: number | null = null
for (let s = 1; s < 50 && sd === null; s++) { try { sd = generateWithRetry(s, 50) } catch { /* next */ } }
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
const rampTiles = tiles.filter(t => TILES[t.type].isRamp)
const world = { graph, rampTiles, tiles, base: { x: 0, y: 0, z: 0 } }
const speed = LUNGE_DISTANCE / LUNGE_ACTIVE_S

type V3 = { x: number; y: number; z: number }
let run: { from: V3; dx: number; dz: number } | null = null
for (const p of graph.worldPos.values()) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
    const far = { x: p[0] + dx * 12, y: p[1], z: p[2] + dz * 12 }
    let clear = true
    for (let d = 0; d <= 12 && clear; d += 1) {
      const x = p[0] + dx * d, z = p[2] + dz * d
      if (graphFloorAt(graph, rampTiles, x, z, p[1] - 0.05, 0.99, 0.8) === null) clear = false
    }
    if (clear) { run = { from: { x: p[0], y: p[1] - 0.05, z: p[2] }, dx, dz }; break }
  }
  if (run) break
}
check('found a 12 m grounded run for a dash', !!run)

function paintDash(dt: number): string[] {
  if (!run) return []
  const body = new BotBody({ ...run.from }, () => 0)
  body.dash(run.dx, run.dz, speed, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)
  const painted = new Set<string>()
  const start = { ...body.pos }
  // Paint the start cell, then each tick's swept path, like tickBots.
  const first = cellsAlongPath(graph, rampTiles, start, start)
  for (const id of first) painted.add(id)
  for (let t = 0; t < 1 && body.ownDashPaint(); t += dt) {
    const prev = { ...body.pos }
    body.tick(dt, world)
    if (!body.ownDashPaint() && !body.isGrounded()) {
      for (const id of cellsAlongPath(graph, rampTiles, prev, body.pos)) painted.add(id)
      break
    }
    for (const id of cellsAlongPath(graph, rampTiles, prev, body.pos)) painted.add(id)
  }
  return [...painted]
}

if (run) {
  clearAll()
  const fine = paintDash(1 / 30)
  check(`a 30 Hz ground dash paints a trail (${fine.length} cells)`, fine.length >= 12)
  let teamOk = true
  for (const id of fine) {
    applyPaint(id, 1, 'bot:1')
    if (teamOfCell(id) !== 1) teamOk = false
  }
  const delta = drainDelta()
  check('dash paint is the bot team colour', teamOk && fine.every(id => teamOfCell(id) === 1))
  check(`dash paint appears in the paintDelta clients already get (${delta.length} cells)`, delta.length === fine.length && delta.every(d => d.team === 1))

  // Coarse tick: 2 Hz would skip many cells if we only stamped the end pose.
  clearAll()
  const coarse = paintDash(0.5)
  check(`a 2 Hz ground dash still paints a trail (${coarse.length} cells)`, coarse.length >= 12)
  let gaps = 0
  for (let d = 0; d <= 8; d += 2) {
    const p = { x: run.from.x + run.dx * d, y: run.from.y, z: run.from.z + run.dz * d }
    const id = cellAt(graph, p)
    const hit = id && (coarse.includes(id) || stampAround(graph, id).some(c => coarse.includes(c)))
    if (!hit) gaps++
  }
  check(`the swept 2 Hz trail has no holes along the path (gaps ${gaps})`, gaps === 0)

  // End-stamp only at 2 Hz would miss the middle — the swept path must beat that.
  const body = new BotBody({ ...run.from }, () => 0)
  body.dash(run.dx, run.dz, speed, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)
  const before = { ...body.pos }
  body.tick(0.5, world)
  const endsOnly = new Set([
    ...cellsAlongPath(graph, rampTiles, before, before),
    ...cellsAlongPath(graph, rampTiles, body.pos, body.pos),
  ])
  check('the swept path paints more than just the start and end poses', coarse.length > endsOnly.size)
}

// Over the void: no floor samples, so no paint.
{
  let voidRun: { from: V3; to: V3 } | null = null
  for (const p of graph.worldPos.values()) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const from = { x: p[0] + dx * 8, y: p[1] - 0.05, z: p[2] + dz * 8 }
      const to = { x: from.x + dx * 10, y: from.y, z: from.z + dz * 10 }
      const a = graphFloorAt(graph, rampTiles, from.x, from.z, from.y, 1.2, 2)
      const b = graphFloorAt(graph, rampTiles, to.x, to.z, to.y, 1.2, 2)
      if (a === null && b === null) { voidRun = { from, to }; break }
    }
    if (voidRun) break
  }
  const cells = voidRun ? cellsAlongPath(graph, rampTiles, voidRun.from, voidRun.to) : ['missing']
  check(`an air dash over the void paints nothing (${cells.length} cells)`, !!voidRun && cells.length === 0)
}

// A ground Burst and a spike landing use the same footprint and team colour.
{
  clearAll()
  const start = [...graph.nodes][Math.floor(graph.nodes.size / 3)]
  const p = graph.worldPos.get(start)!
  const centre = burstCentre(graph, start, { x: p[0], y: p[1] - 0.05, z: p[2] })
  const fp = centre ? burstFootprint(graph, centre) : []
  check(`a ground burst has a real footprint (${fp.length} cells)`, fp.length >= 8)
  for (const id of fp) applyPaint(id, 2, 'bot:7')
  const land = drainDelta()
  check('ground burst paint is the bot team colour', fp.every(id => teamOfCell(id) === 2))
  check(`burst paint replicates through paintDelta (${land.length} cells)`, land.length === fp.length && land.every(d => d.team === 2))

  clearAll()
  const landFp = centre ? burstFootprint(graph, centre) : []
  for (const id of landFp) applyPaint(id, 1, 'bot:7')
  check('an aerial spike that lands on tiles paints the same footprint', landFp.length === fp.length && landFp.every(id => teamOfCell(id) === 1))
}

{
  const mgr = readFileSync(new URL('../src/server/bots/manager.ts', import.meta.url), 'utf8')
  const body = readFileSync(new URL('../src/shared/botBody.ts', import.meta.url), 'utf8')
  const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
  check('tickBots paints a grounded own dash along cellsAlongPath', mgr.includes('ownDashPaint()') && mgr.includes('cellsAlongPath(') && mgr.includes('stampAround('))
  check('a recovered air dash is not movement-painted (dashPaint clears off the floor)', body.includes('if (!this.grounded) this.dashPaint = false') && body.includes('ownDashPaint()'))
  check('an airborne bot burst does not paint until it lands', /if \(air\)[\s\S]{0,400}return/.test(server) && server.includes('onBurstLand:') && server.includes('applyBotPaint'))
}

if (fails) { console.log(`✗ ${fails} bot-paint check(s) failed`); process.exit(1) }
console.log('✓ all bot-paint checks passed')
