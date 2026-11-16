/**
 * Balloon Battle rules. Run: npx tsx scripts/verify-balloon.ts
 */
import { readFileSync } from 'node:fs'
import {
  BALLOON_START, balloonOf, balloonTimeout, dropParticipant, lastStanding,
  balloonsLive, livingIds, paintAllowed, popBalloon, startingBalloons,
} from '../src/shared/balloon'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const ids = ['0xAaa', 'bot:1', '0xBbb']
const start = startingBalloons(ids)
if (Object.keys(start).length !== 3) fail('every participant should start in the book')
for (const id of ['0xaaa', 'bot:1', '0xbbb']) {
  if (start[id] !== BALLOON_START || balloonOf(start, id) !== 3) fail(`${id} should start with 3 balloons`)
}
if (start['0xAaa'] !== undefined) fail('ids should be stored lower-case')
if (BALLOON_START !== 3) fail(`start count should be 3, got ${BALLOON_START}`)

let book = start
const first = popBalloon(book, '0xAAA')
if (!first.popped || first.eliminated || first.before !== 3 || first.after !== 2 || first.counts['0xaaa'] !== 2) {
  fail('a fall should pop one balloon and leave the player in the match')
}
book = first.counts
if (book['bot:1'] !== 3 || book['0xbbb'] !== 3) fail("a pop must not change anyone else's count")
if (lastStanding(book, 3).kind !== 'continue') fail('two or more players still in should continue')

const second = popBalloon(book, '0xaaa')
const third = popBalloon(second.counts, '0xaaa')
if (!third.eliminated || third.after !== 0 || balloonOf(third.counts, '0xaaa') !== 0) {
  fail('the third fall should eliminate the player')
}
book = third.counts
const ignored = popBalloon(book, '0xaaa')
if (ignored.popped || ignored.eliminated || ignored.after !== 0) fail('an already-out player should not pop again')

const mid = lastStanding(book, 3)
if (mid.kind !== 'continue' || livingIds(book).join() !== 'bot:1,0xbbb') {
  fail(`after one elimination the other two should still be playing (${livingIds(book)})`)
}

const botOut = popBalloon(popBalloon(popBalloon(book, 'bot:1').counts, 'bot:1').counts, 'bot:1')
if (!botOut.eliminated) fail('the bot should be out at 0')
const win = lastStanding(botOut.counts, 3)
if (win.kind !== 'winner' || win.id !== '0xbbb') fail('the last player with balloons should win')

const bothGone = popBalloon(popBalloon(popBalloon(botOut.counts, '0xbbb').counts, '0xbbb').counts, '0xbbb')
const tied = lastStanding(bothGone.counts, 3)
if (tied.kind !== 'tie') fail('when everyone is at 0 the match is a tie')

const solo = startingBalloons(['only-me'])
if (lastStanding(solo, 1).kind !== 'continue') fail('a solo match should not be an instant win')
const soloPop = popBalloon(popBalloon(popBalloon(solo, 'only-me').counts, 'only-me').counts, 'only-me')
if (lastStanding(soloPop.counts, 1).kind !== 'tie') fail('a solo player who pops all three still has no opponent to beat')

const clock = { a: 2, b: 2, c: 1 }
const clockTie = balloonTimeout(clock)
if (clockTie.kind !== 'tie') fail('a clock tie on remaining balloons should be a tie')
const clockWin = balloonTimeout({ a: 2, b: 1, c: 0 })
if (clockWin.kind !== 'winner' || clockWin.id !== 'a') fail('the clock should award the player with the most balloons')
if (balloonTimeout({ a: 0, b: 0 }).kind !== 'tie') fail('a clock with everyone out is a tie')

const left = dropParticipant({ a: 3, b: 2 }, 'A')
if (left.a !== 0 || left.b !== 2) fail('a leave should zero that player')
const leaveWin = lastStanding(left, 2)
if (leaveWin.kind !== 'winner' || leaveWin.id !== 'b') fail('the remaining player should win when the other leaves')

if (paintAllowed('pvp') !== true || paintAllowed('pvb') !== true || paintAllowed('prototype') !== true) {
  fail('Pixelwars, Bot Invasion, and Prototype must still paint')
}
if (paintAllowed('balloon') !== false) fail('Balloon Battle must not paint')

