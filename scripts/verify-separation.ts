/**
 * verify-separation.ts — bots do not all move the same way, and they keep apart.
 * Run: npx tsx scripts/verify-separation.ts
 *
 * Spawn personalities are seeded, so the spread of pace / engage / retarget is fixed.
 * After they walk, nearest neighbours sit around the 3–4 m band, and teammates do not
 * all lock onto one tile. Two humans nearby get split across the bots that chase.
 */
import { initBots, rebuildBotGraph, tickBots, getBotPositions, getBotProfiles, getWalkableGraph, setPopulation } from '../src/server/bots/manager'
import { Bot, rollPersonality, mulberry32 } from '../src/server/bots/bot'
import { BOT_SPEED_SPREAD, BOT_ENGAGE_MIN_M, BOT_ENGAGE_MAX_M, BOT_SEPARATE_M } from '../src/shared/pvp'

let failed = false
const fail = (m: string) => { console.error('✗ ' + m); failed = true }

const pace = rollPersonality(mulberry32(1), 1)
const pace2 = rollPersonality(mulberry32(1), 1)
if (pace.speedMul !== pace2.speedMul || pace.engageM !== pace2.engageM) fail('personality roll is not seeded')
if (pace.speedMul < 1 - BOT_SPEED_SPREAD - 1e-6 || pace.speedMul > 1 + BOT_SPEED_SPREAD + 1e-6) {
  fail(`speed multiplier ${pace.speedMul} outside ±${BOT_SPEED_SPREAD}`)
}

let humans: Array<{ id: string; team: number; x: number; y: number; z: number }> = []
initBots({
  applyPaint: () => false,
  paint: { teamOf: () => 0 },
  activeHumans: () => ({ red: humans.length, blue: 0 }),
  humans: () => humans,
  abilities: () => ({ lunge: false, burst: false }),
})
rebuildBotGraph(42)
setPopulation({ kind: 'pvb', humanTeam: 1 })
// Fifteen humans, all far below the floor, so the round fills 15 bots and nobody chases yet.
humans = Array.from({ length: 15 }, (_, i) => ({ id: 'pad' + i, team: 1, x: 0, y: -999, z: i }))
tickBots(0)
const spawned = getBotProfiles()
if (spawned.length !== 15) { console.error(`✗ expected 15 bots, got ${spawned.length}`); process.exit(1) }

const speeds = spawned.map(b => b.speedMul)
const engages = spawned.map(b => b.engageM)
const retargets = spawned.map(b => b.retargetS)
const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
console.log(`pace ${Math.min(...speeds).toFixed(2)}–${Math.max(...speeds).toFixed(2)}  engage ${Math.min(...engages).toFixed(1)}–${Math.max(...engages).toFixed(1)} m  retarget ${Math.min(...retargets).toFixed(1)}–${Math.max(...retargets).toFixed(1)} s`)
if (speeds.some(s => s < 1 - BOT_SPEED_SPREAD - 1e-6 || s > 1 + BOT_SPEED_SPREAD + 1e-6)) fail('a bot pace is outside ±10%')
if (span(speeds) < 0.08) fail(`pace spread only ${span(speeds).toFixed(3)}`)
if (engages.some(e => e < BOT_ENGAGE_MIN_M - 1e-6 || e > BOT_ENGAGE_MAX_M + 1e-6)) fail('engage distance outside the band')
if (span(engages) < 4) fail(`engage spread only ${span(engages).toFixed(2)} m`)
if (span(retargets) < 1) fail(`retarget spread only ${span(retargets).toFixed(2)} s`)
for (const b of spawned) {
  const w = b.weights
  const sum = w.paint + w.enemy + w.chase + w.roam
  if (Math.abs(sum - 1) > 1e-6) fail(`bot ${b.id} weights sum to ${sum}`)
}

