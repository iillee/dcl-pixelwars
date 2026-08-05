// Squareoff paint grid. Phase 1 scaffolding — single-player, single-team for now.
// Design doc: assets/docs/SQUAREOFF-DESIGN.md
// Constants from settings / maze; tile grid Map passed in via init().

import { engine, Transform, MeshRenderer, Material, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

import { PaintCell, PaletteEntry, PaintCoverage, paintCoverageEntity } from 'src/shared/components'
import { events } from 'src/shared/events'
import { cellKeyFromNetworkId, cellKeyToCellId } from 'src/shared/paintGrid'
import { TEAM_COLORS, teamPaletteIndex, PALETTE_NONE, PALETTE_RED, PALETTE_BLUE } from 'src/shared/palette'
import {
	MAZE_ORIGIN_OFFSET_METERS,
	MAZE_TILE_GLTF_SCALE,
	PAINT_BRUSH_SIZE_CELLS,
	PAINT_CELLS_PER_TILE_AXIS,
} from 'src/shared/settings'
import { Team } from 'src/shared/team'

import { playClaimSfx } from 'src/client/audio'

// Team enum lives in shared/; re-exported for existing `import { Team } from './paint'` call sites.
export { Team } from 'src/shared/team'

// Local mirror of the CRDT palette. Seeded with team colors so optimistic
// paint and early chunk updates resolve before PaletteEntry CRDT arrives.
const paletteByIndex = new Map<number, Color4>([
	[PALETTE_NONE, TEAM_COLORS[Team.None]],
	[PALETTE_RED,  TEAM_COLORS[Team.Red]],
	[PALETTE_BLUE, TEAM_COLORS[Team.Blue]],
])

// Last-applied PaintCell index per packed key (skip no-op CRDT echoes).
const cellApplied = new Map<number, number>()

// Cells we painted locally and are still waiting for PaintCell CRDT to
// confirm. Sparse per-cell components mostly eliminate sibling wipes; this
// still covers round-reset zeros and any stale NONE echo.
const optimisticPending = new Set<string>()


// MARK: initPaintNet

/**
 * Wire CRDT observers + round-reset clearing.
 *
 * Paint state arrives via PaintCell / PaletteEntry / PaintCoverage CRDT
 * components (not room messages). Call once from setupClient() after
 * initPaintSync() has registered matching networkIds.
 */
export function initPaintNet(): void {
	events.on('round:reset', () => {
		clearAllPaintState()
	})

	engine.addSystem(() => {
		syncPaletteFromCrdt()
		syncCellsFromCrdt()
	})
}


// MARK: syncPaletteFromCrdt

function syncPaletteFromCrdt(): void {
	for (const [_entity, entry] of engine.getEntitiesWith(PaletteEntry)) {
		// Pre-bound unused slots ship with a=0; ignore until the server
		// interns a real color into that index.
		if (entry.index > PALETTE_BLUE && entry.color.a === 0) continue
		const prev = paletteByIndex.get(entry.index)
		if (prev &&
			prev.r === entry.color.r && prev.g === entry.color.g &&
			prev.b === entry.color.b && prev.a === entry.color.a) {
			continue
		}
		paletteByIndex.set(entry.index, Color4.create(
			entry.color.r, entry.color.g, entry.color.b, entry.color.a,
		))
		// Newly resolved color: re-apply any cells waiting on this index.
		for (const [id, idx] of cellPaintIndex) {
			if (idx === entry.index) applyPaintIndex(id, idx, true)
		}
	}
}


// MARK: syncCellsFromCrdt

function syncCellsFromCrdt(): void {
	for (const [entity, cell] of engine.getEntitiesWith(PaintCell)) {
		const net = NetworkEntity.getOrNull(entity)
		if (!net) continue
		// syncEntity(enumId) stores identity as NetworkEntity.entityId
		// (networkId is 0 for fixed enum ids) — not in the PaintCell payload.
		const key = cellKeyFromNetworkId(net.entityId)
		if (key === null) continue
		if (cellApplied.get(key) === cell.index) continue
		cellApplied.set(key, cell.index)
		const id    = cellKeyToCellId(key)
		const index = cell.index
		if (index === PALETTE_NONE && cellPaintIndex.get(id) === undefined) continue
		if (index === PALETTE_NONE && optimisticPending.has(id)) continue
		if (index !== PALETTE_NONE) optimisticPending.delete(id)
		applyPaintIndex(id, index, false)
	}
}

// MARK: Masks
// One char per paint cell. Canonical (unrotated) orientation.
//   '.' = wall / void          (no cell entity spawned)
//   'F' = flat floor cell      (Y = tile base + FLAT_OFFSET)
//   '0'..'9' = ramp cell       (Y = tile base + (digit / 9) * STEP)
//
// Convention (subject to visual verification):
//   Row 0    = south edge (-Z)
//   Row last = north edge (+Z)
//   Col 0    = west  edge (-X)
//   Col last = east  edge (+X)
export type Mask = string[]

// GLB floor is 0.25 local (0.5m world) above the tile origin. Sit paint cells
// 0.26 local (0.52m world) above origin → 0.02m world above the walkable surface.
export const FLAT_OFFSET = 0.275 * MAZE_TILE_GLTF_SCALE // clears floor + tilted-cell edge sag

// Placeholder masks — designer is re-exporting. Cross is going first so we'll
// author its real mask against the new GLB once it lands. Everything else stays
// empty (no paint cells spawned) until their GLBs are updated too.
//
// Helpers to build masks compactly.
const repeat = (ch: string, n: number) => ch.repeat(n)
// Plus-sign row: `pad` void + `arm` floor + `pad` void, where 2*pad + arm = size.
const plusRow = (size: number, arm: number, mid: string, edge: string = '.') => {
  const pad = (size - arm) / 2
  return repeat(edge, pad) + repeat(mid, arm) + repeat(edge, pad)
}

// All tile masks are 32x32 with a 20-cell-wide corridor (middle band cols/rows
// 6–25) and 6-cell voids at the walls. Canonical (unrotated) orientations per
// TILES in src/index.ts. Row 0 = south, col 0 = west (subject to visual
// verification).
// Cell resolution from settings.PAINT_CELLS_PER_TILE_AXIS.
// Mask constants are ratios of SIZE so corridor shapes stay the same.
const SIZE = PAINT_CELLS_PER_TILE_AXIS
const ARM = SIZE * 20 / 32      // corridor width in cells
const LO = (SIZE - ARM) / 2
const HI = (SIZE + ARM) / 2
const END_CLOSED_VOID = SIZE * 6 / 32  // rows of void on the closed side of `end`
const inCorridor = (i: number) => i >= LO && i < HI

// Build a mask row-by-row from a predicate.
const buildMask = (cellChar: (row: number, col: number) => string): Mask => {
  const rows: string[] = []
  for (let r = 0; r < SIZE; r++) {
    let s = ''
    for (let c = 0; c < SIZE; c++) s += cellChar(r, c)
    rows.push(s)
  }
  return rows
}

// Cross: opens N, E, S, W. Walkable = corridor rows OR corridor cols.
const CROSS_MASK: Mask = buildMask((r, c) =>
  (inCorridor(r) || inCorridor(c)) ? 'F' : '.'
)

// Straight: opens N, S. Corridor is the middle 20 columns, full length.
const STRAIGHT_MASK: Mask = buildMask((r, c) => inCorridor(c) ? 'F' : '.')

// End: opens N only. 16-cell-long chamber flush against the open (N/+Z) edge.
// Row convention (confirmed via end tile): row 0 = south, row 31 = north.
const END_MASK: Mask = buildMask((r, c) => (inCorridor(c) && r >= END_CLOSED_VOID) ? 'F' : '.')

// Turn: opens N and E. L-shape — N-going corridor (middle cols, all rows)
// clipped to rows LO..SIZE (removes the south leg), plus E-going corridor
// (middle rows, cols LO..SIZE) removes the west leg. Equivalent: walkable if
// (in corridor cols AND row >= LO) OR (in corridor rows AND col >= LO).
const TURN_MASK: Mask = buildMask((r, c) => {
  const nLeg = inCorridor(c) && r >= LO   // N opening → arm extends south from N edge, stops at center
  const eLeg = inCorridor(r) && c >= LO   // E opening → arm extends west from E edge, stops at center
  return (nLeg || eLeg) ? 'F' : '.'
})

// Fork: opens N, S, W. T-shape — full N-S corridor + W arm.
const FORK_MASK: Mask = buildMask((r, c) => {
  const nsLeg = inCorridor(c)                // full-length N-S corridor
  const wLeg  = inCorridor(r) && c < HI     // W arm from west edge to center
  return (nsLeg || wLeg) ? 'F' : '.'
})

// Ramp: opens N, S. Same 2D footprint as straight; Y is computed at spawn time
// from the cell's canonical-row position along the slope axis (rampHighDir=N),
// so rotation via the tile's `r` naturally rotates the slope direction too.
const RAMP_MASK: Mask = STRAIGHT_MASK

/**
 * Flat landing length at each end of a ramp, in world meters.
 * Must match tile-ramp.glb (1.0 local × MAZE_TILE_GLTF_SCALE). Do NOT derive
 * this from paint cell size — when SIZE went 16→32, a 1-cell landing shrank
 * from 2m to 1m and the incline math buried the upper half of the slope.
 */
const RAMP_FLAT_END_METERS = 1.0 * MAZE_TILE_GLTF_SCALE

// Ramp geometry derived from CELL and STEP. Same math used by spawn and lookup
// so cellIds agree.
function rampGeometry(CELL: number, STEP: number) {
	const cellSize     = CELL / SIZE
	const flatLen      = RAMP_FLAT_END_METERS
	const nFlat        = Math.max(1, Math.round(flatLen / cellSize))
	const inclineStart = flatLen
	const inclineEnd   = CELL - flatLen
	const inclineLen   = inclineEnd - inclineStart
	const slopeLen     = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
	const nIncline     = Math.round(slopeLen / cellSize)
	const slopeCellSize = slopeLen / nIncline
	const cosA         = inclineLen / slopeLen
	const sinA         = STEP / slopeLen
	return {
		cellSize, flatLen, nFlat,
		inclineStart, inclineEnd, inclineLen,
		slopeLen, nIncline, slopeCellSize, cosA, sinA,
	}
}

// Given canonical (lx, lz) on a ramp, return the cell (col, row) used in
// cellId. Returns null if outside the walkable corridor.
function rampCellIdxFromCanonical(lx: number, lz: number, geom: ReturnType<typeof rampGeometry>): { col: number; row: number } | null {
	const col = Math.floor(lx / geom.cellSize)
	if (col < LO || col >= HI) return null
	let row: number
	if (lz < geom.inclineStart) {
		row = Math.floor(lz / geom.cellSize)
	} else if (lz >= geom.inclineEnd) {
		row = geom.nFlat + geom.nIncline + Math.floor((lz - geom.inclineEnd) / geom.cellSize)
	} else {
		const slopeDist = (lz - geom.inclineStart) / geom.cosA
		row = geom.nFlat + Math.floor(slopeDist / geom.slopeCellSize)
	}
	return { col, row }
}

// Enable masks one at a time as we visually verify each tile type.
export const MASKS: Partial<Record<string, Mask>> = {
  cross: CROSS_MASK,
  end: END_MASK,
  straight: STRAIGHT_MASK,
  turn: TURN_MASK,
  fork: FORK_MASK,
  ramp: RAMP_MASK,
}

// Rotate a mask 90°×r CW (to match tile rotation). If tile at rotation r
// renders with Y-rotation of r*90° CW, the mask must be rotated the same
// amount so that mask[row][col] indexes the same world point regardless of r.
export function rotateMask(m: Mask, r: number): Mask {
  r = ((r % 4) + 4) % 4
  let out = m
  for (let i = 0; i < r; i++) out = rot90cw(out)
  return out
}
function rot90cw(m: Mask): Mask {
  // 90° CW rotation: new[r][c] = old[c][N-1-r]. Matches the tile GLB rotation
  // (Quaternion.fromEulerDegrees(0, r*90, 0) rotates local +Z → world +X, i.e.
  // N → E for r=1, which is CW viewed from above).
  const h = m.length, w = m[0].length
  const rows: string[] = []
  for (let r = 0; r < h; r++) {
    let s = ''
    for (let c = 0; c < w; c++) s += m[c][h - 1 - r]
    rows.push(s)
  }
  return rows
}

// MARK: Cell store
// Stable cell IDs (deterministic from tile pos + local cell) → palette index.
// Format: `${tileX},${tileZ},${tileY}:${cellCol},${cellRow}` (post-rotation local).
const cellPaintIndex = new Map<string, number>()
const cellEntity = new Map<string, Entity>()
// Reverse index: tile entity → all paint cell entities spawned for it, plus
// their cell ids. Used by removePaintForTile() so tile teardown can strip its
// paint in the same chunked pass — no ghost cells linger after the tile is
// gone, and coverage state stays consistent.
const paintByTile = new Map<Entity, { entities: Entity[]; ids: string[] }>()

export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
	return `${tx},${tz},${ty}:${col},${row}`
}

