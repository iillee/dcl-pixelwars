/**
 * mazeGraph.ts — pure, engine-free maze topology.
 *
 * Single source of truth for:
 *   1. Per-tile walkability masks (which local (col,row) cells are floor)
 *   2. Mask rotation (matches Tile GLB rotation)
 *   3. Stable cellId format ("tx,tz,ty:col,row")
 *   4. Walkable adjacency graph across a full maze (Placed[] → Map<cellId, cellId[]>)
 *
 * Importable from BOTH client (paint.ts) and server (bots/*). No engine,
 * no @dcl/sdk. Only depends on maze/tiles and maze/generator (both pure).
 *
 * Anything mask-shape-related lives here so paint spawning and bot
 * pathfinding cannot drift out of sync — a bot will never try to walk
 * into a wall because paint would have refused to render there.
 */

import { Placed } from '../maze/generator'
import { TILES, TileType, Dir, rotDir, N, E, S, W, highDirAt, openingsAt } from '../maze/tiles'

// ─── Cell-resolution constants ──────────────────────────────────────
// SIZE = cells per tile edge. 16 → 2m cells at CELL=32m. See paint.ts
// history note for why we can't safely bump this without a material-
// batching rewrite.
export const SIZE = 16
export const ARM = SIZE * 20 / 32       // 10 — corridor width
export const LO = (SIZE - ARM) / 2      // 3 — corridor low index
export const HI = (SIZE + ARM) / 2      // 13 — corridor high index (exclusive)
export const END_CLOSED_VOID = SIZE * 6 / 32 // 3 — rows of void on end's closed side

export const inCorridor = (i: number) => i >= LO && i < HI

// ─── Mask construction ──────────────────────────────────────────────
export type Mask = string[]

const buildMask = (cellChar: (row: number, col: number) => string): Mask => {
  const rows: string[] = []
  for (let r = 0; r < SIZE; r++) {
    let s = ''
    for (let c = 0; c < SIZE; c++) s += cellChar(r, c)
    rows.push(s)
  }
  return rows
}

// Canonical (unrotated) masks. Row 0 = south, col 0 = west. 'F' = floor,
// '.' = void. Rotated per placement via rotateMask().
const CROSS_MASK: Mask    = buildMask((r, c) => (inCorridor(r) || inCorridor(c)) ? 'F' : '.')
const STRAIGHT_MASK: Mask = buildMask((r, c) => inCorridor(c) ? 'F' : '.')
const END_MASK: Mask      = buildMask((r, c) => (inCorridor(c) && r >= END_CLOSED_VOID) ? 'F' : '.')
const TURN_MASK: Mask     = buildMask((r, c) => {
  const nLeg = inCorridor(c) && r >= LO
  const eLeg = inCorridor(r) && c >= LO
  return (nLeg || eLeg) ? 'F' : '.'
})
const FORK_MASK: Mask     = buildMask((r, c) => {
  const nsLeg = inCorridor(c)
  const wLeg  = inCorridor(r) && c < HI
  return (nsLeg || wLeg) ? 'F' : '.'
})
const RAMP_MASK: Mask     = STRAIGHT_MASK
export const RAMP_FLAT_END = 1 // cells of flat landing at each end of the ramp

export const MASKS: Partial<Record<TileType, Mask>> = {
  cross: CROSS_MASK,
  end: END_MASK,
  straight: STRAIGHT_MASK,
  turn: TURN_MASK,
  fork: FORK_MASK,
  ramp: RAMP_MASK,
}

// ─── Mask rotation ──────────────────────────────────────────────────
// 90° CW rotation: new[r][c] = old[c][N-1-r]. Matches the tile GLB rotation
// (Quaternion.fromEulerDegrees(0, r*90, 0) rotates local +Z → world +X).
function rot90cw(m: Mask): Mask {
  const h = m.length
  const rows: string[] = []
  for (let r = 0; r < h; r++) {
    let s = ''
    for (let c = 0; c < h; c++) s += m[c][h - 1 - r]
    rows.push(s)
  }
  return rows
}

