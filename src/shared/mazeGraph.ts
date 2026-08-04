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

import { Placed, CELL, MAZE_ORIGIN, STEP } from '../maze/generator'
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

// Ramp cells span (SIZE + 1) rows on the canonical slope axis: top landing
// at row=SIZE, matching paint.ts's RAMP_FLAT_END + nIncline + RAMP_FLAT_END
// for our SIZE=16 / CELL=32 / STEP=10.767 tuning. Kept in sync manually.
export const RAMP_ROWS = SIZE + 1

// Cached ramp geometry — mirrors paint.ts rampGeometry(). Only depends on
// CELL, STEP, SIZE, RAMP_FLAT_END so we can build it eagerly at module load.
function computeRampGeometry() {
  const cellSize = CELL / SIZE
  const flatLen = RAMP_FLAT_END * cellSize
  const inclineStart = flatLen
  const inclineEnd = CELL - flatLen
  const inclineLen = inclineEnd - inclineStart
  const slopeLen = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
  const nIncline = Math.round(slopeLen / cellSize)
  const sinA = STEP / slopeLen
  return { cellSize, flatLen, inclineStart, inclineEnd, nIncline, sinA }
}
const RAMP_GEO = computeRampGeometry()

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

/**
 * Enumerate all walkable cells for a single placed tile.
 *
 * Rotation-convention split (matches paint.ts):
 *   - Flat tiles: cellIds are WORLD-AXIS-ALIGNED (col,row). Mask is rotated
 *     via rotateMask() so mask[row][col] indexes world-relative position.
 *   - Ramps: cellIds are CANONICAL (pre-rotation) (col,row). paint.ts's
 *     worldToCellId rotates the player's world position back to canonical
 *     frame via rampCellIdxFromCanonical(). We must emit the same
 *     canonical cellIds or bot paint lands on ids that don't render.
 *
 * Ramps also have RAMP_ROWS (=SIZE+1=17) rows, not SIZE, because paint.ts
 * spawns an extra top landing row at row=SIZE.
 */
export function walkableCellsForTile(p: Placed): CellCoord[] {
  const mask = MASKS[p.type]
  if (!mask) return []
  const out: CellCoord[] = []

  if (TILES[p.type].isRamp) {
    for (let row = 0; row < RAMP_ROWS; row++) {
      for (let col = LO; col < HI; col++) {
        out.push({ tx: p.x, tz: p.z, ty: p.y, col, row })
      }
    }
    return out
  }

  const rotated = rotateMask(mask, p.r)
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
  /** World-space (x,y,z) of the top-center of each walkable cell. Used by
   *  server-side bot position broadcasts. Populated during buildWalkableGraph. */
  worldPos: Map<string, [number, number, number]>
}

// Height offset above tile origin so bot boxes / paint discs sit clear of
// the floor mesh. Must match paint.ts FLAT_OFFSET so bots stand on the same
// visual plane as their paint.
const FLAT_OFFSET = 0.275 * 2

/**
 * World-space center of a single cell within a placed tile. Mirrors the
 * math in paint.ts spawnCellsForTileImmediate() — keep in sync if paint
 * ever moves that transform.
 *
 * Ramp cells are approximated: we linearly interpolate Y from bottom to
 * top based on `row` (canonical, pre-rotation). Good enough for a floating
 * bot marker; not used for actual paint positioning.
 */
