// ─── Squareoff paint grid ────────────────────────────────────────────
// Phase 1 scaffolding. Single-player, single-team for now.
//
// Design doc: assets/docs/SQUAREOFF-DESIGN.md
// Depends on constants exposed from index.ts (CELL, STEP, TILE_SCALE) and the
// tile grid Map — passed in via init() to keep this module standalone.

import { engine, Transform, MeshRenderer, Material, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { MAZE_ORIGIN } from './maze/generator'

// ─── Teams ───────────────────────────────────────────────────────────
// Team enum lives in shared/ so the server can reference it symbolically.
// Re-exported here so existing `import { Team } from './paint'` call sites
// keep working during the refactor.
export { Team } from './shared/team'
import { Team } from './shared/team'
import { events } from './shared/events'

/**
 * initPaintNet — wire this module's server-event subscribers.
 *
 * Publishers (clientHandler.ts) don't know we exist. We subscribe here
 * to keep all paint-related side effects in the paint module. Call once
 * from setupClient() after paint state is initialized.
 */
export function initPaintNet(): void {
  // Server broadcasts every 200ms with all changes since the last tick
  // + current coverage. This is the ONLY path that colors cells now —
  // both our own paint (echoed back) and other players' paint arrive
  // through here uniformly.
  events.on('paint:delta', ({ changes, red, blue, total }) => {
    for (const { id, team } of changes) applyRemotePaint(id, team)
    setServerCoverage({ red, blue, total })
  })

  // Snapshot arrives once per teamAssigned (or on manual requestSnapshot).
  // Same processing path as paint:delta — material updates and cellTeam
  // bookkeeping stay consistent whether the client's tile entities have
  // finished spawning yet or not (spawnOne adopts pre-existing paint).
  events.on('paint:snapshot', ({ entries, red, blue, total }) => {
    for (const { id, team } of entries) applyRemotePaint(id, team)
    setServerCoverage({ red, blue, total })
  })

  // Round boundary: clear the paint map BEFORE the seed watcher sees
  // the new seed and rebuilds. Two reasons:
  // 1) rebuildMaze does NOT clear (so mid-round snapshots survive reload).
  //    Real round transitions still need a clean slate here to avoid
  //    ghost paint from cellId collisions between old/new mazes.
  // 2) Zero the coverage HUD immediately — next paintDelta will refill it.
  events.on('round:reset', () => {
    clearAllPaintState()
    setServerCoverage({ red: 0, blue: 0, total: 0 })
  })
}

const TEAM_COLORS: Record<Team, Color4> = {
  [Team.None]: Color4.create(1, 1, 1, 1),
  [Team.Red]:  Color4.create(255/255, 117/255, 119/255, 1), // pallet.jpeg #FF7577
  [Team.Blue]: Color4.create(106/255, 153/255, 252/255, 1), // pallet.jpeg #6A99FC (queued for Phase 3)
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

// GLB floor is 0.25 local (0.5m world) above the tile origin. Sit paint cells
// 0.26 local (0.52m world) above origin → 0.02m world above the walkable surface.
// TILE_SCALE from index.ts is 2; hard-coded here to keep this module standalone.
export const FLAT_OFFSET = 0.275 * 2 // 0.55m world above tile origin — clears the 0.5m floor + tilted-cell edge sag on inclines.

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
// Cell resolution: SIZE cells across a tile (tile world width = CELL = 32m).
// SIZE=16 → 2m cells (~256 max cells/tile); SIZE=32 → 1m cells (~1024/tile).
// Dropped from 32 to 16 to relieve entity/draw-call load. All other mask
// constants are ratios of SIZE so shapes stay the same.
const SIZE = 16
const ARM = SIZE * 20 / 32      // 10 — corridor width in cells (was 20 at SIZE=32)
const LO = (SIZE - ARM) / 2     // 3
const HI = (SIZE + ARM) / 2     // 13
const END_CLOSED_VOID = SIZE * 6 / 32  // 3 — rows of void on the closed side of `end`
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
const RAMP_FLAT_END = 1 // cells of flat landing at each end of the ramp

// Ramp geometry derived from CELL and STEP. Same math used by spawn and lookup
// so cellIds agree.
function rampGeometry(CELL: number, STEP: number) {
  const cellSize = CELL / SIZE
  const flatLen = RAMP_FLAT_END * cellSize
  const inclineStart = flatLen
  const inclineEnd = CELL - flatLen
  const inclineLen = inclineEnd - inclineStart
  const slopeLen = Math.sqrt(STEP * STEP + inclineLen * inclineLen)
  const nIncline = Math.round(slopeLen / cellSize)
  const slopeCellSize = slopeLen / nIncline
  const cosA = inclineLen / slopeLen
  const sinA = STEP / slopeLen
  return { cellSize, flatLen, inclineStart, inclineEnd, inclineLen, slopeLen, nIncline, slopeCellSize, cosA, sinA }
}

// Given canonical (lx, lz) on a ramp, return the cell (col, row) used in
// cellId. Returns null if outside the walkable corridor.
function rampCellIdxFromCanonical(lx: number, lz: number, geom: ReturnType<typeof rampGeometry>): { col: number; row: number } | null {
  const col = Math.floor(lx / geom.cellSize)
  if (col < LO || col >= HI) return null
  let row: number
  if (lz < geom.inclineStart) {
    row = Math.floor(lz / geom.cellSize)                    // bottom landing (0..RAMP_FLAT_END-1)
  } else if (lz >= geom.inclineEnd) {
    row = RAMP_FLAT_END + geom.nIncline + Math.floor((lz - geom.inclineEnd) / geom.cellSize)
  } else {
    const slopeDist = (lz - geom.inclineStart) / geom.cosA
    row = RAMP_FLAT_END + Math.floor(slopeDist / geom.slopeCellSize)
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

// ─── Cell store ──────────────────────────────────────────────────────
// Stable cell IDs (deterministic from tile pos + local cell) → team.
// Format: `${tileX},${tileZ},${tileY}:${cellCol},${cellRow}` (post-rotation local).
const cellTeam = new Map<string, Team>()
const cellEntity = new Map<string, Entity>()
// Reverse index: tile entity → all paint cell entities spawned for it, plus
// their cell ids. Used by removePaintForTile() so tile teardown can strip its
// paint in the same chunked pass — no ghost cells linger after the tile is
// gone, and coverage state stays consistent.
const paintByTile = new Map<Entity, { entities: Entity[]; ids: string[] }>()

export function cellId(tx: number, tz: number, ty: number, col: number, row: number): string {
  return `${tx},${tz},${ty}:${col},${row}`
}

// ─── Public: paint a cell (idempotent for same team) ─────────────────
// Matte PBR material spec for a team. Roughness=1 + metallic=0 + no specular
// kills the shine so paint reads as flat pigment, not plastic.
function cellMaterial(team: Team) {
  return {
    albedoColor: TEAM_COLORS[team],
    roughness: 1.0,
    metallic: 0.0,
    specularIntensity: 0.0,
  }
}

// ─── Deferred-spawn queue ──────────────────────────────────
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
// removePaintForTile() during the chunked tile teardown in index.ts — that
// way paint disappears in the same frame as its tile, avoiding ghost cells,
// while the total ~30k removeEntity() cost is spread across several frames.
export function clearAllPaintState() {
  cellTeam.clear()
  serverCoverage = null
  paintOutbox.clear()
  // cellEntity is left in place; entries are pruned as tiles are torn down.
}

// ─── Server-authoritative coverage mirror (Phase 4 Step 4) ─────────────────
// Each paintDelta includes the current coverage totals. Storing them here
// means the HUD (which reads coverage() below) shows GLOBAL truth — all
// players' paint — not just cells visible to the local client. Before the
// first delta arrives, coverage() falls back to a local scan (returns
// zeros on fresh join, which is fine — Step 5's snapshot fills the gap).
let serverCoverage: { red: number; blue: number; total: number } | null = null
export function setServerCoverage(c: { red: number; blue: number; total: number }): void {
  serverCoverage = c
}

export function removePaintForTile(tileEntity: Entity) {
  const rec = paintByTile.get(tileEntity)
  if (!rec) return
  for (const e of rec.entities) engine.removeEntity(e)
  for (const id of rec.ids) cellEntity.delete(id)
  paintByTile.delete(tileEntity)
}

/**
 * Reset paint on a tile without destroying its entities. Used for the
 * persistent center-cross tile at round boundaries: the tile geometry
 * stays in place (so players standing on it aren't shoved by grow-in),
 * but its paint cells snap back to Team.None so the new round starts
 * with a clean slate underfoot.
 */
export function resetPaintForTile(tileEntity: Entity) {
  const rec = paintByTile.get(tileEntity)
  if (!rec) return
  const noneMat = cellMaterial(Team.None)
  for (let i = 0; i < rec.entities.length; i++) {
    Material.setPbrMaterial(rec.entities[i], noneMat)
    cellTeam.set(rec.ids[i], Team.None)
  }
}

// ─── Network outbox (Phase 4 Step 3) ────────────────────────────────
// Cell ids the local player has walked onto since the last flush. Client.ts
// drains this at 10Hz and sends paintTick { ids } to the server. Server
// attributes to the sender's team and broadcasts paintDelta — which is
// how OUR paint eventually becomes visible on our own screen too.
// (We do NOT paint locally anymore — pure server-authoritative.)
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
 * Reconciliation is safe by construction:
 *  - Server echoes our paint back in the next delta — applyRemotePaint's
 *    idempotent guard (`if (cellTeam.get(id) === team) return`) no-ops it.
 *  - If an opponent stole the cell in the intervening ~200ms, their color
 *    arrives in the same delta and overwrites ours. Brief wrong-color
 *    flash, then correct. Much better than persistent lag.
 *
 * If localTeam is None (pre-teamAssigned race), we skip the local paint
 * and just enqueue — server will drop it anyway (pre-roster), no harm.
 */
export function noteLocalPaintCandidate(id: string): void {
  paintOutbox.add(id)
  if (localTeam !== Team.None) {
    applyRemotePaint(id, localTeam)
  }
}

// Set from client.ts when teamAssigned arrives. Read by noteLocalPaintCandidate
// for optimistic local paint. Stays None on guest / pre-roster clients.
let localTeam: Team = Team.None
export function setLocalTeam(team: Team): void {
  localTeam = team
}

/**
 * Apply a paint change received from the server (paintDelta). Updates
 * both the local team-map (so coverage() reads consistently) and the
 * visible material. Does NOT add to the outbox — would infinite-loop.
 */
export function applyRemotePaint(id: string, team: Team): void {
  if (cellTeam.get(id) === team) return
  cellTeam.set(id, team)
  const e = cellEntity.get(id)
  if (e !== undefined) {
    Material.setPbrMaterial(e, cellMaterial(team))
  }
  // Note: if the cell entity hasn't spawned yet (grow-in delay window),
  // cellTeam still records the color — spawnOne() adopts it when the
  // entity is created, preserving paint through the 500ms teardown gap.
}

// ─── Public: spawn cells for a tile ──────────────────────────────────
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

  const tileWorldX = tx * CELL + MAZE_ORIGIN
  const tileWorldZ = tz * CELL + MAZE_ORIGIN

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
    // Adopt any paint that landed on this id BEFORE the entity existed.
    // Repro: round rebuild queues a 500ms grow-in delay; a fast-moving
    // player paints cells during that window — paintCell() sets cellTeam
    // but there's no entity to color yet. Without this check we'd
    // overwrite the team back to None and the cell would render white
    // forever despite having been "painted". Preserves the pre-Phase-4
    // invariant that walk-over-cell = colored-cell.
    const preexisting = cellTeam.get(id) ?? Team.None
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(wx, wy, wz),
      rotation: rot,
      scale: Vector3.create(cellSize, scaleY, 1),
    })
    MeshRenderer.setPlane(e)
    Material.setPbrMaterial(e, cellMaterial(preexisting))
    cellEntity.set(id, e)
    cellTeam.set(id, preexisting)
    tileRec!.entities.push(e)
    tileRec!.ids.push(id)
  }

  // ─── Ramp: dedicated path ───────────────────────────────────────
  // Space incline cells at cellSize intervals along the SLOPE (not horizontal)
  // so they tile flush along the tilted surface without needing size scaling.
  // (col, row) always come from rampCellIdxFromCanonical() so the ids agree
  // with worldToCellId's lookup on the same tile.
  if (isRamp) {
    // Bottom landing
    for (let i = 0; i < RAMP_FLAT_END; i++) {
      const lz = (i + 0.5) * geom.cellSize
      for (let col = LO; col < HI; col++) {
        const lx = (col + 0.5) * geom.cellSize
        const idx = rampCellIdxFromCanonical(lx, lz, geom)!
        const { wx, wz } = localToWorld(lx, lz)
        spawnOne(wx, ty + FLAT_OFFSET, wz, flatRot, idx.col, idx.row)
      }
    }
    // Incline
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
    for (let i = 0; i < RAMP_FLAT_END; i++) {
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

  // ─── Non-ramp tiles: mask iteration ──────────────────────────────
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

// ─── Public: coverage counter ────────────────────────────────────────
// red / blue = absolute painted-cell counts (server-authoritative when
// paintDelta has arrived, otherwise a local fallback).
// total = WALKABLE CELLS IN THE MAZE, not "cells that have been touched."
// Previously used cellTeam.size, which is only cells with a recorded team
// — that made red=5, total=5, red% = 100% even with a huge unpainted maze.
// cellEntity.size is authoritative for "how many paint targets exist"
// because we spawn one entity per walkable mask cell. During round
// teardown it briefly drops toward 0 as tiles are removed and climbs back
// as new tiles spawn; % briefly overshoots then settles, which is fine.
export function coverage(): { red: number; blue: number; total: number } {
  const total = cellEntity.size
  if (serverCoverage !== null) {
    return { red: serverCoverage.red, blue: serverCoverage.blue, total }
  }
  let red = 0, blue = 0
  for (const t of cellTeam.values()) {
    if (t === Team.Red) red++
    else if (t === Team.Blue) blue++
  }
  return { red, blue, total }
}

// ─── Coord math: world pos → cell ID ─────────────────────────────────
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
  const tx = Math.floor((px - MAZE_ORIGIN) / CELL)
  const tz = Math.floor((pz - MAZE_ORIGIN) / CELL)
  const tile = lookupTile(tx, tz, py)
  if (!tile) return null

  const raw = MASKS[tile.type]
  if (!raw) return null

  const tileWorldX = tx * CELL + MAZE_ORIGIN
  const tileWorldZ = tz * CELL + MAZE_ORIGIN

  // ─── Ramp branch: use shared canonical-frame helper ───────────────
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

// ─── Painting system (per-frame, single-player for now) ──────────────
// Reads player position, resolves current cell, paints it.
// Team is hard-coded to Red for Phase 1 solo testing.
export function initPaintingSystem(
  CELL: number, STEP: number,
  lookupTile: (tx: number, tz: number, py: number) => { type: string; r: number; y: number } | null,
) {
  const GROUND_TOLERANCE = 0.4
  // Paint footprint: 3x3 square (9 cells, center + all 8 neighbors). Offsets
  // in world meters; one cell is CELL / SIZE = 2m.
  const step = CELL / SIZE
  const OFFSETS: Array<[number, number]> = [
    [-step, -step], [0, -step], [step, -step],
    [-step,     0], [0,     0], [step,     0],
    [-step,  step], [0,  step], [step,  step],
  ]
  // Phase 4 Step 4: this system no longer touches cellTeam or materials.
  // It just enqueues candidate cell ids into the outbox; the server owns
  // team attribution and echoes back paintDelta, which is what actually
  // colors cells (via applyRemotePaint in the client's delta handler).
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
