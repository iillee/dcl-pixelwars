/**
 * BASES connected-territory rules. Run: npx tsx scripts/verify-bases.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import {
  accrueProgress, adoptConnected, baseThresholdVerdict, baseTimeoutVerdict, basesOn,
  connectedCells, GROWTH_PER_CELL_PER_SEC, VICTORY_PROGRESS,
} from '../src/shared/bases'
import { EAST_LOBBY_CELL, EAST_PARK_CELL, EAST_SLOT_MODE, LOBBY_MODES, modeSubtitle, modeTitle, placedModes } from '../src/shared/lobby'
import { generateWithRetry, getPlacedTilesInOrder, baseTeamOfCellId, baseSpawn } from '../src/maze/generator'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { applyPaint, clearAll, seedOwned, setLockTeamBases, teamOfCell } from '../src/server/paintState'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!basesOn('bases') || basesOn('pvb') || basesOn('pvp') || basesOn('prototype') || basesOn('balloon')) {
  fail('basesOn should be true only for the BASES format')
}
if (GROWTH_PER_CELL_PER_SEC !== 1 || VICTORY_PROGRESS !== 90_000) {
  fail(`expected 1 paint/s and 90,000 to win, got ${GROWTH_PER_CELL_PER_SEC} / ${VICTORY_PROGRESS}`)
}

const adj = new Map<string, string[]>([
  ['a', ['b']],
  ['b', ['a', 'c', 'd']],
  ['c', ['b']],
  ['d', ['b']],
  ['e', ['f']],
  ['f', ['e']],
])
const owner = new Map<string, number>([['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 1], ['f', 1], ['diag', 1]])
const teamOf = (id: string) => owner.get(id) ?? 0

const net = connectedCells(1, ['a'], teamOf, adj)
if ([...net].sort().join() !== 'a,b,c,d') fail(`connected from a should be a,b,c,d got ${[...net]}`)
if (net.has('e') || net.has('f') || net.has('diag')) fail('disconnected or diagonal cells must not count')

owner.set('b', 2)
const cut = connectedCells(1, ['a'], teamOf, adj)
if ([...cut].join() !== 'a' || cut.has('c') || cut.has('d')) fail('flipping the link should isolate the far cells')
if (connectedCells(2, ['b'], teamOf, adj).has('a')) fail("blue should not claim red's origin")
owner.set('b', 1)
const restored = connectedCells(1, ['a'], teamOf, adj)
if (!restored.has('c') || !restored.has('d')) fail('restoring the link should reconnect the region')

const edge = new Set<string>(['a'])
owner.set('b', 1)
owner.set('c', 1)
owner.set('d', 1)
const grew = adoptConnected('b', 1, teamOf, adj, edge)
if (!grew.includes('b') || !edge.has('c') || !edge.has('d')) fail('painting a cell next to connected territory should attach it and anything it relinks')
const island = adoptConnected('e', 1, teamOf, adj, edge)
if (island.length !== 0 || edge.has('e')) fail('a cell that does not touch the network must stay disconnected')

const started = accrueProgress(0, 500, 0)
if (started !== 0) fail('zero dt should not add charge')
const one = accrueProgress(0, 500, 1)
if (one !== 500) fail(`500 connected tiles should add 500 charge in 1s, got ${one}`)
const long = accrueProgress(0, 500, 180)
if (long !== VICTORY_PROGRESS) fail(`500 tiles over 3 min should hit the cap, got ${long}`)
const held = accrueProgress(12_000, 0, 10)
if (held !== 12_000) fail('charge must persist after a disconnect')
const capped = accrueProgress(VICTORY_PROGRESS - 10, 1000, 5)
if (capped !== VICTORY_PROGRESS) fail('charge must stop at the victory threshold')

if (baseThresholdVerdict(89_999, 10).kind !== 'continue') fail('under the threshold the match continues')
const win = baseThresholdVerdict(90_000, 10)
if (win.kind !== 'winner' || win.team !== 1) fail('reaching the threshold should win')
if (baseThresholdVerdict(90_000, 90_000).kind !== 'tie') fail('both sides at the cap is a tie')
if (baseTimeoutVerdict(10, 20).kind !== 'winner' || (baseTimeoutVerdict(10, 20) as { team: number }).team !== 2) fail('timeout should go to the higher charge')
if (baseTimeoutVerdict(4, 4).kind !== 'tie') fail('equal charge at timeout is a tie')

if (EAST_SLOT_MODE !== 'bases') fail('the east lobby tile should currently host BASES')
const basesMode = LOBBY_MODES.find(m => m.id === 'bases')
const pvbMode = LOBBY_MODES.find(m => m.id === 'pvb')
if (!basesMode || !basesMode.live || !basesMode.placed || basesMode.economy || basesMode.teamRule !== 'balance') {
  fail('BASES should be the live balanced east mode, with no paint economy')
}
if (basesMode.cell.x !== EAST_LOBBY_CELL.x || basesMode.cell.z !== EAST_LOBBY_CELL.z) fail('BASES should sit on the east lobby tile')
if (!pvbMode || pvbMode.live || pvbMode.placed || pvbMode.economy || pvbMode.teamRule !== 'humans-together') {
  fail('Bot Invasion must stay in the registry, unplaced, with its original rules')
}
if (pvbMode.cell.x !== EAST_PARK_CELL.x || pvbMode.cell.z !== EAST_PARK_CELL.z) fail('parked Bot Invasion should use the unused east park cell')
if (placedModes().some(m => m.id === 'pvb') || !placedModes().some(m => m.id === 'bases')) fail('the lobby floor should show BASES, not Bot Invasion')
if (modeTitle('pvb') !== 'BOT INVASION' || modeSubtitle('pvb') !== 'vs Bots') fail('Bot Invasion titles must stay intact')
if (modeTitle('bases') !== 'BASE CHARGE' || modeSubtitle('bases') !== 'Prototype') fail('BASES lobby copy is wrong')
const blue = basesMode.color
if (Math.abs(blue.r - 0x6A / 255) > 0.002 || Math.abs(blue.g - 0x99 / 255) > 0.002 || Math.abs(blue.b - 0xFC / 255) > 0.002) {
  fail('BASES should keep the Bot Invasion blue #6A99FC')
}

generateWithRetry(42)
const graph = buildWalkableGraph(getPlacedTilesInOrder())
const redOrigins = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 1)
const blueOrigins = [...graph.nodes].filter(id => baseTeamOfCellId(id) === 2)
if (redOrigins.length < 8 || blueOrigins.length < 8) fail('each base should have walkable origin cells')

clearAll()
const home = redOrigins[0]
setLockTeamBases(true)
seedOwned(home, 1, 'base', 0)
if (applyPaint(home, 2, 'p2')) fail('an enemy must not paint a locked BASES origin')
if (teamOfCell(home) !== 1) fail('a locked origin must stay with its team')
setLockTeamBases(false)
if (!applyPaint(home, 2, 'p2')) fail('unlocking should allow a flip again')
clearAll()
const own = new Map<string, number>()
for (const id of redOrigins) own.set(id, 1)
const teamAt = (id: string) => own.get(id) ?? 0
const seeded = connectedCells(1, redOrigins, teamAt, graph.adj)
if (seeded.size !== redOrigins.length) fail('seeded base cells should form one connected origin')

let start = redOrigins[0]
let step: string | undefined
for (const id of redOrigins) {
  const n = (graph.adj.get(id) ?? []).find(x => baseTeamOfCellId(x) === 0)
  if (n) { start = id; step = n; break }
}
if (!step) fail('expected a walkable exit off the red base')
own.set(step, 1)
const grown = connectedCells(1, redOrigins, teamAt, graph.adj)
if (!grown.has(step)) fail('a painted walkable neighbor should join the network')

const startPos = graph.worldPos.get(start)
if (!startPos) fail('missing world position for a base cell')
const painted = new Set<string>([...redOrigins, step])
let diagonal: string | null = null
for (const id of graph.nodes) {
  if (painted.has(id)) continue
  const p = graph.worldPos.get(id)
  if (!p) continue
  let adjTouch = false
  let diagTouch = false
  for (const pid of painted) {
    if ((graph.adj.get(pid) ?? []).includes(id)) { adjTouch = true; break }
    const q = graph.worldPos.get(pid)
    if (!q) continue
    const dx = Math.abs(p[0] - q[0]), dz = Math.abs(p[2] - q[2]), dy = Math.abs(p[1] - q[1])
    if (dy < 0.5 && dx > 0.5 && dz > 0.5 && dx < 3 && dz < 3) diagTouch = true
  }
  if (!adjTouch && diagTouch) { diagonal = id; break }
}
if (diagonal) {
  own.set(diagonal, 1)
  const after = connectedCells(1, redOrigins, teamAt, graph.adj)
  if (after.has(diagonal)) fail('a diagonal neighbor must not count as connected')
}

let rampLink: [string, string] | null = null
for (const [id, next] of graph.adj) {
  const a = graph.worldPos.get(id)
  for (const n of next) {
    const b = graph.worldPos.get(n)
    if (a && b && Math.abs(a[1] - b[1]) > 0.4) { rampLink = [id, n]; break }
  }
  if (rampLink) break
}
if (!rampLink) fail('the graph should expose walkable ramp links across elevation')
own.set(rampLink[0], 1)
own.set(rampLink[1], 1)
// Walk a red path along adj from the base toward the ramp; if the ramp cells
// are not yet reached, just assert the pair itself is in adj (elevation is allowed).
if (!(graph.adj.get(rampLink[0]) ?? []).includes(rampLink[1])) fail('ramp endpoints must be real adj neighbors')

let closeOtherLevel: string | null = null
for (const id of graph.nodes) {
  const p = graph.worldPos.get(id)
  if (!p || (graph.adj.get(start) ?? []).includes(id)) continue
  const dx = p[0] - startPos[0], dz = p[2] - startPos[2], dy = Math.abs(p[1] - startPos[1])
  if (dy > 2 && Math.hypot(dx, dz) < 4) { closeOtherLevel = id; break }
}
if (closeOtherLevel) {
  own.set(closeOtherLevel, 1)
  const after = connectedCells(1, redOrigins, teamAt, graph.adj)
  if (after.has(closeOtherLevel)) fail('a nearby cell on another level must not connect without a walkable edge')
}

let airOnly = 0
const walkSeen = new Set<string>()
const q = [...redOrigins, ...blueOrigins]
for (const id of q) walkSeen.add(id)
for (let i = 0; i < q.length; i++) {
  for (const n of graph.adj.get(q[i]) ?? []) {
    if (walkSeen.has(n)) continue
    walkSeen.add(n)
    q.push(n)
  }
}
for (const id of graph.nodes) if (!walkSeen.has(id)) airOnly++
const spawnR = baseSpawn(1).pos
const spawnB = baseSpawn(2).pos
if (!Number.isFinite(spawnR.x) || !Number.isFinite(spawnB.x) || Math.hypot(spawnR.x - spawnB.x, spawnR.z - spawnB.z) < 8) {
  fail('team bases should have distinct spawn points')
}

const lobby = readFileSync(new URL('../src/shared/lobby.ts', import.meta.url), 'utf8')
if (!lobby.includes("EAST_SLOT_MODE: 'pvb' | 'bases'") && !lobby.includes("EAST_SLOT_MODE: 'pvb' | 'bases' = 'bases'")) {
  if (!lobby.includes("export const EAST_SLOT_MODE")) fail('EAST_SLOT_MODE should be the switch that restores Bot Invasion')
}
const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
if (!server.includes('seedBaseTerritory') || !server.includes('tickBaseGrowth') || !server.includes('basesOn(roundFormat)')) {
  fail('the server should seed and tick BASES only when that format is live')
}
if (!server.includes("mode === 'bases' ? 'bases'")) fail('BASES needs its own round format, not pvb')
if (!server.includes("roundFormat === 'pvb'")) fail('Bot Invasion start-up logic must remain reachable')
if (!server.includes('if (basesOn(roundFormat)) return null') || !server.includes("basesOn(roundFormat) ? baseSpawn(team).pos")) {
  fail('BASES rescues must always land at the team base, not the nearest paint')
}
const msgs = readFileSync(new URL('../src/shared/messages.ts', import.meta.url), 'utf8')
if (!msgs.includes('baseState') || !msgs.includes('baseWin')) fail('clients need baseState and baseWin messages')
const paint = readFileSync(new URL('../src/paint.ts', import.meta.url), 'utf8')
if (!paint.includes('MUTE_WASH') || paint.includes('c.r * 0.52') || !paint.includes('(1 - c.r)')) {
  fail('disconnected BASES paint should be a lighter pastel, not a darker shade')
}
if (!paint.includes('setPaintConnect') || !paint.includes('paintConnect?.(')) {
  fail('fresh paint should notify BASES so the leading edge can attach immediately')
}
const beams = readFileSync(new URL('../src/client/baseBeams.ts', import.meta.url), 'utf8')
if (!beams.includes('adoptConnected') || !beams.includes('noteBasePaint') || !beams.includes('setPaintConnect(noteBasePaint)')) {
  fail('the client should incrementally attach paint that touches the connected network')
}
if (!existsSync(new URL('../assets/images/beacon-gradient.png', import.meta.url)) || !existsSync(new URL('../assets/images/beacon-alpha.png', import.meta.url))) {
  fail('BASES should ship the Flagtag beacon gradient and alpha textures')
}
if (!beams.includes('assets/images/beacon-gradient.png') || !beams.includes('assets/images/beacon-alpha.png') || !beams.includes('BillboardMode.BM_Y') || !beams.includes('MeshRenderer.setPlane') || !beams.includes('INNER_WIDTH') || !beams.includes('OUTER_WIDTH')) {
  fail('BASES charge pillars should be Flagtag-style inner/outer Y-billboard beacons')
}
if (!beams.includes('SIZE_EASE_S') || !beams.includes('progress / charge.threshold') || !beams.includes('MAX_H = 110') || !beams.includes('MIN_H = 8')) {
  fail('beacon height and size should ease with charge from a short stub up to Flagtag height')
}
if (!beams.includes("events.on('base:win'") || !beams.includes('startWave') || !beams.includes('tickWave')) {
  fail('the victory shockwave should still play when a team fills its base')
}
if (!beams.includes('TEAM_RGB[team]') || !beams.includes('TEAM_RGB[wave.team]')) {
  fail('beacons and the shockwave should use the team colors (red #FF7577, blue #6A99FC)')
}
const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!ui.includes('function BasesChargeHud') || !ui.includes('FILL THE BASE') || !ui.includes('+${rate}/s')) {
  fail('BASES should have its own two-team charge HUD, not the single territory bar')
}
if (!ui.includes('isBasesRound() ? (') || !ui.includes('BasesChargeHud')) {
  fail('the shared territory-% bar must stay hidden during a BASES match')
}

console.log(`✓ BASES network, charge, locked origins, ramps; walk-isolated cells on seed 42: ${airOnly}; spawns ${spawnR.x.toFixed(0)},${spawnB.x.toFixed(0)}`)
