/**
 * verify-recovery.ts — a knocked bot tries to get back, and does not always make it.
 * Run: npx tsx scripts/verify-recovery.ts
 *
 * A weak shove off a real lip: a bot that plays the jump perfectly gets back, a bot
 * that never tries falls, and a seeded spread of reaction / misjudge / skipped
 * double-jump lands in between. A full lunge still falls even when the attempt is perfect.
 * Jump apexes match the human heights in shared/pvp.ts.
 */
import { generateWithRetry, getPlacedTilesInOrder, CELL, MAZE_ORIGIN } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { BotBody } from '../src/shared/botBody'
import { lungeKnock, KnockSpec } from '../src/shared/knocks'
import {
  BOT_GRAVITY, BOT_KNOCK_UNIT, BOT_RECOVERY_ENABLED, botJumpSpeed,
  HUMAN_JUMP_HEIGHT, HUMAN_RUN_JUMP_HEIGHT, HUMAN_DOUBLE_JUMP_HEIGHT,
} from '../src/shared/pvp'
import { BOT_ANIM_DOUBLE, BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP } from '../src/shared/botAnim'

let failed = false
const fail = (m: string) => { console.error('✗ ' + m); failed = true }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

const apexOf = (h: number) => botJumpSpeed(h) ** 2 / (2 * BOT_GRAVITY)
for (const [name, h] of [['standing', HUMAN_JUMP_HEIGHT], ['run', HUMAN_RUN_JUMP_HEIGHT], ['double', HUMAN_DOUBLE_JUMP_HEIGHT]] as const) {
  const apex = apexOf(h)
  if (Math.abs(apex - h) > 0.02) fail(`${name} jump apex ${apex.toFixed(3)} m, human height is ${h} m`)
}
console.log(`✓ jump apexes match human heights (stand ${HUMAN_JUMP_HEIGHT}, run ${HUMAN_RUN_JUMP_HEIGHT}, double ${HUMAN_DOUBLE_JUMP_HEIGHT}) under BOT_GRAVITY ${BOT_GRAVITY}`)

generateWithRetry(1)
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
const world = {
  graph,
  rampTiles: tiles.filter(t => TILES[t.type].isRamp),
  base: { x: 0, y: 0, z: 0 },
}

const cover = (x: number, z: number) => tiles.filter(t => {
  const x0 = t.x * CELL + MAZE_ORIGIN, z0 = t.z * CELL + MAZE_ORIGIN
  return x >= x0 && x < x0 + CELL && z >= z0 && z < z0 + CELL
})
const beyond = (p: [number, number, number], dx: number, dz: number): boolean => {
  for (const dist of [3, 8]) {
    const x = p[0] + dx * dist, z = p[2] + dz * dist
    const near = [...graph.worldPos.values()].some(q => Math.abs(q[1] - p[1]) < 1.5 && Math.hypot(q[0] - x, q[2] - z) < 1.5)
    if (near) return false
    if (!cover(x, z).length) return true
  }
  return false
}

/** Flat floor a short run back from a lip, so a weak slide can reach the void and a lunge flies past it. */
type Spot = { x: number; y: number; z: number; dx: number; dz: number }
const spots: Spot[] = []
for (const [id, p] of graph.worldPos) {
  const [tx, tz, ty] = id.split(':')[0].split(',').map(Number)
  const tile = tiles.find(t => t.x === tx && t.z === tz && Math.abs(t.y - ty) < 0.05)
  if (!tile || TILES[tile.type].isRamp) continue
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
    if (!beyond(p, dx, dz)) continue
    const q = [...graph.worldPos.values()].find(c => Math.abs(c[1] - p[1]) < 0.4 && Math.hypot(c[0] - (p[0] - dx * 4), c[2] - (p[2] - dz * 4)) < 1.2)
    if (q) spots.push({ x: q[0], y: q[1], z: q[2], dx, dz })
  }
  if (spots.length >= 12) break
}
if (spots.length === 0) { console.error('✗ no floor behind a lip'); process.exit(1) }

/** Shove that clears a lip 4 m ahead without a lunge's carry. Impulse is Physics units (× BOT_KNOCK_UNIT → m/s). */
const WEAK_PUSH = 56
function weakKnock(dx: number, dz: number): KnockSpec {
  return {
    kind: 'lunge',
    impulse: { x: dx * WEAK_PUSH, y: 0, z: dz * WEAK_PUSH },
    forceDir: { x: dx, y: 0, z: dz },
    force: 0, forceS: 0, lockS: 0.3,
  }
}

type Outcome = 'saved' | 'fell' | 'open'
function run(spot: Spot, spec: KnockSpec, rng: () => number): {
  outcome: Outcome; jump: boolean; doubled: boolean; peak: number
  sawJump: boolean; sawDouble: boolean; sawGlide: boolean; sawFall: boolean
} {
  const body = new BotBody({ x: spot.x, y: spot.y, z: spot.z }, rng)
  body.knock(spec)
  let jump = false, doubled = false, peak = body.pos.y
  let sawJump = false, sawDouble = false, sawGlide = false, sawFall = false
  let outcome: Outcome = 'open'
  for (let t = 0; t < 12 && outcome === 'open'; t += 0.05) {
    for (const e of body.tick(0.05, world)) {
      if (e.type === 'recover' && e.how === 'jump') jump = true
      if (e.type === 'recover' && e.how === 'double') doubled = true
      if (e.type === 'settled') outcome = 'saved'
      if (e.type === 'fell') outcome = 'fell'
    }
    const pose = body.animCode()
    if (pose === BOT_ANIM_JUMP) sawJump = true
    if (pose === BOT_ANIM_DOUBLE) sawDouble = true
    if (pose === BOT_ANIM_GLIDE) sawGlide = true
    if (pose === BOT_ANIM_FALL) sawFall = true
    if (body.pos.y > peak) peak = body.pos.y
  }
  return { outcome, jump, doubled, peak, sawJump, sawDouble, sawGlide, sawFall }
}

