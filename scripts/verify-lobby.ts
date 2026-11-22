/**
 * Lobby layout and vote rules. Run: npx tsx scripts/verify-lobby.ts
 */
import { readFileSync } from 'node:fs'
import { clearLobbyVotes, countedTeam, everyoneStandingReady, lobbyVerdict, noteLobbyPos, occupancyTeams, stepLobby, tallyTeams, tallyVotes } from '../src/server/lobbyVote'
import { CELL, BASE_Y, MAZE_ORIGIN, baseSpawn, placeLobbyLayout, validate, getPlacedTilesInOrder } from '../src/maze/generator'
import { openingsAt } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import {
  LOBBY_AFK_MS, LOBBY_CROSS, LOBBY_MODES, LOBBY_MOVE_M, LOBBY_READY_MS, LOBBY_TEAMS, LOBBY_VOTE_MS, MODE_PILL_HEX, MODE_PILL_TEXT_HEX, SIGN_BADGE_H_M, SIGN_CAMERA_AXIS, SIGN_CLEAR_M, SIGN_H_M, SIGN_LIP_DEPTH_M, SIGN_LIP_PAD_H, SIGN_LIP_PAD_W, SIGN_LIP_Z, SIGN_COUNT_FONT, SIGN_LIFT_M, SIGN_ORTHO_AT_REF, SIGN_PLATE_DEPTH_M, SIGN_REF_W_M, SIGN_TITLE_FONT, SIGN_W_M, SIGN_ZOOM_MAX, SIGN_ZOOM_MIN, SIGN_ZOOM_REF, assignLobbyTeams, emptyCounts, everyPresentInZone, rgbFromHex,
  billboardAnchor, earlySpawnPads, hudRoundStartsLine, hudVoteHeadline, leadingModes, lobbyFeet, modeSubtitle, modeTitle, padContains, pickWinner, placedModes, signBadgeY, signFaceZ, signPlateWidth, SIGN_TITLE_PAD_M, signTitlePlane, signTitleScale, signZoomScale, stillAfk, teamTitle, toSceneFeet, voteLead, voteLocalToWorld, voteModeAt, voteTeamAt, voteTeamIdAt, voteTintPose, voteZoneLocal,
} from '../src/shared/lobby'
import { PVB_BOT_MAX, PVB_RATIO, pvbBotCount } from '../src/shared/pvp'
import { OUTLINE_COPIES, outlineOffsets } from '../src/shared/outlineOffsets'