// Matte PBR material. Roughness=1 + metallic=0 + no specular kills the shine
// so paint reads as flat pigment, not plastic. Shared by palette index once
// the Color4 is known.
function cellMaterialFromColor(color: Color4) {
	return {
		albedoColor:       color,
		roughness:         1.0,
		metallic:          0.0,
		specularIntensity: 0.0,
	}
}

function cellMaterialForIndex(index: number): ReturnType<typeof cellMaterialFromColor> | null {
	const color = paletteByIndex.get(index)
	if (!color) return null
	return cellMaterialFromColor(color)
}

// MARK: Deferred spawn
// Paint cells are held back until the tile's grow-in tween finishes so the
// GLB is fully visible before its grid appears. All entries use the same
// delay, so the queue naturally stays FIFO-ordered by dueMs.
const SPAWN_DELAY_MS = 500 // matches spawnTileWithGrow's tween duration
const deferredSpawns: Array<{ dueMs: number; run: () => void }> = []
let spawnClockMs = 0
engine.addSystem((dt: number) => {
  spawnClockMs += dt * 1000
  while (deferredSpawns.length && deferredSpawns[0].dueMs <= spawnClockMs) {
    deferredSpawns.shift()!.run()
  }
})

// Wipe scoring state immediately (so coverage % snaps to 0) without touching
// entities. Actual paint entity removal is driven per-tile by
// removePaintForTile() during the chunked tile teardown — that way paint
// disappears in the same frame as its tile, avoiding ghost cells, while
// the total ~30k removeEntity() cost is spread across several frames.
export function clearAllPaintState() {
	cellPaintIndex.clear()
	cellApplied.clear()
	paintOutbox.clear()
	optimisticPending.clear()
	// cellEntity is left in place; entries are pruned as tiles are torn down.
}

