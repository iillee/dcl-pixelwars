/**
 * Lobby layout and vote rules. Run: npx tsx scripts/verify-lobby.ts
 */
import { readFileSync } from 'node:fs'
import { clearLobbyVotes, countedMode, lobbyVerdict, noteLobbyPos, stepLobby, tallyVotes } from '../src/server/lobbyVote'
import { CELL, BASE_Y, MAZE_ORIGIN, baseSpawn, placeLobbyLayout, validate, getPlacedTilesInOrder } from '../src/maze/generator'
import { openingsAt } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import {
  LOBBY_AFK_MS, LOBBY_CROSS, LOBBY_MODES, LOBBY_MOVE_M, LOBBY_VOTE_MS, MODE_PILL_HEX, SIGN_CAMERA_AXIS, SIGN_CLEAR_M, SIGN_H_M, SIGN_LIP_DEPTH_M, SIGN_LIP_Z, SIGN_ORTHO_AT_REF, SIGN_PLATE_DEPTH_M, SIGN_W_M, SIGN_ZOOM_MAX, SIGN_ZOOM_MIN, SIGN_ZOOM_REF, emptyCounts, everyPresentInZone, rgbFromHex,
  billboardAnchor, earlySpawnPads, hudVoteHeadline, lobbyFeet, modeSubtitle, modeTitle, padContains, pickWinner, placedModes, signBadgeY, signFaceZ, signZoomScale, stillAfk, toSceneFeet, voteLocalToWorld, voteModeAt, voteTintPose, voteZoneLocal,
} from '../src/shared/lobby'
import { PVB_BOT_MAX, PVB_RATIO, pvbBotCount } from '../src/shared/pvp'

