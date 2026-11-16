/**
 * Nearest team-paint rescue cell. Run: npx tsx scripts/verify-team-rescue.ts
 */
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

if (pickTeamRescueCell(0, from, painted, g) || pickTeamRescueCell(3, from, painted, g)) {
  fail('only red or blue teams can be revived on paint')
}

console.log('✓ nearest painted rescue cell, occupancy, safety, and spawn fallback')
