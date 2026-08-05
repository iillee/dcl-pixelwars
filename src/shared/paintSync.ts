/**
 * paintSync.ts — register PaintCoverage / PaletteEntry; sparse PaintCell helpers.
 *
 * Both client and server call initPaintSync() so palette/coverage networkIds
 * match. PaintCell entities are created on demand via ensurePaintCellEntity
 * when the server first paints a cell (deterministic networkId from cell key).
 */

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { Color4 } from '@dcl/sdk/math'

import {
	PaintCell,
	PaletteEntry,
	PaintCoverage,
	paintCoverageEntity,
} from 'src/shared/components'
import {
	cellNetworkId,
	COVERAGE_NETWORK_ID,
	PALETTE_NETWORK_BASE,
	paintGridCapacity,
} from 'src/shared/paintGrid'
import {
	TEAM_COLORS,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	MAX_PALETTE_INDEX,
} from 'src/shared/palette'
import { Team } from 'src/shared/team'

/** Pre-bind this many palette slots (headroom beyond team colors). */
export const PREBOUND_PALETTE_SLOTS = 32

const cellEntities    = new Map<number, Entity>()
const paletteEntities = new Map<number, Entity>()

let initialized = false


// MARK: getPaintCellEntity

/** Entity for a packed cell key, or undefined if never painted on this runtime. */
export function getPaintCellEntity(key: number): Entity | undefined {
	return cellEntities.get(key)
}


// MARK: eachPaintCellEntity

/** Iterate all registered (key, entity) paint-cell pairs. */
export function eachPaintCellEntity(): IterableIterator<[number, Entity]> {
	return cellEntities.entries()
}


// MARK: ensurePaintCellEntity

/**
 * Create (or return) the synced PaintCell entity for a packed cell key.
 * networkId is deterministic from the key so client and server agree.
 */
export function ensurePaintCellEntity(key: number): Entity {
	const existing = cellEntities.get(key)
	if (existing !== undefined) return existing
	const e = engine.addEntity()
	PaintCell.create(e, { index: PALETTE_NONE })
	safeSyncEntity(e, [PaintCell.componentId], cellNetworkId(key))
	cellEntities.set(key, e)
	return e
}


// MARK: getPaletteEntity

/** Entity for a palette index, or undefined if not pre-bound / created. */
export function getPaletteEntity(index: number): Entity | undefined {
	return paletteEntities.get(index)
}


// MARK: ensurePaletteEntity

/**
 * Create (or return) a palette entity for index and syncEntity it.
 * Used when internColor exceeds the pre-bound slot count.
 */
export function ensurePaletteEntity(index: number): Entity {
	const existing = paletteEntities.get(index)
	if (existing !== undefined) return existing
	const e = engine.addEntity()
	PaletteEntry.create(e, { index, color: Color4.create(0, 0, 0, 0) })
	safeSyncEntity(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + index)
	paletteEntities.set(index, e)
	return e
}


// MARK: safeSyncEntity

/**
 * syncEntity throws if the networkId is already claimed (stale main.crdt,
 * composite Smart Items, or a prior failed boot). Log and continue so the
 * auth server stays up — room messages still work even if one id collides.
 */
function safeSyncEntity(entity: Entity, componentIds: number[], networkId: number): void {
	try {
		syncEntity(entity, componentIds, networkId)
	} catch (err) {
		console.error(`[PaintSync] syncEntity failed for networkId ${networkId}:`, err)
	}
}


// MARK: initPaintSync

/**
 * Register coverage + palette CRDT entities. PaintCell entities are sparse
 * (ensurePaintCellEntity). Idempotent. Call from setupServer / setupClient.
 */
export function initPaintSync(): void {
	if (initialized) return
	initialized = true

	const cap = paintGridCapacity()
	safeSyncEntity(paintCoverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)

	const seedColors: Array<{ index: number; color: Color4 }> = [
		{ index: PALETTE_NONE, color: TEAM_COLORS[Team.None] },
		{ index: PALETTE_RED,  color: TEAM_COLORS[Team.Red] },
		{ index: PALETTE_BLUE, color: TEAM_COLORS[Team.Blue] },
	]

	const slots = Math.min(PREBOUND_PALETTE_SLOTS, MAX_PALETTE_INDEX + 1)
	for (let i = 0; i < slots; i++) {
		const e = engine.addEntity()
		const seeded = seedColors.find(s => s.index === i)
		PaletteEntry.create(e, {
			index: i,
			color: seeded ? seeded.color : Color4.create(0, 0, 0, 0),
		})
		safeSyncEntity(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + i)
		paletteEntities.set(i, e)
	}

	console.log(
		`[PaintSync] paint grid: PAINT_CELLS_PER_TILE_AXIS=${cap.paintCellsPerTileAxis} ` +
		`(${cap.paintCellsPerTileAxis}×${cap.paintCellsPerTileAxis}/tile), ` +
		`tiles=${cap.tiles}, levels=${cap.levels}, cellCapacity=${cap.cellCapacity}`
	)
	console.log(
		`[PaintSync] sparse PaintCell @ networkId ${cap.cellNetBase}+ordinal; ` +
		`PaletteEntry=${paletteEntities.size}; PaintCoverage@${COVERAGE_NETWORK_ID}`
	)
}
