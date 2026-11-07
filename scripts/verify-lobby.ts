/**
 * Lobby layout and vote rules. Run: npx tsx scripts/verify-lobby.ts
 */
import { CELL, MAZE_ORIGIN, placeLobbyLayout, validate, getPlacedTilesInOrder } from '../src/maze/generator'
import {
  LOBBY_AFK_MS, LOBBY_CROSS, LOBBY_MODES, LOBBY_MOVE_M, emptyCounts, everyPresentInZone,
  lobbyFeet, pickWinner, stillAfk, voteModeAt,
} from '../src/shared/lobby'

const tiles = placeLobbyLayout()
if (tiles.length !== 9) {
  console.error(`✗ lobby should be 9 tiles, got ${tiles.length}`)
  process.exit(1)
}
if (!validate()) {
  console.error('✗ lobby openings do not connect')
  process.exit(1)
}
const cross = tiles.filter(t => t.type === 'cross')
if (cross.length !== 1 || cross[0].x !== LOBBY_CROSS.x || cross[0].z !== LOBBY_CROSS.z || tiles[0].type !== 'cross') {
  console.error('✗ the cross should be the first tile at the center')
  process.exit(1)
}
const ends = getPlacedTilesInOrder().filter(t => t.type === 'end')
if (ends.length !== 4) {
  console.error(`✗ expected 4 end tiles, got ${ends.length}`)
  process.exit(1)
}
for (const m of LOBBY_MODES) {
  const end = ends.find(t => t.x === m.cell.x && t.z === m.cell.z)
  if (!end) {
    console.error(`✗ ${m.id} has no end tile`)
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

console.log('✓ lobby layout and vote rules')
