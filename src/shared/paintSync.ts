/**
 * paintSync.ts — server create + syncEntity for PaintCoverage / Palette / PaintCell.
 *
 * Only the server calls these. Clients observe replicas via getEntitiesWith.
 *
 * syncEntity requires myProfile.networkId (async). If boot races that, we
 * create the entity anyway and retry sync on later writes — otherwise paint
 * stays server-local and clients see nothing.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { myProfile, syncEntity } from '@dcl/sdk/network'

import {
	PaintCell,
	PaletteEntry,
	PaintCoverage,
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

export const PREBOUND_PALETTE_SLOTS = 8

const cellEntities    = new Map<number, Entity>()
const paletteEntities = new Map<number, Entity>()

let paintCoverageEntity: Entity | null = null
let initialized = false


// MARK: getPaintCoverageEntity

export function getPaintCoverageEntity(): Entity | null {
	return paintCoverageEntity
}


// MARK: getPaintCellEntity

export function getPaintCellEntity(key: number): Entity | undefined {
	return cellEntities.get(key)
}


// MARK: eachPaintCellEntity

export function eachPaintCellEntity(): IterableIterator<[number, Entity]> {
	return cellEntities.entries()
}


// MARK: paintCellEntityCount

export function paintCellEntityCount(): number {
	return cellEntities.size
}


// MARK: trySync

/**
 * Attach NetworkEntity when the network profile is ready. Safe to call
 * repeatedly — no-ops if already linked or profile not ready yet.
 */
function trySync(entity: Entity, componentIds: number[], networkId: number): void {
	if (NetworkEntity.getOrNull(entity) !== null) return
	if (!myProfile?.networkId) return
	try {
		syncEntity(entity, componentIds, networkId)
	} catch (err) {
		console.error(`[PaintSync] syncEntity@${networkId} failed:`, err)
	}
}


// MARK: ensurePaintCellEntity

/** Create (if needed) and sync a PaintCell for a packed key. */
export function ensurePaintCellEntity(key: number): Entity {
	let e = cellEntities.get(key)
	if (e === undefined) {
		e = engine.addEntity()
		PaintCell.create(e, { index: PALETTE_NONE })
		cellEntities.set(key, e)
	}
	trySync(e, [PaintCell.componentId], cellNetworkId(key))
	return e
}


// MARK: getPaletteEntity

export function getPaletteEntity(index: number): Entity | undefined {
	return paletteEntities.get(index)
}


// MARK: ensurePaletteEntity

/** Create (if needed) and sync a palette slot. */
export function ensurePaletteEntity(index: number): Entity {
	let e = paletteEntities.get(index)
	if (e === undefined) {
		e = engine.addEntity()
		PaletteEntry.create(e, { index, color: Color4.create(0, 0, 0, 0) })
		paletteEntities.set(index, e)
	}
	trySync(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + index)
	return e
}


// MARK: relinkPaintSync

/** Retry syncEntity for coverage + palette after profile becomes ready. */
export function relinkPaintSync(): void {
	if (!initialized || paintCoverageEntity === null) return
	trySync(paintCoverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)
	for (const [index, entity] of paletteEntities) {
		trySync(entity, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + index)
	}
}


// MARK: initPaintSync

/** Create coverage + pre-bound palette entities. Call once from setupServer. */
export function initPaintSync(): void {
	if (initialized) return
	initialized = true

	const cap = paintGridCapacity()
	paintCoverageEntity = engine.addEntity()
	PaintCoverage.create(paintCoverageEntity, { red: 0, blue: 0, total: 0 })
	trySync(paintCoverageEntity, [PaintCoverage.componentId], COVERAGE_NETWORK_ID)

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
		paletteEntities.set(i, e)
		trySync(e, [PaletteEntry.componentId], PALETTE_NETWORK_BASE + i)
	}

	console.log(
		`[PaintSync] grid ${cap.paintCellsPerTileAxis}×${cap.paintCellsPerTileAxis}/tile, ` +
		`tiles=${cap.tiles}, capacity=${cap.cellCapacity}; ` +
		`PaletteEntry=${paletteEntities.size}; PaintCoverage@${COVERAGE_NETWORK_ID}; ` +
		`profileReady=${!!myProfile?.networkId}`
	)
}
