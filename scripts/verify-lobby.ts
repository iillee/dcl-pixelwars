/**
 * Lobby layout and vote rules. Run: npx tsx scripts/verify-lobby.ts
 */
import { readFileSync } from 'node:fs'
import { clearLobbyVotes, lobbyVerdict, noteLobbyPos, stepLobby, tallyVotes } from '../src/server/lobbyVote'
import { CELL, MAZE_ORIGIN, placeLobbyLayout, validate, getPlacedTilesInOrder } from '../src/maze/generator'
import { openingsAt } from '../src/maze/tiles'
import {
  LOBBY_AFK_MS, LOBBY_CROSS, LOBBY_MODES, LOBBY_MOVE_M, LOBBY_VOTE_MS, SIGN_CAMERA_AXIS, SIGN_CLEAR_M, SIGN_LIP_DEPTH_M, SIGN_LIP_Z, SIGN_PLATE_DEPTH_M, emptyCounts, everyPresentInZone,
  billboardAnchor, lobbyFeet, modeSubtitle, modeTitle, pickWinner, placedModes, signFaceZ, stillAfk, toSceneFeet, voteLocalToWorld, voteModeAt, voteZoneLocal,
} from '../src/shared/lobby'

const tiles = placeLobbyLayout()
if (tiles.length !== 3) {
  console.error(`✗ lobby should be 3 tiles, got ${tiles.length}`)
  process.exit(1)
}
if (LOBBY_MODES.length !== 4 || !LOBBY_MODES.some(m => m.id === 'garden') || !LOBBY_MODES.some(m => m.id === 'pots')) {
  console.error('✗ Color Garden and Pot Hunt must stay in the registry')
  process.exit(1)
}
if (placedModes().map(m => m.id).join() !== 'pvp,pvb') {
  console.error('✗ only PvP and PvB are placed')
  process.exit(1)
}
if (!validate()) {
  console.error('✗ lobby openings do not connect')
  process.exit(1)
}
const center = tiles[0]
if (center.type !== 'straight' || center.x !== LOBBY_CROSS.x || center.z !== LOBBY_CROSS.z) {
  console.error('✗ the center should be the first tile, a straight between the ends')
  process.exit(1)
}
if (!openingsAt('straight', center.r).has(1) || !openingsAt('straight', center.r).has(3)) {
  console.error('✗ the center straight should open east and west')
  process.exit(1)
}
const ends = getPlacedTilesInOrder().filter(t => t.type === 'end')
if (ends.length !== 2) {
  console.error(`✗ expected 2 end tiles, got ${ends.length}`)
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
checkFrame('medium', 64 * 16, (64 * 16 - 160) / 2, -32 * 16)
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
if (LOBBY_VOTE_MS !== 30_000) {
  console.error(`✗ the vote window should be 30s, got ${LOBBY_VOTE_MS}ms`)
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
  const edge = m.cell.x * CELL + (m.cell.x < LOBBY_CROSS.x ? 0 : CELL) + MAZE_ORIGIN
  const outside = m.cell.x < LOBBY_CROSS.x ? sign.x < edge - SIGN_CLEAR_M + 0.01 : sign.x > edge + SIGN_CLEAR_M - 0.01
  if (!outside || Math.abs(sign.z - (m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN)) > 0.01) {
    console.error(`✗ ${m.id} billboard is not on the outer side of its tile`)
    process.exit(1)
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
if (!lobbySrc.includes('BillboardMode.BM_Y') || !lobbySrc.includes('BillboardMode.BM_NONE') || !lobbySrc.includes('overviewSignRotation')) {
  console.error('✗ signs should yaw in play, and copy the overview camera rotation so they stay parallel')
  process.exit(1)
}
if (!lobbySrc.includes('roughness: 1') || !lobbySrc.includes('specularIntensity: 0') || !lobbySrc.includes('metallic: 0')) {
  console.error('✗ sign plates should be matte')
  process.exit(1)
}
if (!lobbySrc.includes('TITLE_FONT = 50') || !lobbySrc.includes('signFaceZ()') || lobbySrc.includes('Vector3.create(1.55')) {
  console.error('✗ titles should be 5 m tall, on the camera face, with no stretched scale')
  process.exit(1)
}
const face = signFaceZ()
const plateNear = SIGN_CAMERA_AXIS * (SIGN_PLATE_DEPTH_M / 2)
const lipNear = SIGN_LIP_Z + SIGN_CAMERA_AXIS * (SIGN_LIP_DEPTH_M / 2)
const slabNear = SIGN_CAMERA_AXIS < 0 ? Math.min(plateNear, lipNear) : Math.max(plateNear, lipNear)
const inFront = (face - slabNear) * SIGN_CAMERA_AXIS
if (inFront < 0.1) {
  console.error(`✗ sign text Z ${face.toFixed(2)} is not on the camera side of the plate (gap ${inFront.toFixed(2)} m)`)
  process.exit(1)
}
if (modeTitle('pvb') !== 'BOT FIGHT' || modeTitle('pvp') !== 'TEAM FIGHT' || modeSubtitle('pvb') !== 'vs Bots' || modeSubtitle('pvp') !== 'vs Players') {
  console.error('✗ lobby choices should read BOT FIGHT and TEAM FIGHT')
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

const tied = emptyCounts()
tied.pvp = 2
tied.pvb = 2
if (pickWinner(tied, 'pvb') !== 'pvb') {
  console.error('✗ a tie should keep the previous mode')
  process.exit(1)
}
if (pickWinner(tied, 'garden') !== 'pvp') {
  console.error('✗ a tie with a previous mode that is not tied should fall back to PvP')
  process.exit(1)
}
const none = emptyCounts()
if (pickWinner(none, 'pvb') !== null) {
  console.error('✗ zero votes should not pick a winner')
  process.exit(1)
}
const lead = emptyCounts()
lead.pvb = 3
lead.pvp = 1
if (pickWinner(lead, 'pvp') !== 'pvb') {
  console.error('✗ the higher count should win')
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
const lobbyFn = server.slice(server.indexOf('function openLobby'), server.indexOf('function closeCountdown'))
if (lobbyFn.includes('rebuildBotGraph') || lobbyFn.includes('anvilsMazeChanged')) {
  console.error('✗ the lobby regen must not rebuild the bot graph or reseat anvils')
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
if (!rebuild.includes('holdSeed || layoutKind === \'lobby\'')) {
  console.error('✗ a maze seed can still replace the lobby')
  process.exit(1)
}
const rescue = readFileSync(new URL('../src/client/fallRescue.ts', import.meta.url), 'utf8')
if (!rescue.includes('isLobbyLayout()') || !rescue.includes('lobbyFeet')) {
  console.error('✗ fall rescue should return to the cross during the lobby')
  process.exit(1)
}

console.log('✓ lobby layout, votes, and match gates')
