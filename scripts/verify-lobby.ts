/**
 * Lobby layout and vote rules. Run: npx tsx scripts/verify-lobby.ts
 */
import { readFileSync } from 'node:fs'
import { clearLobbyVotes, countedTeam, lobbyVerdict, noteLobbyPos, stepLobby, tallyTeams, tallyVotes } from '../src/server/lobbyVote'
import { CELL, BASE_Y, MAZE_ORIGIN, baseSpawn, placeLobbyLayout, validate, getPlacedTilesInOrder } from '../src/maze/generator'
import { openingsAt } from '../src/maze/tiles'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import {
  LOBBY_AFK_MS, LOBBY_CROSS, LOBBY_MODES, LOBBY_MOVE_M, LOBBY_TEAMS, LOBBY_VOTE_MS, MODE_PILL_HEX, MODE_PILL_TEXT_HEX, SIGN_BADGE_H_M, SIGN_CAMERA_AXIS, SIGN_CLEAR_M, SIGN_H_M, SIGN_LIP_DEPTH_M, SIGN_LIP_PAD_H, SIGN_LIP_PAD_W, SIGN_LIP_Z, SIGN_COUNT_FONT, SIGN_ORTHO_AT_REF, SIGN_PLATE_DEPTH_M, SIGN_REF_W_M, SIGN_TITLE_FONT, SIGN_ZOOM_MAX, SIGN_ZOOM_MIN, SIGN_ZOOM_REF, assignLobbyTeams, emptyCounts, everyPresentInZone, rgbFromHex,
  billboardAnchor, earlySpawnPads, hudVoteHeadline, leadingModes, lobbyFeet, modeSubtitle, modeTitle, padContains, pickWinner, placedModes, signBadgeY, signFaceZ, signPlateWidth, signZoomScale, stillAfk, teamTitle, toSceneFeet, voteLead, voteLocalToWorld, voteModeAt, voteTeamAt, voteTeamIdAt, voteTintPose, voteZoneLocal,
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
if (step.log !== 'start' || step.next.countdownEnds !== aged + LOBBY_VOTE_MS) {
  console.error(`✗ idle phase with this sample did not start the ${LOBBY_VOTE_MS}ms countdown (${step.log} ends ${step.next.countdownEnds})`)
  process.exit(1)
}
if (LOBBY_VOTE_MS !== 10_000) {
  console.error(`✗ the vote window should be 10s, got ${LOBBY_VOTE_MS}ms`)
  process.exit(1)
}
if (hudVoteHeadline() !== 'CHOOSE A TEAM' || hudVoteHeadline(0, 'pvp') !== 'CHOOSE A TEAM') {
  console.error(`✗ the top lobby line should stay CHOOSE A TEAM when no countdown is running (${hudVoteHeadline()})`)
  process.exit(1)
}
if (hudVoteHeadline(5) !== 'PIXELWARS IS STARTING IN 5' || hudVoteHeadline(10, 'bases') !== 'PIXELWARS IS STARTING IN 10' || hudVoteHeadline(3, 'prototype') !== 'PIXELWARS IS STARTING IN 3' || hudVoteHeadline(1, 'balloon') !== 'PIXELWARS IS STARTING IN 1') {
  console.error(`✗ the countdown should always read PIXELWARS IS STARTING IN N (${hudVoteHeadline(5)})`)
  process.exit(1)
}
if (hudVoteHeadline(5, 'tie') !== 'PIXELWARS IS STARTING IN 5' || hudVoteHeadline(8, '') !== 'PIXELWARS IS STARTING IN 8') {
  console.error(`✗ a tied or empty lead should still name Pixelwars (${hudVoteHeadline(5, 'tie')})`)
  process.exit(1)
}

const early = stepLobby(step.next, ['0xabc'], aged + 5_000)
if (early.log === 'resolve' || early.log === 'close') {
  console.error(`✗ the vote closed before ${LOBBY_VOTE_MS}ms (${early.log})`)
  process.exit(1)
}
const done = stepLobby(step.next, ['0xabc'], aged + LOBBY_VOTE_MS)
if (done.log !== 'resolve') {
  console.error(`✗ the vote did not resolve at ${LOBBY_VOTE_MS}ms (${done.log})`)
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
if (blueStep.log !== 'start' || blueStep.next.countdownEnds !== aged + 2_000 + LOBBY_VOTE_MS) {
  console.error(`✗ a sticky blue pick did not start the ${LOBBY_VOTE_MS}ms countdown (${blueStep.log})`)
  process.exit(1)
}
const blueTallied = tallyTeams(['proto'], aged + 2_000)
if (blueTallied.blue !== 1 || blueTallied.red !== 0) {
  console.error(`✗ sticky blue tally leaked into red (${blueTallied.red}/${blueTallied.blue})`)
  process.exit(1)
}
const blueDone = stepLobby(blueStep.next, ['proto'], aged + 2_000 + LOBBY_VOTE_MS)
if (blueDone.log !== 'resolve') {
  console.error(`✗ a sticky blue pick did not resolve at ${LOBBY_VOTE_MS}ms (${blueDone.log})`)
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
const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (uiSrc.includes('hudVoteCountdown') || uiSrc.includes('voteSecs') || uiSrc.includes('fontSize={78}')) {
  console.error('✗ the lobby countdown should live in the top headline, not as a second line under the pill')
  process.exit(1)
}
if (!readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8').includes('PIXELWARS IS STARTING IN') || !lobbySrc.includes('hudVoteHeadline(left)')) {
  console.error('✗ the top lobby line should show PIXELWARS IS STARTING IN N during the countdown')
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
if (!lobbySrc.includes('TITLE_FONT = SIGN_TITLE_FONT') || !lobbySrc.includes('signFaceZ()') || !lobbySrc.includes('signPlateWidth(teamTitle(m.id))') || !lobbySrc.includes('TITLE_INK') || !lobbySrc.includes('Color4.create(1, 1, 1, 1)') || !lobbySrc.includes('outlineWidth: TITLE_OUTLINE_W') || lobbySrc.includes('modeTitleLines') || lobbySrc.includes('overviewSignScale()') === false) {
  console.error('✗ titles should be one tight white line with a dark outline, and scale with the overview zoom')
  process.exit(1)
}
if (!lobbySrc.includes('TITLE_OUTLINE_W = 0.18') || !lobbySrc.includes('Color4.create(0.04, 0.03, 0.04, 1)')) {
  console.error('✗ title ink needs a near-black outline so white letters stay readable on yellow')
  process.exit(1)
}
if (!lobbySrc.includes('TITLE_INK') || lobbySrc.split('textColor: ink').length - 1 < 2) {
  console.error('✗ title and subtitle should use the per-mode pill text color, white on every sign including Paint Limit')
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
const redW = signPlateWidth('RED')
const blueW = signPlateWidth('BLUE')
const greenW = signPlateWidth('GREEN')
const yellowW = signPlateWidth('YELLOW')
if (!(redW < blueW && blueW < greenW && greenW < yellowW) || yellowW >= 26 || redW < SIGN_H_M + 1) {
  console.error(`✗ each pill should hug its word, got RED=${redW.toFixed(2)} BLUE=${blueW.toFixed(2)} GREEN=${greenW.toFixed(2)} YELLOW=${yellowW.toFixed(2)}`)
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
if (Math.abs(redSign.x - (westEdge - SIGN_CLEAR_M)) > 0.01 || redSign.y !== BASE_Y + 22) {
  console.error(`✗ the RED sign should sit 10 m past the west edge at base+22, got ${redSign.x}, ${redSign.y}`)
  process.exit(1)
}
const blueSign = billboardAnchor(LOBBY_TEAMS[1].cell, MAZE_ORIGIN, CELL, BASE_Y)
const eastEdge = LOBBY_TEAMS[1].cell.x * CELL + CELL + MAZE_ORIGIN
if (Math.abs(blueSign.x - (eastEdge + SIGN_CLEAR_M)) > 0.01 || blueSign.y !== BASE_Y + 22) {
  console.error(`✗ the BLUE sign should sit 10 m past the east edge at base+22, got ${blueSign.x}, ${blueSign.y}`)
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
if (hudVoteHeadline(4, voteLead(balloonTie)) !== 'PIXELWARS IS STARTING IN 4') {
  console.error('✗ a tied countdown should still read PIXELWARS IS STARTING IN N')
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
if (!phaseSrc.includes("next === 'red'") || !phaseSrc.includes("next === 'blue'")) {
  console.error('✗ red and blue team picks must not be dropped')
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

console.log('✓ lobby layout, team choice, and match gates')
