/**
 * generator.ts — grid state + placement rules + BFS maze growth.
 *
 * Deterministic given a seed. `generate()` mutates module-private state
 * (`grid`, `placeCounter`) — callers loop over seeds via `resetGrid()` +
 * `setSeed()` + `generate()` + `validate()` until a valid maze surfaces.
 *
 * No engine imports. Pure over tiles + rng + math. The visual side
 * (spawning entities) lives in rebuild.ts.
 *
 * Grid coordinates are integer cell indices; world Y is a real number
 * quantized to STEP multiples (with 3-decimal rounding to defeat float
 * drift from repeated `y + STEP` arithmetic).
 */

import {
  ALL_DIRS, DX, DZ, Dir, OPP,
  TILES, TileType,
  GROWTH_PRIMARY, GROWTH_FALLBACK,
  openingsAt, highDirAt,
} from './tiles'
import { rand, setSeed } from './rng'
import {
  IS_SKY, SKY_ALTITUDE, SKY_LEVEL_COUNT, SKY_BASE_SIZE, SKY_BASE_MARGIN,
  SKY_CENTRE_HUB, SKY_BRANCH_DENSITY, SKY_RAMP_WEIGHT, SKY_MAX_TILES, SKY_BASES_ONLY, SKY_EDGE_INSET,
} from './level'

// ─── World-scale constants ──────────────────────────────────────────
// All exported so rebuild.ts can position entities and paint.ts can size
// its per-tile cell grids consistently.
export const TILE_SCALE = 2                                          // uniform GLB scale
export const CELL = 16 * TILE_SCALE                                  // one grid cell = 32 m
// Scene is 11×11 parcels = 176×176 m. 176/32 = 5.5, so we use a 5×5
// maze grid (160 m) centered inside the scene with an 8 m border on all
// sides. MAZE_ORIGIN is added to every tile→world / cell→world conversion
// so cell (2,2) — the true center — lands exactly at world (88, 88).
// Sky mode: 20×20 parcels = 320 m, inset SKY_EDGE_INSET (16 m = 1 parcel)
// from every edge → 9×9 grid filling 16–304 m, centred on (160, 160) so the
// 180° mirror (x → GRID_W-1-x) is also a mirror about the scene centre.
export const SCENE_SIZE = IS_SKY ? 320 : 176
const EDGE_INSET = IS_SKY ? SKY_EDGE_INSET : 0
export const GRID_W = Math.floor((SCENE_SIZE - 2 * EDGE_INSET) / CELL)
export const GRID_H = Math.floor((SCENE_SIZE - 2 * EDGE_INSET) / CELL)
export const MAZE_ORIGIN = (SCENE_SIZE - GRID_W * CELL) / 2         // classic 8 m border; sky 16 m
export const STEP = 5.3835 * TILE_SCALE                              // ramp Y increment
                                                                     // (5.3835 m = walkable floor-to-floor in the new tile GLBs)
/** World Y of the lowest level. 0 in classic; SKY_ALTITUDE in sky. Tiles
 *  store absolute world Y, so rebuild / paint / mazeGraph need no offset. */
export const BASE_Y = IS_SKY ? SKY_ALTITUDE : 0
export const MAX_Y = IS_SKY ? BASE_Y + (SKY_LEVEL_COUNT - 1) * STEP + 0.5 : 40                                              // stack cap — 4 levels max
                                                                     // (Y = 0, 10.77, 21.53, 32.30).
                                                                     // STEP is 10.767 so 40 blocks
                                                                     // level 4 (43.07) while allowing
                                                                     // level 3. Keeps play flat → more
                                                                     // player collisions → more
                                                                     // contested paint.

// ─── Tile record type ───────────────────────────────────────────────
export interface Placed {
  type: TileType
  r: number
  x: number
  z: number
  y: number
  /** BFS order (seed=0, seed's neighbors=1..N, etc.). Used for reveal cascade. */
  order: number
}

