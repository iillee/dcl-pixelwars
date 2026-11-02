/**
 * verify-botbody.ts — the ghost bot's body (shared/botBody.ts) on a real maze.
 * Knocks a bot standing on its base with each hit in four directions and reports
 * the KnockTrace line and what happened next (settled / fell → cloud → landed).
 */
import { generateWithRetry, getPlacedTilesInOrder, baseSpawn } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { BotBody, BotBodyEvent } from '../src/shared/botBody'
import { lungeKnock, burstKnock, spikeKnock, KnockSpec } from '../src/shared/knocks'
import { rescueTripSeconds } from '../src/shared/rescuePath'

let failed = false
const fail = (m: string) => { console.error('✗ ' + m); failed = true }

generateWithRetry(1)
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
const rampTiles = tiles.filter(t => TILES[t.type].isRamp)
const base = baseSpawn(1).pos
const world = { graph, rampTiles, base }

const dirs: Array<[string, number, number]> = [['+x', 1, 0], ['-x', -1, 0], ['+z', 0, 1], ['-z', 0, -1]]
const kinds: Array<[string, (dx: number, dz: number) => KnockSpec]> = [
  ['lunge', lungeKnock], ['burst', burstKnock], ['spike (grounded)', (dx, dz) => spikeKnock(dx, dz, true)],
]

let fellCount = 0
for (const [kName, make] of kinds) {
  for (const [dName, dx, dz] of dirs) {
    const body = new BotBody(base)
    if (!body.knock(make(dx, dz))) { fail(`${kName} ${dName}: knock refused`); continue }
    const log: string[] = []
    let t = 0, fellAt = -1, landedAt = -1, settledAt = -1
    while (t < 15 && landedAt < 0 && settledAt < 0) {
      const evs: BotBodyEvent[] = body.tick(0.1, world)
      t += 0.1
      for (const e of evs) {
        if (e.type === 'trace') log.push(e.line)
        else if (e.type === 'fell') fellAt = t
        else if (e.type === 'landed') landedAt = t
        else if (e.type === 'settled') settledAt = t
      }
    }
    const p = body.pos
    let what: string
    if (settledAt >= 0) what = `settled at ${settledAt.toFixed(1)} s (${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)})`
    else if (landedAt >= 0) {
      fellCount++
      what = `fell at ${fellAt.toFixed(1)} s, home at ${landedAt.toFixed(1)} s (${Math.hypot(p.x - base.x, p.z - base.z).toFixed(1)} m from base)`
      if (Math.hypot(p.x - base.x, p.z - base.z) > 1.5) fail(`${kName} ${dName}: landed away from base`)
      if (landedAt - fellAt < rescueTripSeconds() - 0.2) fail(`${kName} ${dName}: cloud trip too short`)
      if (body.canBeHit()) fail(`${kName} ${dName}: hittable right after landing`)
      if (body.canWalk()) fail(`${kName} ${dName}: walking during the land hold`)
    } else { what = `still ${body.mode} after 15 s`; fail(`${kName} ${dName}: never resolved`) }
    console.log(`${kName.padEnd(16)} ${dName}: ${log[0] ?? '(no trace)'} | ${what}`)
  }
}

// Riding the cloud: hits are ignored.
{
  const body = new BotBody(base)
  body.knock(spikeKnock(1, 0, true))
  let guard = 0
  while (!body.inRescue() && guard++ < 200) body.tick(0.1, world)
  if (body.inRescue() && body.knock(lungeKnock(1, 0))) fail('a riding bot took a hit')
}

console.log(`${fellCount} of ${kinds.length * dirs.length} knocks off the base fell and were rescued`)
if (failed) process.exit(1)
console.log('✓ bot body checks passed')
