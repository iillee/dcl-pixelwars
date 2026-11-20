/**
 * Nearest team-paint rescue cell. Run: npx tsx scripts/verify-team-rescue.ts
 */
import { readFileSync } from 'node:fs'
import { pickTeamRescueCell, type RescueGraph, type PaintedCell } from '../src/shared/teamRescue'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function graph(cells: Array<{
  id: string
  x: number
  y?: number
  z: number
  wall?: number
  deep?: boolean
  adj?: string[]
}>): RescueGraph {
  const worldPos = new Map<string, [number, number, number]>()
  const distToWall = new Map<string, number>()
  const deepNodes = new Set<string>()
  const nodes = new Set<string>()
  const adj = new Map<string, string[]>()
  for (const c of cells) {
    nodes.add(c.id)
    worldPos.set(c.id, [c.x, c.y ?? 0, c.z])
    distToWall.set(c.id, c.wall ?? 0)
    if (c.deep || (c.wall ?? 0) >= 1) deepNodes.add(c.id)
    adj.set(c.id, c.adj ?? [])
  }
  return { worldPos, distToWall, deepNodes, nodes, adj }
}

// A 3-cell red patch at the origin, a safer deep red cell further out,
// a blue cell close to the fall, and an edge-only red cell even closer.
const g = graph([
  { id: 'red-a', x: 10, z: 0, wall: 2, deep: true, adj: ['red-b', 'red-c'] },
  { id: 'red-b', x: 12, z: 0, wall: 2, deep: true, adj: ['red-a', 'red-c'] },
  { id: 'red-c', x: 11, z: 2, wall: 1, deep: true, adj: ['red-a', 'red-b'] },
  { id: 'red-edge', x: 1, z: 0, wall: 0, adj: ['red-a'] },
  { id: 'red-lonely', x: 0.5, z: 0, wall: 0, adj: [] },
  { id: 'blue-near', x: 0.2, z: 0, wall: 2, deep: true, adj: ['blue-b'] },
  { id: 'blue-b', x: 0.2, z: 2, wall: 2, deep: true, adj: ['blue-near'] },
  { id: 'walk-neutral', x: 4, z: 0, wall: 2, deep: true, adj: ['red-a'] },
])

const painted: PaintedCell[] = [
  { id: 'red-a', team: 1 },
  { id: 'red-b', team: 1 },
  { id: 'red-c', team: 1 },
  { id: 'red-edge', team: 1 },
  { id: 'red-lonely', team: 1 },
  { id: 'blue-near', team: 2 },
  { id: 'blue-b', team: 2 },
]

const from = { x: 0, y: 0, z: 0 }

const red = pickTeamRescueCell(1, from, painted, g)
if (!red) fail('red should find a painted cell')
if (red.id !== 'red-a') fail(`red should pick the nearest deep connected cell (got ${red.id})`)
if (Math.abs(red.pos.x - 10) > 1e-9) fail('picked cell should keep its world position')

const blue = pickTeamRescueCell(2, from, painted, g)
if (!blue || blue.id !== 'blue-near') fail(`blue should pick its nearest deep cell (got ${blue?.id})`)

const none = pickTeamRescueCell(1, from, [{ id: 'blue-near', team: 2 }], g)
if (none) fail('a team with no paint must fall back to the normal spawn')

const blocked = pickTeamRescueCell(1, from, painted, g, new Set(['red-a']))
if (!blocked || blocked.id !== 'red-c') fail(`an occupied nearest cell should lose to the next safe one (got ${blocked?.id})`)

const onlyEdge: PaintedCell[] = [{ id: 'red-edge', team: 1 }, { id: 'red-lonely', team: 1 }]
const edge = pickTeamRescueCell(1, from, onlyEdge, g)
if (!edge || edge.id !== 'red-edge') fail(`with only unsafe paint, prefer a cell with neighbors over a lonely lip (got ${edge?.id})`)

const unknown = pickTeamRescueCell(1, from, [{ id: 'ghost', team: 1 }], g)
if (unknown) fail('a painted id that is not walkable must be ignored')

if (pickTeamRescueCell(0, from, painted, g)) fail('an unassigned team must not land on paint')

// Green and yellow use the same nearest-own-colour rule, including cells
// whose floor is not the L0 base height.
const raised = graph([
  { id: 'green-a', x: 20, y: 11.05, z: 0, wall: 2, deep: true, adj: ['green-b'] },
  { id: 'green-b', x: 22, y: 11.05, z: 0, wall: 2, deep: true, adj: ['green-a'] },
  { id: 'green-far', x: 80, y: 11.05, z: 0, wall: 2, deep: true, adj: [] },
  { id: 'yellow-high', x: 8, y: 21.55, z: 8, wall: 2, deep: true, adj: ['yellow-b'] },
  { id: 'yellow-b', x: 10, y: 21.55, z: 8, wall: 2, deep: true, adj: ['yellow-high'] },
  { id: 'yellow-low', x: 0.4, y: 0.55, z: 0, wall: 2, deep: true, adj: [] },
  { id: 'red-a', x: 10, z: 0, wall: 2, deep: true, adj: ['red-b'] },
  { id: 'red-b', x: 12, z: 0, wall: 2, deep: true, adj: ['red-a'] },
])
const fourPaint: PaintedCell[] = [
  { id: 'green-a', team: 3 },
  { id: 'green-b', team: 3 },
  { id: 'green-far', team: 3 },
  { id: 'yellow-high', team: 4 },
  { id: 'yellow-b', team: 4 },
  { id: 'yellow-low', team: 4 },
  { id: 'red-a', team: 1 },
]

const green = pickTeamRescueCell(3, from, fourPaint, raised)
if (!green || green.id !== 'green-a') fail(`green should pick its nearest deep cell (got ${green?.id})`)
if (Math.abs(green.pos.y - 11.05) > 1e-9) fail(`green landing should keep the tile height (got ${green.pos.y})`)

const yellow = pickTeamRescueCell(4, { x: 8, y: 21, z: 8 }, fourPaint, raised)
if (!yellow || yellow.id !== 'yellow-high') fail(`yellow should pick the closest own-colour cell at that height (got ${yellow?.id})`)
if (Math.abs(yellow.pos.y - 21.55) > 1e-9) fail(`yellow landing should keep the raised tile height (got ${yellow.pos.y})`)

const yellowNoPaint = pickTeamRescueCell(4, from, [{ id: 'green-a', team: 3 }, { id: 'red-a', team: 1 }], raised)
if (yellowNoPaint) fail('a team with no paint must fall back to the normal spawn')

const src = readFileSync(new URL('../src/shared/teamRescue.ts', import.meta.url), 'utf8')
if (src.includes('team !== 1 && team !== 2')) fail('pickTeamRescueCell should accept all four playing teams')
const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
const paintedFn = server.slice(server.indexOf('function paintedRescueHome'), server.indexOf('const clampRescueT'))
if (paintedFn.includes('team !== 1 && team !== 2')) fail('server paintedRescueHome should not skip green and yellow')

const mgr = readFileSync(new URL('../src/server/bots/manager.ts', import.meta.url), 'utf8')
if (!mgr.includes("b.body.mode === 'knock'") || !mgr.includes('paintedSnap') || !mgr.includes('paintedCells')) {
  fail('bots should only search a painted landing while knocked, and share one paint snapshot per tick')
}

console.log('✓ nearest painted rescue cell, occupancy, safety, four-team landings, and spawn fallback')