const tiles = placeLobbyLayout()
if (tiles.length !== 5) {
  console.error(`✗ lobby should be 5 tiles, got ${tiles.length}`)
  process.exit(1)
}
if (LOBBY_MODES.length !== 7 || !LOBBY_MODES.some(m => m.id === 'garden') || !LOBBY_MODES.some(m => m.id === 'pots') || !LOBBY_MODES.some(m => m.id === 'prototype') || !LOBBY_MODES.some(m => m.id === 'balloon') || !LOBBY_MODES.some(m => m.id === 'bases') || !LOBBY_MODES.some(m => m.id === 'pvb')) {
  console.error('✗ Color Garden, Pot Hunt, Prototype, Balloon Battle, Bases, and Bot Invasion must stay in the registry')
  process.exit(1)
}
if (placedModes().map(m => m.id).join() !== 'pvp,bases,prototype,balloon') {
  console.error('✗ Pixelwars, Bases, Prototype, and Balloon Battle should be the placed ends')
  process.exit(1)
}
if (LOBBY_MODES.some(m => m.economy && m.id !== 'prototype') || !LOBBY_MODES.find(m => m.id === 'prototype')?.economy) {
  console.error('✗ the paint economy flag belongs only on Prototype')
  process.exit(1)
}
const cellKeys = LOBBY_MODES.map(m => `${m.cell.x},${m.cell.z}`)
if (new Set(cellKeys).size !== cellKeys.length) {
  console.error('✗ every mode in the registry needs its own cell')
  process.exit(1)
}
const balloonMode = LOBBY_MODES.find(m => m.id === 'balloon')!
if (!balloonMode.live || !balloonMode.placed || balloonMode.economy || balloonMode.teamRule !== 'balance' || balloonMode.cell.x !== 2 || balloonMode.cell.z !== 1 || balloonMode.label !== 'BALLOON BATTLE') {
  console.error('✗ Balloon Battle should be a live south end with team balance and no paint economy')
  process.exit(1)
}
const expectedHex: Record<'pvp' | 'bases' | 'prototype' | 'balloon', string> = {
  pvp: '#FF7577',
  bases: '#6A99FC',
  prototype: '#FFE04A',
  balloon: '#4FD68C',
}
if (MODE_PILL_HEX.pvp !== expectedHex.pvp || MODE_PILL_HEX.bases !== expectedHex.bases || MODE_PILL_HEX.pvb !== expectedHex.bases || MODE_PILL_HEX.prototype !== expectedHex.prototype || MODE_PILL_HEX.balloon !== expectedHex.balloon) {
  console.error(`✗ lobby pill hexes should be Classic #FF7577, Base Charge #6A99FC, Paint Limit #FFE04A, Balloon Battle #4FD68C, got ${JSON.stringify(MODE_PILL_HEX)}`)
  process.exit(1)
}
for (const id of ['pvp', 'bases', 'prototype', 'balloon'] as const) {
  const got = LOBBY_MODES.find(m => m.id === id)!.color
  const want = rgbFromHex(expectedHex[id])
  if (Math.abs(got.r - want.r) > 1e-9 || Math.abs(got.g - want.g) > 1e-9 || Math.abs(got.b - want.b) > 1e-9) {
    console.error(`✗ ${id} should use ${expectedHex[id]}, got ${got.r},${got.g},${got.b}`)
    process.exit(1)
  }
}
if (!validate()) {
  console.error('✗ lobby openings do not connect')
  process.exit(1)
}
const center = tiles[0]
if (center.type !== 'cross' || center.x !== LOBBY_CROSS.x || center.z !== LOBBY_CROSS.z) {
  console.error('✗ the center should be the first tile, a cross opening all four ways')
  process.exit(1)
}
const centerOpen = openingsAt('cross', center.r)
if (!centerOpen.has(0) || !centerOpen.has(1) || !centerOpen.has(2) || !centerOpen.has(3)) {
  console.error('✗ the center cross should open north, east, south, and west')
  process.exit(1)
}
const ends = getPlacedTilesInOrder().filter(t => t.type === 'end')
if (ends.length !== 4) {
  console.error(`✗ expected 4 end tiles, got ${ends.length}`)
  process.exit(1)
}
for (const m of LOBBY_MODES) {
  const end = ends.find(t => t.x === m.cell.x && t.z === m.cell.z)
  if (!m.placed) {
    if (end) {
      console.error(`✗ ${m.id} should not be built`)
      process.exit(1)
    }
    const midX = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
    const midZ = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
    if (voteModeAt(midX, midZ, MAZE_ORIGIN, CELL) !== '') {
      console.error(`✗ ${m.id} still votes`)
      process.exit(1)
    }
    continue
  }
  if (!end) {
    console.error(`✗ ${m.id} has no end tile`)
    process.exit(1)
  }
  const dx = LOBBY_CROSS.x - end.x
  const dz = LOBBY_CROSS.z - end.z
  if (Math.abs(dx) + Math.abs(dz) !== 1) {
    console.error(`✗ ${m.id} is not next to the cross`)
    process.exit(1)
  }
  const toward = dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 0 : 2
  if (!openingsAt('end', end.r).has(toward as 0 | 1 | 2 | 3)) {
    console.error(`✗ ${m.id} does not open toward the cross`)
    process.exit(1)
  }
  const midX = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const midZ = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  const got = voteModeAt(midX, midZ, MAZE_ORIGIN, CELL)
  const want = m.live ? m.id : ''
  if (got !== want) {
    console.error(`✗ ${m.id} center votes as '${got}', want '${want}'`)
    process.exit(1)
  }
}
const hold = earlySpawnPads(MAZE_ORIGIN, CELL, BASE_Y, [baseSpawn(1).pos, baseSpawn(2).pos])
if (hold.length !== 6) {
  console.error(`✗ expected base, base, cross, bases, prototype, and balloon pads, got ${hold.length}`)
  process.exit(1)
}
const slab = BASE_Y + 0.5
for (const p of hold) {
  if (Math.abs(p.y + p.sy / 2 - slab) > 0.001) {
    console.error('✗ a spawn pad top is not the walkable slab')
    process.exit(1)
  }
}
const forkFeet = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
if (!padContains(hold[2], forkFeet.x, forkFeet.z) || hold[2].sx !== 16) {
  console.error('✗ the cross pad does not cover the lobby spawn')
  process.exit(1)
}
for (const team of [1, 2]) {
  const s = baseSpawn(team).pos
  if (!padContains(hold[team - 1], s.x, s.z) || hold[team - 1].sx !== 16) {
    console.error(`✗ team ${team} base pad moved`)
    process.exit(1)
  }
}
const protoMode = LOBBY_MODES.find(m => m.id === 'prototype')!
const protoZone = voteZoneLocal(CELL)
const protoDoor = voteLocalToWorld((protoZone.x0 + protoZone.x1) / 2, protoZone.z1, protoMode.cell, MAZE_ORIGIN, CELL)
const protoCap = voteLocalToWorld((protoZone.x0 + protoZone.x1) / 2, protoZone.z0, protoMode.cell, MAZE_ORIGIN, CELL)
const protoStand = voteTintPose(protoMode.cell, MAZE_ORIGIN, CELL)
const basesPad = hold[3]
const protoPad = hold[4]
const balloonPad = hold[5]
const basesMode = LOBBY_MODES.find(m => m.id === 'bases')!
const basesZone = voteZoneLocal(CELL)
const basesDoor = voteLocalToWorld((basesZone.x0 + basesZone.x1) / 2, basesZone.z1, basesMode.cell, MAZE_ORIGIN, CELL)
const basesCap = voteLocalToWorld((basesZone.x0 + basesZone.x1) / 2, basesZone.z0, basesMode.cell, MAZE_ORIGIN, CELL)
const basesStand = voteTintPose(basesMode.cell, MAZE_ORIGIN, CELL)
if (!padContains(basesPad, basesStand.x, basesStand.z) || !padContains(basesPad, basesDoor.x, basesDoor.z) || !padContains(basesPad, basesCap.x, basesCap.z)) {
  console.error('✗ the bases pad does not cover the east vote floor')
  process.exit(1)
}
if (!padContains(protoPad, protoStand.x, protoStand.z) || !padContains(protoPad, protoDoor.x, protoDoor.z) || !padContains(protoPad, protoCap.x, protoCap.z)) {
  console.error('✗ the prototype pad does not cover the north vote floor')
  process.exit(1)
}
const teamFight = voteTintPose(LOBBY_MODES.find(m => m.id === 'pvp')!.cell, MAZE_ORIGIN, CELL)
if (padContains(protoPad, teamFight.x, teamFight.z) || padContains(hold[2], teamFight.x, teamFight.z) || padContains(balloonPad, teamFight.x, teamFight.z)) {
  console.error('✗ a prototype, balloon, or cross pad reaches the Team Fight tile')
  process.exit(1)
}
const balloonZone = voteZoneLocal(CELL)
const balloonDoor = voteLocalToWorld((balloonZone.x0 + balloonZone.x1) / 2, balloonZone.z1, balloonMode.cell, MAZE_ORIGIN, CELL)
const balloonCap = voteLocalToWorld((balloonZone.x0 + balloonZone.x1) / 2, balloonZone.z0, balloonMode.cell, MAZE_ORIGIN, CELL)
const balloonStand = voteTintPose(balloonMode.cell, MAZE_ORIGIN, CELL)
if (!padContains(balloonPad, balloonStand.x, balloonStand.z) || !padContains(balloonPad, balloonDoor.x, balloonDoor.z) || !padContains(balloonPad, balloonCap.x, balloonCap.z)) {
  console.error('✗ the balloon pad does not cover the south vote floor')
  process.exit(1)
}
if (padContains(hold[2], balloonStand.x, balloonStand.z) || padContains(protoPad, balloonStand.x, balloonStand.z) || padContains(balloonPad, protoStand.x, protoStand.z) || padContains(balloonPad, forkFeet.x, forkFeet.z)) {
  console.error('✗ the south or north pad reaches the other lobby floors')
  process.exit(1)
}
function checkFrame(label: string, sceneM: number, origin: number, baseMeters: number): void {
  for (const m of LOBBY_MODES) {
    const sx = m.cell.x * 32 + 16 + origin
    const sz = m.cell.z * 32 + 16 + origin
    const scene = toSceneFeet(sx, sz, sceneM, origin, 32, baseMeters)
    const world = toSceneFeet(sx + baseMeters, sz + baseMeters, sceneM, origin, 32, baseMeters)
    if (scene.frame !== 'scene' || world.frame !== 'world') {
      console.error(`✗ ${label} ${m.id} frame scene=${scene.frame} world=${world.frame}`)
      process.exit(1)
    }
    const want = m.live ? m.id : ''
    if (voteModeAt(scene.x, scene.z, origin, 32) !== want || voteModeAt(world.x, world.z, origin, 32) !== want) {
      console.error(`✗ ${label} ${m.id} does not vote from both coordinate frames`)
      process.exit(1)
    }
    // The unconverted world point is NOT the scene cell. That miss is the full-world vote bug.
    if (m.live && voteModeAt(sx + baseMeters, sz + baseMeters, origin, 32) !== '') {
      console.error(`✗ ${label} ${m.id} world metres already voted before the frame conversion`)
      process.exit(1)
    }
  }
  const cx = 2 * 32 + 16 + origin
  const cross = toSceneFeet(cx + baseMeters, cx + baseMeters, sceneM, origin, 32, baseMeters)
  if (cross.frame !== 'world' || voteModeAt(cross.x, cross.z, origin, 32) !== '') {
    console.error(`✗ ${label} cross in world metres should abstain`)
    process.exit(1)
  }
}
checkFrame('small', 320, 80, -10 * 16)
checkFrame('fifty', 50 * 16, (50 * 16 - 160) / 2, -25 * 16)
checkFrame('medium', 64 * 16, (64 * 16 - 160) / 2, -32 * 16)
checkFrame('eighty', 80 * 16, (80 * 16 - 160) / 2, -40 * 16)
checkFrame('large', 100 * 16, (100 * 16 - 160) / 2, -50 * 16)
checkFrame('full', 4800, 2320, -150 * 16)