function cellCenterWorld(p: Placed, col: number, row: number): [number, number, number] {
  const cellSize = CELL / SIZE
  const tileWorldX = p.x * CELL + MAZE_ORIGIN
  const tileWorldZ = p.z * CELL + MAZE_ORIGIN

  if (TILES[p.type].isRamp) {
    // Canonical (col, row). Compute canonical local (lx, lz) matching the
    // sample positions rampCellIdxFromCanonical would classify to (col, row).
    // Then rotate to world via paint.ts's localToWorld math.
    const lx = (col + 0.5) * cellSize
    let lz: number, wy: number
    if (row < RAMP_FLAT_END) {
      lz = (row + 0.5) * cellSize
      wy = p.y + FLAT_OFFSET
    } else if (row >= RAMP_FLAT_END + RAMP_GEO.nIncline) {
      lz = RAMP_GEO.inclineEnd + (row - RAMP_FLAT_END - RAMP_GEO.nIncline + 0.5) * cellSize
      wy = p.y + STEP + FLAT_OFFSET
    } else {
      const slopeIdx = row - RAMP_FLAT_END
      // Midpoint of this slope cell along canonical Z (approximate; enough for a marker).
      const slopeDist = (slopeIdx + 0.5) * cellSize
      lz = RAMP_GEO.inclineStart + slopeDist * (RAMP_GEO.inclineEnd - RAMP_GEO.inclineStart) /
           (RAMP_GEO.nIncline * cellSize)
      wy = p.y + FLAT_OFFSET + slopeDist * RAMP_GEO.sinA
    }
    const cx = lx - CELL / 2
    const cz = lz - CELL / 2
    const rad = p.r * Math.PI / 2
    const sinR = Math.sin(rad), cosR = Math.cos(rad)
    const wxRel =  cx * cosR + cz * sinR
    const wzRel = -cx * sinR + cz * cosR
    const wx = tileWorldX + CELL / 2 + wxRel
    const wz = tileWorldZ + CELL / 2 + wzRel
    return [wx, wy, wz]
  }

  // Flat tile: (col, row) world-axis after rotateMask, no rotation.
  const wx = tileWorldX + (col + 0.5) * cellSize
  const wz = tileWorldZ + (row + 0.5) * cellSize
  const wy = p.y + FLAT_OFFSET
  return [wx, wy, wz]
}