export function removePaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	for (const e of rec.entities) engine.removeEntity(e)
	for (const id of rec.ids) {
		cellEntity.delete(id)
		// Drop the index association — the cell no longer exists, so any
		// stale entry would "poison" a future tile that happens to spawn at
		// the same (tx, tz, ty) with the same cellId.
		cellPaintIndex.delete(id)
		optimisticPending.delete(id)
	}
	paintByTile.delete(tileEntity)
}

/**
 * Reset paint on a tile without destroying its entities. Used for the
 * persistent center-cross tile at round boundaries: the tile geometry
 * stays in place (so players standing on it aren't shoved by grow-in),
 * but its paint cells snap back to unpainted so the new round starts
 * with a clean slate underfoot.
 */
export function resetPaintForTile(tileEntity: Entity) {
	const rec = paintByTile.get(tileEntity)
	if (!rec) return
	const noneMat = cellMaterialForIndex(PALETTE_NONE)!
	for (let i = 0; i < rec.entities.length; i++) {
		Material.setPbrMaterial(rec.entities[i], noneMat)
		cellPaintIndex.set(rec.ids[i], PALETTE_NONE)
		optimisticPending.delete(rec.ids[i])
	}
}

// MARK: Network outbox
// Cell ids the local player has walked onto since the last flush. Client
// drains this at PAINT_TICK_HZ (after teamAssigned) and sends paintTick
// { ids } to the server. Server writes palette indexes into per-cell
// PaintCell CRDT — which is how OUR paint and peers' paint converge.
const paintOutbox = new Set<string>()
export function drainPaintOutbox(): string[] {
	if (paintOutbox.size === 0) return []
	const out: string[] = []
	for (const id of paintOutbox) out.push(id)
	paintOutbox.clear()
	return out
}