// The server path: a stored sample scores only for ids the tick considers present.
const now = 1_700_000_000_000
for (const m of LOBBY_MODES.filter(x => x.live)) {
  const sx = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const sz = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  clearLobbyVotes()
  if (!noteLobbyPos('player', sx, 190, sz, now)) {
    console.error(`✗ server rejected a scene-local ${m.id} sample`)
    process.exit(1)
  }
  const scored = tallyVotes(['player'], now)
  if (scored.counts[m.id] !== 1) {
    console.error(`✗ server tally missed scene-local ${m.id}`)
    process.exit(1)
  }
  // The sample itself is the vote. An empty present list must not hide it.
  const fromSample = tallyVotes([], now)
  if (fromSample.counts[m.id] !== 1) {
    console.error(`✗ a stored ${m.id} sample was dropped with nobody in presentIds`)
    process.exit(1)
  }
}
clearLobbyVotes()

// Same stand as Luke's west-end sample: 4 m east and 2 m south of that cell's centre.
const lukeAt = 1_700_000_000_000
const lukeX = 1 * CELL + CELL / 2 + MAZE_ORIGIN + 4
const lukeZ = 2 * CELL + CELL / 2 + MAZE_ORIGIN - 2
if (voteModeAt(lukeX, lukeZ, MAZE_ORIGIN, CELL) !== 'pvp') {
  console.error(`✗ ${lukeX},${lukeZ} must be the west PvP end`)
  process.exit(1)
}
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, lukeAt)) {
  console.error('✗ server rejected the west-end sample')
  process.exit(1)
}
const aged = lukeAt + 2_000 // past the old 1.5 s freshness window
const mismatch = tallyVotes(['0xabc'], aged)
if (mismatch.counts.pvp !== 1) {
  console.error(`✗ west-end sample 2s old under a different id case scored pvp ${mismatch.counts.pvp}`)
  process.exit(1)
}
const verdict = lobbyVerdict(['0xabc'], aged)
if (verdict.zone !== 'pvp' || verdict.why !== 'ok') {
  console.error(`✗ verdict zone=${verdict.zone} why=${verdict.why}, want pvp / ok`)
  process.exit(1)
}
const split = lobbyVerdict(['peer-1'], aged)
if (split.counts.pvp !== 1 || split.why !== 'ok-id') {
  console.error(`✗ sample under a different id was dropped (pvp ${split.counts.pvp} why ${split.why})`)
  process.exit(1)
}
const clock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: lukeAt, emptySince: 0 }
const step = stepLobby(clock, ['0xabc'], aged)
if (step.log !== 'start' || step.next.countdownEnds !== aged + LOBBY_VOTE_MS) {
  console.error(`✗ idle phase with this sample did not start the ${LOBBY_VOTE_MS}ms countdown (${step.log} ends ${step.next.countdownEnds})`)
  process.exit(1)
}
if (LOBBY_VOTE_MS !== 10_000) {
  console.error(`✗ the vote window should be 10s, got ${LOBBY_VOTE_MS}ms`)
  process.exit(1)
}
if (hudVoteHeadline(false) !== 'CHOOSE A GAME MODE' || hudVoteHeadline(true) !== 'STARTING SOON' || hudVoteHeadline(false, 5) !== 'STARTING IN 5' || hudVoteHeadline(true, 10) !== 'STARTING IN 10') {
  console.error(`✗ the top lobby line should read CHOOSE A GAME MODE, then STARTING IN N when the countdown is running (${hudVoteHeadline(false)} / ${hudVoteHeadline(true)} / ${hudVoteHeadline(true, 5)})`)
  process.exit(1)
}
if (PVB_RATIO !== 2 || pvbBotCount(1) !== 2 || pvbBotCount(2) !== 4 || pvbBotCount(7) !== 14 || pvbBotCount(8) !== PVB_BOT_MAX || pvbBotCount(0) !== 0) {
  console.error(`✗ Bot Invasion should be 2× humans, capped at ${PVB_BOT_MAX}: 1→${pvbBotCount(1)} 2→${pvbBotCount(2)} 7→${pvbBotCount(7)} 8→${pvbBotCount(8)}`)
  process.exit(1)
}
const early = stepLobby(step.next, ['0xabc'], aged + 5_000)
if (early.log !== '' || early.next.countdownEnds !== step.next.countdownEnds) {
  console.error(`✗ the vote closed before ${LOBBY_VOTE_MS}ms (${early.log})`)
  process.exit(1)
}
const done = stepLobby(step.next, ['0xabc'], aged + LOBBY_VOTE_MS)
if (done.log !== 'resolve') {
  console.error(`✗ the vote did not resolve at ${LOBBY_VOTE_MS}ms (${done.log})`)
  process.exit(1)
}
clearLobbyVotes()
const held = stepLobby({ wantFull: true, countdownEnds: 0, hadVotes: false, readyAt: aged - 3_000, emptySince: 0 }, ['0xabc'], aged)
if (held.log !== '' || held.next.countdownEnds !== 0) {
  console.error(`✗ a lobby with nobody voting started a countdown (${held.log})`)
  process.exit(1)
}
clearLobbyVotes()
const protoX = 2 * CELL + CELL / 2 + MAZE_ORIGIN
const protoZ = 3 * CELL + CELL / 2 + MAZE_ORIGIN
if (voteModeAt(protoX, protoZ, MAZE_ORIGIN, CELL) !== 'prototype') {
  console.error(`✗ ${protoX},${protoZ} must be the north Prototype end`)
  process.exit(1)
}
if (!noteLobbyPos('proto', protoX, 190, protoZ, aged)) {
  console.error('✗ server rejected the Prototype sample')
  process.exit(1)
}
if (countedMode('proto', aged) !== 'prototype') {
  console.error('✗ standing on Prototype was not counted as that vote')
  process.exit(1)
}
const protoClock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: lukeAt, emptySince: 0 }
const protoStep = stepLobby(protoClock, ['proto'], aged)
if (protoStep.log !== 'start' || protoStep.next.countdownEnds !== aged + LOBBY_VOTE_MS) {
  console.error(`✗ a Prototype vote did not start the ${LOBBY_VOTE_MS}ms countdown (${protoStep.log})`)
  process.exit(1)
}
const protoTallied = tallyVotes(['proto'], aged)
if (protoTallied.counts.prototype !== 1 || protoTallied.counts.pvp !== 0 || protoTallied.counts.pvb !== 0 || protoTallied.counts.balloon !== 0) {
  console.error(`✗ Prototype tally leaked into the other modes (${protoTallied.counts.pvp}/${protoTallied.counts.pvb}/${protoTallied.counts.prototype})`)
  process.exit(1)
}
const protoDone = stepLobby(protoStep.next, ['proto'], aged + LOBBY_VOTE_MS)
if (protoDone.log !== 'resolve' || pickWinner(protoTallied.counts, 'pvp') !== 'prototype') {
  console.error(`✗ a Prototype vote did not launch a Prototype round (${protoDone.log})`)
  process.exit(1)
}
clearLobbyVotes()
const balloonX = 2 * CELL + CELL / 2 + MAZE_ORIGIN
const balloonZ = 1 * CELL + CELL / 2 + MAZE_ORIGIN
if (voteModeAt(balloonX, balloonZ, MAZE_ORIGIN, CELL) !== 'balloon') {
  console.error(`✗ ${balloonX},${balloonZ} must be the south Balloon Battle end`)
  process.exit(1)
}
if (!noteLobbyPos('balloon', balloonX, 190, balloonZ, aged)) {
  console.error('✗ server rejected the Balloon Battle sample')
  process.exit(1)
}
if (countedMode('balloon', aged) !== 'balloon') {
  console.error('✗ standing on Balloon Battle was not counted as that vote')
  process.exit(1)
}
const balloonClock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: lukeAt, emptySince: 0 }
const balloonStep = stepLobby(balloonClock, ['balloon'], aged)
if (balloonStep.log !== 'start' || balloonStep.next.countdownEnds !== aged + LOBBY_VOTE_MS) {
  console.error(`✗ a Balloon Battle vote did not start the ${LOBBY_VOTE_MS}ms countdown (${balloonStep.log})`)
  process.exit(1)
}
const balloonTallied = tallyVotes(['balloon'], aged)
if (balloonTallied.counts.balloon !== 1 || balloonTallied.counts.pvp !== 0 || balloonTallied.counts.pvb !== 0 || balloonTallied.counts.prototype !== 0) {
  console.error(`✗ Balloon Battle tally leaked into the other modes (${balloonTallied.counts.pvp}/${balloonTallied.counts.pvb}/${balloonTallied.counts.prototype}/${balloonTallied.counts.balloon})`)
  process.exit(1)
}
const balloonDone = stepLobby(balloonStep.next, ['balloon'], aged + LOBBY_VOTE_MS)
if (balloonDone.log !== 'resolve' || pickWinner(balloonTallied.counts, 'pvp') !== 'balloon') {
  console.error(`✗ a Balloon Battle vote did not launch a Balloon Battle round (${balloonDone.log})`)
  process.exit(1)
}
clearLobbyVotes()
const zone = voteZoneLocal(CELL)
const pvpCell = LOBBY_MODES.find(m => m.id === 'pvp')!.cell
const onTint = voteLocalToWorld(zone.x0 + 0.05, zone.z0 + 0.05, pvpCell, MAZE_ORIGIN, CELL)
const offTint = voteLocalToWorld(zone.x0 - 0.25, (zone.z0 + zone.z1) / 2, pvpCell, MAZE_ORIGIN, CELL)
if (voteModeAt(onTint.x, onTint.z, MAZE_ORIGIN, CELL) !== 'pvp') {
  console.error('✗ the inner edge of the tint does not count as PvP')
  process.exit(1)
}
if (voteModeAt(offTint.x, offTint.z, MAZE_ORIGIN, CELL) !== '') {
  console.error('✗ a point just outside the tint still counts as a vote')
  process.exit(1)
}
const expectW = CELL * (20 / 32) - 0.3
const expectL = CELL - CELL * (6 / 32) - 0.3
if (Math.abs(zone.width - expectW) > 0.001 || Math.abs(zone.length - expectL) > 0.001) {
  console.error(`✗ tint is ${zone.width.toFixed(2)}×${zone.length.toFixed(2)}, want ${expectW.toFixed(2)}×${expectL.toFixed(2)}`)
  process.exit(1)
}
for (const m of placedModes()) {
  const sign = billboardAnchor(m.cell, MAZE_ORIGIN, CELL, 0)
  const midX = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const midZ = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  if (m.cell.x !== LOBBY_CROSS.x) {
    const edge = m.cell.x * CELL + (m.cell.x < LOBBY_CROSS.x ? 0 : CELL) + MAZE_ORIGIN
    const outside = m.cell.x < LOBBY_CROSS.x ? sign.x < edge - SIGN_CLEAR_M + 0.01 : sign.x > edge + SIGN_CLEAR_M - 0.01
    if (!outside || Math.abs(sign.z - midZ) > 0.01) {
      console.error(`✗ ${m.id} billboard is not on the outer side of its tile`)
      process.exit(1)
    }
  } else {
    const edge = m.cell.z * CELL + (m.cell.z < LOBBY_CROSS.z ? 0 : CELL) + MAZE_ORIGIN
    const outside = m.cell.z < LOBBY_CROSS.z ? sign.z < edge - SIGN_CLEAR_M + 0.01 : sign.z > edge + SIGN_CLEAR_M - 0.01
    if (!outside || Math.abs(sign.x - midX) > 0.01) {
      console.error(`✗ ${m.id} billboard is not on the outer side of its tile`)
      process.exit(1)
    }
  }
}
// Still standing on the same tile a minute later. That is a vote, not AFK.
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, lukeAt + 61_000)) {
  console.error('✗ standing still on the end tile was rate-limited')
  process.exit(1)
}
if (tallyVotes(['0xabc'], lukeAt + 61_000).counts.pvp !== 1) {
  console.error('✗ standing still on the west end dropped the vote')
  process.exit(1)
}
clearLobbyVotes()

