/**
 * verify-ramp-knock.ts — a knocked bot rides a ramp on the surface.
 * Run: npx tsx scripts/verify-ramp-knock.ts
 *
 * A lunge (and slower / faster / off-axis shoves) up a real ramp must keep
 * the feet on the slope, not drop through the mesh and pop up at the top.
 * Anvils are checked on the same knocks and reported, but this script does
 * not require them to match (anvils have no snap-up, by design).
 */
import { generateWithRetry, getPlacedTilesInOrder, CELL, MAZE_ORIGIN, type Placed } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph, rampSurfaceY } from '../src/shared/mazeGraph'
import { BotBody } from '../src/shared/botBody'
import { AnvilWorld, graphFloorAt } from '../src/shared/anvilSim'
import { lungeKnock, type KnockSpec } from '../src/shared/knocks'
import { readFileSync } from 'node:fs'

let failed = false
const fail = (m: string) => { console.error('✗ ' + m); failed = true }

generateWithRetry(1)
const tiles = getPlacedTilesInOrder()
const floorAt = Date.now()
const graph = buildWalkableGraph(tiles)
const floorMs = Date.now() - floorAt
const rampTiles = tiles.filter(t => TILES[t.type].isRamp)
const world = { graph, rampTiles, tiles, base: { x: 0, y: 0, z: 0 } }

const FLOOR_FROM_NODE = -0.05
const INCLINE_START = 2
const INCLINE_END = 30

function rampUphill(p: Placed): { x: number; z: number } {
  const rad = p.r * Math.PI / 2
  return { x: Math.sin(rad), z: Math.cos(rad) }
}

function onRampTile(p: Placed, x: number, z: number): boolean {
  const x0 = p.x * CELL + MAZE_ORIGIN
  const z0 = p.z * CELL + MAZE_ORIGIN
  return x >= x0 && x < x0 + CELL && z >= z0 && z < z0 + CELL
}

function rampFeetY(p: Placed, x: number, z: number): number {
  return rampSurfaceY(p, x, z) + FLOOR_FROM_NODE
}

/** t=0 is the bottom landing, t=1 is the top of the incline, on the centreline. */
function onIncline(p: Placed, t: number): { x: number; y: number; z: number } {
  const rad = p.r * Math.PI / 2
  const cx = p.x * CELL + MAZE_ORIGIN + CELL / 2
  const cz = p.z * CELL + MAZE_ORIGIN + CELL / 2
  const lz = INCLINE_START + t * (INCLINE_END - INCLINE_START)
  const along = lz - CELL / 2
  const x = cx + along * Math.sin(rad)
  const z = cz + along * Math.cos(rad)
  return { x, y: rampFeetY(p, x, z), z }
}

function shove(ux: number, uz: number, speed: number): KnockSpec {
  const base = lungeKnock(ux, uz)
  return {
    ...base,
    impulse: { x: base.impulse.x * speed, y: base.impulse.y, z: base.impulse.z * speed },
    force: base.force * speed,
  }
}

function turn(up: { x: number; z: number }, deg: number): { x: number; z: number } {
  const r = deg * Math.PI / 180
  const c = Math.cos(r), s = Math.sin(r)
  const x = up.x * c - up.z * s
  const z = up.x * s + up.z * c
  const len = Math.hypot(x, z)
  return { x: x / len, z: z / len }
}

type Trial = { name: string; maxBelow: number; maxAbove: number; climbed: number; samples: number; popped: boolean }

function runBot(p: Placed, start: { x: number; y: number; z: number }, dir: { x: number; z: number }, speed: number, dt: number): Trial {
  const body = new BotBody({ ...start })
  body.recoveryEnabled = false
  body.knock(shove(dir.x, dir.z, speed))
  let maxBelow = 0, maxAbove = 0, climbed = 0, samples = 0, popped = false, lastBelow = 0
  const time = 1.6
  for (let t = 0; t < time; t += dt) {
    const prevY = body.pos.y
    body.tick(dt, world)
    if (!onRampTile(p, body.pos.x, body.pos.z)) break
    const floor = rampFeetY(p, body.pos.x, body.pos.z)
    // An off-axis shove can leave the walkable corridor while still inside
    // the 32 m tile; falling there is a real edge drop, not a tunnel.
    const walk = graphFloorAt(graph, rampTiles, body.pos.x, body.pos.z, floor + 1, 1.2, 2)
    if (walk === null) break
    const below = floor - body.pos.y
    const above = body.pos.y - floor
    if (below > maxBelow) maxBelow = below
    if (above > maxAbove) maxAbove = above
    if (body.pos.y - start.y > climbed) climbed = body.pos.y - start.y
    if (below > 0.8 && body.pos.y - prevY > 1.5 && lastBelow > 0.8) popped = true
    lastBelow = below
    samples++
  }
  return { name: '', maxBelow, maxAbove, climbed, samples, popped }
}

