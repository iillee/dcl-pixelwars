/**
 * Prototype depots. Positions come from the walkable graph, so the server
 * and every client pick the same anchors. Ownership is the anchor cell's team.
 */
import { baseSpawn } from '../maze/generator'
import { nearestNode, onDepot, placeDepots, PAINT_CAPACITY, PAINT_REFILL_PER_SEC, type DepotAnchor } from '../shared/territory'
import { applyPaint, teamOfCell } from './paintState'
import { setWallet, walletOf } from './paintWallet'
import { getWalkableGraph } from './bots/manager'

let anchors: DepotAnchor[] = []

export function depotAnchors(): readonly DepotAnchor[] {
  return anchors
}

export function clearDepots(): void {
  anchors = []
}

/** Paint the two base anchors for free. Neutrals stay unpainted until captured. */
export function seedDepots(economy: boolean): void {
  clearDepots()
  if (!economy) return
  const graph = getWalkableGraph()
  if (!graph) return
  const redAt = baseSpawn(1).pos
  const blueAt = baseSpawn(2).pos
  const red = nearestNode(graph, redAt.x, redAt.y, redAt.z)
  const blue = nearestNode(graph, blueAt.x, blueAt.y, blueAt.z)
  if (!red || !blue) return
  anchors = placeDepots(graph, red, blue)
  for (const d of anchors) {
    if (d.owner === 0) continue
    applyPaint(d.id, d.owner, 'depot')
  }
}

export function depotUnder(cell: string): DepotAnchor | null {
  const graph = getWalkableGraph()
  if (!graph || !cell) return null
  let best: DepotAnchor | null = null
  let bestD = Infinity
  for (const d of anchors) {
    if (!onDepot(graph, cell, d.id)) continue
    const p = graph.worldPos.get(cell)
    const q = graph.worldPos.get(d.id)
    const dist = p && q ? Math.hypot(p[0] - q[0], p[2] - q[2]) : 0
    if (dist < bestD) { bestD = dist; best = d }
  }
  return best
}

export function depotOwner(id: string): number {
  return teamOfCell(id)
}

/** Nearest anchor this team currently owns, or null. */
export function friendlyDepotCell(team: number, fromCell: string): string | null {
  const graph = getWalkableGraph()
  if (!graph) return null
  const from = graph.worldPos.get(fromCell)
  let best: string | null = null
  let bestD = Infinity
  for (const d of anchors) {
    if (teamOfCell(d.id) !== team) continue
    const p = graph.worldPos.get(d.id)
    if (!p) continue
    const dist = from ? Math.hypot(p[0] - from[0], p[2] - from[2]) : 0
    if (dist < bestD) { bestD = dist; best = d.id }
  }
  return best
}

const feet = new Map<string, { cell: string; t: number }>()
const frac = new Map<string, number>()

export function noteDepotFeet(id: string, cell: string): void {
  if (!cell) return
  feet.set(id, { cell, t: Date.now() })
}

/** Refill friendly anchors and capture a nearby neutral or enemy one if the tank can pay. */
export function tickDepotRefill(
  dt: number,
  people: Array<{ id: string; team: number; cell: string }>,
  teamOf: (id: string) => number | null,
  paintOne: (id: string, team: number, cell: string) => void,
  pushWallet: (id: string, tank: number) => void,
): void {
  const graph = getWalkableGraph()
  if (!graph || anchors.length === 0) return
  const now = Date.now()
  const queue = people.slice()
  for (const [id, s] of feet) {
    if (now - s.t > 500) continue
    const team = teamOf(id)
    if (team !== 1 && team !== 2) continue
    queue.push({ id, team, cell: s.cell })
  }
  const seen = new Set<string>()
  for (const p of queue) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const spot = depotUnder(p.cell)
    if (!spot) continue
    const team = p.team === 1 || p.team === 2 ? p.team : 0
    if (team !== 1 && team !== 2) continue
    if (teamOfCell(spot.id) !== team) {
      if (walletOf(p.id) <= 0) continue
      paintOne(p.id, team, spot.id)
      continue
    }
    const have = walletOf(p.id)
    if (have >= PAINT_CAPACITY) continue
    const acc = (frac.get(p.id) ?? 0) + PAINT_REFILL_PER_SEC * dt
    const whole = Math.floor(acc)
    frac.set(p.id, acc - whole)
    if (whole <= 0) continue
    const next = Math.min(PAINT_CAPACITY, have + whole)
    setWallet(p.id, next)
    pushWallet(p.id, next)
  }
}