const lobbySrc = readFileSync(new URL('../src/client/lobby.ts', import.meta.url), 'utf8')
if (lobbySrc.includes('!isLobbyLayout() || !inLobby()')) {
  console.error('✗ feet reports must not wait on the lobby layout flag')
  process.exit(1)
}
if (!lobbySrc.includes('if (tints.length === 0) laySigns()') || !lobbySrc.includes("layout === 'arena'") || !lobbySrc.includes('else laySigns()')) {
  console.error('✗ signs must be relaid whenever the lobby floor is up, including after a match returns to the lobby')
  process.exit(1)
}
if (lobbySrc.includes('SECS_FONT') || lobbySrc.includes('`${left}s`')) {
  console.error('✗ billboards should keep the vote count and drop the countdown')
  process.exit(1)
}
const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (uiSrc.includes('hudVoteCountdown') || uiSrc.includes('voteSecs') || uiSrc.includes('fontSize={78}')) {
  console.error('✗ the lobby countdown should live in the top headline, not as a second line under the pill')
  process.exit(1)
}
if (!lobbySrc.includes('STARTING IN') && !readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8').includes('STARTING IN')) {
  console.error('✗ the top lobby line should show STARTING IN N during the vote countdown')
  process.exit(1)
}
if (uiSrc.includes('hudYourVote') || lobbySrc.includes('Your vote:')) {
  console.error('✗ the vote pill should not name the player\'s vote')
  process.exit(1)
}
if (lobbySrc.includes('emissiveIntensity: glow') || !/emissiveIntensity: 0,/.test(lobbySrc) || !lobbySrc.includes('MTM_OPAQUE')) {
  console.error('✗ the vote tint should stay matte and opaque so the white floor does not wash it out')
  process.exit(1)
}
if (
  lobbySrc.includes('const FLOOR_LIT_LIFT') ||
  lobbySrc.includes('function litPlate') ||
  lobbySrc.includes('litPlate(copy.plate)') ||
  !lobbySrc.includes('Material.setBasicMaterial') ||
  !lobbySrc.includes('Color4.fromHexString') ||
  !/function plateMat[\s\S]{0,250}diffuseColor/.test(lobbySrc) ||
  /function plateMat[\s\S]{0,250}emissiveIntensity/.test(lobbySrc) ||
  !/function plateMat[\s\S]{0,250}, 1\)/.test(lobbySrc)
) {
  console.error('✗ lobby billboard plates should be unlit, fully opaque, and use the exact pill hex with no floor-light lift')
  process.exit(1)
}
if (lobbySrc.includes('setBox(tail)') || lobbySrc.includes('signCaretSize') || lobbySrc.includes('orthoSignPoses')) {
  console.error('✗ signs should have no caret, and overview signs should stay on their anchors')
  process.exit(1)
}
if (!lobbySrc.includes('BillboardMode.BM_Y') || !lobbySrc.includes('BillboardMode.BM_NONE') || !lobbySrc.includes('overviewSignRotation')) {
  console.error('✗ signs should yaw in play, and copy the overview camera rotation so they stay parallel')
  process.exit(1)
}
if (!lobbySrc.includes('roughness: 1') || !lobbySrc.includes('specularIntensity: 0') || !lobbySrc.includes('metallic: 0')) {
  console.error('✗ vote floor tints should stay matte PBR')
  process.exit(1)
}
if (
  !lobbySrc.includes('TILE_FRAME_M') ||
  !lobbySrc.includes('function layTileFrame') ||
  !lobbySrc.includes('layTileFrame(tint)') ||
  !lobbySrc.includes('Material.setBasicMaterial(e, frameMat())') ||
  lobbySrc.split('addBar(').length - 1 < 4 ||
  !lobbySrc.includes('Color4.create(0, 0, 0, 1)')
) {
  console.error('✗ every activation tile should have an unlit black frame on all four sides')
  process.exit(1)
}
const frameW = Number((lobbySrc.match(/const TILE_FRAME_M = ([0-9.]+)/) || [])[1])
const frameH = Number((lobbySrc.match(/const TILE_FRAME_H = ([0-9.]+)/) || [])[1])
if (!(frameW > 0) || frameW > 0.1 || !(frameH > 0) || frameH > 0.04) {
  console.error(`✗ tile frames should be a thin low bar (about 0.07 × 0.024), got ${frameW} × ${frameH}`)
  process.exit(1)
}
const tickTintsFn = (lobbySrc.match(/function tickTints[\s\S]*?^function /m) || [''])[0]
if (tickTintsFn.includes('layTileFrame') || tickTintsFn.includes('TILE_FRAME') || tickTintsFn.includes('frameRoot')) {
  console.error('✗ the tile frame should stay visible, not be scaled away with the vote tint')
  process.exit(1)
}
if (!lobbySrc.includes('TITLE_FONT = 45') || !lobbySrc.includes('signFaceZ()') || lobbySrc.includes('outlineColor:') || !lobbySrc.includes('outlineWidth: 0') || lobbySrc.includes('outlineWidth: 0.2') || lobbySrc.includes('modeTitleLines') || lobbySrc.includes('overviewSignScale()') === false) {
  console.error('✗ titles should be one 4.5 m line of unoutlined white text, and scale with the overview zoom')
  process.exit(1)
}
if (SIGN_W_M < 40 || SIGN_H_M > 12) {
  console.error(`✗ plate should be a wide single-line pill, got ${SIGN_W_M}×${SIGN_H_M}`)
  process.exit(1)
}
const atRef = signZoomScale(SIGN_ZOOM_REF)
if (Math.abs(atRef - SIGN_ORTHO_AT_REF) > 1e-6 || atRef > 0.4 || atRef < 0.25) {
  console.error(`✗ default overview zoom should shrink the sign to ~0.3×, got ${atRef}`)
  process.exit(1)
}
const zoomIn = signZoomScale(7)
if (Math.abs(zoomIn - SIGN_ORTHO_AT_REF * (7 / SIGN_ZOOM_REF)) > 1e-6 || !(zoomIn < atRef)) {
  console.error(`✗ zooming in should scale linearly below the default, got ${zoomIn}`)
  process.exit(1)
}
if (signZoomScale(1) < SIGN_ZOOM_MIN - 1e-6 || signZoomScale(1) > SIGN_ZOOM_MIN + 1e-6) {
  console.error('✗ a very close overview should sit on the scale floor')
  process.exit(1)
}
if (signZoomScale(500) > SIGN_ZOOM_MAX + 1e-6 || signZoomScale(500) < SIGN_ZOOM_MAX - 1e-6) {
  console.error('✗ a very far overview should sit on the scale ceiling')
  process.exit(1)
}
const face = signFaceZ()
const plateNear = SIGN_CAMERA_AXIS * (SIGN_PLATE_DEPTH_M / 2)
const lipNear = SIGN_LIP_Z + SIGN_CAMERA_AXIS * (SIGN_LIP_DEPTH_M / 2)
if ((lipNear - plateNear) * SIGN_CAMERA_AXIS >= -1e-6) {
  console.error('✗ the dark lip covers the colored plate; it must sit behind so the true hex shows')
  process.exit(1)
}
const slabNear = SIGN_CAMERA_AXIS < 0 ? Math.min(plateNear, lipNear) : Math.max(plateNear, lipNear)
const inFront = (face - slabNear) * SIGN_CAMERA_AXIS
if (inFront < 0.1) {
  console.error(`✗ sign text Z ${face.toFixed(2)} is not on the camera side of the plate (gap ${inFront.toFixed(2)} m)`)
  process.exit(1)
}
if (modeTitle('pvb') !== 'BOT INVASION' || modeTitle('pvp') !== 'PIXELWARS' || modeSubtitle('pvb') !== 'vs Bots' || modeSubtitle('pvp') !== 'Classic') {
  console.error('✗ lobby choices should read BOT INVASION and PIXELWARS / Classic')
  process.exit(1)
}
const lipBottom = -(SIGN_H_M + 0.55) / 2
const chipTop = signBadgeY() + 3.4 / 2
if (!(chipTop < lipBottom - 0.2) || !(chipTop > lipBottom - 1.2)) {
  console.error('✗ the vote count chip should sit just under the pill')
  process.exit(1)
}
if (modeTitle('prototype') !== 'PAINT LIMIT' || modeSubtitle('prototype') !== 'Prototype') {
  console.error('✗ the north mode should read PAINT LIMIT / Prototype')
  process.exit(1)
}
if (modeTitle('balloon') !== 'BALLOON BATTLE' || modeSubtitle('balloon') !== 'Prototype') {
  console.error('✗ Balloon Battle should read BALLOON BATTLE / Prototype')
  process.exit(1)
}
if (modeTitle('bases') !== 'BASE CHARGE' || modeSubtitle('bases') !== 'Prototype') {
  console.error('✗ the east mode should read BASE CHARGE / Prototype')
  process.exit(1)
}
const proto = LOBBY_MODES.find(m => m.id === 'prototype')!
const protoSign = billboardAnchor(proto.cell, MAZE_ORIGIN, CELL, BASE_Y)
const northEdge = proto.cell.z * CELL + CELL + MAZE_ORIGIN
if (Math.abs(protoSign.z - (northEdge + SIGN_CLEAR_M)) > 0.01 || protoSign.y !== BASE_Y + 22) {
  console.error(`✗ Prototype sign should sit 10 m past the north edge at base+22, got ${protoSign.z}, ${protoSign.y}`)
  process.exit(1)
}
const balloonSign = billboardAnchor(balloonMode.cell, MAZE_ORIGIN, CELL, BASE_Y)
const southEdge = balloonMode.cell.z * CELL + MAZE_ORIGIN
if (Math.abs(balloonSign.z - (southEdge - SIGN_CLEAR_M)) > 0.01 || balloonSign.y !== BASE_Y + 22) {
  console.error(`✗ Balloon Battle sign should sit 10 m past the south edge at base+22, got ${balloonSign.z}, ${balloonSign.y}`)
  process.exit(1)
}
const signSpan = SIGN_W_M * SIGN_ORTHO_AT_REF / 2
if (Math.hypot(balloonSign.x - protoSign.x, balloonSign.z - protoSign.z) <= signSpan * 2) {
  console.error('✗ the south and north signs overlap in the default overview')
  process.exit(1)
}
const indexSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
if (!indexSrc.includes("rebuildMaze(1, 'lobby', 'boot')") || !indexSrc.includes('not rolling a local arena seed')) {
  console.error('✗ client boot should lay the lobby and not roll an arena seed over it')
  process.exit(1)
}