function runAnvil(p: Placed, start: { x: number; y: number; z: number }, dir: { x: number; z: number }, speed: number, dt: number): Trial {
  const aw = new AnvilWorld(1)
  aw.setMaze(graph, tiles, [], false)
  const a = aw.anvils[0]
  a.alive = true
  a.pos = { ...start }
  a.vel = { x: 0, y: 0, z: 0 }
  a.forceLeft = 0
  a.tracking = false
  aw.hit(0, dir.x, dir.z, speed)
  let maxBelow = 0, maxAbove = 0, climbed = 0, samples = 0, popped = false, lastBelow = 0
  const time = 1.6
  for (let t = 0; t < time; t += dt) {
    const prevY = a.pos.y
    aw.tick(dt)
    if (!a.alive || !onRampTile(p, a.pos.x, a.pos.z)) break
    const floor = rampFeetY(p, a.pos.x, a.pos.z)
    const walk = graphFloorAt(graph, rampTiles, a.pos.x, a.pos.z, floor + 1, 1.2, 2)
    if (walk === null) break
    const below = floor - a.pos.y
    const above = a.pos.y - floor
    if (below > maxBelow) maxBelow = below
    if (above > maxAbove) maxAbove = above
    if (a.pos.y - start.y > climbed) climbed = a.pos.y - start.y
    if (below > 0.8 && a.pos.y - prevY > 1.5 && lastBelow > 0.8) popped = true
    lastBelow = below
    samples++
  }
  return { name: '', maxBelow, maxAbove, climbed, samples, popped }
}

if (rampTiles.length === 0) {
  fail('the seeded maze should include at least one ramp')
} else {
  const ramp = rampTiles[0]
  const up = rampUphill(ramp)
  const starts: [string, number][] = [['bottom', 0], ['mid', 0.22]]
  const angles = [0, 22, -30]
  const speeds = [0.7, 1, 1.35]
  const dts = [1 / 20]
  let botOk = 0, botN = 0
  const anvilNotes: string[] = []
  let anvilTunnel = 0, anvilN = 0
  for (const [startName, t0] of starts) {
    const start = onIncline(ramp, t0)
    for (const ang of angles) {
      const dir = turn(up, ang)
      for (const speed of speeds) {
        for (const dt of dts) {
          const label = startName + ' ' + speed.toFixed(2) + 'x lunge at ' + ang + ' deg, dt=' + dt.toFixed(3)
          const bot = runBot(ramp, start, dir, speed, dt)
          botN++
          // Straight knocks must hug the slope. Off-axis ones may dip a little
          // on the last walkable cell as they leave the corridor; that is an
          // edge drop, not a tunnel through the mesh.
          const limit = ang === 0 ? 0.3 : 0.85
          const tunneled = bot.maxBelow > limit || bot.popped || bot.samples < 4 || (ang === 0 && bot.climbed < 1.5)
          if (tunneled) {
            fail(label + ': bot maxBelow ' + bot.maxBelow.toFixed(2) + ' m, climbed ' + bot.climbed.toFixed(2) + ' m, samples ' + bot.samples + (bot.popped ? ', popped' : ''))
          } else {
            botOk++
          }
          const anvil = runAnvil(ramp, start, dir, speed, dt)
          anvilN++
          if (anvil.maxBelow > (ang === 0 ? 0.3 : 0.85) || anvil.popped) {
            anvilTunnel++
            anvilNotes.push(label + ': anvil maxBelow ' + anvil.maxBelow.toFixed(2) + ' m, climbed ' + anvil.climbed.toFixed(2) + ' m' + (anvil.popped ? ', popped' : ''))
          }
        }
      }
    }
  }
  if (botOk === botN && botN > 0) {
    console.log('✓ knocked bots stay on the ramp surface for ' + botN + ' speeds and angles (max climb checked on the straight shoves)')
  }
  if (anvilTunnel === 0) {
    console.log('✓ anvils also stayed on the ramp in ' + anvilN + ' matching knocks (no anvil change needed)')
  } else {
    console.log('! anvils dropped through the ramp in ' + anvilTunnel + '/' + anvilN + ' knocks (left unchanged: anvils have no snap-up so edge hangs stay fixed)')
    for (const n of anvilNotes.slice(0, 6)) console.log('  ' + n)
  }
}

const visualSrc = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
const arenaSrc = readFileSync(new URL('../src/client/arenaGraph.ts', import.meta.url), 'utf8')
const graphSrc = readFileSync(new URL('../src/shared/mazeGraph.ts', import.meta.url), 'utf8')
if (!visualSrc.includes('resolveSupport') || !visualSrc.includes('stepLocalKnock') || !visualSrc.includes('clientArenaGraph')) {
  fail('the client local knock should follow the same ramp support as the server, not a flat floorY')
} else {
  console.log('✓ client local knock uses resolveSupport on the walkable graph')
}
if (!arenaSrc.includes('buildWalkableGraph(') || !arenaSrc.includes('clientArenaGraph')) {
  fail('burst ripples and local knocks should share one client floor graph')
} else {
  console.log('✓ burst ripples and local knocks share one client floor graph')
}
if (!graphSrc.includes('get air()') || !graphSrc.includes('get deepAir()') || graphSrc.includes('const air = linkAir(')) {
  fail('air links should be computed on first read, not during the floor graph build')
} else if (floorMs > 250) {
  fail('the floor graph should build in well under 250 ms without air links (took ' + floorMs + ' ms)')
} else {
  console.log('✓ floor graph built in ' + floorMs + ' ms; air links stay lazy until a path needs them')
}

if (failed) {
  console.error('verify-ramp-knock failed')
  process.exit(1)
}
console.log('verify-ramp-knock ok')
