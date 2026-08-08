/**
 * graph.ts - pure, engine-free maze topology.
 *
 * Single source of truth for:
 *   1. Per-tile walkability masks (which local (col,row) cells are floor)
 *   2. Mask rotation (matches Tile GLB rotation)
 *   3. Stable cellId format ("tx,tz,ty:col,row")
 *   4. Walkable adjacency graph across a full maze (Placed[] -> Map<cellId, cellId[]>)
 *
 * Importable from BOTH client (paint) and server (bots). No engine,
 * no @dcl/sdk. Only depends on shared/maze/{tiles,generator} (both pure).
 *
 * Anything mask-shape-related lives here so paint spawning and bot
 * pathfinding cannot drift out of sync - a bot will never try to walk
 * into a wall because paint would have refused to render there.
 */

import {
	CELL,
	MAZE_ORIGIN,
	Placed,
	STEP,
} from 'src/shared/maze/generator'
import {
	Dir,
	E,
	highDirAt,
	N,
	openingsAt,
	rotDir,
	S,
	TILES,
	TileType,
	W,
} from 'src/shared/maze/tiles'
import {
	MAZE_TILE_GLTF_SCALE,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'


// MARK: cell-resolution constants

export const SIZE             = PAINT_CELLS_PER_TILE_AXIS
export const ARM              = SIZE * 20 / 32      // 10 - corridor width
export const LO               = (SIZE - ARM) / 2    // 3  - corridor low index
export const HI               = (SIZE + ARM) / 2    // 13 - corridor high index (exclusive)
export const END_CLOSED_VOID  = SIZE * 6 / 32       // 3  - rows of void on end's closed side

export const inCorridor = (i: number): boolean => i >= LO && i < HI


// MARK: mask construction

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
const STRAIGHT_MASK: Mask = buildMask((_r, c) => inCorridor(c) ? 'F' : '.')
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

// MARK: ramp geometry

/**
 * Cells of flat landing at each end of the ramp. Matches paint.ts's
 * RAMP_FLAT_END_METERS / cellSize.
 */
export const RAMP_FLAT_END = 1

/**
 * Ramp cells span SIZE rows total on the refactor branch (1 flat + 14
 * incline + 1 flat with the incline cap). Kept in sync with paint.ts's
 * rampGeometry() by the identical derivation below.
 */
function computeRampGeometry() {
	const cellSize     = CELL / SIZE
	const flatLen      = RAMP_FLAT_END * cellSize
	const inclineStart = flatLen
	const inclineEnd   = CELL - flatLen
	const inclineLen   = inclineEnd - inclineStart
	const slopeLen     = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
	const nInclineIdeal = Math.round(slopeLen / cellSize)
	const nInclineMax   = SIZE - 2 * RAMP_FLAT_END
	const nIncline      = Math.min(nInclineIdeal, nInclineMax)
	const sinA         = STEP / slopeLen
	return { cellSize, flatLen, inclineStart, inclineEnd, inclineLen, slopeLen, nIncline, sinA }
}
const RAMP_GEO = computeRampGeometry()

/** Total canonical rows on a ramp tile (flat + incline + flat). */
export const RAMP_ROWS = 2 * RAMP_FLAT_END + RAMP_GEO.nIncline

export const MASKS: Partial<Record<TileType, Mask>> = {
	cross:    CROSS_MASK,
	end:      END_MASK,
	straight: STRAIGHT_MASK,
	turn:     TURN_MASK,
	fork:     FORK_MASK,
	ramp:     RAMP_MASK,
}


// MARK: rot90cw

// 90 deg CW rotation: new[r][c] = old[c][N-1-r]. Matches the tile GLB
// rotation (Quaternion.fromEulerDegrees(0, r*90, 0) rotates local +Z ->
// world +X, i.e. N -> E for r=1, which is CW viewed from above).
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


// MARK: rotateMask

/** Rotate a canonical mask by r * 90 deg CW. Idempotent modulo 4. */
export function rotateMask(m: Mask, r: number): Mask {
	r = ((r % 4) + 4) % 4
	let out = m
	for (let i = 0; i < r; i++) out = rot90cw(out)
	return out
}


// MARK: cellId

/**
 * Stable cell ID = tile grid coords + local (col,row) after rotation
 * (flat tiles) or canonical (ramps). Same string paint.ts stores in its
 * cell entity map and CRDT keys.
 */
export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
	return `${tx},${tz},${ty}:${col},${row}`
}


// MARK: walkableCellsForTile