// ─── Private grid state ─────────────────────────────────────────────
// Kept module-private; callers touch the grid only via the exported
// helpers below (`resetGrid`, `getPlacedTilesInOrder`, `lookupTile`,
// `hasPlacementAt`). Prevents accidental mutation from the render side.
const grid = new Map<string, Placed>()
let placeCounter = 0

// Y quantization: STEP is 10.767, so `y + STEP + STEP` drifts. Rounding
// to 3 decimals makes lookups match regardless of accumulated float error.
const key = (x: number, z: number, y: number) =>
  `${x},${z},${Math.round(y * 1000) / 1000}`

const inBounds = (x: number, z: number) =>
  x >= 0 && x < GRID_W && z >= 0 && z < GRID_H

// ─── Public grid accessors ──────────────────────────────────────────
export function resetGrid(): void {
  grid.clear()
  placeCounter = 0
}

export function gridSize(): number {
  return grid.size
}

/** BFS-order iteration — seeds first, then neighbors, ideal for reveal cascade. */
export function getPlacedTilesInOrder(): Placed[] {
  return [...grid.values()].sort((a, b) => a.order - b.order)
}

/**
 * Look up the highest tile at (tx, tz) whose Y is at or below the player's
 * feet (with a small tolerance). Used by the painting system to resolve
 * world-space player position → the tile they're standing on.
 */
export function lookupTile(
  tx: number, tz: number, playerY: number,
): { type: TileType; r: number; y: number } | null {
  let best: Placed | null = null
  for (const p of grid.values()) {
    if (p.x !== tx || p.z !== tz) continue
    if (p.y > playerY + 0.5) continue
    if (!best || p.y > best.y) best = p
  }
  return best ? { type: best.type, r: best.r, y: best.y } : null
}

// ─── Rotation offset lookup ─────────────────────────────────────────
// GLB pivot is at the tile's SW corner (geometry extends +X/+Z), so
// rotating swings geometry into other cells. This offset compensates
// so the rotated tile still fills its intended parcel.
export const ROT_OFFSET: Array<[number, number]> = [
  [0, 0],           // r=0: no offset
  [0, CELL],        // r=1: 90° CW
  [CELL, CELL],     // r=2: 180°
  [CELL, 0],        // r=3: 270° CW
]