/**
 * Register a cell the local player has stepped on. Adds to the outbox for
 * the next server flush AND applies optimistic local paint so our own
 * cells color instantly (no server roundtrip delay behind the avatar).
 *
 * Marks the cell optimisticPending so syncCellsFromCrdt will not apply a
 * stale PALETTE_NONE before paintTick lands. Authority clears the pending
 * flag when it writes any non-zero index.
 */
export function noteLocalPaintCandidate(id: string): void {
	paintOutbox.add(id)
	optimisticPending.add(id)
	const team    = localTeam !== Team.None ? localTeam : Team.Red
	const index   = teamPaletteIndex(team)
	const wasOurs = cellPaintIndex.get(id) === index
	applyPaintIndex(id, index, false)
	if (!wasOurs) playClaimSfx()
}

// Set from clientHandler (provisional Red on boot, then teamAssigned).
let localTeam: Team = Team.None
export function setLocalTeam(team: Team): void {
	localTeam = team
}

/**
 * Apply a palette index to a cell. If the palette entry is not yet known,
 * records the index but skips the material update (defer until PaletteEntry
 * CRDT arrives). force=true re-applies material even when index unchanged
 * (used when a previously-missing palette color becomes resolvable).
 */
export function applyPaintIndex(id: string, index: number, force: boolean): void {
	if (!force && cellPaintIndex.get(id) === index) {
		// Still try material if entity spawned after index was recorded.
		const e = cellEntity.get(id)
		if (e === undefined) return
		const mat = cellMaterialForIndex(index)
		if (mat) Material.setPbrMaterial(e, mat)
		return
	}
	cellPaintIndex.set(id, index)
	const mat = cellMaterialForIndex(index)
	if (!mat) return // unresolved palette — wait for PaletteEntry
	const e = cellEntity.get(id)
	if (e !== undefined) {
		Material.setPbrMaterial(e, mat)
	}
}