const feet = lobbyFeet(CELL, MAZE_ORIGIN, 0)
const abstain = voteModeAt(feet.x, feet.z, MAZE_ORIGIN, CELL)
if (abstain !== '') {
  console.error(`✗ the cross should abstain, got ${abstain}`)
  process.exit(1)
}
const floor = buildWalkableGraph(tiles)
let onFork = false
for (const id of floor.nodes) {
  const p = floor.worldPos.get(id)
  if (p && Math.hypot(p[0] - feet.x, p[2] - feet.z) <= 2) onFork = true
}
if (!onFork) {
  console.error('✗ the lobby spawn is not on the cross floor')
  process.exit(1)
}

const tied = emptyCounts()
tied.pvp = 2
tied.bases = 2
if (pickWinner(tied, 'bases') !== 'bases') {
  console.error('✗ a tie should keep the previous mode')
  process.exit(1)
}
if (pickWinner(tied, 'garden') !== 'pvp') {
  console.error('✗ a tie with a previous mode that is not tied should fall back to PvP')
  process.exit(1)
}
const none = emptyCounts()
if (pickWinner(none, 'bases') !== null) {
  console.error('✗ zero votes should not pick a winner')
  process.exit(1)
}
const lead = emptyCounts()
lead.bases = 3
lead.pvp = 1
if (pickWinner(lead, 'pvp') !== 'bases') {
  console.error('✗ the higher count should win')
  process.exit(1)
}
const parked = emptyCounts()
parked.pvb = 5
parked.pvp = 1
if (pickWinner(parked, 'pvp') !== 'pvp') {
  console.error('✗ parked Bot Invasion votes must not win')
  process.exit(1)
}
const protoLead = emptyCounts()
protoLead.prototype = 4
protoLead.pvp = 1
protoLead.bases = 2
if (pickWinner(protoLead, 'pvp') !== 'prototype') {
  console.error('✗ a Prototype lead should win the vote')
  process.exit(1)
}
const balloonLead = emptyCounts()
balloonLead.balloon = 3
balloonLead.pvp = 2
balloonLead.prototype = 2
if (pickWinner(balloonLead, 'pvp') !== 'balloon') {
  console.error('✗ a Balloon Battle lead should win the vote')
  process.exit(1)
}
const balloonTie = emptyCounts()
balloonTie.balloon = 2
balloonTie.pvp = 2
if (pickWinner(balloonTie, 'balloon') !== 'balloon') {
  console.error('✗ a tie should keep Balloon Battle when it was the previous mode')
  process.exit(1)
}
if (pickWinner(balloonTie, 'pvb') !== 'pvp') {
  console.error('✗ a balloon/pvp tie with a different previous mode should fall back to PvP')
  process.exit(1)
}
if (!stillAfk(0, LOBBY_AFK_MS) || stillAfk(0, LOBBY_AFK_MS - 1)) {
  console.error('✗ the AFK window should be 60 s')
  process.exit(1)
}
if (LOBBY_MOVE_M <= 0) {
  console.error('✗ movement that keeps a vote has to be a real step')
  process.exit(1)
}
if (!everyPresentInZone(['a', 'b'], new Set(['a', 'b'])) || everyPresentInZone(['a', 'b'], new Set(['a'])) || everyPresentInZone([], new Set())) {
  console.error('✗ early finish needs every present human in a live zone')
  process.exit(1)
}