// ─── Placement rule check ───────────────────────────────────────────
// Returns true iff the tile can legally occupy (x, z, y) at rotation r
// given the current grid contents. Encodes: vertical stacking rules,
// cross-level parallel-ramp rules, ramp-handshake rules, preemptive
// unsatisfiability checks, no-two-ramps-in-a-row, and edge connectivity
// against every neighbor at same level and one-below (for ramp decks).
function canPlace(t: TileType, r: number, x: number, z: number, y: number): boolean {
  if (grid.has(key(x, z, y))) return false
  const opens = openingsAt(t, r)
  const highDir = highDirAt(t, r)
  const iAmRamp = !!TILES[t].isRamp

  // Vertical stacking rule:
  //  - The cell above a ramp must be empty OR another ramp (chained upward).
  //  - The cell below a ramp is unrestricted (ramps only go up, so there's empty
  //    air beneath the deck that any tile can occupy).
  const above = grid.get(key(x, z, y + STEP))
  if (above?.type === 'ramp' && !iAmRamp) return false
  if (iAmRamp && above && above.type !== 'ramp') return false
  // Stacked ramps must share the same rotation (same climb direction),
  // otherwise perpendicular ramps collide in a tight vertical space.
  if (iAmRamp && above?.type === 'ramp' && above.r !== r) return false
  const below = grid.get(key(x, z, y - STEP))
  if (iAmRamp && below?.type === 'ramp' && below.r !== r) return false
  // Non-ramp tiles cannot sit above a ramp cell (would clip the ramp's deck).
  if (!iAmRamp && below?.type === 'ramp') return false

  // Cross-level parallel ramp rule.
  // Two ramps that are (a) offset by one STEP in Y, (b) orthogonally adjacent in
  // XZ, and (c) parallel (same axis) must share the SAME high direction — i.e.
  // same rotation, not opposite. Opposite-high parallels form fragile "V"
  // configurations whose resolution requires several dependent placements to
  // succeed; when any link fails, one end is left dangling. Requiring matched
  // high directions collapses these into clean, always-resolvable staircases.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      // Only check neighbors along MY axis — same-axis ramps interact via
      // their sloping edges on the axis-aligned column boundary. Cross-axis
      // neighbors meet as wall‑to‑wall regardless of rotation, so they don't
      // create edge mismatches.
      if ((d % 2) !== (r % 2)) continue
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      for (const dy of [STEP, -STEP]) {
        const nb = grid.get(key(nx, nz, y + dy))
        if (nb?.type !== 'ramp') continue
        // Same axis (guaranteed by d filter) but different rotation → opposite
        // highs → misaligned edges on shared boundary at differing Y → reject.
        if (nb.r !== r) return false
      }
    }
  }

  // Adjacent-ramp handshake rule.
  // A ramp's cell-above is locked to be either empty OR a same-rotation ramp.
  // Consequence: if one ramp's HIGH side points at an orthogonally-adjacent
  // same-Y ramp, the pointer's high opening lands in the neighbor's cell-above,
  // which is constrained to the neighbor's rotation. Unless the two ramps share
  // a rotation (matched handshake) OR both high-sides point at each other
  // (parallel-opposite ramps meeting edge-to-edge at Y+STEP), the opening is
  // structurally unsatisfiable → dangling end. Reject up front.
  if (iAmRamp) {
    for (const d of ALL_DIRS) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const nb = grid.get(key(nx, nz, y))
      if (nb?.type !== 'ramp') continue
      const nbHigh = highDirAt(nb.type, nb.r)!
      const mePointsAtNb = highDir === d              // my high goes toward neighbor
      const nbPointsAtMe = nbHigh === OPP[d]          // neighbor's high comes toward me
      if (!mePointsAtNb && !nbPointsAtMe) continue    // no high-side interaction, other checks cover it
      if (nb.r === r) continue                        // same rotation → clean handshake
      if (mePointsAtNb && nbPointsAtMe) continue      // parallel-opposite meeting at shared high edge
      return false                                     // asymmetric point → unsatisfiable
    }
  }

  // Preemptive: if I'm a ramp, my high side lands at (targetX, targetZ, y+STEP).
  // If that cell already has a ramp at y=y with a DIFFERENT rotation, the
  // target cell can never be filled (non-ramp above ramp is forbidden, and only
  // same-rotation ramps can stack). Reject me now to save a wasted attempt.
  if (iAmRamp && highDir !== null) {
    const tx = x + DX[highDir]
    const tz = z + DZ[highDir]
    if (inBounds(tx, tz)) {
      const targetBelow = grid.get(key(tx, tz, y))
      if (targetBelow?.type === 'ramp' && targetBelow.r !== r) return false
    }
  }

  // No-two-ramps-in-a-row rule: a ramp cannot connect directly to another
  // ramp. Forces at least one flat tile between elevation changes, breaking up
  // long staircases and giving the maze more horizontal breathing room.
  if (iAmRamp) {
    for (const d of opens) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const ny = highDir === d ? y + STEP : y
      const nb = grid.get(key(nx, nz, ny))
      if (nb?.type === 'ramp') return false
      // Also check the ramp-below case: if a lower ramp's high side reaches
      // my opening's level, that's still a ramp-to-ramp connection.
      if (ny >= BASE_Y + STEP - 0.001) {
        const under = grid.get(key(nx, nz, ny - STEP))
        if (under?.type === 'ramp' && highDirAt(under.type, under.r) === OPP[d]) return false
      }
    }
  }

  for (const d of ALL_DIRS) {
    const isOpen = opens.has(d)
    const nx = x + DX[d], nz = z + DZ[d]
    if (!inBounds(nx, nz)) {
      if (isOpen) return false // opening would face off-grid
      continue
    }
    // Height at which MY opening on side d sits
    const myY = highDir === d ? y + STEP : y
    if (myY > MAX_Y) return false

    const back = OPP[d]

    // (a) Neighbor at same level as my opening
    const nb1 = grid.get(key(nx, nz, myY))
    if (nb1) {
      const nb1Opens = openingsAt(nb1.type, nb1.r)
      const nb1High = highDirAt(nb1.type, nb1.r)
      if (nb1High === back) {
        // Neighbor's back side is its ramp-high: no horizontal opening from nb1
        // itself at Y=myY. BUT if a ramp below nb1 has its high reaching myY on
        // this edge (same-rotation stack), that lower ramp's high deck IS the
        // walkway our opening receives — so "open" is still valid. Only reject
        // when neither nb1 nor a matching lower ramp provides the connection.
        if (isOpen) {
          if (myY < BASE_Y + STEP - 0.001) return false
          const under = grid.get(key(nx, nz, myY - STEP))
          if (!under || under.type !== 'ramp' || highDirAt(under.type, under.r) !== back) return false
        }
      } else {
        if (nb1Opens.has(back) !== isOpen) return false
      }
    }
    // (a2) If this side is MY ramp's high side, my Y=y level is a wall on that side.
    // A neighbor at (nx, nz, y) with a horizontal opening pointing back at us would
    // die into that wall — reject.
    if (highDir === d) {
      const nbAtY = grid.get(key(nx, nz, y))
      if (nbAtY) {
        const nbAtYOpens = openingsAt(nbAtY.type, nbAtY.r)
        const nbAtYHigh = highDirAt(nbAtY.type, nbAtY.r)
        if (nbAtYOpens.has(back) && nbAtYHigh !== back) return false
      }
    }
    // (b) Ramp below whose upper level reaches my Y.
    //  - If its high side points at me → my side must be OPEN (connects to ramp's high).
    //  - Otherwise (wall side or low side facing me) → my side must be CLOSED,
    //    since there's nothing valid to connect to at this elevation.
    if (myY >= BASE_Y + STEP - 0.001) {
      const nb2 = grid.get(key(nx, nz, myY - STEP))
      if (nb2?.type === 'ramp') {
        const nb2High = highDirAt(nb2.type, nb2.r)
        if (nb2High === back) {
          if (!isOpen) return false
        } else {
          if (isOpen) return false
        }
      }
    }
  }
  return true
}