export function buildWalkableGraph(placed: Placed[]): WalkableGraph {
  const nodes = new Set<string>()
  const adj = new Map<string, string[]>()
  const worldPos = new Map<string, [number, number, number]>()

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
      const id = cellKey(c)
      nodes.add(id)
      worldPos.set(id, cellCenterWorld(p, c.col, c.row))
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

  // ─── Flat-tile adjacency (same-tile + flat↔flat cross-tile) ──────────────────
  // Ramps are handled below via world-position matching: their cellIds are
  // canonical (pre-rotation) so world-direction indexing doesn't apply.
  for (const p of placed) {
    const isRamp = TILES[p.type].isRamp
    const tk = tileKey(p)
    const local = cellsByTile.get(tk)!
    const openings = openingsAt(p.type, p.r)

    for (const cellStr of local) {
      const [col, row] = cellStr.split(',').map(Number)
      const from = cellId(p.x, p.z, p.y, col, row)

      for (const d of [N, E, S, W] as Dir[]) {
        const { dc, dr, dx, dz } = dirVec[d]
        const nc = col + dc
        const nr = row + dr

        // Same-tile neighbour. Bounds differ for ramps (canonical LO..HI × 0..RAMP_ROWS).
        const inBounds = isRamp
          ? (nc >= LO && nc < HI && nr >= 0 && nr < RAMP_ROWS)
          : (nc >= 0 && nc < SIZE && nr >= 0 && nr < SIZE)
        if (inBounds) {
          if (local.has(`${nc},${nr}`)) {
            addEdge(from, cellId(p.x, p.z, p.y, nc, nr))
          }
          continue
        }

        // Cross-tile. Ramps handled in the world-position pass below.
        if (isRamp) continue
        if (!openings.has(d)) continue

        const neighborsAtXZ = tilesByXZ.get(xzKey(p.x + dx, p.z + dz)) ?? []
        for (const np of neighborsAtXZ) {
          if (TILES[np.type].isRamp) continue // ramp neighbours handled below
          const npOpenings = openingsAt(np.type, np.r)
          const back: Dir = ((d + 2) % 4) as Dir
          if (!npOpenings.has(back)) continue
          if (Math.abs(np.y - p.y) > 0.01) continue // flat↔flat is same-Y only

          let ncol = col, nrow = row
          if (d === N)      nrow = 0
          else if (d === S) nrow = SIZE - 1
          else if (d === E) ncol = 0
          else if (d === W) ncol = SIZE - 1

          const npLocal = cellsByTile.get(tileKey(np))
          if (npLocal?.has(`${ncol},${nrow}`)) {
            addEdge(from, cellId(np.x, np.z, np.y, ncol, nrow))
          }
        }
      }
    }
  }

  // ─── Ramp cross-tile edges via world-position matching ──────────────────────
  // For each ramp's canonical S exit (row=0) and N exit (row=SIZE) and each
  // corridor column, find the flush cell in the neighbour tile by matching
  // world (x,z) within half a cell. Uniform whether neighbour is flat or
  // another ramp — both have worldPos populated.
  const cellSizeM = CELL / SIZE
  const posEps = cellSizeM * 0.5
  for (const p of placed) {
    if (!TILES[p.type].isRamp) continue
    const exits: Array<{ canonRow: number; canonDir: Dir; exitY: number }> = [
      { canonRow: 0,    canonDir: S, exitY: p.y },
      { canonRow: SIZE, canonDir: N, exitY: p.y + STEP },
    ]
    for (const { canonRow, canonDir, exitY } of exits) {
      const worldDir = rotDir(canonDir, p.r)
      const { dx, dz } = dirVec[worldDir]
      const neighborsAtXZ = tilesByXZ.get(xzKey(p.x + dx, p.z + dz)) ?? []
      for (let col = LO; col < HI; col++) {
        const fromId = cellId(p.x, p.z, p.y, col, canonRow)
        const fromPos = worldPos.get(fromId)
        if (!fromPos) continue
        const targetX = fromPos[0] + dx * cellSizeM
        const targetZ = fromPos[2] + dz * cellSizeM
        for (const np of neighborsAtXZ) {
          if (Math.abs(np.y - exitY) > 0.01) continue
          const npLocal = cellsByTile.get(tileKey(np))
          if (!npLocal) continue
          let bestId: string | null = null
          let bestDist = Infinity
          for (const localStr of npLocal) {
            const [nc, nr] = localStr.split(',').map(Number)
            const nId = cellId(np.x, np.z, np.y, nc, nr)
            const nPos = worldPos.get(nId)
            if (!nPos) continue
            const dxp = nPos[0] - targetX, dzp = nPos[2] - targetZ
            const dist = Math.sqrt(dxp * dxp + dzp * dzp)
            if (dist < posEps && dist < bestDist) {
              bestDist = dist; bestId = nId
            }
          }
          if (bestId) {
            addEdge(fromId, bestId)
            addEdge(bestId, fromId)
          }
        }
      }
    }
  }

  return { nodes, adj, worldPos }
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

/**
 * BFS shortest path between two cells. Uniform edge cost (every step is
 * one cell), so BFS gives optimal path with no priority-queue overhead.
 * A* would only help if we later add non-uniform costs (e.g. "avoid
 * enemy paint").
 *
 * Returns the path as [start, ..., goal] inclusive, or null if goal is
 * unreachable (should be impossible on a valid maze but bots must fail
 * safe if a race condition ever hands them a stale cellId).
 *
 * `maxNodes` bounds the search to guard against pathological cases
 * (partial graph, cycles from a future bug). At ~12k cells per maze,
 * 20k is a safe ceiling that still permits full-map traversal.
 */
export function findPath(
  graph: WalkableGraph,
  start: string,
  goal: string,
  maxNodes: number = 20000,
): string[] | null {
  if (start === goal) return [start]
  if (!graph.nodes.has(start) || !graph.nodes.has(goal)) return null

  const parent = new Map<string, string>()
  const visited = new Set<string>([start])
  const queue: string[] = [start]
  let head = 0 // avoid O(n) Array.shift on large queues
  let expanded = 0

  while (head < queue.length) {
    const cur = queue[head++]
    if (++expanded > maxNodes) return null
    for (const nb of graph.adj.get(cur) ?? []) {
      if (visited.has(nb)) continue
      visited.add(nb)
      parent.set(nb, cur)
      if (nb === goal) {
        // Reconstruct path from goal back to start.
        const path: string[] = [nb]
        let step = cur
        while (step !== start) { path.push(step); step = parent.get(step)! }
        path.push(start)
        path.reverse()
        return path
      }
      queue.push(nb)
    }
  }
  return null
}