const tiles = placeLobbyLayout()
if (tiles.length !== 5) {
  console.error(`✗ lobby should be 5 tiles, got ${tiles.length}`)
  process.exit(1)
}
if (LOBBY_MODES.length !== 7 || !LOBBY_MODES.some(m => m.id === 'garden') || !LOBBY_MODES.some(m => m.id === 'pots') || !LOBBY_MODES.some(m => m.id === 'prototype') || !LOBBY_MODES.some(m => m.id === 'balloon') || !LOBBY_MODES.some(m => m.id === 'bases') || !LOBBY_MODES.some(m => m.id === 'pvb')) {
  console.error('✗ Color Garden, Pot Hunt, Prototype, Balloon Battle, Bases, and Bot Invasion must stay in the registry')
  process.exit(1)
}
if (placedModes().length !== 0) {
  console.error('✗ alternate modes should stay in the registry, unplaced')
  process.exit(1)
}
if (LOBBY_TEAMS.map(m => m.id).join() !== 'red,blue,yellow,green' || LOBBY_TEAMS[0].team !== 1 || LOBBY_TEAMS[1].team !== 2 || LOBBY_TEAMS[2].team !== 4 || LOBBY_TEAMS[3].team !== 3) {
  console.error('✗ the lobby floor should offer RED, BLUE, YELLOW, and GREEN')
  process.exit(1)
}
if (LOBBY_TEAMS[0].hex !== '#FF7577' || LOBBY_TEAMS[1].hex !== '#6A99FC' || LOBBY_TEAMS[2].hex !== '#FFE04A' || LOBBY_TEAMS[3].hex !== '#4FD68C' || teamTitle('red') !== 'RED' || teamTitle('blue') !== 'BLUE' || teamTitle('yellow') !== 'YELLOW' || teamTitle('green') !== 'GREEN') {
  console.error('✗ team signs should use the four lobby colours and labels RED BLUE YELLOW GREEN')
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
if (!balloonMode.live || balloonMode.placed || balloonMode.economy || balloonMode.teamRule !== 'balance' || balloonMode.cell.x !== 2 || balloonMode.cell.z !== 1 || balloonMode.label !== 'BALLOON BATTLE') {
  console.error('✗ Balloon Battle should stay in the registry, unplaced, with team balance and no paint economy')
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
if (MODE_PILL_TEXT_HEX.prototype !== '#FFFFFF' || MODE_PILL_TEXT_HEX.pvp !== '#FFFFFF' || MODE_PILL_TEXT_HEX.bases !== '#FFFFFF' || MODE_PILL_TEXT_HEX.balloon !== '#FFFFFF' || MODE_PILL_TEXT_HEX.pvb !== '#FFFFFF') {
  console.error(`✗ all four sign titles should be white, got ${JSON.stringify(MODE_PILL_TEXT_HEX)}`)
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
if (center.type !== 'cross' || center.r !== 0 || center.x !== LOBBY_CROSS.x || center.z !== LOBBY_CROSS.z) {
  console.error('✗ the center should be the first tile, a four-way cross')
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
  // Team pads may share those cells; modes themselves stay unplaced and cannot be voted.
  const midX = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const midZ = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  if (voteModeAt(midX, midZ, MAZE_ORIGIN, CELL) !== '') {
    console.error(`✗ ${m.id} should not win a mode vote from the floor`)
    process.exit(1)
  }
}
for (const team of LOBBY_TEAMS) {
  const end = ends.find(t => t.x === team.cell.x && t.z === team.cell.z)
  if (!end) {
    console.error(`✗ ${team.id} has no end tile`)
    process.exit(1)
  }
  const dx = LOBBY_CROSS.x - end.x
  const dz = LOBBY_CROSS.z - end.z
  if (Math.abs(dx) + Math.abs(dz) !== 1) {
    console.error(`✗ ${team.id} is not next to the hub`)
    process.exit(1)
  }
  const toward = dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 0 : 2
  if (!openingsAt('end', end.r).has(toward as 0 | 1 | 2 | 3)) {
    console.error(`✗ ${team.id} does not open toward the hub`)
    process.exit(1)
  }
  const midX = team.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const midZ = team.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  const got = voteTeamAt(midX, midZ, MAZE_ORIGIN, CELL)
  if (got !== team.team || voteTeamIdAt(midX, midZ, MAZE_ORIGIN, CELL) !== team.id) {
    console.error(`✗ ${team.id} center picks as '${got}', want ${team.team}`)
    process.exit(1)
  }
}
const hold = earlySpawnPads(MAZE_ORIGIN, CELL, BASE_Y, [baseSpawn(1).pos, baseSpawn(2).pos])
if (hold.length !== 7) {
  console.error(`✗ expected two bases, hub, and four team pads, got ${hold.length}`)
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
  console.error('✗ the hub pad does not cover the lobby spawn')
  process.exit(1)
}
for (const team of [1, 2]) {
  const s = baseSpawn(team).pos
  if (!padContains(hold[team - 1], s.x, s.z) || hold[team - 1].sx !== 16) {
    console.error(`✗ team ${team} base pad moved`)
    process.exit(1)
  }
}
const redTeam = LOBBY_TEAMS[0]
const blueTeam = LOBBY_TEAMS[1]
const zone = voteZoneLocal(CELL)
const redPad = hold[3]
const bluePad = hold[4]
const redStand = voteTintPose(redTeam.cell, MAZE_ORIGIN, CELL)
const blueStand = voteTintPose(blueTeam.cell, MAZE_ORIGIN, CELL)
const redDoor = voteLocalToWorld((zone.x0 + zone.x1) / 2, zone.z1, redTeam.cell, MAZE_ORIGIN, CELL)
const redCap = voteLocalToWorld((zone.x0 + zone.x1) / 2, zone.z0, redTeam.cell, MAZE_ORIGIN, CELL)
const blueDoor = voteLocalToWorld((zone.x0 + zone.x1) / 2, zone.z1, blueTeam.cell, MAZE_ORIGIN, CELL)
const blueCap = voteLocalToWorld((zone.x0 + zone.x1) / 2, zone.z0, blueTeam.cell, MAZE_ORIGIN, CELL)
if (!padContains(redPad, redStand.x, redStand.z) || !padContains(redPad, redDoor.x, redDoor.z) || !padContains(redPad, redCap.x, redCap.z)) {
  console.error('✗ the red pad does not cover the west team floor')
  process.exit(1)
}
if (!padContains(bluePad, blueStand.x, blueStand.z) || !padContains(bluePad, blueDoor.x, blueDoor.z) || !padContains(bluePad, blueCap.x, blueCap.z)) {
  console.error('✗ the blue pad does not cover the east team floor')
  process.exit(1)
}
if (padContains(hold[2], redStand.x, redStand.z) || padContains(hold[2], blueStand.x, blueStand.z) || padContains(redPad, forkFeet.x, forkFeet.z) || padContains(bluePad, forkFeet.x, forkFeet.z) || padContains(redPad, blueStand.x, blueStand.z) || padContains(bluePad, redStand.x, redStand.z)) {
  console.error('✗ a team or hub pad reaches the other lobby floors')
  process.exit(1)
}
function checkFrame(label: string, sceneM: number, origin: number, baseMeters: number): void {
  for (const m of LOBBY_TEAMS) {
    const sx = m.cell.x * 32 + 16 + origin
    const sz = m.cell.z * 32 + 16 + origin
    const scene = toSceneFeet(sx, sz, sceneM, origin, 32, baseMeters)
    const world = toSceneFeet(sx + baseMeters, sz + baseMeters, sceneM, origin, 32, baseMeters)
    if (scene.frame !== 'scene' || world.frame !== 'world') {
      console.error(`✗ ${label} ${m.id} frame scene=${scene.frame} world=${world.frame}`)
      process.exit(1)
    }
    if (voteTeamAt(scene.x, scene.z, origin, 32) !== m.team || voteTeamAt(world.x, world.z, origin, 32) !== m.team) {
      console.error(`✗ ${label} ${m.id} does not pick from both coordinate frames`)
      process.exit(1)
    }
    // The unconverted world point is NOT the scene cell. That miss is the full-world vote bug.
    if (voteTeamAt(sx + baseMeters, sz + baseMeters, origin, 32) !== 0) {
      console.error(`✗ ${label} ${m.id} world metres already picked before the frame conversion`)
      process.exit(1)
    }
  }
  const cx = 2 * 32 + 16 + origin
  const cross = toSceneFeet(cx + baseMeters, cx + baseMeters, sceneM, origin, 32, baseMeters)
  if (cross.frame !== 'world' || voteTeamAt(cross.x, cross.z, origin, 32) !== 0) {
    console.error(`✗ ${label} hub in world metres should abstain`)
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
for (const m of LOBBY_TEAMS) {
  const sx = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
  const sz = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
  clearLobbyVotes()
  if (!noteLobbyPos('player', sx, 190, sz, now)) {
    console.error(`✗ server rejected a scene-local ${m.id} sample`)
    process.exit(1)
  }
  const scored = tallyTeams(['player'], now)
  if (scored[m.id] !== 1) {
    console.error(`✗ server tally missed scene-local ${m.id}`)
    process.exit(1)
  }
  // The sample itself is the pick. An empty present list must not hide it.
  const fromSample = tallyTeams([], now)
  if (fromSample[m.id] !== 1) {
    console.error(`✗ a stored ${m.id} sample was dropped with nobody in presentIds`)
    process.exit(1)
  }
}
clearLobbyVotes()

// Same stand as Luke's west-end sample: 4 m east and 2 m south of that cell's centre.
const lukeAt = 1_700_000_000_000
const lukeX = 1 * CELL + CELL / 2 + MAZE_ORIGIN + 4
const lukeZ = 2 * CELL + CELL / 2 + MAZE_ORIGIN - 2
if (voteTeamAt(lukeX, lukeZ, MAZE_ORIGIN, CELL) !== 1) {
  console.error(`✗ ${lukeX},${lukeZ} must be the west RED end`)
  process.exit(1)
}
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, lukeAt)) {
  console.error('✗ server rejected the west-end sample')
  process.exit(1)
}
const aged = lukeAt + 2_000 // past the old 1.5 s freshness window
const mismatch = tallyTeams(['0xabc'], aged)
if (mismatch.red !== 1) {
  console.error(`✗ west-end sample 2s old under a different id case scored red ${mismatch.red}`)
  process.exit(1)
}
if (lobbyVerdict(['0xabc'], aged).why !== 'ok') {
  console.error(`✗ west-end sample 2s old should still be ok, got ${lobbyVerdict(['0xabc'], aged).why}`)
  process.exit(1)
}
const split = lobbyVerdict(['0xabc'], aged)
if (split.zone !== 'red' || split.why !== 'ok') {
  console.error(`✗ sample under a different id was dropped (zone ${split.zone} why ${split.why})`)
  process.exit(1)
}

const clock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: lukeAt, emptySince: 0 }
const step = stepLobby(clock, ['0xabc'], aged)
if (step.log !== 'start' || step.next.countdownEnds !== aged + LOBBY_READY_MS) {
  console.error(`✗ a lone player in a zone should start the last ${LOBBY_READY_MS}ms (${step.log} ends ${step.next.countdownEnds})`)
  process.exit(1)
}
if (LOBBY_VOTE_MS !== 15_000 || LOBBY_READY_MS !== 5_000) {
  console.error(`✗ the vote window should be 15s, shrinking to 5s when everyone is ready (got ${LOBBY_VOTE_MS}ms / ${LOBBY_READY_MS}ms)`)
  process.exit(1)
}

const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!uiSrc.includes("textWSafe('CHOOSE A TEAM', lobbyFont)") || !uiSrc.includes("textWSafe('STARTING IN 15', lobbyFont)") || !uiSrc.includes("textWSafe('STARTING...', lobbyFont)") || uiSrc.includes('textWSafe(lobbyClock')) {
  console.error('✗ the lobby status box should stay one fixed width that fits both CHOOSE A TEAM and STARTING IN 15')
  process.exit(1)
}
if (hudVoteHeadline() !== 'CHOOSE A TEAM' || hudVoteHeadline(0, 'pvp') !== 'CHOOSE A TEAM') {
  console.error(`✗ the top lobby line should stay CHOOSE A TEAM when no countdown is running (${hudVoteHeadline()})`)
  process.exit(1)
}
if (hudVoteHeadline(5) !== 'STARTING IN 5' || hudVoteHeadline(10, 'bases') !== 'STARTING IN 10' || hudVoteHeadline(3, 'prototype') !== 'STARTING IN 3' || hudVoteHeadline(1, 'balloon') !== 'STARTING IN 1') {
  console.error(`✗ the countdown should always read STARTING IN N (${hudVoteHeadline(5)})`)
  process.exit(1)
}
if (hudVoteHeadline(5, 'tie') !== 'STARTING IN 5' || hudVoteHeadline(8, '') !== 'STARTING IN 8') {
  console.error(`✗ a tied or empty lead should still read STARTING IN N (${hudVoteHeadline(5, 'tie')})`)
  process.exit(1)
}

const early = stepLobby(step.next, ['0xabc'], aged + 2_000)
if (early.log === 'resolve' || early.log === 'close') {
  console.error(`✗ the vote closed before ${LOBBY_READY_MS}ms (${early.log})`)
  process.exit(1)
}
const done = stepLobby(step.next, ['0xabc'], aged + LOBBY_READY_MS)
if (done.log !== 'resolve') {
  console.error(`✗ the lone-player vote did not resolve at ${LOBBY_READY_MS}ms (${done.log})`)
  process.exit(1)
}
const held = stepLobby({ wantFull: true, countdownEnds: 0, hadVotes: false, readyAt: aged - 3_000, emptySince: 0 }, ['0xabc'], aged)
if (held.log !== 'start') {
  console.error(`✗ a returning lobby with a live pick should still start the countdown (${held.log})`)
  process.exit(1)
}

// Standing on blue after red should switch the sticky pick.
clearLobbyVotes()
const blueX = 3 * CELL + CELL / 2 + MAZE_ORIGIN
const blueZ = 2 * CELL + CELL / 2 + MAZE_ORIGIN
if (voteTeamAt(blueX, blueZ, MAZE_ORIGIN, CELL) !== 2) {
  console.error(`✗ ${blueX},${blueZ} must be the east BLUE end`)
  process.exit(1)
}
if (!noteLobbyPos('proto', lukeX, 190, lukeZ, aged)) {
  console.error('✗ server rejected a red sample')
  process.exit(1)
}
if (countedTeam('proto', aged) !== 1) {
  console.error('✗ a west stand should choose red')
  process.exit(1)
}
if (!noteLobbyPos('proto', blueX, 190, blueZ, aged + 1_000)) {
  console.error('✗ server rejected a blue sample')
  process.exit(1)
}
if (countedTeam('proto', aged + 1_000) !== 2) {
  console.error('✗ walking onto blue should switch the pick')
  process.exit(1)
}
const hubX = LOBBY_CROSS.x * CELL + CELL / 2 + MAZE_ORIGIN
const hubZ = LOBBY_CROSS.z * CELL + CELL / 2 + MAZE_ORIGIN
if (!noteLobbyPos('proto', hubX, 190, hubZ, aged + 2_000)) {
  console.error('✗ server rejected a hub sample')
  process.exit(1)
}
if (countedTeam('proto', aged + 2_000) !== 2) {
  console.error('✗ walking off a team tile should keep the last pick')
  process.exit(1)
}
const blueClock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: lukeAt, emptySince: 0 }
const blueStep = stepLobby(blueClock, ['proto'], aged + 2_000)
if (blueStep.log !== '' || blueStep.next.countdownEnds !== 0) {
  console.error(`✗ walking off every team zone should not start the countdown (${blueStep.log} ends ${blueStep.next.countdownEnds})`)
  process.exit(1)
}
const blueTallied = tallyTeams(['proto'], aged + 2_000)
if (blueTallied.blue !== 1 || blueTallied.red !== 0) {
  console.error(`✗ sticky blue tally leaked into red (${blueTallied.red}/${blueTallied.blue})`)
  process.exit(1)
}

