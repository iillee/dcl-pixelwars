/**
 * Pick a safe painted cell to revive a player or bot after a fall.
 * Pure. The server is the authority; the client only follows the
 * destination it is told (or a local fallback if none has arrived).
 *
 * Prefers a deep, well-connected walkable cell of the team's colour,
 * nearest to where they fell. Falls back to less ideal painted cells,
 * then the caller uses the team spawn if nothing is painted.
 */
export type RescueVec = { x: number; y: number; z: number }

export type RescueGraph = {
  worldPos: Map<string, [number, number, number]>
  distToWall: Map<string, number>
  deepNodes: Set<string>
  nodes: Set<string>
  adj: Map<string, string[]>
}

export type PaintedCell = { id: string; team: number }

export type RescuePick = { id: string; pos: RescueVec }

const MIN_NEIGHBORS = 2

function distSq(a: RescueVec, b: RescueVec): number {
  const dy = a.y - b.y
  return (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z) + dy * dy * 0.25
}

/**
 * Nearest painted cell of `team` that is safe to land on.
 * `from` is the fall / knock-off point (or last known position).
 * `occupied` is cell ids already held by other bots or riders.
 * Returns null when the team has no usable paint, so the caller
 * can fall back to the normal spawn.
 */
export function pickTeamRescueCell(
  team: number,
  from: RescueVec,
  painted: Iterable<PaintedCell>,
  graph: RescueGraph,
  occupied?: Set<string>,
): RescuePick | null {
  if (team !== 1 && team !== 2) return null
  type Cand = { id: string; pos: RescueVec; wall: number; neighbors: number; deep: boolean; dist: number }
  const cands: Cand[] = []
  for (const cell of painted) {
    if (cell.team !== team) continue
    const id = cell.id
    if (!graph.nodes.has(id)) continue
    if (occupied?.has(id)) continue
    const p = graph.worldPos.get(id)
    if (!p) continue
    const pos = { x: p[0], y: p[1], z: p[2] }
    const wall = graph.distToWall.get(id) ?? 0
    const neighbors = (graph.adj.get(id) ?? []).length
    cands.push({
      id,
      pos,
      wall,
      neighbors,
      deep: graph.deepNodes.has(id) || wall >= 1,
      dist: distSq(from, pos),
    })
  }
  if (cands.length === 0) return null
  const nearest = (list: Cand[]): RescuePick => {
    let best = list[0]
    for (const c of list) if (c.dist < best.dist) best = c
    return { id: best.id, pos: best.pos }
  }
  const deepConnected = cands.filter(c => c.deep && c.neighbors >= MIN_NEIGHBORS)
  if (deepConnected.length) return nearest(deepConnected)
  const deep = cands.filter(c => c.deep)
  if (deep.length) return nearest(deep)
  const connected = cands.filter(c => c.neighbors >= MIN_NEIGHBORS)
  if (connected.length) return nearest(connected)
  const hasNeighbor = cands.filter(c => c.neighbors >= 1)
  if (hasNeighbor.length) return nearest(hasNeighbor)
  return nearest(cands)
}