// MARK: Spawn cells
// Called from index.ts after a tile is placed. `tileType` selects the mask,
// `r` rotates it, and (tx, tz, ty) locate the tile in the maze grid.
export function spawnCellsForTile(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType]
  if (!raw) return // designer hasn't authored this tile's mask yet
  // Defer the actual spawn so cells appear after the GLB's grow-in tween.
  deferredSpawns.push({
    dueMs: spawnClockMs + SPAWN_DELAY_MS,
    run: () => spawnCellsForTileImmediate(tileType, r, tx, tz, ty, CELL, STEP, tileEntity),
  })
}

function spawnCellsForTileImmediate(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number,
  tileEntity: Entity
) {
  const raw = MASKS[tileType]
  if (!raw) return
  const mask = rotateMask(raw, r)
  const h = mask.length, w = mask[0].length
  // World meters per mask cell. Mask is authored at 1 cell = 1m; the tile
  // fills CELL x CELL world meters, so w should equal CELL.
  const cellSize = CELL / w

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp height helper: canonical ramp rises +Z (N high). After tile rotation
  // r, the slope axis rotates too. Given a world (wx, wz) on the tile, we
  // recover the canonical local (lx, lz) via the same math ROT_OFFSET encodes:
  // local +Z direction, in world frame, is (sin(r*90°), cos(r*90°)) applied to
  // the vector from tile center to the point.
  const isRamp = tileType === 'ramp'
  const rad = r * Math.PI / 2
  const sinR = Math.sin(rad), cosR = Math.cos(rad)
  const geom = rampGeometry(CELL, STEP)
  const slopeAngleDeg = Math.atan2(STEP, geom.inclineLen) * 180 / Math.PI

  // Precomputed rotations. Cell base is -90° around X (face up). Incline cells
  // add slope tilt (negative so the canonical +Z / high edge lifts up). Both
  // then get the tile's yaw (r * 90° around Y) so the tilt axis rotates with
  // the tile — canonical tilt is around world X, rotated versions tilt around
  // the corresponding rotated axis.
  const yaw = Quaternion.fromEulerDegrees(0, r * 90, 0)
  const flatRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90, 0, 0))
  const inclineRot = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(-90 - slopeAngleDeg, 0, 0))

  // Convert canonical local (lx, lz) → world (wx, wz), applying the tile's CW
  // yaw around its center. Same math ROT_OFFSET encodes.
  const localToWorld = (lx: number, lz: number) => {
    const cx = lx - CELL / 2, cz = lz - CELL / 2
    const wxRel =  cx * cosR + cz * sinR
    const wzRel = -cx * sinR + cz * cosR
    return {
      wx: tileWorldX + CELL / 2 + wxRel,
      wz: tileWorldZ + CELL / 2 + wzRel,
    }
  }

  let tileRec = paintByTile.get(tileEntity)
  if (!tileRec) {
    tileRec = { entities: [], ids: [] }
    paintByTile.set(tileEntity, tileRec)
  }

	const spawnOne = (wx: number, wy: number, wz: number, rot: any, col: number, row: number, scaleY: number = cellSize) => {
		const id = cellId(tx, tz, ty, col, row)
		// Adopt any paint that landed on this id BEFORE the entity existed
		// (PaintCell CRDT or optimistic local paint during grow-in delay).
		const preexisting = cellPaintIndex.get(id) ?? PALETTE_NONE
		const e = engine.addEntity()
		Transform.create(e, {
			position: Vector3.create(wx, wy, wz),
			rotation: rot,
			scale: Vector3.create(cellSize, scaleY, 1),
		})
		MeshRenderer.setPlane(e)
		const mat = cellMaterialForIndex(preexisting) ?? cellMaterialForIndex(PALETTE_NONE)!
		Material.setPbrMaterial(e, mat)
		cellEntity.set(id, e)
		cellPaintIndex.set(id, preexisting)
		tileRec!.entities.push(e)
		tileRec!.ids.push(id)
	}

  // Ramp: space incline cells along the SLOPE so they tile flush.
  // (col, row) from rampCellIdxFromCanonical() agree with worldToCellId.
  if (isRamp) {
    // Bottom landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    // Incline — spaced along the slope so cells tile flush on the GLB surface.
    for (let i = 0; i < geom.nIncline; i++) {
      const slopeDist = (i + 0.5) * geom.slopeCellSize
      const lz = geom.inclineStart + slopeDist * geom.cosA
      const y  = ty + FLAT_OFFSET + slopeDist * geom.sinA
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, y, wz, inclineRot, idx.col, idx.row, geom.slopeCellSize)
      }
    }
    // Top landing
    for (let i = 0; i < geom.nFlat; i++) {
      const lz = geom.inclineEnd + (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + STEP + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    return
  }

  // Non-ramp: iterate mask cells.
  const flatRotDefault = Quaternion.fromEulerDegrees(-90, 0, 0)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ch = mask[row][col]
      if (ch === '.') continue
      const wx = tileWorldX + (col + 0.5) * cellSize
      const wz = tileWorldZ + (row + 0.5) * cellSize

      let wy: number
      if (ch === 'F') {
        wy = ty + FLAT_OFFSET
      } else if (ch >= '0' && ch <= '9') {
        const t = (ch.charCodeAt(0) - 48) / 9
        wy = ty + t * STEP + FLAT_OFFSET
      } else {
        continue
      }
      spawnOne(wx, wy, wz, flatRotDefault, col, row)
    }
  }
}

