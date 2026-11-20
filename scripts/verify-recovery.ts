/**
 * verify-recovery.ts — a knocked bot tries to get back, and does not always make it.
 * Run: npx tsx scripts/verify-recovery.ts
 *
 * A weak shove off a real lip: a bot that plays the jump perfectly gets back, a bot
 * that never tries falls, and a seeded spread of reaction / misjudge / skipped
 * double-jump lands in between. A full lunge still falls even when the attempt is perfect.
 * Jump apexes match the human heights in shared/pvp.ts.
 *
 * The world includes tiles so lip faces are real, matching live play. A returning
 * glide that arrives a little under the lip must mantle on, and a knocked body
 * at the same height must still fall off. Weak-knock saves, pooled across several lips, stay in a mid-high band, with a human-like miss now and then.
 */
import { readFileSync } from 'node:fs'
import { generateWithRetry, getPlacedTilesInOrder, CELL, MAZE_ORIGIN } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { BotBody } from '../src/shared/botBody'
import { planBotLungeAim, lipInAimCone } from '../src/shared/botDash'
import { lungeKnock, KnockSpec } from '../src/shared/knocks'
import { graphFloorAt } from '../src/shared/anvilSim'
import { inAirSpike } from '../src/shared/burst'
import {
  BOT_GRAVITY, BOT_KNOCK_UNIT, botJumpSpeed, botRecoveryEnabled,
  HUMAN_JUMP_HEIGHT, HUMAN_RUN_JUMP_HEIGHT, HUMAN_DOUBLE_JUMP_HEIGHT,
  LUNGE_DISTANCE, LUNGE_ACTIVE_S, LUNGE_COOLDOWN_S, BOT_LUNGE_BRAKE, AIR_SPIKE_MIN_ABOVE,
  BOT_DASH_SLIP_CHANCE,
} from '../src/shared/pvp'
import { BOT_ANIM_DOUBLE, BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP, BOT_ANIM_LOCO, BOT_ANIM_SLIDE, botShowsGlider } from '../src/shared/botAnim'
import { rescueAllowsSnapshotInterp, snapsAfterRescueRelease } from '../src/shared/rescuePath'

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

if (botShowsGlider(BOT_ANIM_JUMP) || botShowsGlider(BOT_ANIM_DOUBLE) || botShowsGlider(BOT_ANIM_FALL) || botShowsGlider(BOT_ANIM_LOCO) || botShowsGlider(BOT_ANIM_SLIDE) || !botShowsGlider(BOT_ANIM_GLIDE)) {
  fail('the glider should pop only during the glide, not the jump or double jump')
} else {
  console.log('✓ the glider stays down through the jump and double jump, and opens on the glide')
}

const visualSrc = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
if (!visualSrc.includes('ghost-recover.glb') || !visualSrc.includes('Animator.playSingleAnimation') || !visualSrc.includes('ghostClipForPose')) {
  fail('ghosts should play jump, double, and glide clips from ghost-recover.glb')
}
if (!visualSrc.includes("function visualKind(): VisualKind") || !visualSrc.includes("return 'ghost'") || visualSrc.includes('botRecoveryEnabled(roundFormat) ?')) {
  fail('the bot visual should always be the ghost, not gated on the current format')
}
if (visualSrc.includes('function syncGhostTag') || visualSrc.includes('BillboardMode.BM_Y') || visualSrc.includes("text: red ? 'RED' : 'BLUE'")) {
  fail('the billboarded RED/BLUE team plate should be removed from bot visuals')
}
if (!visualSrc.includes('hideGhostPlates') || !visualSrc.includes("roundFormat === 'balloon'") || !visualSrc.includes('NEUTRAL_LIGHT')) {
  fail('Balloon Battle ghosts should hide the team plate and use a neutral light')
}
if (!visualSrc.includes('rescueAllowsSnapshotInterp') || !visualSrc.includes('snapsAfterRescueRelease') || !visualSrc.includes('else if (rec.riding)')) {
  fail('a released rescue should not replay delayed descent snapshots')
}
if (rescueAllowsSnapshotInterp(true) || !rescueAllowsSnapshotInterp(false)) {
  fail('snapshot interpolation should be off while the bot is riding or dropping')
}
{
  const land = { x: 4, y: 2, z: -1 }
  const kept = snapsAfterRescueRelease(12, land)
  if (kept.length !== 1 || kept[0].t !== 12 || kept[0].pos !== land || kept[0].pos.y !== 2) {
    fail('snapsAfterRescueRelease should keep only the landing pose')
  }
}