// Countdown follows live occupancy, not the sticky pick: step on blue, then off.
if (!noteLobbyPos('proto', blueX, 190, blueZ, aged + 3_000)) {
  console.error('✗ server rejected a return to blue')
  process.exit(1)
}
const onBlue = stepLobby(blueClock, ['proto'], aged + 3_000)
if (onBlue.log !== 'start' || onBlue.next.countdownEnds !== aged + 3_000 + LOBBY_READY_MS) {
  console.error(`✗ a lone player standing in blue should start the last ${LOBBY_READY_MS}ms (${onBlue.log})`)
  process.exit(1)
}
const onBlueOcc = occupancyTeams(['proto'], aged + 3_000)
if (onBlueOcc.blue !== 1 || onBlueOcc.red !== 0) {
  console.error(`✗ standing in blue should show 1 on the blue sign (got red=${onBlueOcc.red} blue=${onBlueOcc.blue})`)
  process.exit(1)
}
if (!noteLobbyPos('proto', hubX, 190, hubZ, aged + 4_000)) {
  console.error('✗ server rejected walking off blue to the hub')
  process.exit(1)
}
const offBlue = stepLobby(onBlue.next, ['proto'], aged + 4_000)
if (offBlue.log !== 'close' || offBlue.next.countdownEnds !== 0) {
  console.error(`✗ leaving every team zone should stop and reset the timer (${offBlue.log} ends ${offBlue.next.countdownEnds})`)
  process.exit(1)
}
if (countedTeam('proto') !== 2) {
  console.error('✗ walking off blue should keep the sticky pick')
  process.exit(1)
}
const leftBlue = occupancyTeams(['proto'], aged + 4_000)
if (leftBlue.blue !== 0 || leftBlue.red !== 0) {
  console.error(`✗ leaving a team zone should drop the sign count to 0 (got red=${leftBlue.red} blue=${leftBlue.blue})`)
  process.exit(1)
}