interface CellCoord { tx: number; tz: number; ty: number; col: number; row: number }

const cellKey = (c: CellCoord): string => cellId(c.tx, c.tz, c.ty, c.col, c.row)

/**
 * Enumerate all walkable cells for a single placed tile.
 *
 * Rotation-convention split (matches paint.ts):
 *   - Flat tiles: cellIds are WORLD-AXIS-ALIGNED (col,row). Mask is
 *     rotated via rotateMask() so mask[row][col] indexes world-relative.
 *   - Ramps: cellIds are CANONICAL (pre-rotation) (col,row). paint.ts's
 *     rampCellIdxFromCanonical rotates the player's world position back
 *     to canonical frame. We must emit the same canonical cellIds or
 *     bot paint lands on ids that don't render.
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


// MARK: WalkableGraph

export interface WalkableGraph {
	nodes:      Set<string>
	adj:        Map<string, string[]>
	/** World-space (x,y,z) of the top-center of each walkable cell. */
	worldPos:   Map<string, [number, number, number]>
	/** Manhattan distance from each walkable cell to the nearest wall. */
	distToWall: Map<string, number>
	/**
	 * Eroded subgraph: only cells with distToWall >= DEEP_MARGIN. The
	 * bot uses this exclusively for movement + pathfinding, so it
	 * CANNOT enter a wall cell.
	 */
	deepNodes:  Set<string>
	deepAdj:    Map<string, string[]>
}

/**
 * Minimum distToWall for a cell to be considered "deep centre" and safe
 * for the bot to occupy. 1 fits ARM=10 corridors without fragmenting the
 * deep-subgraph; bumping to 2 was too conservative during main's tuning.
 */
export const DEEP_MARGIN = 1

// Height offset above tile origin so world-position markers sit clear
// of the floor mesh. Must match paint.ts's FLAT_OFFSET.
const FLAT_OFFSET = 0.275 * MAZE_TILE_GLTF_SCALE


// MARK: cellCenterWorld

/**
 * World-space centre of a single cell within a placed tile. Mirrors
 * paint.ts's spawnCellsForTileImmediate() transform math. Ramp cells
 * are approximated linearly along the slope - good enough for a
 * floating bot marker; not used for actual paint positioning.
 */
function cellCenterWorld(p: Placed, col: number, row: number): [number, number, number] {
	const cellSize   = CELL / SIZE
	const tileWorldX = p.x * CELL + MAZE_ORIGIN
	const tileWorldZ = p.z * CELL + MAZE_ORIGIN

	if (TILES[p.type].isRamp) {
		const lx = (col + 0.5) * cellSize
		let lz: number, wy: number
		if (row < RAMP_FLAT_END) {
			lz = (row + 0.5) * cellSize
			wy = p.y + FLAT_OFFSET
		} else if (row >= RAMP_FLAT_END + RAMP_GEO.nIncline) {
			lz = RAMP_GEO.inclineEnd + (row - RAMP_FLAT_END - RAMP_GEO.nIncline + 0.5) * cellSize
			wy = p.y + STEP + FLAT_OFFSET
		} else {
			const slopeIdx  = row - RAMP_FLAT_END
			const slopeDist = (slopeIdx + 0.5) * cellSize
			lz = RAMP_GEO.inclineStart + slopeDist * (RAMP_GEO.inclineEnd - RAMP_GEO.inclineStart) /
				 (RAMP_GEO.nIncline * cellSize)
			wy = p.y + FLAT_OFFSET + slopeDist * RAMP_GEO.sinA
		}
		const cx   = lx - CELL / 2
		const cz   = lz - CELL / 2
		const rad  = p.r * Math.PI / 2
		const sinR = Math.sin(rad), cosR = Math.cos(rad)
		const wxRel =  cx * cosR + cz * sinR
		const wzRel = -cx * sinR + cz * cosR
		const wx = tileWorldX + CELL / 2 + wxRel
		const wz = tileWorldZ + CELL / 2 + wzRel
		return [wx, wy, wz]
	}

	const wx = tileWorldX + (col + 0.5) * cellSize
	const wz = tileWorldZ + (row + 0.5) * cellSize
	const wy = p.y + FLAT_OFFSET
	return [wx, wy, wz]
}


// MARK: buildWalkableGraph

/**
 * Build the full walkable graph for a completed maze. Returns nodes,
 * adjacency, world positions, distance-to-wall, and the eroded deep
 * subgraph used by bot pathfinding.
 */
