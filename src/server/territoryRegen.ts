/**
 * Prototype paint regen on cured friendly ground. Depots are not used.
 * The server is authoritative; the client only interpolates between wallet echoes.
 */
import { baseTeamOfCellId } from '../maze/generator'
import { accruePaint, isRegenEligible, PAINT_CAPACITY, PAINT_CURE_S, PAINT_REFILL_PER_SEC } from '../shared/territory'
import { getWalkableGraph } from './bots/manager'
import { seedOwned, teamOfCell, ownedSince } from './paintState'
import { setWallet, walletOf } from './paintWallet'

export type RegenStance = { id: string; team: number; cell: string; y: number; grounded: boolean }

const STALE_MS = 800
const stance = new Map<string, { cell: string; y: number; grounded: boolean; t: number }>()
const frac = new Map<string, number>()
/** Players last told they are regenerating, so a stop can echo regen=0 once. */
const regenerating = new Set<string>()

export function clearTerritoryRegen(): void {
  stance.clear()
  frac.clear()
  regenerating.clear()
}

export function noteRegenStance(id: string, cell: string, y: number, grounded: boolean, now = Date.now()): void {
  if (!id) return
  stance.set(id, { cell, y, grounded, t: now })
}

/** Walkable cells on each team's base tiles, already cured so spawn can refill at once. */
export function seedStartTerritory(): void {
  const graph = getWalkableGraph()
  if (!graph) return
  for (const id of graph.nodes) {
    const team = baseTeamOfCellId(id)
    if (team !== 1 && team !== 2) continue
    seedOwned(id, team, 'base', 0)
  }
}

/** Nearest cured friendly cell, preferring the one the bot is already on. */
export function nearestCuredCell(team: number, fromCell: string, now = Date.now()): string | null {
  const graph = getWalkableGraph()
  if (!graph) return null
  if (isRegenEligible({
    team,
    cellTeam: teamOfCell(fromCell),
    ownedSince: ownedSince(fromCell),
    now,
    grounded: true,
    feetY: graph.worldPos.get(fromCell)?.[1] ?? 0,
    cellY: graph.worldPos.get(fromCell)?.[1] ?? 0,
  })) return fromCell
  const from = graph.worldPos.get(fromCell)
  let best: string | null = null
  let bestD = Infinity
  for (const id of graph.nodes) {
    const p = graph.worldPos.get(id)
    if (!p) continue
    if (!isRegenEligible({
      team,
      cellTeam: teamOfCell(id),
      ownedSince: ownedSince(id),
      now,
      grounded: true,
      feetY: p[1],
      cellY: p[1],
    })) continue
    const dist = from ? Math.hypot(p[0] - from[0], p[2] - from[2]) : 0
    if (dist < bestD) { bestD = dist; best = id }
  }
  return best
}

export function stanceIsRegenEligible(team: number, cell: string, y: number, grounded: boolean, now: number): boolean {
  const graph = getWalkableGraph()
  const cellY = graph?.worldPos.get(cell)?.[1]
  if (cellY === undefined) return false
  return isRegenEligible({
    team,
    cellTeam: teamOfCell(cell),
    ownedSince: ownedSince(cell),
    now,
    grounded,
    feetY: y,
    cellY,
  })
}

/**
 * Accrue paint for anyone standing on cured friendly ground. `people` is the
 * live bot list; human stance comes from the last paintTick.
 */
export function tickTerritoryRegen(
  dt: number,
  people: RegenStance[],
  teamOf: (id: string) => number | null,
  pushWallet: (id: string, tank: number, regen: number) => void,
  now = Date.now(),
): void {
  const graph = getWalkableGraph()
  if (!graph) return
  const queue: RegenStance[] = people.slice()
  for (const [id, s] of stance) {
    if (now - s.t > STALE_MS) continue
    const team = teamOf(id)
    if (team !== 1 && team !== 2) continue
    queue.push({ id, team, cell: s.cell, y: s.y, grounded: s.grounded })
  }
  const seen = new Set<string>()
  const still = new Set<string>()
  for (const p of queue) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const team = p.team === 1 || p.team === 2 ? p.team : 0
    if (team !== 1 && team !== 2) continue
    const ok = stanceIsRegenEligible(team, p.cell, p.y, p.grounded, now)
    if (!ok) {
      frac.delete(p.id)
      continue
    }
    const have = walletOf(p.id)
    if (have >= PAINT_CAPACITY) {
      frac.delete(p.id)
      continue
    }
    const next = accruePaint(have, frac.get(p.id) ?? 0, dt, PAINT_REFILL_PER_SEC, PAINT_CAPACITY)
    frac.set(p.id, next.frac)
    still.add(p.id)
    if (next.gained <= 0) continue
    setWallet(p.id, next.tank)
    if (!p.id.startsWith('bot:')) pushWallet(p.id, next.tank, 1)
  }
  for (const id of [...regenerating]) {
    if (still.has(id)) continue
    regenerating.delete(id)
    if (!id.startsWith('bot:')) pushWallet(id, walletOf(id), 0)
  }
  for (const id of still) regenerating.add(id)
}

export { PAINT_CURE_S }
