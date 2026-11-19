/**
 * verify-bot-face.ts — every bot face is reachable, short events stay
 * visible across a 2 Hz position stream, and priority holds.
 *
 * Run: npx tsx scripts/verify-bot-face.ts
 *
 * The resolver is headless (src/shared/botFaceState.ts). Triggers match
 * the live client: lunge:started → dash, burst:fired → burst, lunge /
 * burst / dash impact and playBotKnock → hit, BOT_ANIM_GLIDE / st 4 →
 * glide, BOT_ANIM_FALL or the fall clip → fall, otherwise idle.
 */
import {
  BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP, BOT_ANIM_LOCO,
} from '../src/shared/botAnim'
import {
  FACE_MIN_S, FACE_PRIORITY, botIdFromActor, faceFromMotion, latchFace,
  resolveBotFace, type BotFaceExpr, type FaceLatches,
} from '../src/shared/botFaceState'
import { LUNGE_ACTIVE_S, DASH_DURATION_S } from '../src/shared/pvp'
import { readFileSync } from 'node:fs'

let failed = 0
function fail(msg: string): void {
  failed++
  console.error('✗', msg)
}
function ok(msg: string): void {
  console.log('✓', msg)
}

function step(
  nowMs: number,
  pose = BOT_ANIM_LOCO,
  st = 0,
  clip: 'idle' | 'jump' | 'double' | 'glide' | 'fall' | 'slide' | null = 'idle',
  latches: FaceLatches = {},
) {
  return resolveBotFace({ nowMs, pose, st, clip, latches })
}

function expect(got: BotFaceExpr, want: BotFaceExpr, why: string): void {
  if (got !== want) fail(`${why}: expected ${want}, got ${got}`)
}

// ── Reachability ────────────────────────────────────────────────────
{
  const seen = new Set<BotFaceExpr>()
  seen.add(step(0).expr)

  let r = step(0)
  r = resolveBotFace({ nowMs: 0, pose: 0, st: 0, clip: 'idle', latches: latchFace({}, 'dash', 0) })
  expect(r.expr, 'dash', 'lunge:started latch')
  seen.add(r.expr)

  r = resolveBotFace({ nowMs: 0, pose: 0, st: 0, clip: 'idle', latches: latchFace({}, 'burst', 0) })
  expect(r.expr, 'burst', 'burst:fired latch')
  seen.add(r.expr)

  r = resolveBotFace({ nowMs: 0, pose: 0, st: 0, clip: 'idle', latches: latchFace({}, 'hit', 0) })
  expect(r.expr, 'hit', 'impact / playBotKnock latch')
  seen.add(r.expr)

  r = step(0, BOT_ANIM_FALL, 1, 'fall')
  expect(r.expr, 'fall', 'fall pose + clip')
  seen.add(r.expr)

  r = step(0, BOT_ANIM_FALL, 1, 'idle')
  expect(r.expr, 'fall', 'fall pose alone (clip may lag a packet)')
  seen.add(r.expr)

  r = step(0, BOT_ANIM_GLIDE, 4, 'glide')
  expect(r.expr, 'glide', 'glide pose + st 4')
  seen.add(r.expr)

  r = step(0, BOT_ANIM_LOCO, 4, 'idle')
  expect(r.expr, 'glide', 'st 4 (recovery glide) even if pose is late')
  seen.add(r.expr)

  const rStar = resolveBotFace({ nowMs: 0, pose: 0, st: 0, clip: 'idle', latches: {}, starred: true })
  expect(rStar.expr, 'star', 'starred bot uses the star-eyes face')
  seen.add(rStar.expr)

  const all: BotFaceExpr[] = ['idle', 'dash', 'burst', 'hit', 'fall', 'glide', 'star']
  const missing = all.filter(e => !seen.has(e))
  if (missing.length) fail(`unreachable faces: ${missing.join(', ')}`)
  else ok('each face state is reachable (idle, dash, burst, hit, fall, glide, star)')
}