export function buildWalkableGraph(placed: Placed[]): WalkableGraph {
	const nodes    = new Set<string>()
	const adj      = new Map<string, string[]>()
	const worldPos = new Map<string, [number, number, number]>()

	// Index tiles by (x,z) for O(1) neighbour lookup. Multiple Y values
	// per (x,z) supported (stacked ramps).
	const tilesByXZ = new Map<string, Placed[]>()
	const xzKey = (x: number, z: number) => `${x},${z}`
	for (const p of placed) {
		const k    = xzKey(p.x, p.z)
		const list = tilesByXZ.get(k) ?? []
		list.push(p)
		tilesByXZ.set(k, list)
	}

	// Per-tile mask cache; enumerating all cells is the hot inner loop.
	const cellsByTile = new Map<string, Set<string>>()
	const tileKey     = (p: Placed) => `${p.x},${p.z},${Math.round(p.y * 1000) / 1000}`
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

	// Directional deltas indexed by Dir (0=N, 1=E, 2=S, 3=W).
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

	// Flat-tile adjacency (same-tile + flat<->flat cross-tile). Ramps
	// use the world-position pass below because their cellIds are
	// canonical, not world-axis.
	for (const p of placed) {
		const isRamp   = TILES[p.type].isRamp
		const tk       = tileKey(p)
		const local    = cellsByTile.get(tk)!
		const openings = openingsAt(p.type, p.r)

		for (const cellStr of local) {
			const [col, row] = cellStr.split(',').map(Number)
			const from = cellId(p.x, p.z, p.y, col, row)

			for (const d of [N, E, S, W] as Dir[]) {
				const { dc, dr, dx, dz } = dirVec[d]
				const nc = col + dc
				const nr = row + dr

				const inBounds = isRamp
					? (nc >= LO && nc < HI && nr >= 0 && nr < RAMP_ROWS)
					: (nc >= 0 && nc < SIZE && nr >= 0 && nr < SIZE)
				if (inBounds) {
					if (local.has(`${nc},${nr}`)) {
						addEdge(from, cellId(p.x, p.z, p.y, nc, nr))
					}
					continue
				}

				if (isRamp) continue
				if (!openings.has(d)) continue

				const neighborsAtXZ = tilesByXZ.get(xzKey(p.x + dx, p.z + dz)) ?? []
				for (const np of neighborsAtXZ) {
					if (TILES[np.type].isRamp) continue
					const npOpenings = openingsAt(np.type, np.r)
					const back: Dir  = ((d + 2) % 4) as Dir
					if (!npOpenings.has(back)) continue
					if (Math.abs(np.y - p.y) > 0.01) continue

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

	// Ramp cross-tile edges via world-position matching. Ramp canonical
	// S exit (row=0) leaves at ramp base Y; N exit (row=RAMP_ROWS-1)
	// leaves at base + STEP.
	const cellSizeM = CELL / SIZE
	const posEps    = cellSizeM * 0.5
	for (const p of placed) {
		if (!TILES[p.type].isRamp) continue
		const exits: Array<{ canonRow: number; canonDir: Dir; exitY: number }> = [
			{ canonRow: 0,              canonDir: S, exitY: p.y },
			{ canonRow: RAMP_ROWS - 1,  canonDir: N, exitY: p.y + STEP },
		]
		for (const { canonRow, canonDir, exitY } of exits) {
			const worldDir      = rotDir(canonDir, p.r)
			const { dx, dz }    = dirVec[worldDir]
			const neighborsAtXZ = tilesByXZ.get(xzKey(p.x + dx, p.z + dz)) ?? []
			for (let col = LO; col < HI; col++) {
				const fromId  = cellId(p.x, p.z, p.y, col, canonRow)
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
						const nId  = cellId(np.x, np.z, np.y, nc, nr)
						const nPos = worldPos.get(nId)
						if (!nPos) continue
						const dxp  = nPos[0] - targetX, dzp = nPos[2] - targetZ
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

	// Distance-to-wall via multi-source BFS. Seed from cells with a
	// wall-adjacent side (same-tile neighbour non-walkable, or a
	// tile-boundary direction that isn't an opening).
	const distToWall = new Map<string, number>()
	const wallBfs: string[] = []
	for (const p of placed) {
		const isRamp   = TILES[p.type].isRamp
		const local    = cellsByTile.get(tileKey(p))!
		const openings = openingsAt(p.type, p.r)
		for (const cellStr of local) {
			const [col, row] = cellStr.split(',').map(Number)
			let wallAdj = false
			for (const d of [N, E, S, W] as Dir[]) {
				const { dc, dr } = dirVec[d]
				const nc = col + dc
				const nr = row + dr
				const inBounds = isRamp
					? (nc >= LO && nc < HI && nr >= 0 && nr < RAMP_ROWS)
					: (nc >= 0 && nc < SIZE && nr >= 0 && nr < SIZE)
				if (inBounds) {
					if (!local.has(`${nc},${nr}`)) { wallAdj = true; break }
				} else {
					if (isRamp) {
						if (d === N || d === S) continue
						wallAdj = true; break
					} else {
						if (!openings.has(d)) { wallAdj = true; break }
					}
				}
			}
			if (wallAdj) {
				const id = cellId(p.x, p.z, p.y, col, row)
				distToWall.set(id, 0)
				wallBfs.push(id)
			}
		}
	}
	let bfsHead = 0
	while (bfsHead < wallBfs.length) {
		const cur     = wallBfs[bfsHead++]
		const curDist = distToWall.get(cur)!
		for (const nb of adj.get(cur) ?? []) {
			if (distToWall.has(nb)) continue
			distToWall.set(nb, curDist + 1)
			wallBfs.push(nb)
		}
	}
	// Sort neighbours by distToWall desc so BFS discovers deep cells first.
	const wallDist = (id: string): number => distToWall.get(id) ?? 0
	for (const [, list] of adj) {
		list.sort((a, b) => wallDist(b) - wallDist(a))
	}

	// Eroded "deep" subgraph. Bot pathfinds on this so wall cells are
	// physically absent from its world. Fall back to full graph if
	// erosion would fragment reachability.
	let deepNodes = new Set<string>()
	let deepAdj   = new Map<string, string[]>()
	for (const id of nodes) {
		if ((distToWall.get(id) ?? 0) >= DEEP_MARGIN) deepNodes.add(id)
	}
	for (const id of deepNodes) {
		const filtered = (adj.get(id) ?? []).filter(n => deepNodes.has(n))
		deepAdj.set(id, filtered)
	}
	const firstDeep    = deepNodes.values().next().value as string | undefined
	let   deepReachable = 0
	if (firstDeep) {
		const seen = new Set<string>([firstDeep])
		const q: string[] = [firstDeep]
		let h = 0
		while (h < q.length) {
			for (const nb of deepAdj.get(q[h++]) ?? []) {
				if (!seen.has(nb)) { seen.add(nb); q.push(nb) }
			}
		}
		deepReachable = seen.size
	}
	const deepFragmented = deepNodes.size > 0 && deepReachable < deepNodes.size * 0.95
	if (deepFragmented) {
		console.log(`[Bots] buildWalkableGraph: eroded graph fragmented (${deepReachable}/${deepNodes.size} reachable). Falling back to full graph - wall-hugging may return.`)
		deepNodes = new Set(nodes)
		deepAdj   = new Map()
		for (const [id, list] of adj) deepAdj.set(id, [...list])
	}

	// Diagnostic: distToWall histogram + deep-graph stats.
	const hist = new Map<number, number>()
	let maxDist = 0
	for (const d of distToWall.values()) {
		hist.set(d, (hist.get(d) ?? 0) + 1)
		if (d > maxDist) maxDist = d
	}
	const histStr = [...hist.entries()].sort((a, b) => a[0] - b[0])
		.map(([d, n]) => `${d}:${n}`).join(' ')
	const pct = nodes.size === 0 ? 0 : Math.round(100 * deepNodes.size / nodes.size)
	console.log(`[Bots] buildWalkableGraph: distToWall hist=${histStr} maxDist=${maxDist} deep(>=${DEEP_MARGIN})=${deepNodes.size}/${nodes.size} (${pct}%) reachable=${deepReachable}`)

	return { nodes, adj, worldPos, distToWall, deepNodes, deepAdj }
}


// MARK: reachableCount

/**
 * BFS from a node, return count of reachable nodes. On a valid maze
 * this equals nodes.size (generator guarantees full connectivity).
 * Used to catch mask/connectivity regressions.
 */
export function reachableCount(graph: WalkableGraph, start: string): number {
	if (!graph.nodes.has(start)) return 0
	const visited = new Set<string>([start])
	const queue   = [start]
	while (queue.length) {
		const cur = queue.shift()!
		for (const nb of graph.adj.get(cur) ?? []) {
			if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
		}
	}
	return visited.size
}


// MARK: findPath

/**
 * BFS (or Dijkstra when costOf is supplied) shortest path between two
 * cells. Returns [start, ..., goal] inclusive, or null if unreachable
 * or the cap is hit. useDeepOnly restricts to the eroded subgraph so
 * bots never traverse wall cells. costOf > 1 for cells the bot should
 * avoid (e.g. own paint) lets Dijkstra detour when the alt is short.
 */
export function findPath(
	graph:       WalkableGraph,
	start:       string,
	goal:        string,
	maxNodes:    number  = 20000,
	useDeepOnly: boolean = false,
	costOf?:     (cellId: string) => number,
): string[] | null {
	const nodeSet = useDeepOnly ? graph.deepNodes : graph.nodes
	const adj     = useDeepOnly ? graph.deepAdj   : graph.adj
	if (start === goal) return [start]
	if (!nodeSet.has(start) || !nodeSet.has(goal)) return null

	// Fisher-Yates shuffle for organic, non-axis-aligned paths.
	const shuffled = (list: string[]): string[] => {
		const a = list.slice()
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			const t = a[i]; a[i] = a[j]; a[j] = t
		}
		return a
	}

	const parent = new Map<string, string>()

	// Fast path: unweighted BFS when no cost function is supplied.
	if (!costOf) {
		const visited = new Set<string>([start])
		const queue: string[] = [start]
		let head     = 0
		let expanded = 0
		while (head < queue.length) {
			const cur = queue[head++]
			if (++expanded > maxNodes) return null
			for (const nb of shuffled(adj.get(cur) ?? [])) {
				if (visited.has(nb)) continue
				visited.add(nb)
				parent.set(nb, cur)
				if (nb === goal) {
					const path: string[] = [nb]
					let step = cur
					while (step !== start) { path.push(step); step = parent.get(step)! }
					path.push(start); path.reverse()
					return path
				}
				queue.push(nb)
			}
		}
		return null
	}

	// Weighted path: Dijkstra with a binary min-heap.
	const dist = new Map<string, number>([[start, 0]])
	const heap: Array<{ id: string; g: number; seq: number }> = []
	let seq = 0
	const push = (id: string, g: number) => {
		heap.push({ id, g, seq: seq++ })
		let i = heap.length - 1
		while (i > 0) {
			const p = (i - 1) >> 1
			if (heap[p].g <= heap[i].g) break
			const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp
			i = p
		}
	}
	const pop = (): { id: string; g: number; seq: number } | undefined => {
		if (heap.length === 0) return undefined
		const top  = heap[0]
		const last = heap.pop()!
		if (heap.length > 0) {
			heap[0] = last
			let i = 0
			const n = heap.length
			while (true) {
				const l = i * 2 + 1, r = l + 1
				let best = i
				if (l < n && heap[l].g < heap[best].g) best = l
				if (r < n && heap[r].g < heap[best].g) best = r
				if (best === i) break
				const tmp = heap[best]; heap[best] = heap[i]; heap[i] = tmp
				i = best
			}
		}
		return top
	}

	// Zig-zag bias: small extra cost when the next step continues in
	// the same direction as the previous. Converts straight-then-turn
	// into a staircase on Manhattan-equivalent open stretches.
	const STRAIGHT_PENALTY = 0.15
	const dirOf = (fromId: string, toId: string): [number, number] | null => {
		const a = graph.worldPos.get(fromId)
		const b = graph.worldPos.get(toId)
		if (!a || !b) return null
		return [Math.sign(b[0] - a[0]), Math.sign(b[2] - a[2])]
	}

	push(start, 0)
	let expanded = 0
	while (heap.length > 0) {
		const cur = pop()!
		if (cur.g !== dist.get(cur.id)) continue // stale entry
		if (cur.id === goal) {
			const path: string[] = [goal]
			let step = goal
			while (step !== start) { step = parent.get(step)!; path.push(step) }
			path.reverse()
			return path
		}
		if (++expanded > maxNodes) return null
		const prev  = parent.get(cur.id)
		const inDir = prev ? dirOf(prev, cur.id) : null
		for (const nb of shuffled(adj.get(cur.id) ?? [])) {
			let w = Math.max(1, costOf(nb))
			if (inDir) {
				const outDir = dirOf(cur.id, nb)
				if (outDir && outDir[0] === inDir[0] && outDir[1] === inDir[1]) {
					w += STRAIGHT_PENALTY
				}
			}
			const ng  = cur.g + w
			const old = dist.get(nb)
			if (old === undefined || ng < old) {
				dist.set(nb, ng)
				parent.set(nb, cur.id)
				push(nb, ng)
			}
		}
	}
	return null
}
