/**
 * verify-air-trace.ts — per-tick pos / vel / st / an for one platform leap
 * and one lip knock-off. Flags a step that jumps farther than the velocity
 * allows, and a wire state that flips back to walk while still airborne.
 *
 * Run: npx tsx scripts/verify-air-trace.ts
 *
 * The loop is the manager's: body physics, then legs, then a leap handed to
 * the body, then follow() only while the body is walking. `st` matches
 * getBotPositions (0 walk, 1 air, 2 rescue, 4 glide).
 */
import { generateWithRetry, getPlacedTilesInOrder } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph, WalkableGraph } from '../src/shared/mazeGraph'
import { Bot } from '../src/server/bots/bot'
import { BotBody } from '../src/shared/botBody'
import { lungeKnock } from '../src/shared/knocks'
import { BOT_ANIM_GLIDE } from '../src/shared/botAnim'
import { BOT_RECOVERY_ENABLED } from '../src/shared/pvp'

generateWithRetry(42)
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
const rampTiles = tiles.filter(t => TILES[t.type].isRamp)
const world = { graph, rampTiles, tiles, base: { x: 0, y: 0, z: 0 } }

function cellNear(g: WalkableGraph, p: { x: number; y: number; z: number }): string | null {
  for (const pool of [g.deepNodes, g.nodes]) {
    let best: string | null = null, bestD = 2.5
    for (const id of pool) {
      const q = g.worldPos.get(id)
      if (!q || Math.abs(q[1] - p.y) > 1.5) continue
      const d = Math.hypot(q[0] - p.x, q[2] - p.z)
      if (d < bestD) { bestD = d; best = id }
    }
    if (best) return best
  }
  return null
}

function wire(body: BotBody): number {
  if (body.isGliding()) return 4
  if (body.mode === 'walk') return 0
  return body.mode === 'knock' ? 1 : 2
}

type Sample = { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; st: number; an: number; mode: string }

/** One server tick the way tickBots drives a single bot. */
function managerTick(bot: Bot, body: BotBody, dt: number, log: (s: string) => void): void {
  for (const ev of body.tick(dt, world)) {
    if (ev.type === 'settled') {
      const c = cellNear(graph, body.pos)
      log(`  event settled cell=${c ?? 'none'}`)
      if (c) {
        const p = graph.worldPos.get(c)!
        bot.currentCell = c
        bot.clearPath()
        body.follow({ x: p[0], y: p[1], z: p[2] })
      }
    } else if (ev.type === 'fell') log(`  event fell`)
    else if (ev.type === 'recover') log(`  event recover ${ev.how}`)
    else if (ev.type === 'landed') log(`  event landed`)
  }
  if (!body.canWalk()) return
  bot.tick(dt * 1000, graph)
  const leap = bot.takeLeap()
  let holdLip = false
  if (leap) {
    const pos = graph.worldPos.get(leap.to)
    const launched = !!(pos && body.leap({ x: pos[0], y: pos[1], z: pos[2] }))
    log(`  leap ${leap.kind} → ${leap.to} launched=${launched}`)
    if (launched) bot.commitLeap()
    else {
      const lip = graph.worldPos.get(bot.currentCell)
      const far = !!lip && Math.hypot(body.pos.x - lip[0], body.pos.z - lip[2]) > 1.4
      if (far && lip) { body.follow({ x: lip[0], y: lip[1], z: lip[2] }); holdLip = true; log(`  holdLip snap`) }
      else { bot.clearPath(); log(`  leap failed, path cleared`) }
    }
  }
  if (body.canWalk() && !holdLip) {
    const vp = bot.visualPosition(graph)
    if (vp) body.follow({ x: vp[0], y: vp[1], z: vp[2] })
  }
}

function analyse(name: string, samples: Sample[], dt: number): { jumps: number; flaps: number; stuck: boolean } {
  let jumps = 0
  let flaps = 0
  let airTicks = 0
  let maxStep = 0
  console.log(`\n== ${name} ==`)
  console.log('t     x      y      z      vx     vy     vz    st an mode')
  let prev: Sample | null = null
  let prevWalk = true
  for (const s of samples) {
    const step = prev ? Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z) : 0
    // A knock leaves at ~30 m/s and a missed glide falls at ~60 m/s, so one
    // 50 ms step can be ~3 m. Anything past 4 m in a single step is a teleport.
    const jump = prev !== null && step > 4
    if (jump) jumps++
    if (step > maxStep) maxStep = step
    const airborne = s.mode !== 'walk' && s.mode !== 'rescue'
    if (airborne) airTicks++
    // Walk wire while the body is still in the air, or walk→air→walk inside one flight.
    if (prev && prev.st !== 0 && s.st === 0 && airborne) flaps++
    if (prev && !prevWalk && s.st === 0 && samples[samples.indexOf(s) + 1]?.st !== 0) flaps++
    prevWalk = s.st === 0 && s.mode === 'walk'
    const mark = jump ? '  JUMP' : ''
    if (jump || s.t < 0.35 || (prev && (prev.st !== s.st || prev.an !== s.an)) || s.t > samples[samples.length - 1].t - 0.15) {
      console.log(
        `${s.t.toFixed(2).padStart(5)} ${s.x.toFixed(2).padStart(7)} ${s.y.toFixed(2).padStart(7)} ${s.z.toFixed(2).padStart(7)} ` +
        `${s.vx.toFixed(1).padStart(6)} ${s.vy.toFixed(1).padStart(6)} ${s.vz.toFixed(1).padStart(6)} ` +
        `${String(s.st).padStart(2)} ${String(s.an).padStart(2)} ${s.mode}${mark}`,
      )
    }
    prev = s
  }
  const last = samples[samples.length - 1]
  const stuck = !!last && last.mode === 'walk' && airTicks > 4 && Math.abs(last.y - samples[0].y) > 2 && last.st === 0
  console.log(`steps=${samples.length} airTicks=${airTicks} maxStep=${maxStep.toFixed(2)} m  jumps=${jumps} stFlaps=${flaps} end=${last?.mode} y=${last?.y.toFixed(2)}`)
  return { jumps, flaps, stuck }
}

