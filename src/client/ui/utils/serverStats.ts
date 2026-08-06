/**
 * serverStats.ts — read the server-authored ServerStats CRDT for the HUD.
 */

import { engine } from '@dcl/sdk/ecs'

import { ServerStats } from 'src/shared/components'
import { paintGridCapacity } from 'src/shared/paintGrid'
import {
	MAZE_GRID_HEIGHT,
	MAZE_GRID_WIDTH,
	MAZE_TILE_WORLD_METERS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'


export type ServerStatsSnapshot = {
	tiles:             number
	paintResolution:   number
	activeComponents:  number
	maxComponents:     number
	paintedCells:      number
	totalChanges:      number
	changesLast1s:     number
	changesLast10s:    number
	changesLast60s:    number
}

export type ServerStatsRow = {
	label: string
	value: string
}


// MARK: readServerStats

/** Current ServerStats replica, or zeros until it arrives. */
export function readServerStats(): ServerStatsSnapshot {
	for (const [, s] of engine.getEntitiesWith(ServerStats)) {
		return s
	}
	const cap = paintGridCapacity()
	return {
		tiles:             cap.tiles,
		paintResolution:   PAINT_CELLS_PER_TILE_AXIS,
		activeComponents:  0,
		maxComponents:     cap.cellCapacity,
		paintedCells:      0,
		totalChanges:      0,
		changesLast1s:     0,
		changesLast10s:    0,
		changesLast60s:    0,
	}
}


// MARK: formatCellSizeMeters

function formatCellSizeMeters(paintResolution: number): string {
	const meters = MAZE_TILE_WORLD_METERS / Math.max(1, paintResolution)
	if (Number.isInteger(meters)) return `${meters} m`
	return `${meters.toFixed(2)} m`
}


// MARK: formatServerStatsRows

export function formatServerStatsRows(s: ServerStatsSnapshot): ServerStatsRow[] {
	const res          = s.paintResolution
	const cellsPerTile = res * res
	const levels       = s.tiles > 0 && cellsPerTile > 0
		? Math.round(s.maxComponents / (s.tiles * cellsPerTile))
		: 0

	return [
		{ label: 'Maze grid',      value: `${MAZE_GRID_WIDTH}×${MAZE_GRID_HEIGHT} (${s.tiles} slots)` },
		{ label: 'Stack levels',   value: `${levels}` },
		{ label: 'Cells / tile',   value: `${res}×${res}` },
		{ label: 'Cell size',      value: formatCellSizeMeters(res) },
		{ label: 'Capacity',       value: `${s.maxComponents.toLocaleString()}  (${s.tiles}×${levels}×${res}²)` },
		{ label: 'Synced cells',   value: `${s.activeComponents.toLocaleString()} / ${s.maxComponents.toLocaleString()}` },
		{ label: 'Painted now',    value: s.paintedCells.toLocaleString() },
		{ label: 'Total changes',  value: s.totalChanges.toLocaleString() },
		{ label: 'Changes / 1s',   value: s.changesLast1s.toLocaleString() },
		{ label: 'Changes / 10s',  value: s.changesLast10s.toLocaleString() },
		{ label: 'Changes / 60s',  value: s.changesLast60s.toLocaleString() },
	]
}