// 15s window when someone present is not in a zone; shrinks to 5s when they join.
clearLobbyVotes()
const waitAt = aged + 10_000
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, waitAt)) {
  console.error('✗ server rejected the red sample for the two-player countdown')
  process.exit(1)
}
if (!noteLobbyPos('wander', hubX, 190, hubZ, waitAt + 500)) {
  console.error('✗ server rejected the hub wanderer sample')
  process.exit(1)
}
const waitNow = waitAt + 500
if (everyoneStandingReady(['0xabc', 'wander'], waitNow)) {
  console.error('✗ a wanderer in the hub should block the everyone-ready shrink')
  process.exit(1)
}
const waitClock = { wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: waitAt, emptySince: 0 }
const waitStart = stepLobby(waitClock, ['0xabc', 'wander'], waitNow)
if (waitStart.log !== 'start' || waitStart.next.countdownEnds !== waitNow + LOBBY_VOTE_MS) {
  console.error(`✗ a partial lobby should start the full ${LOBBY_VOTE_MS}ms window (${waitStart.log} ends ${waitStart.next.countdownEnds})`)
  process.exit(1)
}
if (!noteLobbyPos('wander', blueX, 190, blueZ, waitNow + 1_000)) {
  console.error('✗ server rejected wander stepping onto blue')
  process.exit(1)
}
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, waitNow + 1_000)) {
  console.error('✗ server rejected refreshing the red sample')
  process.exit(1)
}
const readyNow = waitNow + 1_000
if (!everyoneStandingReady(['0xabc', 'wander'], readyNow)) {
  console.error('✗ both players standing in zones should be everyone-ready')
  process.exit(1)
}
const shrunk = stepLobby(waitStart.next, ['0xabc', 'wander'], readyNow)
if (shrunk.log !== 'shorten' || shrunk.next.countdownEnds !== readyNow + LOBBY_READY_MS) {
  console.error(`✗ everyone ready should drop remaining time to ${LOBBY_READY_MS}ms (${shrunk.log} ends ${shrunk.next.countdownEnds})`)
  process.exit(1)
}
const stillShort = stepLobby(shrunk.next, ['0xabc', 'wander'], readyNow + 1_000)
if (stillShort.log !== '' || stillShort.next.countdownEnds !== readyNow + LOBBY_READY_MS) {
  console.error(`✗ the ready shrink must not run again or extend (${stillShort.log} ends ${stillShort.next.countdownEnds})`)
  process.exit(1)
}
if (!noteLobbyPos('wander', hubX, 190, hubZ, readyNow + 1_500)) {
  console.error('✗ server rejected wander leaving blue after the shrink')
  process.exit(1)
}
const noExtend = stepLobby(shrunk.next, ['0xabc', 'wander'], readyNow + 1_500)
if (noExtend.log === 'close' || noExtend.next.countdownEnds !== readyNow + LOBBY_READY_MS) {
  console.error(`✗ one player leaving a zone must not extend or cancel while another stays (${noExtend.log} ends ${noExtend.next.countdownEnds})`)
  process.exit(1)
}