const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
for (const name of ['paintTick', 'lungeHit', 'burstHit', 'dashHit', 'anvilHit', 'anvilPush', 'bombDrop', 'playerFell']) {
  const at = server.indexOf(`room.onMessage('${name}'`)
  if (at < 0) {
    console.error(`✗ missing handler ${name}`)
    process.exit(1)
  }
  const body = server.slice(at, at + 700)
  if (!body.includes('matchLive()')) {
    console.error(`✗ ${name} does not reject when the match is closed`)
    process.exit(1)
  }
}
if (!server.includes("layout: 'lobby'") || !server.includes('rebuildBotGraph')) {
  console.error('✗ lobby layout or the arena bot graph is missing')
  process.exit(1)
}
if (server.includes('summaryWait')) {
  console.error('✗ the win screen must not hold the arena; the lobby floor swaps when the round ends')
  process.exit(1)
}
if (!server.includes("room.send('roundEnded'") || !server.includes('openLobby(false)')) {
  console.error('✗ round end should announce the win and open the lobby in the same step')
  process.exit(1)
}
const lobbyFn = server.slice(server.indexOf('function openLobby'), server.indexOf('function closeCountdown'))
if (lobbyFn.includes('rebuildBotGraph') || lobbyFn.includes('anvilsMazeChanged')) {
  console.error('✗ the lobby regen must not rebuild the bot graph or reseat anvils')
  process.exit(1)
}
const rippleSrc = readFileSync(new URL('../src/client/burstRipple.ts', import.meta.url), 'utf8')
if (!rippleSrc.includes('graphLayout') || !rippleSrc.includes('isLobbyLayout()')) {
  console.error('✗ burst/dash tile effects must rebuild their walkable graph when the lobby floor returns')
  process.exit(1)
}
const roundSrc = readFileSync(new URL('../src/round.ts', import.meta.url), 'utf8')
if (!roundSrc.includes("gamePhase() === 'match'") || !roundSrc.includes('isBalloonRound')) {
  console.error('✗ the balloon white-effect override must end when the match ends')
  process.exit(1)
}
const rebuild = readFileSync(new URL('../src/maze/rebuild.ts', import.meta.url), 'utf8')
if (!rebuild.includes("events.emit('lobby:floor'")) {
  console.error('✗ the cross should signal before teardown')
  process.exit(1)
}
const spawn = rebuild.slice(rebuild.indexOf('function spawnTile'))
if (!spawn.includes("layoutKind !== 'lobby'") || !spawn.includes("layoutKind === 'arena' && isPersistentTile")) {
  console.error('✗ lobby tiles should skip paint masks and should not latch')
  process.exit(1)
}
if (!rebuild.includes('gridSize() === 5') || !rebuild.includes("p.type === 'end'")) {
  console.error('✗ the lobby rebuild should skip a 5-tile floor and queue only the growing end tiles')
  process.exit(1)
}
if (!rebuild.includes('holdSeed || layoutKind === \'lobby\'')) {
  console.error('✗ a maze seed can still replace the lobby')
  process.exit(1)
}
if (!rebuild.includes('applyServerWorld') || !rebuild.includes('isStaleWorld') || !rebuild.includes('flushTeardown')) {
  console.error('✗ clients must apply the server world and drop a stale match floor')
  process.exit(1)
}
const handler = readFileSync(new URL('../src/client/clientHandler.ts', import.meta.url), 'utf8')
if (!handler.includes('applyServerWorld') || handler.includes("rebuildMaze(idx || 1, 'arena', 'match-clock')")) {
  console.error('✗ a stale match clock must not rebuild the arena over the lobby')
  process.exit(1)
}
const msgs = readFileSync(new URL('../src/shared/messages.ts', import.meta.url), 'utf8')
if (!msgs.includes('layout: Schemas.String') || !msgs.includes('seq: Schemas.Int')) {
  console.error('✗ snapshot, clock, and reset must carry the server layout and seq')
  process.exit(1)
}
if (!server.includes('bumpWorld') || !server.includes('placeLobbyLayout()') || !server.includes('...worldFields()')) {
  console.error('✗ the server must author the floor and keep its grid on the lobby while voting')
  process.exit(1)
}
const rescue = readFileSync(new URL('../src/client/fallRescue.ts', import.meta.url), 'utf8')
if (!rescue.includes('isLobbyLayout()') || !rescue.includes('lobbyFeet')) {
  console.error('✗ fall rescue should return to the cross during the lobby')
  process.exit(1)
}
const phaseSrc = readFileSync(new URL('../src/client/phase.ts', import.meta.url), 'utf8')
if (!phaseSrc.includes("next === 'prototype'") || !phaseSrc.includes("next === 'balloon'") || !phaseSrc.includes("next === 'bases'")) {
  console.error('✗ Prototype, Balloon Battle, and Bases votes must not be dropped')
  process.exit(1)
}
if (handler.includes("format === 'pvb' ? 'pvb' : 'pvp'")) {
  console.error('✗ the client still collapses every format that is not Bot Fight into Team Fight')
  process.exit(1)
}
if (!server.includes("mode === 'prototype' ? 'prototype'") || server.includes("kind: 'prototype'")) {
  console.error('✗ Prototype should keep its format and use Team Fight population')
  process.exit(1)
}
if (!server.includes("mode === 'balloon' ? 'balloon'") || server.includes("kind: 'balloon'")) {
  console.error('✗ Balloon Battle should keep its format and use Team Fight population')
  process.exit(1)
}
if (!handler.includes("format === 'balloon'")) {
  console.error('✗ the client must keep Balloon Battle as its own wire format')
  process.exit(1)
}
if (!handler.includes("format === 'bases'")) {
  console.error('✗ the client must keep Bases as its own wire format')
  process.exit(1)
}
if (!server.includes("mode === 'bases' ? 'bases'")) {
  console.error('✗ Bases should keep its own round format')
  process.exit(1)
}
if (!server.includes("roundFormat !== 'pvb'")) {
  console.error('✗ Prototype should use the Team Fight rejoin flip')
  process.exit(1)
}

const nametags = readFileSync(new URL('../src/client/nametags.ts', import.meta.url), 'utf8')
if (!nametags.includes("events.on('lobby:floor'") || !nametags.includes('isLobbyLayout()') || !nametags.includes('clearNametags') || !nametags.includes('getEntitiesWith(AvatarNametag)')) {
  console.error('✗ team nametags should clear on the lobby floor, including leftover plates')
  process.exit(1)
}

console.log('✓ lobby layout, votes, and match gates')
