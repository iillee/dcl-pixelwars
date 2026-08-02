// ─── Squareoff paint grid ────────────────────────────────────────────
// Phase 1 scaffolding. Single-player, single-team for now.
//
// Design doc: SQUAREOFF-DESIGN.md
// Depends on constants exposed from index.ts (CELL, STEP, TILE_SCALE) and the
// tile grid Map — passed in via init() to keep this module standalone.

import { engine, Transform, MeshRenderer, Material, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

// ─── Teams ───────────────────────────────────────────────────────────
export enum Team { None = 0, Red = 1, Blue = 2 }

const TEAM_COLORS: Record<Team, Color4> = {
  [Team.None]: Color4.create(0.7, 0.7, 0.7, 1),
  [Team.Red]:  Color4.create(1.0, 0.2, 0.35, 1),
  [Team.Blue]: Color4.create(0.2, 0.5, 1.0, 1),
}

// ─── Mask format ─────────────────────────────────────────────────────
// One char per 1m cell. Canonical (unrotated) orientation.
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

export const FLAT_OFFSET = 0.05 // Y lift above tile deck to avoid z-fighting

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

// PROVISIONAL cross mask: 32x32, arms 16 cells wide (middle band cols/rows 8–23),
// corners void. Symmetric on all 4 axes so rotation is trivially correct.
// Iterate against the real GLB once it lands.
const CROSS_MASK: Mask = (() => {
  const size = 32, arm = 16
  const rows: string[] = []
  for (let r = 0; r < size; r++) {
    if (r < (size - arm) / 2 || r >= (size + arm) / 2) {
      // Corner rows: only the middle arm columns are walkable.
      rows.push(plusRow(size, arm, 'F', '.'))
    } else {
      // Middle rows: full width walkable.
      rows.push(repeat('F', size))
    }
  }
  return rows
})()

export const MASKS: Partial<Record<string, Mask>> = {
  cross: CROSS_MASK,
  end: undefined,
  straight: undefined,
  turn: undefined,
  fork: undefined,
  ramp: undefined,
}

// ─── Rotate a mask 90°×r CW (to match tile rotation) ─────────────────
// If tile at rotation r renders with Y-rotation of r*90° CW, the mask must
// be rotated the same amount so that mask[row][col] indexes the same world
// point regardless of r. Sign to be verified against a visible marker cell.
export function rotateMask(m: Mask, r: number): Mask {
  r = ((r % 4) + 4) % 4
  let out = m
  for (let i = 0; i < r; i++) out = rot90cw(out)
  return out
}
function rot90cw(m: Mask): Mask {
  const h = m.length, w = m[0].length
  const rows: string[] = []
  for (let r = 0; r < w; r++) {
    let s = ''
    for (let c = 0; c < h; c++) s += m[h - 1 - c][r]
    rows.push(s)
  }
  return rows
}

// ─── Cell store ──────────────────────────────────────────────────────
// Stable cell IDs (deterministic from tile pos + local cell) → team.
// Format: `${tileX},${tileZ},${tileY}:${cellCol},${cellRow}` (post-rotation local).
const cellTeam = new Map<string, Team>()
const cellEntity = new Map<string, Entity>()

export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
  return `${tx},${tz},${ty}:${col},${row}`
}

// ─── Public: paint a cell (idempotent for same team) ─────────────────
export function paintCell(id: string, team: Team) {
  if (cellTeam.get(id) === team) return
  cellTeam.set(id, team)
  const e = cellEntity.get(id)
  if (e !== undefined) {
    Material.setPbrMaterial(e, { albedoColor: TEAM_COLORS[team] })
  }
}

// ─── Public: spawn cells for a tile ──────────────────────────────────
// Called from index.ts after a tile is placed. `tileType` selects the mask,
// `r` rotates it, and (tx, tz, ty) locate the tile in the maze grid.
export function spawnCellsForTile(
  tileType: string,
  r: number,
  tx: number, tz: number, ty: number,
  CELL: number, STEP: number
) {
  const raw = MASKS[tileType]
  if (!raw) return // designer hasn't authored this tile's mask yet
  const mask = rotateMask(raw, r)
  const h = mask.length, w = mask[0].length
  // World meters per mask cell. Mask is authored at 1 cell = 1m; the tile
  // fills CELL x CELL world meters, so w should equal CELL.
  const cellSize = CELL / w

  const tileWorldX = tx * CELL
  const tileWorldZ = tz * CELL

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ch = mask[row][col]
      if (ch === '.') continue

      // Cell center in world XZ.
      const wx = tileWorldX + (col + 0.5) * cellSize
      const wz = tileWorldZ + (row + 0.5) * cellSize

      // Y: flat floor vs ramp height.
      let wy: number
      if (ch === 'F') {
        wy = ty + FLAT_OFFSET
      } else if (ch >= '0' && ch <= '9') {
        const t = (ch.charCodeAt(0) - 48) / 9
        wy = ty + t * STEP + FLAT_OFFSET
      } else {
        continue
      }

      const id = cellId(tx, tz, ty, col, row)
      const e = engine.addEntity()
      Transform.create(e, {
        position: Vector3.create(wx, wy, wz),
        rotation: Quaternion.fromEulerDegrees(-90, 0, 0), // TODO ramp tilt
        scale: Vector3.create(cellSize * 0.95, cellSize * 0.95, 1),
      })
      MeshRenderer.setPlane(e)
      Material.setPbrMaterial(e, { albedoColor: TEAM_COLORS[Team.None] })
      cellEntity.set(id, e)
      cellTeam.set(id, Team.None)
    }
  }
}

// ─── Public: coverage counter ────────────────────────────────────────
export function coverage(): { red: number; blue: number; total: number } {
  let red = 0, blue = 0
  for (const t of cellTeam.values()) {
    if (t === Team.Red) red++
    else if (t === Team.Blue) blue++
  }
  return { red, blue, total: cellTeam.size }
}

// ─── Coord math: world pos → cell ID ─────────────────────────────────
// Reverses spawnCellsForTile. Requires a tile lookup callback so we don't
// need to import the maze grid directly.
// Returns null if the player isn't standing on a known walkable cell.
export function worldToCellId(
  px: number, py: number, pz: number,
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null
): string | null {
  const tx = Math.floor(px / CELL)
  const tz = Math.floor(pz / CELL)
  const tile = lookupTile(tx, tz, py)
  if (!tile) return null

  const raw = MASKS[tile.type]
  if (!raw) return null
  const mask = rotateMask(raw, tile.r)
  const w = mask[0].length
  const cellSize = CELL / w

  const localX = px - tx * CELL
  const localZ = pz - tz * CELL
  const col = Math.floor(localX / cellSize)
  const row = Math.floor(localZ / cellSize)
  if (col < 0 || col >= w || row < 0 || row >= mask.length) return null
  const ch = mask[row][col]
  if (ch === '.') return null

  return cellId(tx, tz, tile.y, col, row)
}

// ─── Painting system (per-frame, single-player for now) ──────────────
// Reads player position, resolves current cell, paints it.
// Team is hard-coded to Red for Phase 1 solo testing.
export function initPaintingSystem(
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
  myTeam: () => Team = () => Team.Red
) {
  engine.addSystem(() => {
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (!t) return
    const { x, y, z } = t.position
    const id = worldToCellId(x, y, z, CELL, STEP, lookupTile)
    if (id) paintCell(id, myTeam())
  })
}