// An AFK wanderer does not block the ready shrink.
clearLobbyVotes()
const afkBase = aged + 30_000
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, afkBase)) {
  console.error('✗ server rejected the red sample for the AFK case')
  process.exit(1)
}
if (!noteLobbyPos('idle', hubX, 190, hubZ, afkBase + 500)) {
  console.error('✗ server rejected the AFK hub sample')
  process.exit(1)
}
if (!noteLobbyPos('idle', hubX, 190, hubZ, afkBase + 500 + LOBBY_AFK_MS)) {
  console.error('✗ server rejected refreshing the AFK hub sample in place')
  process.exit(1)
}
if (!noteLobbyPos('0xAbC', lukeX - 1, 190, lukeZ, afkBase + 500 + LOBBY_AFK_MS)) {
  console.error('✗ server rejected refreshing the red sample in the AFK case')
  process.exit(1)
}
const afkNow = afkBase + 500 + LOBBY_AFK_MS
if (!everyoneStandingReady(['0xabc', 'idle'], afkNow)) {
  console.error('✗ an AFK player in the hub should not block everyone-ready')
  process.exit(1)
}
const afkStart = stepLobby({ wantFull: false, countdownEnds: 0, hadVotes: false, readyAt: afkNow, emptySince: 0 }, ['0xabc', 'idle'], afkNow)
if (afkStart.log !== 'start' || afkStart.next.countdownEnds !== afkNow + LOBBY_READY_MS) {
  console.error(`✗ a ready lobby with one AFK wanderer should start at ${LOBBY_READY_MS}ms (${afkStart.log} ends ${afkStart.next.countdownEnds})`)
  process.exit(1)
}

if (hudRoundStartsLine(12) !== 'ROUND STARTS IN 12' || hudRoundStartsLine(1) !== 'ROUND STARTS IN 1' || hudRoundStartsLine(0) !== '') {
  console.error(`✗ the center lobby line should read ROUND STARTS IN N (${hudRoundStartsLine(12)})`)
  process.exit(1)
}
const ring = outlineOffsets(6)
if (OUTLINE_COPIES !== 16 || ring.length < 12) {
  console.error(`✗ the text outline should use a 16-copy circle, got ${ring.length}`)
  process.exit(1)
}
if (ring.some(([dx, dy]) => Math.hypot(dx, dy) > 6 + 0.51) || ring.some(([dx, dy]) => Math.abs(dx) === 6 && Math.abs(dy) === 6)) {
  console.error('✗ the text outline must sit on a circle, not a square of diagonal copies')
  process.exit(1)
}
const uiOutlined = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
const upgradeUi = readFileSync(new URL('../src/client/upgradeUi.tsx', import.meta.url), 'utf8')
if (!uiOutlined.includes('<OutlinedLabel') || !upgradeUi.includes('<OutlinedLabel')) {
  console.error('✗ the lobby countdown and the upgrade title should share the circular outline')
  process.exit(1)
}
const lobbyClientSrc = readFileSync(new URL('../src/client/lobby.ts', import.meta.url), 'utf8')
if (!lobbyClientSrc.includes('tickLobbyStartSfx') || !lobbyClientSrc.includes('playUiClick()') || !lobbyClientSrc.includes('sec > 5')) {
  console.error('✗ the lobby should tick click.wav once for each of the last 5 seconds')
  process.exit(1)
}
if (!uiSrc.includes('<LobbyStartCountdown />') || !uiSrc.includes('hudRoundStartsLine(')) {
  console.error('✗ the lobby should show a centered ROUND STARTS IN N countdown')
  process.exit(1)
}
if (hudVoteHeadline(0) !== 'CHOOSE A TEAM') {
  console.error(`✗ after the timer resets the status should be CHOOSE A TEAM (${hudVoteHeadline(0)})`)
  process.exit(1)
}
clearLobbyVotes()
const onTint = voteTintPose(LOBBY_TEAMS[0].cell, MAZE_ORIGIN, CELL)
if (voteTeamAt(onTint.x, onTint.z, MAZE_ORIGIN, CELL) !== 1) {
  console.error('✗ the red tint pose should count as red')
  process.exit(1)
}
const offTint = { x: onTint.x, z: onTint.z + 16 }
if (voteTeamAt(offTint.x, offTint.z, MAZE_ORIGIN, CELL) !== 0) {
  console.error('✗ a point off the red floor should abstain')
  process.exit(1)
}