generateWithRetry(1)
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
const world = {
  graph,
  rampTiles: tiles.filter(t => TILES[t.type].isRamp),
  tiles,
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
function run(spot: Spot, spec: KnockSpec, rng: () => number, enabled = false): {
  outcome: Outcome; jump: boolean; doubled: boolean; peak: number
  sawJump: boolean; sawDouble: boolean; sawGlide: boolean; sawFall: boolean
} {
  const body = new BotBody({ x: spot.x, y: spot.y, z: spot.z }, rng)
  body.recoveryEnabled = enabled
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

for (const m of ['pvp', 'pvb', 'bases', 'prototype', 'balloon'] as const) {
  if (!botRecoveryEnabled(m)) fail(`${m} should allow recovery`)
}
console.log('✓ recovery is on in every live mode')

{
  let found: Spot | null = null
  let weak: ReturnType<typeof run> | null = null
  let strong: ReturnType<typeof run> | null = null
  for (const s of spots) {
    const w = run(s, weakKnock(s.dx, s.dz), perfect(), false)
    const g = run(s, lungeKnock(s.dx, s.dz), perfect(), false)
    if (w.outcome === 'fell' && g.outcome === 'fell') { found = s; weak = w; strong = g; break }
  }
  if (!found || !weak || !strong) { console.error('✗ no lip where both knocks fall with recovery off'); process.exit(1) }
  console.log(`recovery off: weak ${weak.outcome} lunge ${strong.outcome} at (${found.x.toFixed(1)}, ${found.y.toFixed(1)}, ${found.z.toFixed(1)})`)
  if (weak.jump || weak.doubled || weak.sawGlide || weak.sawDouble || strong.sawGlide || strong.sawDouble) {
    fail('recovery off still jumped or opened the glider')
  }
  if (!weak.sawFall || !strong.sawFall) fail('a falling knock should use the fall pose')
  let saved = 0
  for (let i = 0; i < 24; i++) {
    if (run(found, lungeKnock(found.dx, found.dz), mulberry32(5000 + i), false).outcome === 'saved') saved++
  }
  if (saved > 0) fail(`recovery off saved ${saved}/24 lunges`)
  console.log('✓ recovery off: edge knocks fall, no jump or glider')
}


let spot: Spot | null = null
let weakPerfect: ReturnType<typeof run> | null = null
const rateSpots: Spot[] = []
for (const s of spots) {
  const got = run(s, weakKnock(s.dx, s.dz), perfect(), true)
  const off = run(s, weakKnock(s.dx, s.dz), never(), true)
  const lunged = run(s, lungeKnock(s.dx, s.dz), perfect(), true)
  if (got.outcome === 'saved' && got.jump && got.doubled && off.outcome === 'fell' && lunged.outcome === 'fell') {
    rateSpots.push(s)
    if (!spot) { spot = s; weakPerfect = got }
  }
}
if (!spot || !weakPerfect) { console.error('✗ no lip where a perfect save works and a lunge still falls'); process.exit(1) }
console.log(`lip approach (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}, ${spot.z.toFixed(1)}) dir ${spot.dx},${spot.dz}`)

const weak = weakKnock(spot.dx, spot.dz)
const strong = lungeKnock(spot.dx, spot.dz)
const weakNever = run(spot, weak, never(), true)
const strongPerfect = run(spot, strong, perfect(), true)
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

const PER_LIP = 24
let saved = 0, trials = 0
for (const s of rateSpots.slice(0, 8)) {
  const knock = weakKnock(s.dx, s.dz)
  for (let i = 0; i < PER_LIP; i++) {
    const r = run(s, knock, mulberry32(1000 + i + trials), true)
    if (r.outcome === 'open') fail(`trial ${trials} did not resolve`)
    if (r.outcome === 'saved') saved++
    trials++
  }
}
const rate = saved / trials
console.log(`weak knock, ${trials} seeded bots across ${Math.min(8, rateSpots.length)} lips: ${(rate * 100).toFixed(0)}% saved`)
if (rate < 0.68 || rate > 0.90) fail(`expected about 70–85% weak saves, got ${(rate * 100).toFixed(0)}%`)

let strongSaved = 0
for (let i = 0; i < 24; i++) {
  if (run(spot, strong, mulberry32(5000 + i), true).outcome === 'saved') strongSaved++
}
console.log(`full lunge, 24 seeded bots: ${strongSaved} saved`)
if (strongSaved > 2) fail(`strong knocks were saved ${strongSaved}/24 times`)

// A returning glide whose feet are a little under the lip, moving inward.
// Live physics uses the feet; the visible ghost sits ~1.9 m above them, so
// this is the "stuck on the edge and can't get back on" case.
{
  const s = spot
  const floorY = s.y
  // Stand just outside the perimeter face, 0.45 m below the top, heading in.
  let outX = s.x + s.dx * 6, outZ = s.z + s.dz * 6
  for (let d = 2; d <= 10; d += 0.5) {
    const x = s.x + s.dx * d, z = s.z + s.dz * d
    if (!cover(x, z).length) { outX = x + s.dx * 0.4; outZ = z + s.dz * 0.4; break }
  }
  const to = { x: s.x, y: floorY, z: s.z }
  const start = { x: outX, y: floorY - 0.45, z: outZ }
  const inward = { x: -s.dx * 4, y: 0, z: -s.dz * 4 }

  const glider = new BotBody(start)
  glider.startGlideApproach(start, inward, to)
  let gotOn = false
  let stuck = true
  for (let t = 0; t < 4; t += 0.05) {
    for (const e of glider.tick(0.05, world)) {
      if (e.type === 'settled') gotOn = true
      if (e.type === 'fell') stuck = false
    }
    const onFloor = graphFloorAt(world.graph, world.rampTiles, glider.pos.x, glider.pos.z, glider.pos.y, 1.2, 0.8)
    if (gotOn || (glider.isGrounded() && onFloor !== null && Math.abs((onFloor ?? 0) - floorY) < 0.4)) {
      gotOn = true
      stuck = false
      break
    }
  }
  if (!gotOn) {
    fail(`inbound glide 0.45 m under the lip stayed off the floor at (${glider.pos.x.toFixed(2)}, ${glider.pos.y.toFixed(2)}, ${glider.pos.z.toFixed(2)})`)
  } else {
    console.log(`✓ inbound glide 0.45 m under the lip mantled back on (y ${glider.pos.y.toFixed(2)})`)
  }

  // Same pose, no recovery: a knock into the face must not mantle up.
  const knocked = new BotBody(start)
  knocked.recoveryEnabled = false
  knocked.rng = () => 1
  knocked.knock({
    kind: 'lunge',
    impulse: { x: -s.dx * 16, y: 0, z: -s.dz * 16 },
    forceDir: { x: -s.dx, y: 0, z: -s.dz },
    force: 0, forceS: 0, lockS: 0,
  })
  let knockSaved = false
  for (let t = 0; t < 2; t += 0.05) {
    for (const e of knocked.tick(0.05, world)) if (e.type === 'settled') knockSaved = true
  }
  const knockFloor = graphFloorAt(world.graph, world.rampTiles, knocked.pos.x, knocked.pos.z, knocked.pos.y, 1.2, 0.2)
  if (knockSaved || (knocked.isGrounded() && knockFloor !== null && Math.abs((knockFloor ?? 0) - floorY) < 0.2 && knocked.pos.y >= floorY - 0.12)) {
    fail(`outbound/knocked body 0.45 m under the lip was pulled onto the slab at y ${knocked.pos.y.toFixed(2)}`)
  } else {
    console.log(`✓ knocked body 0.45 m under the lip did not mantle (y ${knocked.pos.y.toFixed(2)})`)
  }

  // Air / glide dash: same lunge numbers as a player, once, then the cooldown.
  const far = { x: s.x + s.dx * 12, y: floorY + 1.2, z: s.z + s.dz * 12 }
  const dasher = new BotBody(far)
  dasher.startGlideApproach(far, { x: -s.dx * 2, y: 0, z: -s.dz * 2 }, to)
  let dashes = 0
  let peak = 0
  for (let t = 0; t < LUNGE_COOLDOWN_S + 0.15; t += 0.05) {
    for (const e of dasher.tick(0.05, world)) if (e.type === 'dash') dashes++
    peak = Math.max(peak, dasher.horizontalSpeed())
    if (t > LUNGE_ACTIVE_S + 0.05 && t < LUNGE_COOLDOWN_S - 0.05 && dashes !== 1) {
      fail(`recovery dash count during cooldown at t=${t.toFixed(2)}s was ${dashes}`)
      break
    }
  }
  const want = LUNGE_DISTANCE / LUNGE_ACTIVE_S
  if (dashes !== 1) fail(`recovery dash should fire once in ${LUNGE_COOLDOWN_S}s, got ${dashes}`)
  if (peak < want * 0.9) fail(`recovery dash peak ${peak.toFixed(1)} m/s, expected ~${want.toFixed(1)}`)
  else console.log(`✓ recovery air/glide dash uses the player lunge (${peak.toFixed(1)} m/s) once, then cools down`)

  // Aerial burst only over the arena, using the player's cylinder, never off the edge.
  const over = { x: s.x, y: floorY + AIR_SPIKE_MIN_ABOVE + 1.2, z: s.z }
  const below = { x: s.x, y: floorY, z: s.z }
  const off = { x: s.x + s.dx * 8, y: floorY + AIR_SPIKE_MIN_ABOVE + 1.2, z: s.z + s.dz * 8 }
  const onArena = graphFloorAt(world.graph, world.rampTiles, over.x, over.z, over.y, 1.05, 8) !== null
  const offArena = graphFloorAt(world.graph, world.rampTiles, off.x, off.z, off.y, 1.05, 8) !== null
  if (!onArena) fail('spike over-arena sample was not over a walkable cell')
  if (offArena) fail('spike off-edge sample was still over a walkable cell')
  if (!inAirSpike(over, below)) fail('player air-spike cylinder should cover a target directly below on the floor')
  if (offArena || !onArena) {
    // already failed
  } else {
    console.log('✓ aerial spike is allowed over the arena and refused off the edge')
  }

  // Already on the last stretch: 1.2 m under the lip, a couple of metres out,
  // and almost out of glide time. Must keep the glider open and get on.
  {
    const floorY = s.y
    let outX = s.x + s.dx * 6, outZ = s.z + s.dz * 6
    for (let d = 2; d <= 10; d += 0.5) {
      const x = s.x + s.dx * d, z = s.z + s.dz * d
      if (!cover(x, z).length) { outX = x + s.dx * 0.9; outZ = z + s.dz * 0.9; break }
    }
    const to = { x: s.x, y: floorY, z: s.z }
    const start = { x: outX, y: floorY - 1.2, z: outZ }
    const late = new BotBody(start)
    late.startGlideApproach(start, { x: -s.dx * 5, y: 0, z: -s.dz * 5 }, to, 3.8)
    let gotOn = false
    let gaveUp = false
    for (let t = 0; t < 3; t += 0.05) {
      for (const e of late.tick(0.05, world)) {
        if (e.type === 'settled') gotOn = true
        if (e.type === 'fell') gaveUp = true
      }
      if (gotOn || gaveUp) break
    }
    if (!gotOn || gaveUp) {
      fail(`late inbound glide gave up short of the lip at (${late.pos.x.toFixed(2)}, ${late.pos.y.toFixed(2)}, ${late.pos.z.toFixed(2)})`)
    } else {
      console.log(`✓ late inbound glide kept going and reached the lip (y ${late.pos.y.toFixed(2)})`)
    }
  }
}


{
  const dashSrc = readFileSync(new URL('../src/shared/botDash.ts', import.meta.url), 'utf8')
  const mgrSrc = readFileSync(new URL('../src/server/bots/manager.ts', import.meta.url), 'utf8')
  if (!dashSrc.includes('Never shortens or refuses a dash that would leave the floor') || !mgrSrc.includes('planBotLungeAim')) {
    fail('combat lunges should use planBotLungeAim and must not clamp the dash onto the floor')
  }

  const dashToward = (sp: Spot, enabled: boolean, rng: () => number) => {
    const body = new BotBody({ x: sp.x, y: sp.y, z: sp.z }, rng)
    body.recoveryEnabled = enabled
    body.dash(sp.dx, sp.dz, LUNGE_DISTANCE / LUNGE_ACTIVE_S, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)
    let jump = false, outcome: Outcome = 'open'
    for (let t = 0; t < 8 && outcome === 'open'; t += 0.05) {
      for (const e of body.tick(0.05, world)) {
        if (e.type === 'recover' && e.how === 'jump') jump = true
        if (e.type === 'settled') outcome = 'saved'
        if (e.type === 'fell') outcome = 'fell'
      }
    }
    return { outcome, jump }
  }

  let voidFell = 0
  const voidN = Math.min(12, spots.length)
  for (const sp of spots.slice(0, voidN)) {
    if (dashToward(sp, false, () => 0.5).outcome === 'fell') voidFell++
    else fail(`a dash toward the void was held at the lip at (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)})`)
  }
  if (voidFell === voidN) {
    console.log(`✓ a dash toward the void leaves the lip (${voidFell}/${voidN}), not a wall or snap-up catch`)
  }

  const inland: Spot[] = []
  for (const p of graph.worldPos.values()) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>
    if (!dirs.every(([dx, dz]) => {
      const x = p[0] + dx * 12, z = p[2] + dz * 12
      return graphFloorAt(graph, world.rampTiles, x, z, p[1], 1.2, 2.5) !== null
    })) continue
    inland.push({ x: p[0], y: p[1], z: p[2], dx: 1, dz: 0 })
    if (inland.length >= 4) break
  }
  if (inland.length === 0) fail('no inland floor far from a lip')
  else {
    let slippedOff = 0
    for (let i = 0; i < 40; i++) {
      const sp = inland[i % inland.length]
      const aim = planBotLungeAim(sp, { x: sp.x + 5, z: sp.z }, graph, world.rampTiles, mulberry32(9000 + i))
      const lx = sp.x + aim.dx * LUNGE_DISTANCE, lz = sp.z + aim.dz * LUNGE_DISTANCE
      if (graphFloorAt(graph, world.rampTiles, lx, lz, sp.y, 1.2, 2.5) === null) slippedOff++
    }
    if (slippedOff > 0) fail(`inland lunges left the floor ${slippedOff}/40 times`)
    else console.log('✓ inland lunges stay on the floor (no edge clamp needed)')
  }

  // Stand ~4 m from a lip, dash at a target along the edge: a nearby drop sits in the cone.
  const edge = spots[0]
  const px = -edge.dz, pz = edge.dx
  const along = { x: edge.x + px * 4.5, z: edge.z + pz * 4.5 }
  const cone = lipInAimCone(graph, world.rampTiles, edge, px, pz)
  if (!cone) fail('a dash along a near-edge corridor should see the lip in the aim cone')
  else {
    let slips = 0
    for (let i = 0; i < 80; i++) {
      if (planBotLungeAim(edge, along, graph, world.rampTiles, mulberry32(11000 + i)).slipped) slips++
    }
    const frac = slips / 80
    if (slips < 3 || frac > 0.28) fail(`near-edge slips should be occasional, got ${slips}/80 (${(frac * 100).toFixed(0)}%, chance ${BOT_DASH_SLIP_CHANCE})`)
    else console.log(`✓ near-edge lunges slip off occasionally (${slips}/80)`)
  }

  const forceSlip = (() => {
    let i = 0
    return () => { i++; return i === 2 ? 0 : 0.5 }
  })()
  const slippedAim = planBotLungeAim(edge, along, graph, world.rampTiles, forceSlip)
  if (!slippedAim.slipped) fail('forced slip rng should yaw the dash toward the lip')
  else {
    const body = new BotBody({ x: edge.x, y: edge.y, z: edge.z }, perfect())
    body.recoveryEnabled = true
    body.dash(slippedAim.dx, slippedAim.dz, LUNGE_DISTANCE / LUNGE_ACTIVE_S, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)
    let jump = false, outcome: Outcome = 'open'
    for (let t = 0; t < 8 && outcome === 'open'; t += 0.05) {
      for (const e of body.tick(0.05, world)) {
        if (e.type === 'recover' && e.how === 'jump') jump = true
        if (e.type === 'settled') outcome = 'saved'
        if (e.type === 'fell') outcome = 'fell'
      }
    }
    const landX = edge.x + slippedAim.dx * LUNGE_DISTANCE, landZ = edge.z + slippedAim.dz * LUNGE_DISTANCE
    const leftFloor = graphFloorAt(graph, world.rampTiles, landX, landZ, edge.y, 1.2, 2.5) === null
    if (!leftFloor) fail('a slipped dash should land past the floor')
    if (outcome === 'open') fail('a slipped dash-off did not resolve')
    if (!jump) fail(`a self-dash-off should attempt recovery, outcome ${outcome}`)
    else console.log(`✓ self-dash-off attempts recovery as normal (${outcome}, jumped)`)
  }

  const offDash = dashToward(edge, true, perfect())
  if (!offDash.jump) fail(`a void-aimed dash should still try to recover, got ${offDash.outcome}`)
  else console.log(`✓ void-aimed self-dash tries to recover (${offDash.outcome})`)
}

if (failed) process.exit(1)
console.log('✓ recovery checks passed')