// Still on the base, so both humans are in range for anyone whose engage reaches them.
{
  const p = getBotPositions()
  const x = p.reduce((s, b) => s + b.x, 0) / p.length
  const z = p.reduce((s, b) => s + b.z, 0) / p.length
  const y = p[0].y
  humans = [
    { id: 'west', team: 1, x: x - 4, y, z },
    { id: 'east', team: 1, x: x + 4, y, z },
  ]
  for (let i = 0; i < 8; i++) tickBots(0.25)
  const pos = getBotPositions()
  const profiles = getBotProfiles()
  const reachBoth = profiles.filter(b => {
    const at = pos.find(q => q.id === b.id)
    if (!at) return false
    const west = Math.hypot(at.x - (x - 4), at.z - z)
    const east = Math.hypot(at.x - (x + 4), at.z - z)
    return west <= b.engageM && east <= b.engageM && (b.chaseHuman === 'west' || b.chaseHuman === 'east')
  })
  const kinds = new Set(reachBoth.map(b => b.chaseHuman))
  console.log(`chase split: ${reachBoth.length} bots in range of both, ids ${[...kinds].join('+') || 'none'}`)
  if (reachBoth.length >= 2 && kinds.size < 2) fail('bots who could reach either human all picked the same one')
  humans = Array.from({ length: 15 }, (_, i) => ({ id: 'pad' + i, team: 1, x: 0, y: -999, z: i }))
}

// Pace is wired into the step clock: +10% takes more steps than −10% on the same route.
{
  const g = getWalkableGraph()
  if (!g) { console.error('✗ no graph'); process.exit(1) }
  const nodes = [...g.deepNodes]
  const start = nodes[0]
  const far = nodes[nodes.length - 1]
  const base = { seed: 0, weights: { paint: 1, enemy: 0, chase: 0, roam: 0 }, retargetS: 30, engageM: 14 }
  const count = (speedMul: number) => {
    const bot = new Bot({
      team: 2, startCell: start, stepsPerSec: 4, useAir: false,
      personality: { ...base, speedMul },
      rng: mulberry32(3),
      pickTarget: () => far,
    })
    bot.chase(far)
    let n = 0
    // Short of the route's end, or the faster bot arrives and the count stops meaning pace.
    for (let t = 0; t < 1600; t += 200) n += bot.tick(200, g).length
    return n
  }
  const slow = count(1 - BOT_SPEED_SPREAD)
  const fast = count(1 + BOT_SPEED_SPREAD)
  console.log(`step clock: ${slow} steps at −10%, ${fast} at +10%`)
  if (!(fast > slow)) fail('speed multiplier did not change the step rate')
}

const nearest = () => {
  const p = getBotPositions()
  const ds: number[] = []
  for (let i = 0; i < p.length; i++) {
    let best = Infinity
    for (let j = 0; j < p.length; j++) {
      if (i === j) continue
      best = Math.min(best, Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z))
    }
    ds.push(best)
  }
  ds.sort((a, b) => a - b)
  return ds
}

const typical: number[] = []
const worst: number[] = []
let stacked = 0
let counted = 0
let uniqueGoals = 0
for (let t = 0; t < 8; t += 0.5) {
  tickBots(0.5)
  if (t < 2) continue
  const ds = nearest()
  worst.push(ds[0])
  typical.push(ds[Math.floor(ds.length / 2)])
  stacked += ds.filter(d => d < 1.5).length
  counted += ds.length
  const goals = new Set(getBotProfiles().map(b => b.goal).filter((g): g is string => !!g))
  if (goals.size > uniqueGoals) uniqueGoals = goals.size
}
typical.sort((a, b) => a - b)
worst.sort((a, b) => a - b)
const median = typical[Math.floor(typical.length / 2)]
console.log(`nearest neighbour: typical ${median.toFixed(2)} m, closest pair down to ${worst[0].toFixed(2)} m (want ~${BOT_SEPARATE_M}); ${stacked}/${counted} bot-samples under 1.5 m`)
console.log(`distinct goals seen: ${uniqueGoals}`)
if (median < 2.8) fail(`typical separation ${median.toFixed(2)} m is under 2.8 — bots are clumping`)
if (stacked > counted * 0.08) fail('too many bots inside 1.5 m of someone')
if (uniqueGoals < 4) fail(`only ${uniqueGoals} distinct goals; teammates are sharing one tile`)

if (failed) process.exit(1)
console.log('✓ separation and variety checks passed')