for (const m of LOBBY_TEAMS) {
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

// Re-stand on red, then stay still a minute later. The sticky pick remains.
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, lukeAt)) {
  console.error('✗ server rejected the west-end sample on retry')
  process.exit(1)
}
if (!noteLobbyPos('0xAbC', lukeX, 190, lukeZ, lukeAt + 61_000)) {
  console.error('✗ standing still on the end tile was rate-limited')
  process.exit(1)
}
if (tallyTeams(['0xabc'], lukeAt + 61_000).red !== 1 || countedTeam('0xabc') !== 1) {
  console.error('✗ standing still on the west end dropped the team pick')
  process.exit(1)
}

// Unchosen players fill the smaller team; all-one-side is allowed; a tie prefers red.
const filled = assignLobbyTeams(['a', 'b', 'c'], new Map([['a', 1], ['b', 1]]))
if (filled.map(x => `${x.userId}:${x.team}`).join() !== 'a:1,b:1,c:2') {
  console.error(`✗ the unchosen player should join the smaller team, got ${filled.map(x => `${x.userId}:${x.team}`).join()}`)
  process.exit(1)
}
const allRed = assignLobbyTeams(['a', 'b'], new Map([['a', 1], ['b', 1]]))
if (allRed.some(x => x.team !== 1)) {
  console.error('✗ everyone picking red should be allowed')
  process.exit(1)
}
const unchosen = assignLobbyTeams(['a', 'b', 'c'], new Map())
if (unchosen.map(x => x.team).join() !== '1,2,3') {
  console.error(`✗ unchosen players should fill the smallest of four teams, red first on a tie, got ${unchosen.map(x => x.team).join()}`)
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

if (uiSrc.includes('hudVoteCountdown') || uiSrc.includes('voteSecs') || uiSrc.includes('fontSize={78}')) {
  console.error('✗ the lobby countdown should live in the top headline, not as a second line under the pill')
  process.exit(1)
}
if (!readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8').includes('STARTING IN') || readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8').includes('PIXELWARS IS STARTING IN') || !lobbySrc.includes('hudVoteHeadline(left)')) {
  console.error('✗ the top lobby line should show STARTING IN N during the countdown')
  process.exit(1)
}
if (!lobbySrc.includes('isLobbyStarting()') || !readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8').includes("LOBBY_STATUS_STARTING = 'STARTING...'") || !lobbySrc.includes('return LOBBY_STATUS_STARTING')) {
  console.error('✗ after the countdown hits 0 the status should stay STARTING... until the match, not fall back to CHOOSE A TEAM')
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
if (!lobbySrc.includes('signFaceZ()') || !lobbySrc.includes('signTitlePlane(teamTitle(m.id))') || !lobbySrc.includes('setBasicMaterial(title') || !lobbySrc.includes('TITLE_INK') || lobbySrc.includes('modeTitleLines') || lobbySrc.includes('overviewSignScale()') === false) {
  console.error('✗ titles should be unlit white plates that scale with the overview zoom')
  process.exit(1)
}
if (lobbySrc.includes('TITLE_OUTLINE') || /outlineWidth:\s*TITLE_OUTLINE_W/.test(lobbySrc) || lobbySrc.includes('outlineWidth: TITLE_OUTLINE_W')) {
  console.error('✗ titles should have no dark outline')
  process.exit(1)
}
if (!lobbySrc.includes('TITLE_INK') || !lobbySrc.includes('Color4.create(1, 1, 1, 1)')) {
  console.error('✗ sign lettering should stay white')
  process.exit(1)
}
if (Math.abs(SIGN_LIP_PAD_W - 1.05 * SIGN_REF_W_M / 58) > 1e-6 || Math.abs(SIGN_LIP_PAD_H - 0.825 * SIGN_REF_W_M / 58) > 1e-6 || !lobbySrc.includes('width + SIGN_LIP_PAD_W') || !lobbySrc.includes('SIGN_H_M + SIGN_LIP_PAD_H')) {
  console.error(`✗ the dark sign rim should keep the original proportions, got ${SIGN_LIP_PAD_W} × ${SIGN_LIP_PAD_H}`)
  process.exit(1)
}
if (Math.abs(SIGN_H_M - 8.6 * SIGN_REF_W_M / 58) > 1e-6 || SIGN_TITLE_FONT / 10 < SIGN_H_M * 0.75) {
  console.error(`✗ pills should stay short and the title should fill most of the height, got h=${SIGN_H_M} font=${SIGN_TITLE_FONT}`)
  process.exit(1)
}
const yellowW = signPlateWidth('YELLOW')
if (Math.abs(SIGN_W_M - yellowW) > 1e-6 || yellowW >= 26 || SIGN_W_M < SIGN_H_M + 1 || !lobbySrc.includes('const width = SIGN_W_M')) {
  console.error(`✗ all four pills should share YELLOW's tight width, got ${SIGN_W_M}`)
  process.exit(1)
}
const yellowPlane = signTitlePlane('YELLOW')
const redPlane = signTitlePlane('RED')
const bluePlane = signTitlePlane('BLUE')
const greenPlane = signTitlePlane('GREEN')
if (yellowPlane.src !== 'assets/textures/sign-title-yellow.png' || redPlane.src !== 'assets/textures/sign-title-red.png' || Math.abs(yellowPlane.h - redPlane.h) > 0.1 || yellowPlane.w <= redPlane.w) {
  console.error('✗ unlit title plates should keep a shared letter height and a tight width per word')
  process.exit(1)
}
if (SIGN_TITLE_PAD_M <= SIGN_H_M * 0.5) {
  console.error(`✗ YELLOW needs side padding past the rounded caps, pad=${SIGN_TITLE_PAD_M} capR=${SIGN_H_M / 2}`)
  process.exit(1)
}
if (yellowPlane.w >= SIGN_W_M - SIGN_TITLE_PAD_M || yellowPlane.h >= SIGN_H_M - 0.2) {
  console.error(`✗ YELLOW must fit inside the pill with padding, plane ${yellowPlane.w.toFixed(3)}×${yellowPlane.h.toFixed(3)} pill ${SIGN_W_M.toFixed(3)}×${SIGN_H_M.toFixed(3)}`)
  process.exit(1)
}
if (Math.abs(bluePlane.h - greenPlane.h) > 0.12 || Math.abs(redPlane.h - yellowPlane.h) > 0.15 || signTitleScale() <= 0) {
  console.error('✗ all four titles should share one typographic scale')
  process.exit(1)
}
if (Math.abs(signTitleScale() - (SIGN_W_M - SIGN_TITLE_PAD_M * 2) / 5282) > 1e-9) {
  console.error('✗ title scale must be set by YELLOW plus the shared side padding')
  process.exit(1)
}
if (!lobbySrc.includes('alphaTexture: titleTex') || !lobbySrc.includes('MeshRenderer.setPlane(title)') || lobbySrc.includes('setPlane(title,') || lobbySrc.includes('SIGN_TITLE_UVS') || lobbySrc.includes('fromEulerDegrees(0, 180, 0)')) {
  console.error('✗ title plates should use the explorer default plane UVs (no custom UV array, no 180° yaw) and the PNG alpha')
  process.exit(1)
}
if (!lobbySrc.includes('Billboard.create(root, { billboardMode: BillboardMode.BM_Y })')) {
  console.error('✗ every lobby sign should use the same BM_Y billboard on its root')
  process.exit(1)
}
if (SIGN_COUNT_FONT / 10 < SIGN_BADGE_H_M * 0.7 || SIGN_BADGE_H_M < 2 || SIGN_BADGE_H_M > 3.2) {
  console.error(`✗ the vote-count chip should be large enough to read, got ${SIGN_BADGE_H_M} font ${SIGN_COUNT_FONT}`)
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
const lipBottom = -(SIGN_H_M + SIGN_LIP_PAD_H) / 2
const chipTop = signBadgeY() + SIGN_BADGE_H_M / 2
if (!(chipTop < lipBottom - 0.2) || !(chipTop > lipBottom - 1.2)) {
  console.error('✗ the vote count chip should sit just under the pill')
  process.exit(1)
}
const overviewSrc = readFileSync(new URL('../src/client/overviewCamera.ts', import.meta.url), 'utf8')
if (
  !overviewSrc.includes('function defaultZoomIndex') ||
  !overviewSrc.includes('isLobbyLayout()') ||
  !overviewSrc.includes('table.length - 1') ||
  !overviewSrc.includes('lastLobbyOpen') ||
  !overviewSrc.includes('DESKTOP_DEFAULT_SCALE = 29')
) {
  console.error('✗ lobby overview should open fully zoomed out, and in-match overview should keep its default zoom')
  process.exit(1)
}
if (modeTitle('prototype') !== 'PAINT LIMIT' || modeSubtitle('prototype') !== 'Prototype') {
  console.error('✗ unused Prototype titles should stay PAINT LIMIT / Prototype')
  process.exit(1)
}
if (modeTitle('balloon') !== 'BALLOON BATTLE' || modeSubtitle('balloon') !== 'Prototype') {
  console.error('✗ unused Balloon Battle titles should stay BALLOON BATTLE / Prototype')
  process.exit(1)
}
if (modeTitle('bases') !== 'BASE CHARGE' || modeSubtitle('bases') !== 'Prototype') {
  console.error('✗ unused Bases titles should stay BASE CHARGE / Prototype')
  process.exit(1)
}
const redSign = billboardAnchor(LOBBY_TEAMS[0].cell, MAZE_ORIGIN, CELL, BASE_Y)
const westEdge = LOBBY_TEAMS[0].cell.x * CELL + MAZE_ORIGIN
if (Math.abs(redSign.x - (westEdge - SIGN_CLEAR_M)) > 0.01 || redSign.y !== BASE_Y + SIGN_LIFT_M) {
  console.error(`✗ the RED sign should sit just past the west edge at the lowered height, got ${redSign.x}, ${redSign.y}`)
  process.exit(1)
}
const blueSign = billboardAnchor(LOBBY_TEAMS[1].cell, MAZE_ORIGIN, CELL, BASE_Y)
const eastEdge = LOBBY_TEAMS[1].cell.x * CELL + CELL + MAZE_ORIGIN
if (Math.abs(blueSign.x - (eastEdge + SIGN_CLEAR_M)) > 0.01 || blueSign.y !== BASE_Y + SIGN_LIFT_M) {
  console.error(`✗ the BLUE sign should sit just past the east edge at the lowered height, got ${blueSign.x}, ${blueSign.y}`)
  process.exit(1)
}
const signSpan = signPlateWidth('YELLOW') * SIGN_ORTHO_AT_REF / 2
if (Math.hypot(blueSign.x - redSign.x, blueSign.z - redSign.z) <= signSpan * 2) {
  console.error('✗ the red and blue signs overlap in the default overview')
  process.exit(1)
}
const indexSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
if (!indexSrc.includes("rebuildMaze(1, 'lobby', 'boot')") || !indexSrc.includes('not rolling a local arena seed')) {
  console.error('✗ client boot should lay the lobby and not roll an arena seed over it')
  process.exit(1)
}

const feet = lobbyFeet(CELL, MAZE_ORIGIN, 0)
const abstain = voteTeamAt(feet.x, feet.z, MAZE_ORIGIN, CELL)
if (abstain !== 0) {
  console.error(`✗ the hub should abstain, got ${abstain}`)
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
if (voteLead(tied) !== 'tie' || leadingModes(tied).join() !== 'pvp,bases') {
  console.error(`✗ a pvp/bases lead tie should list both modes, got ${leadingModes(tied).join()}`)
  process.exit(1)
}
if (pickWinner(tied, 0) !== 'pvp' || pickWinner(tied, 1) !== 'bases' || pickWinner(tied, 2) !== 'pvp') {
  console.error('✗ a tie should pick among the tied modes from the world-sync seq')
  process.exit(1)
}
if (pickWinner(tied, 1) !== pickWinner(tied, 1)) {
  console.error('✗ the same seq must pick the same tied mode')
  process.exit(1)
}
const seen = new Set<string>()
for (let s = 0; s < 8; s++) {
  const w = pickWinner(tied, s)
  if (w !== 'pvp' && w !== 'bases') {
    console.error(`✗ a tie must not pick a mode that is not tied, got ${w}`)
    process.exit(1)
  }
  if (w) seen.add(w)
}
if (seen.size !== 2) {
  console.error(`✗ a tie should be able to pick either tied mode, got ${[...seen].join()}`)
  process.exit(1)
}
const none = emptyCounts()
if (pickWinner(none, 3) !== null || voteLead(none) !== '') {
  console.error('✗ zero votes should not pick a winner')
  process.exit(1)
}
const lead = emptyCounts()
lead.bases = 3
lead.pvp = 1
if (pickWinner(lead, 99) !== 'bases' || voteLead(lead) !== 'bases') {
  console.error('✗ the higher count should win')
  process.exit(1)
}
const parked = emptyCounts()
parked.pvb = 5
parked.pvp = 1
if (pickWinner(parked, 0) !== 'pvp') {
  console.error('✗ parked Bot Invasion votes must not win')
  process.exit(1)
}
const protoLead = emptyCounts()
protoLead.prototype = 4
protoLead.pvp = 1
protoLead.bases = 2
if (pickWinner(protoLead, 0) !== 'prototype') {
  console.error('✗ a Prototype lead should win the vote')
  process.exit(1)
}
const balloonLead = emptyCounts()
balloonLead.balloon = 3
balloonLead.pvp = 2
balloonLead.prototype = 2
if (pickWinner(balloonLead, 0) !== 'balloon') {
  console.error('✗ a Balloon Battle lead should win the vote')
  process.exit(1)
}
const balloonTie = emptyCounts()
balloonTie.balloon = 2
balloonTie.pvp = 2
if (leadingModes(balloonTie).join() !== 'pvp,balloon') {
  console.error(`✗ a balloon/pvp tie should list both, got ${leadingModes(balloonTie).join()}`)
  process.exit(1)
}
if (pickWinner(balloonTie, 0) !== 'pvp' || pickWinner(balloonTie, 1) !== 'balloon') {
  console.error('✗ a balloon/pvp tie should pick from the world-sync seq, not the previous mode')
  process.exit(1)
}
if (hudVoteHeadline(4, voteLead(balloonTie)) !== 'STARTING IN 4') {
  console.error('✗ a tied countdown should still read STARTING IN N')
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
for (const name of ['paintTick', 'lungeHit', 'burstHit', 'anvilHit', 'anvilPush', 'playerFell']) {
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
if (roundSrc.includes('isBalloonRound') || roundSrc.includes('isBasesRound')) {
  console.error('✗ balloon and bases banners are not part of Classic Pixelwars')
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
if (!phaseSrc.includes("next === 'red'") || !phaseSrc.includes("next === 'blue'")) {
  console.error('✗ red and blue team picks must not be dropped')
  process.exit(1)
}
if (handler.includes("format === 'pvb'") || handler.includes("format === 'balloon'") || handler.includes("format === 'bases'") || handler.includes("format === 'prototype'")) {
  console.error('✗ the client should only run Classic Pixelwars')
  process.exit(1)
}
if (!server.includes("roundFormat = 'pvp'") || server.includes("mode === 'prototype'") || server.includes("mode === 'balloon'") || server.includes("mode === 'bases'")) {
  console.error('✗ the server should only start Classic Pixelwars')
  process.exit(1)
}

const nametags = readFileSync(new URL('../src/client/nametags.ts', import.meta.url), 'utf8')
if (!nametags.includes("events.on('lobby:floor'") || !nametags.includes('isLobbyLayout()') || !nametags.includes('clearNametags') || !nametags.includes('getEntitiesWith(AvatarNametag)')) {
  console.error('✗ team nametags should clear on the lobby floor, including leftover plates')
  process.exit(1)
}
if (!nametags.includes('isPlayingTeam(team)') || nametags.includes('team !== Team.Red && team !== Team.Blue') || !nametags.includes("const STAR = '★'")) {
  console.error('✗ player nametags should use every playing team, not only red and blue')
  process.exit(1)
}
const botVisualSrc = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
if (botVisualSrc.includes('paintGhostPlate') || botVisualSrc.includes('paintPlate') || botVisualSrc.includes('AvatarNametag') || botVisualSrc.includes('clearGhostPlate') || /\bplate:/.test(botVisualSrc)) {
  console.error('✗ bots should not spawn nametag or team-plate entities')
  process.exit(1)
}

console.log('✓ lobby layout, team choice, and match gates')