export function rotateMask(m: Mask, r: number): Mask {
  r = ((r % 4) + 4) % 4
  let out = m
  for (let i = 0; i < r; i++) out = rot90cw(out)
  return out
}

// ─── Cell IDs ───────────────────────────────────────────────────────
// Stable ID = tile grid coords + local (col,row) after rotation. This is
// the same string paint.ts uses in cellTeam, and the same string that
// flows over the wire in paintDelta messages.
export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
  return `${tx},${tz},${ty}:${col},${row}`
}

// ─── Walkable adjacency graph ───────────────────────────────────────
// Given a full maze (all Placed tiles), produce Map<cellId, cellId[]> of
// 4-connected walkable neighbors. Ramps connect their top-edge cells to
// the upper-level tile they lead to.
//
// Cross-tile neighbors: two same-Y tiles are adjacent iff they sit next to
// each other on the integer grid AND both have openings facing the shared
// edge (this is exactly the invariant the generator enforces on placement,
// so any pair of grid-adjacent tiles at the same Y are safe to link).
//
// Ramp cross-Y: the "high" edge of a ramp connects to the tile above at
// the ramp's high-side neighbor coordinate; the "low" edge behaves as a
// normal same-Y edge to whatever sits at the ramp's Y level.

interface CellCoord { tx: number; tz: number; ty: number; col: number; row: number }

const cellKey = (c: CellCoord) => cellId(c.tx, c.tz, c.ty, c.col, c.row)

/** Enumerate all walkable cells for a single placed tile (post-rotation). */
export function walkableCellsForTile(p: Placed): CellCoord[] {
  const mask = MASKS[p.type]
  if (!mask) return []
  const rotated = rotateMask(mask, p.r)
  const out: CellCoord[] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (rotated[row][col] === 'F') {
        out.push({ tx: p.x, tz: p.z, ty: p.y, col, row })
      }
    }
  }
  return out
}

/**
 * Build the full walkable graph for a completed maze.
 *
 * Returns:
 *   nodes — Set of every walkable cellId in the maze
 *   adj   — Map<cellId, cellId[]> of 4-connected neighbors (may cross tiles)
 */
export interface WalkableGraph {
  nodes: Set<string>
  adj: Map<string, string[]>
}

