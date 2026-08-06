/**
 * paintState.ts — authoritative paint map as sparse PaintCell CRDT + palette.
 *
 * Clients send cell ids via paintTick. Server interns the sender's team
 * Color4 into the palette, writes a Byte index into a per-cell PaintCell
 * component (created on first paint), and publishes coverage on
 * PaintCoverage. No room-message state sync.
 */

import { Color4 } from '@dcl/sdk/math'

import {
	PaintCell,
	PaletteEntry,
	PaintCoverage,
} from 'src/shared/components'
import { cellIdToKey } from 'src/shared/paintGrid'
import {
	colorKey,
	teamColor,
	teamPaletteIndex,
	PALETTE_NONE,
	PALETTE_RED,
	PALETTE_BLUE,
	MAX_PALETTE_INDEX,
	TEAM_COLORS,
} from 'src/shared/palette'
import {
	ensurePaintCellEntity,
	ensurePaletteEntity,
	eachPaintCellEntity,
	getPaintCoverageEntity,
} from 'src/shared/paintSync'
import { Team } from 'src/shared/team'

import { noteComponentChange } from 'src/server/serverStats'

// colorKey → palette index
const colorToIndex = new Map<string, number>()
// index → Color4
const indexToColor: Color4[] = []
let nextPaletteIndex = 0

// cellId → palette index (authoritative). 0 = unpainted.
const cellIndex = new Map<string, number>()

// Coverage dirty flag — coalesced into PaintCoverage at 5 Hz by server.ts.
let coverageDirty = false


// MARK: seedTeamPalette

/**
 * Seed palette indexes 0/1/2 for None/Red/Blue. Call once after initPaintSync
 * so CRDT PaletteEntry entities already exist. Indexes are deterministic.
 */
export function seedTeamPalette(): void {
	internColor(TEAM_COLORS[Team.None]) // → 0
	internColor(TEAM_COLORS[Team.Red])  // → 1
	internColor(TEAM_COLORS[Team.Blue]) // → 2
	if (colorToIndex.get(colorKey(TEAM_COLORS[Team.None])) !== PALETTE_NONE ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Red]))  !== PALETTE_RED ||
		colorToIndex.get(colorKey(TEAM_COLORS[Team.Blue])) !== PALETTE_BLUE) {
		console.error('[PaintState] seedTeamPalette: reserved indexes mismatch')
	}
	publishCoverage()
	console.log('[PaintState] palette seeded: 0=None 1=Red 2=Blue')
}


// MARK: internColor

/**
 * Intern a Color4 into the server palette. Returns the existing index on
 * exact match; otherwise assigns the next free index and writes PaletteEntry
 * BEFORE any cell may reference it.
 */
export function internColor(color: Color4): number {
	const key = colorKey(color)
	const existing = colorToIndex.get(key)
	if (existing !== undefined) return existing

	if (nextPaletteIndex > MAX_PALETTE_INDEX) {
		console.error('[PaintState] internColor: palette full — returning PALETTE_NONE')
		return PALETTE_NONE
	}

	const index = nextPaletteIndex++
	colorToIndex.set(key, index)
	indexToColor[index] = color

	const entity = ensurePaletteEntity(index)
	PaletteEntry.createOrReplace(entity, { index, color })
	return index
}


// MARK: applyPaint

/**
 * Apply a paint from a validated sender's team. Overwrites existing color.
 * Returns true only when the cell's palette index actually changed.
 */
export function applyPaint(id: string, team: number): boolean {
	const index = teamPaletteIndex(team as Team)
	internColor(teamColor(team as Team))

	const prev = cellIndex.get(id) ?? PALETTE_NONE
	if (prev === index) return false

	if (!writeCellIndex(id, index)) return false
	cellIndex.set(id, index)
	coverageDirty = true
	return true
}


// MARK: writeCellIndex

function writeCellIndex(id: string, index: number): boolean {
	const key = cellIdToKey(id)
	if (key === null) {
		// Invalid brush edge / ramp index — drop quietly (client also filters).
		return false
	}
	const entity = ensurePaintCellEntity(key)
	const cur    = PaintCell.getOrNull(entity)
	if (cur?.index === index) return true
	PaintCell.createOrReplace(entity, { index })
	noteComponentChange(1)
	return true
}


// MARK: isCoverageDirty

/** True when coverage CRDT should be republished. */
export function isCoverageDirty(): boolean {
	return coverageDirty
}


// MARK: coverage

/** Live coverage counters from the authoritative cell map. */
export function coverage(): { red: number; blue: number; total: number } {
	let red = 0, blue = 0
	for (const idx of cellIndex.values()) {
		if (idx === PALETTE_RED)       red++
		else if (idx === PALETTE_BLUE) blue++
	}
	return { red, blue, total: cellIndex.size }
}


// MARK: publishCoverage

/** Write PaintCoverage CRDT and clear the dirty flag. */
export function publishCoverage(): void {
	const entity = getPaintCoverageEntity()
	if (entity === null) {
		console.error('[PaintState] publishCoverage: PaintCoverage entity not initialized')
		return
	}
	const c = coverage()
	PaintCoverage.createOrReplace(entity, {
		red:   c.red,
		blue:  c.blue,
		total: c.total,
	})
	coverageDirty = false
}


// MARK: clearAll

/**
 * Round reset: zero every PaintCell component and clear the cell map.
 * Palette entries are kept (stable indexes across rounds).
 */
export function clearAll(): void {
	cellIndex.clear()
	let cleared = 0
	for (const [, entity] of eachPaintCellEntity()) {
		PaintCell.createOrReplace(entity, { index: PALETTE_NONE })
		cleared++
	}
	if (cleared > 0) noteComponentChange(cleared)
	coverageDirty = true
	publishCoverage()
}