// ── Leap: stand on the lip cell and path at the landing ─────────────
let dropFrom = ''
let dropTo = ''
for (const [from, list] of graph.deepAir) {
  const e = list.find(x => x.kind === 'drop')
  if (e) { dropFrom = from; dropTo = e.to; break }
}
if (!dropFrom) { console.error('no drop edge'); process.exit(1) }

const fromP = graph.worldPos.get(dropFrom)!
const bot = new Bot({
  team: 1,
  startCell: dropFrom,
  stepsPerSec: 4,
  useAir: true,
  pickTarget: () => dropTo,
})
const body = new BotBody({ x: fromP[0], y: fromP[1], z: fromP[2] })
const leapSamples: Sample[] = []
const leapLog: string[] = []
const DT = 0.05
for (let i = 0, t = 0; i < 160; i++, t += DT) {
  managerTick(bot, body, DT, s => leapLog.push(`${t.toFixed(2)} ${s}`))
  leapSamples.push({
    t, x: body.pos.x, y: body.pos.y, z: body.pos.z,
    vx: body.verticalSpeed() && body.mode !== 'walk' ? body.pos.x : 0,
    vy: body.verticalSpeed(), vz: 0, st: wire(body), an: body.animCode(), mode: body.mode,
  })
  // Velocity from the last step, filled below. Placeholder replaced after the loop.
}
// Real velocity is the finite difference. The body does not expose horizontal vel.
for (let i = leapSamples.length - 1; i > 0; i--) {
  const a = leapSamples[i - 1], b = leapSamples[i]
  b.vx = (b.x - a.x) / DT
  b.vy = (b.y - a.y) / DT
  b.vz = (b.z - a.z) / DT
}
console.log('leap events:')
for (const line of leapLog) console.log(line)
const leapReport = analyse(`leap ${dropFrom} → ${dropTo}`, leapSamples, DT)

// ── Knock-off recovery, same lip the recovery verify uses ───────────
const spot = { x: fromP[0], y: fromP[1], z: fromP[2] }
// Push toward a neighbourless side. The trace only cares about continuity.
let dx = 1, dz = 0
{
  let best = -1
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
    let open = 0
    for (const dist of [3, 6, 9]) {
      const px = spot.x + x * dist, pz = spot.z + z * dist
      const near = [...graph.worldPos.values()].some(q => Math.abs(q[1] - spot.y) < 1.5 && Math.hypot(q[0] - px, q[2] - pz) < 1.6)
      if (!near) open++
    }
    if (open > best) { best = open; dx = x; dz = z }
  }
}
const knocked = new BotBody({ ...spot }, () => 0)
knocked.knock(lungeKnock(dx, dz))
const knockSamples: Sample[] = []
for (let i = 0, t = 0; i < 200 && knocked.mode !== 'rescue'; i++, t += DT) {
  knocked.tick(DT, world)
  knockSamples.push({
    t, x: knocked.pos.x, y: knocked.pos.y, z: knocked.pos.z,
    vx: 0, vy: knocked.verticalSpeed(), vz: 0, st: wire(knocked), an: knocked.animCode(), mode: knocked.mode,
  })
  if (knocked.mode === 'walk' && t > 0.4) break
}
for (let i = knockSamples.length - 1; i > 0; i--) {
  const a = knockSamples[i - 1], b = knockSamples[i]
  b.vx = (b.x - a.x) / DT
  b.vy = (b.y - a.y) / DT
  b.vz = (b.z - a.z) / DT
}
const sawGlide = knockSamples.some(s => s.an === BOT_ANIM_GLIDE || s.st === 4)
const knockReport = analyse(`knock-off dir ${dx},${dz} glide=${sawGlide}`, knockSamples, DT)
if (!BOT_RECOVERY_ENABLED && (sawGlide || knockSamples[knockSamples.length - 1]?.mode !== 'rescue')) {
  console.error('✗ recovery is off, so a knock off the lip should fall into rescue with no glider')
  process.exit(1)
}

// Client: st != 0 holds snapshot interpolation for FAST_HOLD_S after the last
// airborne packet. A single-tick flap does not alternate snap vs lerp.
const FAST_HOLD_S = 0.4
let hold = 0
let alternations = 0
let drawingFast = false
for (const s of leapSamples) {
  if (s.st !== 0) hold = FAST_HOLD_S
  else hold = Math.max(0, hold - DT)
  const fast = hold > 0
  if (fast !== drawingFast) alternations++
  drawingFast = fast
}
console.log(`\nclient st on the leap: snapshot/lerp switches=${alternations} (a clean flight switches twice: into the air, then back)`)

const bad = leapReport.jumps > 0 || leapReport.flaps > 0 || knockReport.jumps > 0 || knockReport.flaps > 0
if (bad) {
  console.error('✗ air trace found a position jump or a walk/air flap')
  process.exit(1)
}
console.log('\n✓ air trace: leap and knock-off stay inside one velocity step, st does not flap')