export function buildWalkableGraph(placed: Placed[]): WalkableGraph {
  const nodes = new Set<string>()
  const adj = new Map<string, string[]>()

  // Index tiles by grid coord for O(1) neighbor lookup. Y stored per (x,z)
  // as a list so ramps stacking multiple levels resolve correctly.
  const tilesByXZ = new Map<string, Placed[]>()
  const xzKey = (x: number, z: number) => `${x},${z}`
  for (const p of placed) {
    const k = xzKey(p.x, p.z)
    const list = tilesByXZ.get(k) ?? []
    list.push(p)
    tilesByXZ.set(k, list)
  }

  // Per-tile mask cache — enumerating all cells is the hot inner loop.
  const cellsByTile = new Map<string, Set<string>>() // xz+y → set of "col,row"
  const tileKey = (p: Placed) => `${p.x},${p.z},${Math.round(p.y * 1000) / 1000}`
  for (const p of placed) {
    const cells = walkableCellsForTile(p)
    const local = new Set<string>()
    for (const c of cells) {
      local.add(`${c.col},${c.row}`)
      nodes.add(cellKey(c))
    }
    cellsByTile.set(tileKey(p), local)
  }

  // Walk each cell, wire 4 orthogonal neighbors.
  //
  // In grid space: N = +row (+Z), E = +col (+X), S = -row, W = -col.
  // Same-tile: neighbor is (col+dc, row+dr) if walkable in the same mask.
  // Cross-tile: neighbor exits through the edge into the adjacent tile;
  //             we look up the adjacent tile at (x+dx, z+dz) at the same Y
  //             (or, for ramps, at the ramp's exit Y).

  // Indexed by Dir (0=N, 1=E, 2=S, 3=W). Written as tuple to satisfy
  // TS's index-signature check on computed keys.
  const dirVec: Array<{ dc: number; dr: number; dx: number; dz: number }> = [
    { dc:  0, dr:  1, dx:  0, dz:  1 }, // N
    { dc:  1, dr:  0, dx:  1, dz:  0 }, // E
    { dc:  0, dr: -1, dx:  0, dz: -1 }, // S
    { dc: -1, dr:  0, dx: -1, dz:  0 }, // W
  ]

  const addEdge = (a: string, b: string) => {
    const list = adj.get(a) ?? []
    if (!list.includes(b)) list.push(b)
    adj.set(a, list)
  }

  for (const p of placed) {
    const tk = tileKey(p)
    const local = cellsByTile.get(tk)!
    const openings = openingsAt(p.type, p.r)
    const rampHigh = highDirAt(p.type, p.r) // world dir of high edge, or null

    for (const cellStr of local) {
      const [col, row] = cellStr.split(',').map(Number)
      const from = cellId(p.x, p.z, p.y, col, row)

      for (const d of [N, E, S, W] as Dir[]) {
        const { dc, dr, dx, dz } = dirVec[d]
        const nc = col + dc
        const nr = row + dr

        // Same-tile neighbor
        if (nc >= 0 && nc < SIZE && nr >= 0 && nr < SIZE) {
          if (local.has(`${nc},${nr}`)) {
            addEdge(from, cellId(p.x, p.z, p.y, nc, nr))
            continue
          }
          // Else: hit a wall inside the same tile — no edge.
          continue
        }

        // Cross-tile: only if this tile opens in direction `d`
        if (!openings.has(d)) continue

        // Determine target Y: for ramps, the "high" edge exits at y+STEP
        // (approx — ramp connects to whatever tile is placed one level up),
        // all other openings exit at same Y. We resolve by picking whichever
        // placed neighbor tile at (x+dx, z+dz) opens back toward us.
        const neighborsAtXZ = tilesByXZ.get(xzKey(p.x + dx, p.z + dz)) ?? []
        for (const np of neighborsAtXZ) {
          const npOpenings = openingsAt(np.type, np.r)
          const back: Dir = ((d + 2) % 4) as Dir
          if (!npOpenings.has(back)) continue
          // Y check: same level, OR ramp-high edge going to y+STEP tile
          const sameY = Math.abs(np.y - p.y) < 0.01
          const isRampHighExit = rampHigh === d && np.y > p.y + 0.01
          const isRampLowLandingFromAbove =
            highDirAt(np.type, np.r) === back && np.y < p.y - 0.01
          if (!sameY && !isRampHighExit && !isRampLowLandingFromAbove) continue

          // Compute mirrored (col,row) on np's edge.
          // We're exiting p at (col,row) through direction d, entering np
          // through direction `back` at the flush cell across the shared edge.
          let ncol = col, nrow = row
          if (d === N)      { nrow = 0 }
          else if (d === S) { nrow = SIZE - 1 }
          else if (d === E) { ncol = 0 }
          else if (d === W) { ncol = SIZE - 1 }

          const npLocal = cellsByTile.get(tileKey(np))
          if (npLocal?.has(`${ncol},${nrow}`)) {
            addEdge(from, cellId(np.x, np.z, np.y, ncol, nrow))
          }
        }
      }
    }
  }

  return { nodes, adj }
}

/**
 * Test/verification helper: BFS from any node, return the count of reachable
 * nodes. If the graph is fully connected (as the generator guarantees), this
 * should equal nodes.size. Used to catch mask/connectivity regressions.
 */
export function reachableCount(graph: WalkableGraph, start: string): number {
  if (!graph.nodes.has(start)) return 0
  const visited = new Set<string>([start])
  const queue = [start]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of graph.adj.get(cur) ?? []) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
    }
  }
  return visited.size
}