// ── Priority: hit > glide > fall > burst > dash > idle ──────────────
{
  const now = 0
  let latches = latchFace({}, 'dash', now)
  latches = latchFace(latches, 'burst', now)
  latches = latchFace(latches, 'hit', now)
  let r = resolveBotFace({ nowMs: now, pose: BOT_ANIM_GLIDE, st: 4, clip: 'glide', latches })
  expect(r.expr, 'hit', 'hit beats glide, fall, burst, and dash')

  r = resolveBotFace({ nowMs: now, pose: BOT_ANIM_GLIDE, st: 4, clip: 'glide', latches: latchFace(latchFace({}, 'burst', now), 'dash', now) })
  expect(r.expr, 'glide', 'glide beats burst and dash')

  r = resolveBotFace({ nowMs: now, pose: BOT_ANIM_FALL, st: 1, clip: 'fall', latches: latchFace({}, 'burst', now) })
  expect(r.expr, 'fall', 'fall beats burst')

  r = resolveBotFace({ nowMs: now, pose: 0, st: 0, clip: 'idle', latches: latchFace(latchFace({}, 'burst', now), 'dash', now) })
  expect(r.expr, 'burst', 'burst beats dash')

  const order: BotFaceExpr[] = ['hit', 'glide', 'fall', 'burst', 'dash', 'idle']
  for (let i = 0; i < order.length - 1; i++) {
    if (!(FACE_PRIORITY[order[i]] > FACE_PRIORITY[order[i + 1]])) {
      fail(`priority ${order[i]} should outrank ${order[i + 1]}`)
    }
  }
  ok('priority is hit > glide > fall > burst > dash > idle')

  r = resolveBotFace({ nowMs: now, pose: 0, st: 0, clip: 'idle', latches: latchFace({}, 'hit', now), starred: true })
  expect(r.expr, 'star', 'star-eyes stay on while the bot holds the star, even over hit')
  r = resolveBotFace({ nowMs: now, pose: 0, st: 0, clip: 'idle', latches: latchFace({}, 'hit', now), starred: false })
  expect(r.expr, 'hit', 'clearing starred restores the normal priority, including hit')
  ok('star-eyes win while held and revert when the star ends')
}

// ── 2 Hz latch: dash / hit / burst stay up across a quiet packet ────
{
  const packetMs = 500 // 2 Hz
  if (LUNGE_ACTIVE_S >= FACE_MIN_S.dash || DASH_DURATION_S >= FACE_MIN_S.dash) {
    // Not a failure of the face, just unexpected constants.
    console.log(`(note) lunge ${LUNGE_ACTIVE_S}s / dash ${DASH_DURATION_S}s vs dash face ${FACE_MIN_S.dash}s`)
  }
  for (const expr of ['dash', 'hit', 'burst'] as const) {
    const start = 1000
    const latches = latchFace({}, expr, start)
    // Next botPositions arrives 500 ms later, idle loco — the face must still be up.
    const mid = resolveBotFace({ nowMs: start + packetMs, pose: 0, st: 0, clip: 'idle', latches })
    expect(mid.expr, expr, `${expr} still visible ${packetMs}ms after a 2 Hz idle packet`)
    // And after the minimum display time, it returns to idle.
    const after = resolveBotFace({
      nowMs: start + FACE_MIN_S[expr] * 1000 + 20,
      pose: 0, st: 0, clip: 'idle', latches: mid.latches,
    })
    expect(after.expr, 'idle', `${expr} returns to idle after ${FACE_MIN_S[expr]}s`)
  }
  ok('dash, hit, and burst stay visible across a 2 Hz gap, then release')
}