// red / blue = absolute painted-cell counts from PaintCoverage CRDT when
// available; otherwise a local scan of cellPaintIndex.
// total = WALKABLE CELLS IN THE MAZE (cellEntity.size), not "cells touched."
export function coverage(): { red: number; blue: number; total: number } {
	const total = cellEntity.size
	const crdt = PaintCoverage.getOrNull(paintCoverageEntity)
	if (crdt) {
		return { red: crdt.red, blue: crdt.blue, total }
	}
	let red = 0, blue = 0
	for (const idx of cellPaintIndex.values()) {
		if (idx === PALETTE_RED)       red++
		else if (idx === PALETTE_BLUE) blue++
	}
	return { red, blue, total }
}

// MARK: World to cell
// Reverses spawnCellsForTile. Requires a tile lookup callback so we don't
// need to import the maze grid directly.
// Returns null if the player isn't standing on a known walkable cell.
// groundY is the expected walkable-surface Y for the cell — use it to detect
// airborne states (jumping / gliding / falling) by comparing to player.y.
export function worldToCellId(
  px: number, py: number, pz: number,
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null
): { id: string; groundY: number } | null {
  const tx = Math.floor((px - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tz = Math.floor((pz - MAZE_ORIGIN_OFFSET_METERS) / CELL)
  const tile = lookupTile(tx, tz, py)
  if (!tile) return null

  const raw = MASKS[tile.type]
  if (!raw) return null

  const tileWorldX = tx * CELL + MAZE_ORIGIN_OFFSET_METERS
  const tileWorldZ = tz * CELL + MAZE_ORIGIN_OFFSET_METERS

  // Ramp: shared canonical-frame helper.
  if (tile.type === 'ramp') {
    const geom = rampGeometry(CELL, STEP)
    const rad = tile.r * Math.PI / 2
    const sinR = Math.sin(rad), cosR = Math.cos(rad)
    const dx = px - tileWorldX, dz = pz - tileWorldZ
    const cx = dx - CELL / 2, cz = dz - CELL / 2
    const lx = cosR * cx - sinR * cz + CELL / 2
    const lz = sinR * cx + cosR * cz + CELL / 2
    const idx = rampCellIdxFromCanonical(lx, lz, geom)
    if (!idx) return null
    // groundY = walkable surface Y (top of 0.5m floor slab, then + slope rise).
    let surfaceY: number
    if (lz < geom.inclineStart) surfaceY = tile.y + WALKABLE_TOP
    else if (lz >= geom.inclineEnd) surfaceY = tile.y + STEP + WALKABLE_TOP
    else {
      const slopeDist = (lz - geom.inclineStart) / geom.cosA
      surfaceY = tile.y + WALKABLE_TOP + slopeDist * geom.sinA
    }
    return { id: cellId(tx, tz, tile.y, idx.col, idx.row), groundY: surfaceY }
  }

  const mask = rotateMask(raw, tile.r)
  const w = mask[0].length
  const cellSize = CELL / w

  const localX = px - tileWorldX
  const localZ = pz - tileWorldZ
  const col = Math.floor(localX / cellSize)
  const row = Math.floor(localZ / cellSize)
  if (col < 0 || col >= w || row < 0 || row >= mask.length) return null
  const ch = mask[row][col]
  if (ch === '.') return null

  return { id: cellId(tx, tz, tile.y, col, row), groundY: tile.y + WALKABLE_TOP }
}

// Top of the tile's floor slab in world meters. Matches how player.y reads when
// the avatar is grounded on a flat tile at tile.y = 0.
const WALKABLE_TOP = 0.5

// MARK: Painting system
// Reads player position, resolves current cell, paints it.
export function initPaintingSystem(
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
) {
  const GROUND_TOLERANCE = 0.4
  // Brush footprint from settings.PAINT_BRUSH_SIZE_CELLS (odd NxN).
  // Offsets in world meters; one cell is CELL / SIZE.
  const step = CELL / SIZE
  const half = Math.floor(PAINT_BRUSH_SIZE_CELLS / 2)
  const OFFSETS: Array<[number, number]> = []
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      OFFSETS.push([dx * step, dz * step])
    }
  }
	// Enqueue candidate cell ids; optimistic local paint + server CRDT
	// chunk writes converge the visible colors.
	engine.addSystem(() => {
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (!t) return
    const { x, y, z } = t.position
    const center = worldToCellId(x, y, z, CELL, STEP, lookupTile)
    if (!center || y - center.groundY > GROUND_TOLERANCE) return
    for (const [dx, dz] of OFFSETS) {
      const hit = worldToCellId(x + dx, y, z + dz, CELL, STEP, lookupTile)
      if (!hit) continue
      if (Math.abs(y - hit.groundY) > 1.5) continue
      noteLocalPaintCandidate(hit.id)
    }
  })
}