let painted = 0
function tryPaint(format: string): void {
  if (!paintAllowed(format)) return
  painted++
}
tryPaint('pvp')
tryPaint('balloon')
tryPaint('prototype')
if (painted !== 2) fail(`paint mutations leaked into balloon mode (applied ${painted})`)

const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
if (!server.includes('paintAllowed(roundFormat)') && !server.includes("roundFormat === 'balloon'")) {
  fail('the server must refuse paint mutations while Balloon Battle is running')
}
if (!server.includes('popBalloon') && !server.includes('lastStanding') && !server.includes('startingBalloons')) {
  fail('the server must use the shared balloon rules for counts and last standing')
}

const paintSrc = readFileSync(new URL('../src/paint.ts', import.meta.url), 'utf8')
if (!paintSrc.includes('paintAllowed') && !paintSrc.includes("format === 'balloon'")) {
  fail('the client must not apply or send paint during Balloon Battle')
}


if (balloonsLive('match', 'balloon') !== true) fail('balloons should be up during a Balloon Battle match')
if (balloonsLive('summary', 'balloon') !== false) fail('balloons must come down when the match goes to summary')
if (balloonsLive('lobby', 'balloon') !== false) fail('balloons must come down in the lobby')
if (balloonsLive('idle', 'balloon') !== false) fail('balloons must come down while the lobby is idle')
if (balloonsLive('match', 'pvp') !== false || balloonsLive('match', 'pvb') !== false || balloonsLive('match', 'prototype') !== false) {
  fail('other modes must not spawn Balloon Battle rigs')
}

const client = readFileSync(new URL('../src/client/balloons.ts', import.meta.url), 'utf8')
if (!client.includes('balloonsLive') || !client.includes('teardownBalloons')) {
  fail('the client must use balloonsLive and teardownBalloons to drop rigs when the match ends')
}
if (!client.includes("events.on('round:ended'") || !client.includes("events.on('round:reset'")) {
  fail('the client must tear down balloon rigs on round end and reset')
}
if (!client.includes("events.on('lobby:floor'") || !client.includes('isLobbyLayout()')) {
  fail('balloon rigs must come down when the lobby floor is up, even if the phase still says match')
}
if (!client.includes('engine.removeEntity(c.attach)')) {
  fail('the AvatarAttach root must be removed directly, because it may have no Transform')
}
if (!client.includes("events.on('team:roster'") || !client.includes('dropLeavers')) {
  fail('the client must remove a balloon rig when a player leaves')
}
if (client.includes('AAPT_SPINE') || client.includes('ANCHOR_SPINE')) {
  fail('attached balloons must not follow an animated spine bone')
}
if (!client.includes('const BACK_Y = 1.68')) {
  fail('the knot should sit on the upper back, about 1.68 m up')
}
if (!client.includes('STRING_SEGS') || !client.includes('placeString') || !client.includes('STRING_SAG')) {
  fail('balloon strings should be segmented with a slight sag, not one rigid cylinder')
}
if (!client.includes('function balloonBottom') || !client.includes('BALL_BOTTOM') || !client.includes('Vector3.rotate')) {
  fail('each string must meet the balloon nub, from the live transform and scale')
}
if (client.includes('const BALL_SCALE') && client.includes('y: 0.62')) {
  fail('balloons should read as round balloons, not stretched eggs')
}
if (!client.includes('setCylinder') || !client.includes('NUB_Y') || !client.includes('buildBalloonParts') || !client.includes('CHIN_Y')) {
  fail('balloons should be a slight egg with a blended taper and a small tied nub')
}
if (!client.includes('AIM_BLEND') || !client.includes('MAX_AIM_DEG') || !client.includes('AIM_TAU') || !client.includes('aimNub')) {
  fail('the nub should tilt along the string, smoothly and capped')
}
const bodyXz = Number((client.match(/const BODY_XZ = ([0-9.]+)/) || [])[1])
const bodyY = Number((client.match(/const BODY_Y = ([0-9.]+)/) || [])[1])
const aspect = bodyY / bodyXz
if (!(aspect >= 1.12 && aspect <= 1.18)) {
  fail(`balloon body should be a mild egg (1.12–1.18 tall), got ${aspect.toFixed(3)}`)
}

console.log('✓ balloon start, pop, eliminate, last standing, and no paint')