// ── After hit expires, an ongoing fall or glide takes over ──────────
{
  const start = 0
  const latches = latchFace({}, 'hit', start)
  const during = resolveBotFace({ nowMs: start + 100, pose: BOT_ANIM_FALL, st: 1, clip: 'fall', latches })
  expect(during.expr, 'hit', 'hit overrides fall for the latch')
  const later = resolveBotFace({
    nowMs: start + FACE_MIN_S.hit * 1000 + 20,
    pose: BOT_ANIM_FALL, st: 1, clip: 'fall', latches: during.latches,
  })
  expect(later.expr, 'fall', 'fall shows after the hit latch expires')

  const g0 = latchFace({}, 'hit', start)
  const gDuring = resolveBotFace({ nowMs: start + 100, pose: BOT_ANIM_GLIDE, st: 4, clip: 'glide', latches: g0 })
  const gLater = resolveBotFace({
    nowMs: start + FACE_MIN_S.hit * 1000 + 20,
    pose: BOT_ANIM_GLIDE, st: 4, clip: 'glide', latches: gDuring.latches,
  })
  expect(gLater.expr, 'glide', 'glide shows after the hit latch expires')
  ok('hit yields to fall or glide once its latch ends')
}

// ── Own lunge is not a fall (anim stays loco); recovery jump is not a fall
{
  if (faceFromMotion(BOT_ANIM_LOCO, 1, 'idle') !== null) {
    fail('st 1 (knock / own-lunge) with loco clip must not be a fall or glide')
  }
  if (faceFromMotion(BOT_ANIM_JUMP, 1, 'jump') !== null) {
    fail('a recovery jump should not be classified as fall or glide')
  }
  ok('own lunge and recovery jumps do not trigger the fall face')
}

// ── Actor ids ───────────────────────────────────────────────────────
{
  if (botIdFromActor('bot:12') !== 12 || botIdFromActor('BOT:3') !== 3) fail('botIdFromActor should parse bot:N')
  if (botIdFromActor('player-1') !== null || botIdFromActor('bot:') !== null) fail('botIdFromActor should ignore non-bots')
  ok('bot:N attacker and target ids parse, humans are ignored')
}

// ── Client actually hooks the triggers that fire for bots ───────────
{
  const face = readFileSync(new URL('../src/client/botFace.ts', import.meta.url), 'utf8')
  const visual = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
  const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
  const checks: Array<[boolean, string]> = [
    [face.includes("events.on('lunge:started'") && face.includes("latch(id, 'dash')"), 'botFace listens for lunge:started → dash'],
    [face.includes("events.on('burst:fired'") && face.includes("latch(id, 'burst')"), 'botFace listens for burst:fired → burst'],
    [face.includes("events.on('lunge:impact'") && face.includes("events.on('burst:impact'") && face.includes("events.on('dash:impact'"), 'botFace listens for lunge, burst, and dash impacts → hit'],
    [visual.includes('hitBotFace(') && face.includes('export function hitBotFace'), 'playBotKnock latches the hit face'],
    [server.includes("attacker: `bot:${id}`") && server.includes("room.send('lungeStarted'"), 'server sends lungeStarted for bot attackers'],
    [server.includes("room.send('burstFired'") && server.includes('attacker: by'), 'server sends burstFired for bot attackers (by = bot:N)'],
    [server.includes("target: `bot:${"), 'server sends lunge/burst impact targets as bot:N'],
    [face.includes('tickBotFace') && visual.includes('tickBotFace(rec.id, rec.pose, rec.st)'), 'the draw loop ticks the face with pose and wire state'],
    [face.includes('export function setBotStarFace') && face.includes("star: 'assets/images/bots/faces/star.png'"), 'botFace can swap the star-eyes texture'],
    [readFileSync(new URL('../src/client/overdrive.ts', import.meta.url), 'utf8').includes('setBotStarFace('), 'overdrive turns star-eyes on and off with the hold'],
  ]
  for (const [pass, msg] of checks) {
    if (!pass) fail(msg)
  }
  if (failed === 0) ok('client and server hooks fire dash, burst, hit, fall, and glide for bots')
}

if (failed) {
  console.error(`${failed} bot-face check(s) failed`)
  process.exit(1)
}
console.log('✓ bot face checks passed')