function placeTile(t: TileType, r: number, x: number, z: number, y: number): void {
  // Store Y rounded like the grid key: in sky mode Y starts at 80, so
  // 80 + STEP + STEP would otherwise leak float noise into cellIds.
  y = Math.round(y * 1000) / 1000
  grid.set(key(x, z, y), { type: t, r, x, z, y, order: placeCounter++ })
}

/** Post-generation sanity: every opening on every tile must land on a valid neighbor. */
export function validate(): boolean {
  for (const p of grid.values()) {
    const opens = openingsAt(p.type, p.r)
    const highDir = highDirAt(p.type, p.r)
    for (const d of ALL_DIRS) {
      if (!opens.has(d)) continue
      const nx = p.x + DX[d], nz = p.z + DZ[d]
      if (!inBounds(nx, nz)) return false
      const ny = highDir === d ? p.y + STEP : p.y
      const back = OPP[d]
      const nb1 = grid.get(key(nx, nz, ny))
      let connected = false
      if (nb1) {
        const nb1Opens = openingsAt(nb1.type, nb1.r)
        const nb1High = highDirAt(nb1.type, nb1.r)
        if (nb1High !== back && nb1Opens.has(back)) connected = true
      }
      if (!connected && ny >= BASE_Y + STEP - 0.001) {
        const nb2 = grid.get(key(nx, nz, ny - STEP))
        if (nb2 && highDirAt(nb2.type, nb2.r) === back) connected = true
      }
      if (!connected) return false
    }
  }
  return true
}

