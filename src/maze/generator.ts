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
  SKY_CENTRE_HUB, SKY_BRANCH_DENSITY, SKY_RAMP_WEIGHT, SKY_MAX_TILES, SKY_BASES_ONLY, SKY_BASE_LINE, SKY_EDGE_INSET,
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
/** Lowest tile level. Bases+line mode adds one level BELOW the bases
 *  (paths ramp down to BASE_Y - STEP); otherwise the bases are the floor. */
const LINE_MODE = IS_SKY && SKY_BASES_ONLY && SKY_BASE_LINE
export const MIN_Y = LINE_MODE ? BASE_Y - STEP : BASE_Y
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
      if (ny >= MIN_Y + STEP - 0.001) {
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
          if (myY < MIN_Y + STEP - 0.001) return false
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
    if (myY >= MIN_Y + STEP - 0.001) {
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
      if (!connected && ny >= MIN_Y + STEP - 0.001) {
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

/** Grid cells of a team's base. Bases-only: RED = SW corner tile (0,0),
 *  BLUE = NE corner tile (7,7). Full mode: RED mid-south, BLUE mid-north. */
export function baseCells(team: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const x0 = SKY_BASES_ONLY ? SKY_BASE_MARGIN : BASE_X0
  for (let i = 0; i < SKY_BASE_SIZE; i++) {
    for (let j = 0; j < SKY_BASE_SIZE; j++) {
      // Bases-only: RED in the SW corner, BLUE its 180° image in the NE corner.
      const z0 = SKY_BASE_MARGIN
      const x = x0 + i, z = z0 + j
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
  const dist = (c: [number, number]) => Math.abs(c[0] - mid) + Math.abs(c[1] - mid)
  const dMin = Math.min(...baseCells(team).map(dist))
  // Average the nearest tiles: edge-centred bases have two (e.g. RED (1,3)
  // and (1,4)), and their shared edge sits on the ring walkway.
  const near = baseCells(team).filter(c => dist(c) === dMin)
  const cx = near.reduce((a, c) => a + c[0] + 0.5, 0) / near.length * CELL + MAZE_ORIGIN
  const cz = near.reduce((a, c) => a + c[1] + 0.5, 0) / near.length * CELL + MAZE_ORIGIN
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
    if (SKY_BASE_LINE && baseLineFits()) { layBaseLine(); return }
    placeRings()
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

/**
 * Bases + woven network (sky, bases-only, line mode). Seeded per round via
 * rand(); every client and the server run the same steps.
 *
 * Layout: RED = single corner tile (0,0), BLUE = its 180° image (7,7). Each
 * base always opens both interior sides (RED N+E, BLUE S+W), so it is a turn
 * tile every round and rebuild.ts's persistent base entity never changes shape.
 *
 * Per attempt:
 *   1. Height field: every non-base cell starts L0; 2–3 random rectangles
 *      (2–4 × 2–4) are raised to L+1 and 2–3 sunk to L-1, each with its 180°
 *      image. Base cells and their 6 exit cells stay L0. L+1 blocks can sit
 *      right beside L-1 / L0 areas, which gives the layered "over" look.
 *   2. Ramps: a cell X at level l becomes a ramp rising toward d when the
 *      neighbour in d is l+1 and the one behind is l. Picked at random in
 *      180° pairs, never two orthogonally adjacent, up to a random 6–14.
 *   3. Edges: every adjacent same-level flat pair may link; a ramp links
 *      only its low and high ends. Base ring + exit edges are fixed.
 *   4. Prune to the 2-core (no dead ends; a ramp missing an end is dropped)
 *      and keep the component holding both bases.
 *   5. Thin: remove random flat-flat edge pairs (edge + its image) while
 *      every cell keeps ≥2 links and everything stays connected, down to a
 *      random 0–25% removed — a dense woven net, not lanes.
 *   6. Tiles from openings (straight/turn/fork/cross), ramps r = high side;
 *      validate() + allTilesConnected() + symmetry.
 * NET_CANDIDATES valid attempts are scored (junctions + ramps + coverage)
 * and the best kept; up to NET_ATTEMPTS tries, else the frozen FALLBACK_NET.
 */
const NET_ATTEMPTS = 600 // 6×6: ~6% of rounds hit the fallback at 200
/** Size scale vs the 8×8 grid the targets were tuned on (62 non-base cells): 6×6 → 0.55. */
const NET_SCALE = (GRID_W * GRID_H - 2) / 62
const NET_CANDIDATES = 6
const THIN_MAX = 0.25
const NET_SCORE_JITTER = 10 // random tie-break so best-of-N does not converge on one layout
const NET_APRON = 1
let usedFallback = false
const baseLineFits = () => SKY_BASE_SIZE === 1 && GRID_W === GRID_H && GRID_W >= 4 && SKY_BASE_MARGIN === 0

/** Flat tile + rotation whose openings are exactly `need`. */
function tileFor(need: Set<Dir>): { t: TileType; r: number } | null {
  for (const t of ['straight', 'turn', 'fork', 'cross', 'end'] as TileType[]) {
    for (let r = 0; r < 4; r++) {
      const o = openingsAt(t, r)
      if (o.size === need.size && [...need].every(d => o.has(d))) return { t, r }
    }
  }
  return null
}


const ck = (x: number, z: number) => `${x},${z}`
const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const mk = (c: string) => { const [x, z] = c.split(',').map(Number); const [mx, mz] = mirrorCell(x, z); return ck(mx, mz) }

/** Ring + exit edges of both bases (always present). */
function fixedEdges(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const team of [1, 2]) {
    const ring = baseCells(team)
    const inRing = (x: number, z: number) => ring.some(([a, b]) => a === x && b === z)
    for (const [x, z] of ring) for (const d of ALL_DIRS) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      if (inRing(nx, nz) && ck(x, z) > ck(nx, nz)) continue
      out.push([ck(x, z), ck(nx, nz)])
    }
  }
  return out
}

interface Net { level: Map<string, number>; ramp: Map<string, Dir>; edges: Set<string> }

function netAttempt(): Net | null {
  const base = new Set<string>(baseCells(1).concat(baseCells(2)).map(([x, z]) => ck(x, z)))
  const fixed = fixedEdges()
  const protectedCells = new Set<string>(base)
  for (const [a, b] of fixed) { protectedCells.add(a); protectedCells.add(b) }
  // Flat L0 apron: cells within NET_APRON steps of a base never rise or sink
  // (1 = the base's exit cells). 2 was tried on 6×6: fewer failed attempts but
  // fewer distinct layouts (183 vs 195 of 250).
  const nearBase = (x: number, z: number) => baseCells(1).concat(baseCells(2)).some(([a, b]) => Math.abs(a - x) + Math.abs(b - z) <= NET_APRON)
  // 1. Height field.
  const level = new Map<string, number>()
  for (let x = 0; x < GRID_W; x++) for (let z = 0; z < GRID_H; z++) level.set(ck(x, z), 0)
  const blobLevels: number[] = []
  for (const l of [1, -1]) { const k = 2 + Math.floor(rand() * 2); for (let b = 0; b < k; b++) blobLevels.push(l) }
  for (const l of shuffle(blobLevels)) {
    {
      const span = Math.max(1, Math.floor(GRID_W / 2) - 1) // 8×8: 2–4, 6×6: 2–3
      const w = 2 + Math.floor(rand() * span), h = 2 + Math.floor(rand() * span)
      const x0 = Math.floor(rand() * (GRID_W - w + 1)), z0 = Math.floor(rand() * (GRID_H - h + 1))
      for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + h; z++) {
        const c = ck(x, z)
        if (protectedCells.has(c) || nearBase(x, z)) continue
        level.set(c, l); level.set(mk(c), l)
      }
    }
  }
  // 2. Ramps.
  const ramp = new Map<string, Dir>()
  const maxRamps = Math.max(4, 2 * Math.round((3 + Math.floor(rand() * 5)) * NET_SCALE)) // 8×8: 6–14, 6×6: 4–8
  const cands: Array<[string, Dir]> = []
  for (const [c, l] of level) {
    if (protectedCells.has(c)) continue
    const [x, z] = c.split(',').map(Number)
    for (const d of ALL_DIRS) {
      const hx = x + DX[d], hz = z + DZ[d], lx = x - DX[d], lz = z - DZ[d]
      if (!inBounds(hx, hz) || !inBounds(lx, lz)) continue
      if (base.has(ck(hx, hz)) || base.has(ck(lx, lz))) continue
      if (level.get(ck(hx, hz)) === l + 1 && level.get(ck(lx, lz)) === l && l + 1 <= 1) cands.push([c, d])
    }
  }
  const adjRamp = (c: string) => {
    const [x, z] = c.split(',').map(Number)
    return ALL_DIRS.some(d => ramp.has(ck(x + DX[d], z + DZ[d])))
  }
  // Interleave L0→L+1 and L-1→L0 candidates so both extra levels get linked.
  const hiC = shuffle(cands.filter(([c]) => level.get(c) === 0)), loC = shuffle(cands.filter(([c]) => level.get(c) === -1))
  const ordered: Array<[string, Dir]> = []
  for (let i = 0; i < Math.max(hiC.length, loC.length); i++) { if (i < hiC.length) ordered.push(hiC[i]); if (i < loC.length) ordered.push(loC[i]) }
  for (const [c, d] of ordered) {
    if (ramp.size >= maxRamps) break
    const m = mk(c)
    if (ramp.has(c) || ramp.has(m) || adjRamp(c) || adjRamp(m)) continue
    // A ramp's ends must stay flat.
    const [x, z] = c.split(',').map(Number)
    if (ramp.has(ck(x + DX[d], z + DZ[d])) || ramp.has(ck(x - DX[d], z - DZ[d]))) continue
    ramp.set(c, d); ramp.set(m, ((d + 2) % 4) as Dir)
  }
  // 3. Edges.
  const edges = new Set<string>()
  const fixedSet = new Set<string>(fixed.map(([a, b]) => ek(a, b)))
  for (const e of fixedSet) edges.add(e)
  for (let x = 0; x < GRID_W; x++) for (let z = 0; z < GRID_H; z++) {
    const c = ck(x, z)
    if (base.has(c)) continue
    for (const d of [0, 1] as Dir[]) {
      const nx = x + DX[d], nz = z + DZ[d]
      if (!inBounds(nx, nz)) continue
      const n = ck(nx, nz)
      if (base.has(n)) continue
      const rc = ramp.get(c), rn = ramp.get(n)
      if (rc === undefined && rn === undefined) {
        if (level.get(c) === level.get(n)) edges.add(ek(c, n))
      } else if (rc !== undefined && rn === undefined) {
        if (rc % 2 === d % 2) edges.add(ek(c, n)) // along the ramp axis; levels set by construction
      } else if (rn !== undefined && rc === undefined) {
        if (rn % 2 === d % 2) edges.add(ek(c, n))
      }
    }
  }
  // Ramp end levels must match (low end = l, high end = l+1) — re-check.
  for (const [c, d] of ramp) {
    const [x, z] = c.split(',').map(Number)
    const l = level.get(c)!
    if (level.get(ck(x + DX[d], z + DZ[d])) !== l + 1 || level.get(ck(x - DX[d], z - DZ[d])) !== l) return null
  }
  // 4. Prune to 2-core.
  const active = new Set<string>(level.keys())
  const nbrs = (c: string) => {
    const [x, z] = c.split(',').map(Number)
    const out: string[] = []
    for (const d of ALL_DIRS) {
      const n = ck(x + DX[d], z + DZ[d])
      if (active.has(n) && edges.has(ek(c, n))) out.push(n)
    }
    return out
  }
  const prune = (): boolean => {
    let changed = true
    while (changed) {
      changed = false
      for (const c of [...active]) {
        const deg = nbrs(c).length
        const bad = ramp.has(c) ? deg < 2 : deg < 2
        if (bad) {
          if (protectedCells.has(c)) return false
          active.delete(c); changed = true
        }
      }
    }
    return true
  }
  if (!prune()) return null
  const [r0x, r0z] = baseCells(1)[0]
  const reach = (from: string) => {
    const seen = new Set<string>([from]); const q = [from]
    while (q.length) for (const n of nbrs(q.pop()!)) if (!seen.has(n)) { seen.add(n); q.push(n) }
    return seen
  }
  const comp = reach(ck(r0x, r0z))
  for (const c of [...active]) if (!comp.has(c)) active.delete(c)
  for (const c of protectedCells) if (!active.has(c)) return null
  if (!prune()) return null
  // 5. Thin.
  const flatEdges = [...edges].filter(e => {
    if (fixedSet.has(e)) return false
    const [a, b] = e.split('|')
    return active.has(a) && active.has(b) && !ramp.has(a) && !ramp.has(b)
  })
  const target = Math.floor(flatEdges.length * rand() * THIN_MAX)
  let removed = 0
  for (const e of shuffle(flatEdges)) {
    if (removed >= target) break
    if (!edges.has(e)) continue
    const [a, b] = e.split('|')
    const me = ek(mk(a), mk(b))
    const ends = [a, b, mk(a), mk(b)]
    edges.delete(e); edges.delete(me)
    if (ends.some(c => nbrs(c).length < 2) || reach(ck(r0x, r0z)).size !== active.size) {
      edges.add(e); edges.add(me); continue
    }
    removed += 2
  }
  const lv = new Map<string, number>(), rp = new Map<string, Dir>(), es = new Set<string>()
  for (const c of active) { lv.set(c, level.get(c)!); if (ramp.has(c)) rp.set(c, ramp.get(c)!) }
  for (const e of edges) { const [a, b] = e.split('|'); if (active.has(a) && active.has(b)) es.add(e) }
  return { level: lv, ramp: rp, edges: es }
}

/** Put a network on the grid. False if it fails any check. */
function layNet(n: Net): boolean {
  resetGrid()
  for (const [c, l] of n.level) {
    const [x, z] = c.split(',').map(Number)
    const y = BASE_Y + l * STEP
    const r = n.ramp.get(c)
    if (r !== undefined) { placeTile('ramp', r, x, z, y); continue }
    const dirs = new Set<Dir>()
    for (const d of ALL_DIRS) if (n.edges.has(ek(c, ck(x + DX[d], z + DZ[d])))) dirs.add(d)
    const t = dirs.size >= 2 ? tileFor(dirs) : null
    if (!t) return false
    placeTile(t.t, t.r, x, z, y)
  }
  return validate() && allTilesConnected() && gridIsSymmetric()
}

function netScore(n: Net): number {
  let junctions = 0
  for (const [c] of n.level) {
    if (n.ramp.has(c)) continue
    const [x, z] = c.split(',').map(Number)
    if (baseTeamOfTile(x, z, BASE_Y)) continue
    const deg = ALL_DIRS.filter(d => n.edges.has(ek(c, ck(x + DX[d], z + DZ[d])))).length
    if (deg >= 3) junctions++
  }
  return junctions + n.ramp.size * 1.5 + n.level.size * 0.3
}

/** Off-base fork/cross count of a network. */
function netJunctions(n: Net): number {
  let j = 0
  for (const [c] of n.level) {
    if (n.ramp.has(c)) continue
    const [x, z] = c.split(',').map(Number)
    if (baseTeamOfTile(x, z, BASE_Y)) continue
    if (ALL_DIRS.filter(d => n.edges.has(ek(c, ck(x + DX[d], z + DZ[d])))).length >= 3) j++
  }
  return j
}
const NET_MIN_JUNCTIONS = Math.round(12 * NET_SCALE) // 8×8: 12, 6×6: 7

function layBaseLine(): void {
  if (!baseLineFits()) return
  usedFallback = false
  let best: Net | null = null, bestScore = -1, found = 0
  for (let i = 0; i < NET_ATTEMPTS && found < NET_CANDIDATES; i++) {
    const n = netAttempt()
    if (!n || !layNet(n)) continue
    const lv = new Set(n.level.values())
    if (!lv.has(1) || !lv.has(-1)) continue // want all three levels
    if (netJunctions(n) < NET_MIN_JUNCTIONS) continue // want a woven net
    found++
    const sc = netScore(n) + rand() * NET_SCORE_JITTER
    if (sc > bestScore) { best = n; bestScore = sc }
  }
  if (best && layNet(best)) return
  layFallback()
}

// Frozen known-good network (generated once, then pasted): "x,z,level[,rampHigh]"
// cells and "a|b" edges. Used when no attempt validates.
const FALLBACK_NET: { cells: string[]; edges: string[] } = {
  cells: ['0,0,0', '0,1,0', '0,2,0', '0,3,0', '0,4,0', '0,5,0', '1,0,0', '1,1,0', '1,2,0', '1,3,0', '1,4,0', '1,5,0,1', '2,0,0,1', '2,1,-1', '2,2,-1', '2,3,-1', '2,4,-1,3', '2,5,1', '3,0,1', '3,1,-1,1', '3,2,-1', '3,3,-1', '3,4,-1', '3,5,0,3', '4,0,0,3', '4,1,0', '4,2,0', '4,3,0', '4,4,0', '4,5,0', '5,0,0', '5,1,0', '5,2,0', '5,3,0', '5,4,0', '5,5,0'],
  edges: ['0,0|0,1', '0,0|1,0', '0,1|0,2', '0,1|1,1', '0,2|0,3', '0,2|1,2', '0,3|0,4', '0,3|1,3', '0,4|0,5', '0,4|1,4', '0,5|1,5', '1,0|2,0', '1,0|1,1', '1,1|1,2', '1,2|1,3', '1,3|1,4', '1,4|2,4', '1,5|2,5', '2,0|3,0', '2,1|2,2', '2,1|3,1', '2,2|2,3', '2,2|3,2', '2,3|3,3', '2,4|3,4', '2,5|3,5', '3,0|4,0', '3,1|4,1', '3,2|3,3', '3,3|3,4', '3,5|4,5', '4,0|5,0', '4,1|5,1', '4,1|4,2', '4,2|4,3', '4,2|5,2', '4,3|4,4', '4,3|5,3', '4,4|4,5', '4,4|5,4', '4,5|5,5', '5,0|5,1', '5,1|5,2', '5,2|5,3', '5,3|5,4', '5,4|5,5'],
}

/** Lay the frozen fallback layout (also called by verify-graph to check it). */
export function layFallback(): void {
  usedFallback = true
  const n: Net = { level: new Map(), ramp: new Map(), edges: new Set(FALLBACK_NET.edges) }
  for (const s of FALLBACK_NET.cells) {
    const [x, z, l, r] = s.split(',')
    n.level.set(ck(+x, +z), +l)
    if (r !== undefined) n.ramp.set(ck(+x, +z), +r as Dir)
  }
  if (!layNet(n)) throw new Error('fallback layout invalid')
}

/** Serialise the current grid as a FALLBACK_NET literal (dev helper). */
export function dumpNet(): string {
  const cells: string[] = [], edges = new Set<string>()
  for (const p of grid.values()) {
    const l = Math.round((p.y - BASE_Y) / STEP)
    cells.push(p.type === 'ramp' ? `${p.x},${p.z},${l},${p.r}` : `${p.x},${p.z},${l}`)
    for (const d of openingsAt(p.type, p.r)) edges.add(ek(ck(p.x, p.z), ck(p.x + DX[d], p.z + DZ[d])))
  }
  return JSON.stringify({ cells, edges: [...edges] })
}

/** True if the last generate() used the frozen fallback (verify scripts). */
export function lastLayoutUsedFallback(): boolean { return usedFallback }

function gridIsSymmetric(): boolean {
  for (const p of grid.values()) {
    const [mx, mz] = mirrorCell(p.x, p.z)
    const q = grid.get(key(mx, mz, p.y))
    if (!q || q.type !== p.type) return false
    const a = [...openingsAt(p.type, p.r)].map(d => (d + 2) % 4).sort().join(), b = [...openingsAt(q.type, q.r)].sort().join()
    if (a !== b) return false
  }
  return true
}

function placeRings(): void {
  const [x0, z0] = baseCells(1)[0]
  const ringRot = (i: number, j: number) => (j === 0 ? (i === 0 ? 0 : 3) : (i === 0 ? 1 : 2))
  for (const [x, z] of baseCells(1)) placeSym('turn', ringRot(Math.min(1, x - x0), Math.min(1, z - z0)), x, z, BASE_Y)
}
