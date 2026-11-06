/**
 * verify-botbody.ts — the ghost bot's body (shared/botBody.ts) on a real maze.
 * Knocks a bot standing on its base with each hit in four directions and reports
 * the KnockTrace line and what happened next (settled / fell → cloud → landed).
 */
import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, BASE_Y } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { BotBody, BotBodyEvent } from '../src/shared/botBody'
import { lungeKnock, burstKnock, spikeKnock, KnockSpec } from '../src/shared/knocks'
import { rescueTripSeconds } from '../src/shared/rescuePath'
import { LUNGE_DISTANCE, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE } from '../src/shared/pvp'

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
for (const recover of [false, true]) {
console.log(recover ? '\n-- always tries to glide back (BOT_RECOVER roll forced on) --' : '-- never tries to recover --')
for (const [kName, make] of kinds) {
  for (const [dName, dx, dz] of dirs) {
    const body = new BotBody(base)
    body.rng = () => (recover ? 0 : 1)
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
    if (recover && settledAt >= 0 && !graph.nodes.has([...graph.nodes].find(id => {
      const q = graph.worldPos.get(id)!; return Math.hypot(q[0] - p.x, q[2] - p.z) < 1.5 && Math.abs(q[1] - p.y) < 1.5
    }) ?? '')) fail(`${kName} ${dName}: recovered onto no walkable cell`)
    console.log(`${kName.padEnd(16)} ${dName}: ${log[0] ?? '(no trace)'} | ${what}`)
  }
}
}

// A light shove off the same edge: a bot that tries should glide back; one that doesn't falls.
for (const strength of [85, 95, 105, 115]) {
  const res: string[] = []
  for (const recover of [false, true]) {
    const body = new BotBody(base)
    body.rng = () => (recover ? 0 : 1)
    body.knock({ kind: 'lunge', impulse: { x: -strength, y: 8, z: 0 }, forceDir: { x: -1, y: 0, z: 0 }, force: 0, forceS: 0, lockS: 0.3 })
    let out = 'unresolved'
    for (let t = 0; t < 15 && out === 'unresolved'; t += 0.1) {
      for (const e of body.tick(0.1, world)) {
        if (e.type === 'settled') out = `settled ${Math.hypot(body.pos.x - base.x, body.pos.z - base.z).toFixed(1)} m out`
        if (e.type === 'fell') out = 'fell'
      }
    }
    res.push(`${recover ? 'tries' : 'no try'}: ${out}`)
  }
  console.log(`shove ${strength} -x | ${res.join(' | ')}`)
}

// The bot's own lunge dash: about LUNGE_DISTANCE on a floor; off an edge it falls (it rolled no recovery).
for (const [dName, dx, dz] of [['+x', 1, 0], ['-x', -1, 0]] as Array<[string, number, number]>) {
  const body = new BotBody(base)
  body.rng = () => 1
  if (!body.dash(dx, dz, LUNGE_DISTANCE / LUNGE_ACTIVE_S, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)) { fail(`dash ${dName} refused`); continue }
  let out = 'unresolved'
  for (let t = 0; t < 15 && out === 'unresolved'; t += 0.05) {
    for (const e of body.tick(0.05, world)) {
      if (e.type === 'settled') out = `settled ${Math.hypot(body.pos.x - base.x, body.pos.z - base.z).toFixed(1)} m`
      if (e.type === 'fell') out = 'fell'
    }
  }
  console.log(`dash ${dName}: ${out} (LUNGE_DISTANCE ${LUNGE_DISTANCE} m)`)
  if (out === 'unresolved') fail(`dash ${dName} never resolved`)
}

// Riding the cloud: hits are ignored.
{
  const body = new BotBody(base)
  body.rng = () => 1
  body.knock(spikeKnock(-1, 0, true))
  let guard = 0
  while (!body.inRescue() && guard++ < 200) body.tick(0.1, world)
  if (body.inRescue() && body.knock(lungeKnock(1, 0))) fail('a riding bot took a hit')
}

console.log(`${fellCount} of ${2 * kinds.length * dirs.length} knocks fell and were rescued`)

// Ground hop then dive: the spike's two moves. The hop leaves the floor; the dive comes back down.
{
  const body = new BotBody(base)
  if (!body.jump(1, 0)) fail('jump refused')
  let peak = base.y
  for (let i = 0; i < 10; i++) { body.tick(0.05, world); peak = Math.max(peak, body.pos.y) }
  if (peak < base.y + 0.8) fail(`jump peaked only ${(peak - base.y).toFixed(2)} m`)
  if (!body.isAirborne()) fail('jump was not airborne')
  body.dive(1, 0)
  let down = false
  for (let i = 0; i < 40 && !down; i++) {
    body.tick(0.05, world)
    if (body.pos.y < peak - 0.5) down = true
  }
  if (!down) fail('dive did not descend')
  else console.log(`✓ jump then dive: peak +${(peak - base.y).toFixed(2)} m, then down`)
}

// Open floor: player-scale knock, and every step stays a normal physics step (no teleport).
{
  // A flat floor at the raised L0. y 90 sat under the swell fall line after the +100 lift.
  const Y = BASE_Y + 1
  const nodes = new Map<string, [number, number, number]>()
  for (let x = -4; x <= 120; x += 2) nodes.set('flat' + x, [x, Y, 0])
  const flat = { graph: { worldPos: nodes } as typeof graph, rampTiles: [] as typeof rampTiles, base }
  const slide = (spec: KnockSpec) => {
    const body = new BotBody({ x: 0, y: Y - 0.05, z: 0 })
    body.rng = () => 1
    body.knock(spec)
    let peak = body.pos.y
    let prev = { ...body.pos }
    let maxStep = 0
    for (let t = 0; t < 8 && body.mode === 'knock'; t += 0.05) {
      body.tick(0.05, flat)
      maxStep = Math.max(maxStep, Math.hypot(body.pos.x - prev.x, body.pos.y - prev.y, body.pos.z - prev.z))
      prev = { ...body.pos }
      if (body.pos.y > peak) peak = body.pos.y
    }
    return { d: body.pos.x, hop: peak - (Y - 0.05), maxStep, mode: body.mode }
  }
  const lunge = slide(lungeKnock(1, 0))
  const burst = slide(burstKnock(1, 0))
  console.log(`open floor: lunge ${lunge.d.toFixed(1)} m (hop ${lunge.hop.toFixed(2)}, step ${lunge.maxStep.toFixed(2)}), burst ${burst.d.toFixed(1)} m (hop ${burst.hop.toFixed(2)}, step ${burst.maxStep.toFixed(2)})`)
  if (lunge.d < 30 || lunge.d > 60) fail(`lunge on open floor ${lunge.d.toFixed(1)} m; player-scale band is 30–60 m`)
  if (burst.d < 14 || burst.d > 30) fail(`burst on open floor ${burst.d.toFixed(1)} m; player-scale band is 14–30 m`)
  if (lunge.maxStep > 4 || burst.maxStep > 4) fail(`knock stepped ${Math.max(lunge.maxStep, burst.maxStep).toFixed(2)} m in one tick`)
  if (lunge.mode !== 'walk' || burst.mode !== 'walk') fail(`open-floor knock did not settle (lunge ${lunge.mode}, burst ${burst.mode})`)
}

if (failed) process.exit(1)
console.log('✓ bot body checks passed')