/** Fresh stream: willRecover, fast reaction, take the double jump, aim true. */
const stream = (seq: number[]) => { let i = 0; return () => seq[Math.min(i++, seq.length - 1)] }
const perfect = () => stream([0, 0, 0.99, 0])
const never = () => stream([1])

if (!BOT_RECOVERY_ENABLED) {
  let found: Spot | null = null
  let weak: ReturnType<typeof run> | null = null
  let strong: ReturnType<typeof run> | null = null
  for (const s of spots) {
    const w = run(s, weakKnock(s.dx, s.dz), perfect())
    const g = run(s, lungeKnock(s.dx, s.dz), perfect())
    if (w.outcome === 'fell' && g.outcome === 'fell') { found = s; weak = w; strong = g; break }
  }
  if (!found || !weak || !strong) { console.error('✗ no lip where both knocks fall'); process.exit(1) }
  console.log(`recovery off: weak ${weak.outcome} lunge ${strong.outcome} at (${found.x.toFixed(1)}, ${found.y.toFixed(1)}, ${found.z.toFixed(1)})`)
  if (weak.jump || weak.doubled || weak.sawGlide || weak.sawDouble || strong.sawGlide || strong.sawDouble) {
    fail('recovery off still jumped or opened the glider')
  }
  if (!weak.sawFall || !strong.sawFall) fail('a falling knock should use the fall pose')
  let saved = 0
  for (let i = 0; i < 24; i++) {
    if (run(found, lungeKnock(found.dx, found.dz), mulberry32(5000 + i)).outcome === 'saved') saved++
  }
  if (saved > 0) fail(`recovery off saved ${saved}/24 lunges`)
  if (failed) process.exit(1)
  console.log('✓ recovery is off: edge knocks fall, no jump or glider')
  process.exit(0)
}

let spot: Spot | null = null
let weakPerfect: ReturnType<typeof run> | null = null
for (const s of spots) {
  const got = run(s, weakKnock(s.dx, s.dz), perfect())
  const off = run(s, weakKnock(s.dx, s.dz), never())
  const lunged = run(s, lungeKnock(s.dx, s.dz), perfect())
  if (got.outcome === 'saved' && got.jump && off.outcome === 'fell' && lunged.outcome === 'fell') {
    spot = s
    weakPerfect = got
    break
  }
}
if (!spot || !weakPerfect) { console.error('✗ no lip where a perfect save works and a lunge still falls'); process.exit(1) }
console.log(`lip approach (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}, ${spot.z.toFixed(1)}) dir ${spot.dx},${spot.dz}`)

const weak = weakKnock(spot.dx, spot.dz)
const strong = lungeKnock(spot.dx, spot.dz)
const weakNever = run(spot, weak, never())
const strongPerfect = run(spot, strong, perfect())
console.log(`weak perfect: ${weakPerfect.outcome} jump=${weakPerfect.jump} double=${weakPerfect.doubled} peak +${(weakPerfect.peak - spot.y).toFixed(2)} m (${(WEAK_PUSH * BOT_KNOCK_UNIT).toFixed(1)} m/s)`)
console.log(`weak never:   ${weakNever.outcome}`)
console.log(`lunge perfect: ${strongPerfect.outcome}`)

if (weakNever.outcome !== 'fell') fail(`weak knock with recovery off should leave the level, got ${weakNever.outcome}`)
if (weakPerfect.outcome !== 'saved' || !weakPerfect.jump) fail('perfect recovery should jump and save the weak knock')
if (!weakPerfect.doubled) fail('perfect recovery should spend the double jump when the first arc is short')
if (!weakPerfect.sawJump || !weakPerfect.sawDouble || !weakPerfect.sawGlide) {
  fail(`perfect recovery poses jump=${weakPerfect.sawJump} double=${weakPerfect.sawDouble} glide=${weakPerfect.sawGlide}`)
}
if (!weakNever.sawFall || weakNever.sawGlide || weakNever.sawJump) {
  fail(`no-recovery poses fall=${weakNever.sawFall} jump=${weakNever.sawJump} glide=${weakNever.sawGlide}`)
}
if (weakPerfect.peak < spot.y + HUMAN_RUN_JUMP_HEIGHT) fail(`recovery arc peaked only ${(weakPerfect.peak - spot.y).toFixed(2)} m`)
if (strongPerfect.outcome !== 'fell') fail(`a full lunge should still fall when recovery is perfect, got ${strongPerfect.outcome}`)

const TRIALS = 48
let saved = 0
for (let i = 0; i < TRIALS; i++) {
  const r = run(spot, weak, mulberry32(1000 + i))
  if (r.outcome === 'saved') saved++
  else if (r.outcome === 'open') fail(`trial ${i} did not resolve`)
}
const rate = saved / TRIALS
console.log(`weak knock, ${TRIALS} seeded bots: ${(rate * 100).toFixed(0)}% saved`)
if (rate < 0.2 || rate > 0.8) fail(`expected some saves and some falls, got ${(rate * 100).toFixed(0)}%`)

let strongSaved = 0
for (let i = 0; i < 24; i++) {
  if (run(spot, strong, mulberry32(5000 + i)).outcome === 'saved') strongSaved++
}
console.log(`full lunge, 24 seeded bots: ${strongSaved} saved`)
if (strongSaved > 2) fail(`strong knocks were saved ${strongSaved}/24 times`)

if (failed) process.exit(1)
console.log('✓ recovery checks passed')
