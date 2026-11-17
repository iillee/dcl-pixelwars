/**
 * Balloon Battle rules. Run: npx tsx scripts/verify-balloon.ts
 */
import { readFileSync } from 'node:fs'
import {
  BALLOON_REST_Y, BALLOON_SLOT_EASE_S, BALLOON_START, balloonOf, balloonRestSlots, balloonTimeout, dropParticipant, lastStanding,
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


const three = balloonRestSlots(3)
if (three.length !== 3 || three[0].x !== -0.58 || three[1].x !== 0 || three[2].x !== 0.58 || three[0].z !== -0.16 || three[1].z !== -0.5 || three[2].z !== -0.16) {
  fail(`3 balloons should keep the original fan, got ${JSON.stringify(three)}`)
}
if (three.some(s => s.y !== BALLOON_REST_Y)) fail('rest slots should sit at BALLOON_REST_Y')
const pair = balloonRestSlots(2)
if (pair.length !== 2 || pair[0].x !== -pair[1].x || pair[0].x >= 0 || pair[0].z !== pair[1].z || pair[0].x === 0) {
  fail(`2 balloons should be a symmetric pair around the midline, got ${JSON.stringify(pair)}`)
}
const one = balloonRestSlots(1)
if (one.length !== 1 || one[0].x !== 0 || one[0].z >= 0) {
  fail(`1 balloon should sit centered behind the player, got ${JSON.stringify(one)}`)
}
if (balloonRestSlots(0).length !== 0) fail('0 balloons should have no rest slots')
if (BALLOON_SLOT_EASE_S < 0.3 || BALLOON_SLOT_EASE_S > 0.5) {
  fail(`leftover balloons should ease into new slots in 0.3–0.5 s, got ${BALLOON_SLOT_EASE_S}`)
}

const client = readFileSync(new URL('../src/client/balloons.ts', import.meta.url), 'utf8')

if (!client.includes('balloonRestSlots') || !client.includes('function rehome') || !client.includes('tickHome') || !client.includes('BALLOON_SLOT_EASE_S')) {
  fail('leftover balloons must ease into balloonRestSlots for the live count, not keep their original fan slots')
}
if (client.includes('const SLOTS:') || client.includes('SLOTS[i')) {
  fail('client rest positions must come from the live count, not a fixed 3-slot fan')
}
if (!client.includes('rehome(c, false)') || !client.includes('tickHome(b, step)')) {
  fail('pops must re-center the leftover balloons, and the ease must run every tick')
}

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
if (!client.includes('setCylinder') || !client.includes('NUB_Y') || !client.includes('buildBalloonParts')) {
  fail('balloons should be a slight egg with a cone taper and a small tied nub')
}
if (client.includes('CHIN_Y') || client.includes('CHIN_XZ')) {
  fail('the balloon base should be a simple cone, not an extra rounded collar')
}
if (!server.includes('balloonBotIds()') || !server.includes('startingBalloons(ids)') || !server.includes('freezeBots(false); tickBots(0)')) {
  fail('Balloon Battle must fill bots, then seed 3 balloons for each human and bot, before freezing the pool')
}
if (!server.includes('for (const e of rosterEntries()) markActive(e.userId)')) {
  fail('connected lobby players must count as present so Balloon Battle can fill bots after a long vote')
}
if (!server.includes("key.startsWith('bot:')") || !server.includes('benchBot')) {
  fail('an eliminated bot must drop out of last-standing')
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
const neckXz = Number((client.match(/const NECK_XZ = ([0-9.]+)/) || [])[1])
const neckH = Number((client.match(/const NECK_H = ([0-9.]+)/) || [])[1])
const neckTuck = Number((client.match(/const NECK_TUCK = ([0-9.]+)/) || [])[1])
if (!(neckXz > 0) || neckXz * 2 > bodyXz * 0.32) {
  fail(`balloon cone top should be well inside the egg (~25–30% of body width), got diameter ${(neckXz * 2).toFixed(3)} vs body ${bodyXz}`)
}
if (!(neckH > 0) || !(neckTuck > 0) || neckTuck < neckH * 0.5) {
  fail('the balloon cone should be tucked up into the egg so only a short tip shows')
}

const nametags = readFileSync(new URL('../src/client/nametags.ts', import.meta.url), 'utf8')
const bots = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
if (!nametags.includes("format === 'balloon'") || !nametags.includes('balloonMode') || !nametags.includes("events.on('round:reset'") || !nametags.includes("events.on('round:clock'")) {
  fail('Balloon Battle should clear team nametags at round start, including a late join')
}
if (!nametags.includes('teamPlatesHidden') || !bots.includes('teamPlatesHidden') || !bots.includes('AvatarNametag.deleteFrom')) {
  fail('Balloon Battle should not put RED/BLUE nametag plates on players or bots')
}

console.log('✓ balloon start, pop, eliminate, last standing, re-center slots, and no paint')