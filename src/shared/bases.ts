/**
 * BASES mode: connected territory feeds a team's central base.
 * Pure numbers and graph walks. The server is authoritative for
 * counts, charge, and victory. Tune the knobs here.
 *
 * Holding 500 connected tiles fills the base in a 3-minute round
 * (500 * 1/s * 180s = 90,000). 300 usually goes to the clock;
 * 750 can win around 2:00.
 */
export const GROWTH_PER_CELL_PER_SEC = 1
export const VICTORY_PROGRESS = 90_000

export function basesOn(format: string): boolean {
  return format === 'bases'
}

/**
 * Friendly cells linked to a team's origins through 4-neighbor
 * walkable adjacency only. Diagonals, air drops, jumps, and
 * teleporter pads are not edges.
 */
export function connectedCells(
  team: number,
  origins: readonly string[],
  teamOf: (id: string) => number,
  adj: Map<string, readonly string[]>,
): Set<string> {
  const out = new Set<string>()
  const q: string[] = []
  for (const id of origins) {
    if (!id || teamOf(id) !== team || out.has(id)) continue
    out.add(id)
    q.push(id)
  }
  for (let i = 0; i < q.length; i++) {
    const nbrs = adj.get(q[i])
    if (!nbrs) continue
    for (const n of nbrs) {
      if (out.has(n) || teamOf(n) !== team) continue
      out.add(n)
      q.push(n)
    }
  }
  return out
}

export function accrueProgress(
  progress: number,
  connected: number,
  dt: number,
  rate: number = GROWTH_PER_CELL_PER_SEC,
  cap: number = VICTORY_PROGRESS,
): number {
  const cur = Math.min(cap, Math.max(0, progress))
  if (dt <= 0 || connected <= 0 || rate <= 0 || cur >= cap) return cur
  return Math.min(cap, cur + connected * rate * dt)
}

export type BaseVerdict =
  | { kind: 'continue' }
  | { kind: 'winner'; team: 1 | 2 }
  | { kind: 'tie' }

export function baseThresholdVerdict(red: number, blue: number, threshold: number = VICTORY_PROGRESS): BaseVerdict {
  const r = red >= threshold
  const b = blue >= threshold
  if (r && b) return red > blue ? { kind: 'winner', team: 1 } : blue > red ? { kind: 'winner', team: 2 } : { kind: 'tie' }
  if (r) return { kind: 'winner', team: 1 }
  if (b) return { kind: 'winner', team: 2 }
  return { kind: 'continue' }
}

export function baseTimeoutVerdict(red: number, blue: number): BaseVerdict {
  if (red > blue) return { kind: 'winner', team: 1 }
  if (blue > red) return { kind: 'winner', team: 2 }
  return { kind: 'tie' }
}

export type BaseSnapshot = {
  redConnected: number
  blueConnected: number
  redProgress: number
  blueProgress: number
  threshold: number
  redGrowing: boolean
  blueGrowing: boolean
}