function shuffle<T>(a: T[]): T[] {
  const b = a.slice()
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/** Collect empty neighbor cells reached by the placed tile's open edges. */
function frontierFrom(
  p: Placed,
  into: { x: number; z: number; y: number }[],
): void {
  const opens = openingsAt(p.type, p.r)
  const highDir = highDirAt(p.type, p.r)
  for (const d of ALL_DIRS) {
    if (!opens.has(d)) continue
    const nx = p.x + DX[d], nz = p.z + DZ[d]
    if (!inBounds(nx, nz)) continue
    const ny = highDir === d ? p.y + STEP : p.y
    if (ny > MAX_Y) continue
    if (!grid.has(key(nx, nz, ny))) into.push({ x: nx, z: nz, y: ny })
  }
}

/**
 * Populate the grid using the current RNG state (caller must `setSeed()`).
 * Frontier-BFS with vertical stacking: seed at Y=0, grow lowest-Y first
 * so each floor fills horizontally before ramps climb.
 */
export function generate(): void {
  if (IS_SKY) { generateSky(); return }
  const frontier: { x: number; z: number; y: number }[] = []

  // Fixed center seed: place a `cross` tile (4 openings) at the exact
  // grid center. This is the mandatory rally point — same world position
  // every round, four symmetric arms fanning out to N/S/E/W. Downstream
  // teleport-home / respawn logic can rely on it always being there.
  const cx = Math.floor(GRID_W / 2)
  const cz = Math.floor(GRID_H / 2)
  if (canPlace('cross', 0, cx, cz, 0)) {
    placeTile('cross', 0, cx, cz, 0)
    frontierFrom(grid.get(key(cx, cz, 0))!, frontier)
  }

  let safety = 5000
  while (frontier.length > 0 && safety-- > 0) {
    // Process by lowest Y first (random tiebreak within a level).
    // This lets each floor fill out horizontally before ramps climb up.
    const minY = Math.min(...frontier.map(f => f.y))
    const candidates: number[] = []
    for (let i = 0; i < frontier.length; i++) if (frontier[i].y === minY) candidates.push(i)
    const idx = candidates[Math.floor(rand() * candidates.length)]
    const f = frontier.splice(idx, 1)[0]
    if (grid.has(key(f.x, f.z, f.y))) continue

    let placed = false
    // Two passes: branching/ramp/2-way first, then `end` as fallback cap.
    for (const pool of [GROWTH_PRIMARY, GROWTH_FALLBACK]) {
      for (const t of shuffle(pool)) {
        for (const r of shuffle([0, 1, 2, 3])) {
          if (canPlace(t, r, f.x, f.z, f.y)) {
            placeTile(t, r, f.x, f.z, f.y)
            frontierFrom(grid.get(key(f.x, f.z, f.y))!, frontier)
            placed = true
            break
          }
        }
        if (placed) break
      }
      if (placed) break
    }
    // If nothing fits, leave the cell empty (rare with 6 types × 4 rotations).
  }
}

/**
 * Iterate seeds starting at `startSeed` until one produces a valid maze
 * or the attempt budget is exhausted. Returns the winning seed, or null
 * if none was found. Deterministic: same startSeed always yields the
 * same winner across every client.
 */
export function generateWithRetry(startSeed: number, maxAttempts = 500): number | null {
  for (let i = 0; i < maxAttempts; i++) {
    const trySeed = startSeed + i
    setSeed(trySeed)
    resetGrid()
    generate()
    if (validate() && (!IS_SKY || SKY_BASES_ONLY || allTilesConnected())) return trySeed
  }
  return null
}

// ═══ Sky mode ═══════════════════════════════════════════════════════
// Point-symmetric two-base layout. Every placement is made as a PAIR:
// (t, r, x, z, y) plus its 180° image (t, r+2, W-1-x, H-1-z, y), so RED
// and BLUE get the same level. A cell and its image are never orthogonal
// neighbours on an even grid, so the pair can't break each other's rules.
//
// Growth:
//   1. Seeds: RED base square (mirrored → BLUE base) + optional centre hub.
//   2. Main path: grow the frontier cell that lies most "between" the RED
//      base and the hub (min dist-to-base + dist-to-hub, in the RED half
//      frame) until RED reaches BLUE. Never caps with `end` in this phase.
//   3. Branches: the classic lowest-Y-first growth; each frontier cell is
//      capped with `end` first with probability 1 - SKY_BRANCH_DENSITY.
// generateWithRetry then requires validate() AND every tile connected,
// so an accepted seed always links the two bases.

/** 180° image of a grid cell. */
export function mirrorCell(x: number, z: number): [number, number] {
  return [GRID_W - 1 - x, GRID_H - 1 - z]
}

const BASE_X0 = Math.floor(GRID_W / 2) - Math.floor(SKY_BASE_SIZE / 2)

/** Grid cells of a team's base. Bases-only: RED in the SW corner, BLUE in
 *  the NE corner. Full mode: RED mid-south edge, BLUE mid-north edge. */
export function baseCells(team: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const x0 = SKY_BASES_ONLY ? SKY_BASE_MARGIN : BASE_X0
  for (let i = 0; i < SKY_BASE_SIZE; i++) {
    for (let j = 0; j < SKY_BASE_SIZE; j++) {
      const x = x0 + i, z = SKY_BASE_MARGIN + j
      out.push(team === 1 ? [x, z] : mirrorCell(x, z))
    }
  }
  return out
}

/** Team whose base occupies tile (tx, tz, ty), or 0. Always 0 in classic. */
export function baseTeamOfTile(tx: number, tz: number, ty: number): number {
  if (!IS_SKY || Math.abs(ty - BASE_Y) > 0.01) return 0
  for (const team of [1, 2]) {
    for (const [x, z] of baseCells(team)) if (x === tx && z === tz) return team
  }
  return 0
}

/** Same as baseTeamOfTile for a paint cellId "tx,tz,ty:col,row". */
export function baseTeamOfCellId(id: string): number {
  if (!IS_SKY) return 0
  const colon = id.indexOf(':')
  const parts = id.slice(0, colon < 0 ? id.length : colon).split(',')
  return baseTeamOfTile(+parts[0], +parts[1], +parts[2])
}

/** World-space spawn (feet) on a team's base, plus a camera target at the
 *  scene centre. Uses the centre of the base TILE nearest the scene centre:
 *  a ring of turn tiles has a hole in the middle of the block, so the block
 *  centre isn't walkable. */
export function baseSpawn(team: number): { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } {
  const mid = (GRID_W - 1) / 2
  let best = baseCells(team)[0]
  for (const c of baseCells(team)) {
    if (Math.abs(c[0] - mid) + Math.abs(c[1] - mid) < Math.abs(best[0] - mid) + Math.abs(best[1] - mid)) best = c
  }
  const cx = (best[0] + 0.5) * CELL + MAZE_ORIGIN
  const cz = (best[1] + 0.5) * CELL + MAZE_ORIGIN
  const y = BASE_Y + 1.5 // walkable slab top is +0.5
  return { pos: { x: cx, y, z: cz }, look: { x: SCENE_SIZE / 2, y, z: SCENE_SIZE / 2 } }
}

/** Tiles kept alive across round rebuilds (players stand on them at reset). */
export function isPersistentTile(p: Placed): boolean {
  if (IS_SKY) return baseTeamOfTile(p.x, p.z, p.y) !== 0
  return p.x === Math.floor(GRID_W / 2) && p.z === Math.floor(GRID_H / 2) && p.y === 0
}

/** Tiles reachable from `p` through matched openings (same rules as validate()). */
function linkedNeighbours(p: Placed): Placed[] {
  const out: Placed[] = []
  const opens = openingsAt(p.type, p.r)
  const highDir = highDirAt(p.type, p.r)
  for (const d of opens) {
    const nx = p.x + DX[d], nz = p.z + DZ[d]
    if (!inBounds(nx, nz)) continue
    const ny = highDir === d ? p.y + STEP : p.y
    const back = OPP[d]
    const nb1 = grid.get(key(nx, nz, ny))
    if (nb1 && highDirAt(nb1.type, nb1.r) !== back && openingsAt(nb1.type, nb1.r).has(back)) { out.push(nb1); continue }
    const nb2 = grid.get(key(nx, nz, ny - STEP))
    if (nb2 && highDirAt(nb2.type, nb2.r) === back) out.push(nb2)
  }
  return out
}

function reachableFrom(start: Placed): Set<Placed> {
  const seen = new Set<Placed>([start])
  const q = [start]
  while (q.length) {
    for (const n of linkedNeighbours(q.pop()!)) if (!seen.has(n)) { seen.add(n); q.push(n) }
  }
  return seen
}

/** True when the RED base tile reaches the BLUE base tile. */
export function basesConnected(): boolean {
  const [rx, rz] = baseCells(1)[0]
  const [bx, bz] = baseCells(2)[0]
  const red = grid.get(key(rx, rz, BASE_Y)), blue = grid.get(key(bx, bz, BASE_Y))
  if (!red || !blue) return false
  return reachableFrom(red).has(blue)
}

/** True when every placed tile is reachable from the RED base (implies basesConnected). */
export function allTilesConnected(): boolean {
  const [rx, rz] = baseCells(1)[0]
  const red = grid.get(key(rx, rz, BASE_Y))
  if (!red) return false
  return reachableFrom(red).size === grid.size && basesConnected()
}

/** Place a tile and its 180° image, or nothing. */
function placeSym(t: TileType, r: number, x: number, z: number, y: number): boolean {
  const [mx, mz] = mirrorCell(x, z)
  const mr = (r + 2) % 4
  if (mx === x && mz === z) {
    // Odd grid centre: tile must look the same after a half turn.
    if (TILES[t].isRamp) return false
    const a = openingsAt(t, r), b = openingsAt(t, mr)
    if (a.size !== b.size || [...a].some(d => !b.has(d))) return false
    if (!canPlace(t, r, x, z, y)) return false
    placeTile(t, r, x, z, y)
    return true
  }
  if (!canPlace(t, r, x, z, y)) return false
  placeTile(t, r, x, z, y)
  if (!canPlace(t, mr, mx, mz, y)) {
    grid.delete(key(x, z, y)); placeCounter--
    return false
  }
  placeTile(t, mr, mx, mz, y)
  return true
}

function skyPrimaryPool(): TileType[] {
  const pool: TileType[] = []
  for (let i = 0; i < SKY_RAMP_WEIGHT; i++) pool.push('ramp')
  return pool.concat(GROWTH_PRIMARY.filter(t => t !== 'ramp'))
}

function generateSky(): void {
  const frontier: { x: number; z: number; y: number }[] = []
  const pushFrontierAt = (x: number, z: number, y: number) => {
    const p = grid.get(key(x, z, y))
    if (p) frontierFrom(p, frontier)
    const [mx, mz] = mirrorCell(x, z)
    const m = grid.get(key(mx, mz, y))
    if (m && m !== p) frontierFrom(m, frontier)
  }

  // Bases-only: each base is a closed loop — a 2×2 block of `turn` tiles
  // whose openings only face each other (SW opens N+E, SE N+W, NE S+W,
  // NW S+E). The 180° image of RED's block is BLUE's block.
  if (SKY_BASES_ONLY) {
    const [x0, z0] = baseCells(1)[0]
    const ringRot = (i: number, j: number) => (j === 0 ? (i === 0 ? 0 : 3) : (i === 0 ? 1 : 2))
    for (const [x, z] of baseCells(1)) {
      const i = Math.min(1, x - x0), j = Math.min(1, z - z0)
      placeSym('turn', ringRot(i, j), x, z, BASE_Y)
    }
    return
  }

  // 1. Seeds. RED base crosses (images become the BLUE base), then the hub.
  for (const [x, z] of baseCells(1)) {
    if (!grid.has(key(x, z, BASE_Y))) placeSym('cross', 0, x, z, BASE_Y)
  }
  const hubCells: Array<[number, number]> = []
  if (SKY_CENTRE_HUB) {
    const hx = Math.floor(GRID_W / 2) - 1, hz = Math.floor(GRID_H / 2) - 1
    for (const [x, z] of [[hx, hz], [hx + 1, hz], [hx, hz + 1], [hx + 1, hz + 1]] as Array<[number, number]>) {
      hubCells.push([x, z])
      if (!grid.has(key(x, z, BASE_Y))) placeSym('cross', 0, x, z, BASE_Y)
    }
  }
  for (const p of [...grid.values()]) frontierFrom(p, frontier)

  const primary = skyPrimaryPool()
  const tryPlace = (f: { x: number; z: number; y: number }, pools: TileType[][]): boolean => {
    for (const pool of pools) {
      for (const t of shuffle(pool)) {
        for (const r of shuffle([0, 1, 2, 3])) {
          if (placeSym(t, r, f.x, f.z, f.y)) { pushFrontierAt(f.x, f.z, f.y); return true }
        }
      }
    }
    return false
  }
  const capReached = () => SKY_MAX_TILES > 0 && grid.size >= SKY_MAX_TILES

  // 2. Main path: RED half frame; target = hub centre (or the BLUE base).
  const [rbx, rbz] = baseCells(1)[0]
  const goal = hubCells.length ? hubCells[0] : baseCells(2)[0]
  const half = (x: number, z: number): [number, number] =>
    (z >= GRID_H / 2 ? mirrorCell(x, z) : [x, z])
  const score = (f: { x: number; z: number; y: number }) => {
    const [x, z] = half(f.x, f.z)
    const dBase = Math.abs(x - rbx) + Math.abs(z - rbz)
    const dGoal = Math.abs(x - goal[0]) + Math.abs(z - goal[1])
    return dBase + dGoal + (f.y - BASE_Y) / STEP * 0.5 + rand() * 0.9
  }
  let guard = 2000
  while (!basesConnected() && frontier.length && guard-- > 0 && !capReached()) {
    let bi = 0, bs = Infinity
    for (let i = 0; i < frontier.length; i++) {
      const s = score(frontier[i])
      if (s < bs) { bs = s; bi = i }
    }
    const f = frontier.splice(bi, 1)[0]
    if (grid.has(key(f.x, f.z, f.y))) continue
    tryPlace(f, [primary])
  }

  // 3. Branches (classic order: lowest Y first, random within a level).
  guard = 5000
  while (frontier.length && guard-- > 0) {
    const minY = Math.min(...frontier.map(f => f.y))
    const candidates: number[] = []
    for (let i = 0; i < frontier.length; i++) if (frontier[i].y === minY) candidates.push(i)
    const f = frontier.splice(candidates[Math.floor(rand() * candidates.length)], 1)[0]
    if (grid.has(key(f.x, f.z, f.y))) continue
    const branch = !capReached() && rand() < SKY_BRANCH_DENSITY
    tryPlace(f, branch ? [primary, GROWTH_FALLBACK] : [GROWTH_FALLBACK, primary])
  }
}
