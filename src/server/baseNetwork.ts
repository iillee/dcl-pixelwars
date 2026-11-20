/**
 * Server-side BASES network: seed and lock each team's base tiles,
 * flood-fill connected territory, and accrue charge.
 */
import { baseTeamOfCellId } from '../maze/generator'
import {
  accrueProgress, connectedCells, GROWTH_PER_CELL_PER_SEC, VICTORY_PROGRESS,
  type BaseSnapshot,
} from '../shared/bases'
import type { WalkableGraph } from '../shared/mazeGraph'
import { seedOwned, setLockTeamBases, teamOfCell } from './paintState'
import { getWalkableGraph } from './bots/manager'

const origins: { 1: string[]; 2: string[] } = { 1: [], 2: [] }
const connected: { 1: Set<string>; 2: Set<string> } = { 1: new Set(), 2: new Set() }
let redProgress = 0
let blueProgress = 0
let dirty = true

export function clearBaseNetwork(): void {
  origins[1] = []
  origins[2] = []
  connected[1] = new Set()
  connected[2] = new Set()
  redProgress = 0
  blueProgress = 0
  dirty = true
  setLockTeamBases(false)
}

export function markNetworkDirty(): void {
  dirty = true
}

export function baseOrigins(team: 1 | 2): readonly string[] {
  return origins[team]
}

export function connectedSet(team: 1 | 2): ReadonlySet<string> {
  return connected[team]
}

export function baseProgress(): { red: number; blue: number } {
  return { red: redProgress, blue: blueProgress }
}

/** Walkable cells on each team's base tiles, painted and locked. */
export function seedBaseTerritory(): void {
  const graph = getWalkableGraph()
  origins[1] = []
  origins[2] = []
  if (!graph) { dirty = true; return }
  for (const id of graph.nodes) {
    const team = baseTeamOfCellId(id)
    if (team !== 1 && team !== 2) continue
    seedOwned(id, team, 'base', 0)
    origins[team].push(id)
  }
  setLockTeamBases(true)
  dirty = true
}

function recompute(graph: WalkableGraph): void {
  connected[1] = connectedCells(1, origins[1], teamOfCell, graph.adj)
  connected[2] = connectedCells(2, origins[2], teamOfCell, graph.adj)
  dirty = false
}

export function syncBaseNetwork(graph: WalkableGraph | null): void {
  if (!graph) return
  if (dirty) recompute(graph)
}

export function tickBaseGrowth(dt: number, graph: WalkableGraph | null): BaseSnapshot {
  if (graph && dirty) recompute(graph)
  const redN = connected[1].size
  const blueN = connected[2].size
  const redBefore = redProgress
  const blueBefore = blueProgress
  redProgress = accrueProgress(redProgress, redN, dt, GROWTH_PER_CELL_PER_SEC, VICTORY_PROGRESS)
  blueProgress = accrueProgress(blueProgress, blueN, dt, GROWTH_PER_CELL_PER_SEC, VICTORY_PROGRESS)
  return {
    redConnected: redN,
    blueConnected: blueN,
    redProgress,
    blueProgress,
    threshold: VICTORY_PROGRESS,
    redGrowing: redN > 0 && redProgress > redBefore && redProgress < VICTORY_PROGRESS,
    blueGrowing: blueN > 0 && blueProgress > blueBefore && blueProgress < VICTORY_PROGRESS,
  }
}

export function baseSnapshot(): BaseSnapshot {
  return {
    redConnected: connected[1].size,
    blueConnected: connected[2].size,
    redProgress,
    blueProgress,
    threshold: VICTORY_PROGRESS,
    redGrowing: false,
    blueGrowing: false,
  }
}
