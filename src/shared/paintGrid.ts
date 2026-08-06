/**
 * paintGrid.ts — shared paint-cell coordinate math + CRDT network ids.
 *
 * Safe for client and server. Cell IDs stay
 * `${tx},${tz},${ty}:${col},${row}`. Each painted cell is its own
 * PaintCell CRDT component (sparse — created on first paint) so a write
 * never fans out sibling cells on a single write.
 *
 * Resolution / maze extent knobs live in src/shared/settings.ts.
 */

import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_MAX_LEVEL_INDEX,
	MAZE_RAMP_STEP_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'

// MARK: Settings aliases

export const PAINT_SIZE      = PAINT_CELLS_PER_TILE_AXIS
export const PAINT_STEP      = MAZE_RAMP_STEP_METERS
export const PAINT_MAX_LEVEL = MAZE_MAX_LEVEL_INDEX
export const PAINT_GRID_W    = MAZE_GRID_WIDTH
export const PAINT_GRID_H    = MAZE_GRID_HEIGHT

// MARK: Network ids
// Ranges must not overlap — syncEntity rejects duplicate ids.
// Smart Items auto-claim 8001+ for composite items; paint cells use a high
// sparse-friendly band so we never pre-bind 100k entities below 8001.
// Fixed singleton ids for server-owned syncEntity (except SeedHolder).
//   3000       SeedHolder (transitional client sync)
//   3001       LeaderboardState
//   3100       PaintCoverage
//   3101       ServerStats
//   6000-6255  PaletteEntry
//   100000+    PaintCell (created on first paint)
export const SEED_NETWORK_ID        = 3000
export const LEADERBOARD_NETWORK_ID = 3001
export const PALETTE_NETWORK_BASE   = 6000
export const COVERAGE_NETWORK_ID    = 3100
export const STATS_NETWORK_ID       = 3101
export const CELL_NETWORK_BASE      = 100000


export type CellCoord = {
	tx:  number
	tz:  number
	ty:  number
	col: number
	row: number
}


// MARK: parseCellId

/**
 * Parse a cell id produced by paint.ts cellId().
 * Returns null when the string is malformed or out of range.
 */
export function parseCellId(id: string): CellCoord | null {
	const colon = id.indexOf(':')
	if (colon < 0) return null
	const head = id.slice(0, colon).split(',')
	const tail = id.slice(colon + 1).split(',')
	if (head.length !== 3 || tail.length !== 2) return null
	const tx  = Number(head[0])
	const tz  = Number(head[1])
	const ty  = Number(head[2])
	const col = Number(tail[0])
	const row = Number(tail[1])
	if (![tx, tz, ty, col, row].every(Number.isFinite)) return null
	if (col < 0 || col >= PAINT_SIZE || row < 0 || row >= PAINT_SIZE) return null
	return { tx, tz, ty, col, row }
}


// MARK: tyToLevel

/** Quantize tile Y (meters) to a stack level index 0..PAINT_MAX_LEVEL. */
export function tyToLevel(ty: number): number {
	return Math.round(ty / PAINT_STEP)
}


// MARK: levelToTy

/** Inverse of tyToLevel — 3-decimal rounding matches maze/generator keys. */
export function levelToTy(level: number): number {
	return Math.round(level * PAINT_STEP * 1000) / 1000
}


// MARK: packCellKey

/**
 * Pack cell identity into a dense Int for syncEntity entityEnumId ordinal.
 * Layout: level | tz | tx | row | col — supports SIZE up to 64, grid to 16.
 */
export function packCellKey(
	tx: number,
	tz: number,
	level: number,
	col: number,
	row: number,
): number {
	const perTile  = PAINT_SIZE * PAINT_SIZE
	const perLevel = PAINT_GRID_W * PAINT_GRID_H * perTile
	return level * perLevel
		+ (tz * PAINT_GRID_W + tx) * perTile
		+ row * PAINT_SIZE
		+ col
}


// MARK: unpackCellKey

/** Unpack a key produced by packCellKey. */
export function unpackCellKey(key: number): {
	tx: number
	tz: number
	level: number
	col: number
	row: number
} {
	const perTile  = PAINT_SIZE * PAINT_SIZE
	const perLevel = PAINT_GRID_W * PAINT_GRID_H * perTile
	const level    = Math.floor(key / perLevel)
	let   rem      = key - level * perLevel
	const tileOrd  = Math.floor(rem / perTile)
	rem            = rem - tileOrd * perTile
	const tz       = Math.floor(tileOrd / PAINT_GRID_W)
	const tx       = tileOrd - tz * PAINT_GRID_W
	const row      = Math.floor(rem / PAINT_SIZE)
	const col      = rem - row * PAINT_SIZE
	return { tx, tz, level, col, row }
}


// MARK: cellIdToKey

/** Packed cell ordinal for a cell id, or null if the id is invalid. */
export function cellIdToKey(id: string): number | null {
	const c = parseCellId(id)
	if (!c) return null
	return packCellKey(c.tx, c.tz, tyToLevel(c.ty), c.col, c.row)
}


// MARK: cellKeyToCellId

/** Rebuild a cell id from a packed cell ordinal. */
export function cellKeyToCellId(key: number): string {
	const { tx, tz, level, col, row } = unpackCellKey(key)
	const ty = levelToTy(level)
	return `${tx},${tz},${ty}:${col},${row}`
}


// MARK: cellNetworkId

/**
 * Stable syncEntity entityEnumId for a packed cell key (client + server).
 * With a fixed enum id, NetworkEntity stores { networkId: 0, entityId: this }.
 */
export function cellNetworkId(key: number): number {
	return CELL_NETWORK_BASE + key
}


// MARK: cellKeyFromNetworkId

/**
 * Reverse of cellNetworkId — packed key from NetworkEntity.entityId
 * (the syncEntity entityEnumId). Null if outside the paint-cell band.
 */
export function cellKeyFromNetworkId(entityEnumId: number): number | null {
	const key = entityEnumId - CELL_NETWORK_BASE
	if (key < 0) return null
	return key
}


// MARK: paintGridCapacity

/** Static capacity stats for logging (no engine dependency). */
export function paintGridCapacity(): {
	paintCellsPerTileAxis: number
	tiles:                 number
	levels:                number
	cellCapacity:          number
	cellNetBase:           number
	paletteNetBase:        number
} {
	const levels       = PAINT_MAX_LEVEL + 1
	const tiles        = PAINT_GRID_W * PAINT_GRID_H
	const cellCapacity = tiles * levels * PAINT_SIZE * PAINT_SIZE
	return {
		paintCellsPerTileAxis: PAINT_SIZE,
		tiles,
		levels,
		cellCapacity,
		cellNetBase:           CELL_NETWORK_BASE,
		paletteNetBase:        PALETTE_NETWORK_BASE,
	}
}
