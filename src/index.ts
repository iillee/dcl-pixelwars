import { engine, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { setupUi } from './ui'

// ─── Direction system ────────────────────────────────────────────────
// N=+Z, E=+X, S=-Z, W=-X
type Dir = 0 | 1 | 2 | 3
const N: Dir = 0, E: Dir = 1, S: Dir = 2, W: Dir = 3
const ALL_DIRS: Dir[] = [N, E, S, W]
const OPP: Dir[] = [S, W, N, E]
const DX = [0, 1, 0, -1]
const DZ = [1, 0, -1, 0]
const rotDir = (d: Dir, r: number): Dir => (((d + r) % 4) + 4) % 4 as Dir

// ─── Tile catalog (canonical orientations) ───────────────────────────
type TileType = 'end' | 'straight' | 'turn' | 'fork' | 'cross' | 'ramp'
interface TileDef {
  openings: Dir[]
  model: string
  isRamp?: boolean
  rampHighDir?: Dir // which opening is the "high" (Y+5) side, canonically
}
const TILES: Record<TileType, TileDef> = {
  end:      { openings: [N],           model: 'assets/models/tile-end.glb' },
  straight: { openings: [N, S],        model: 'assets/models/tile-straight.glb' },
  turn:     { openings: [N, E],        model: 'assets/models/tile-turn.glb' },
  fork:     { openings: [N, S, W],     model: 'assets/models/tile-fork.glb' },
  cross:    { openings: [N, E, S, W],  model: 'assets/models/tile-cross.glb' },
  ramp:     { openings: [N, S],        model: 'assets/models/tile-ramp.glb', isRamp: true, rampHighDir: N },
}
const TYPES: TileType[] = ['end', 'straight', 'turn', 'fork', 'cross', 'ramp']
// Growth priority: try branching + ramps first, cap with `end` only as last resort.
// Weighted pool: repeat entries to bias selection. Ramps are boosted to counteract
// their higher validation-failure rate, so surviving mazes still feature elevation.
const GROWTH_PRIMARY: TileType[] = [
  'ramp', 'ramp', 'ramp',
  'cross', 'cross',
  'fork', 'fork',
  'turn',
  'straight',
]
const GROWTH_FALLBACK: TileType[] = ['end']

const openingsAt = (t: TileType, r: number): Set<Dir> =>
  new Set(TILES[t].openings.map(d => rotDir(d, r)))
const highDirAt = (t: TileType, r: number): Dir | null => {
  const def = TILES[t]
  return def.isRamp && def.rampHighDir !== undefined ? rotDir(def.rampHighDir, r) : null
}

// ─── Grid ────────────────────────────────────────────────────────────
const TILE_SCALE = 2            // uniform scale applied to every tile
const CELL = 16 * TILE_SCALE    // world-space size of one grid cell (m)
const GRID_W = Math.floor(160 / CELL), GRID_H = Math.floor(160 / CELL)  // cells across the 160m scene
const STEP = 5 * TILE_SCALE     // ramp Y increment (scales with tile height)
const MAX_Y = 120               // max stack height (still bound by scene ceiling)

interface Placed { type: TileType; r: number; x: number; z: number; y: number }
const grid = new Map<string, Placed>()
const key = (x: number, z: number, y: number) => `${x},${z},${y}`
const inBounds = (x: number, z: number) => x >= 0 && x < GRID_W && z >= 0 && z < GRID_H

// Check whether tile `t` at rotation `r` can be placed at (x, z, y)
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
      if (!mePointsAtNb && !nbPointsAtMe) continue     // no high-side interaction, other checks cover it
      if (nb.r === r) continue                         // same rotation → clean handshake
      if (mePointsAtNb && nbPointsAtMe) continue       // parallel-opposite meeting at shared high edge
      return false                                      // asymmetric point → unsatisfiable
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
          if (myY < STEP) return false
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
    if (myY >= STEP) {
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

// Because the GLB pivot is at the tile's SW corner (geometry extends +X/+Z),
// rotating swings the geometry into other cells. Compensate with an offset
// so the rotated tile still fills its intended parcel.
const ROT_OFFSET: Array<[number, number]> = [
  [0, 0],           // r=0: no offset
  [0, CELL],        // r=1: 90° CW
  [CELL, CELL],     // r=2: 180°
  [CELL, 0],        // r=3: 270° CW
]

// Record a tile in the grid (no entity spawned yet)
function placeTile(t: TileType, r: number, x: number, z: number, y: number) {
  grid.set(key(x, z, y), { type: t, r, x, z, y })
}

// Spawn an actual entity for a recorded tile
function spawnTile(p: Placed) {
  const [dx, dz] = ROT_OFFSET[p.r]
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(p.x * CELL + dx, p.y, p.z * CELL + dz),
    rotation: Quaternion.fromEulerDegrees(0, p.r * 90, 0),
    scale: Vector3.create(TILE_SCALE, TILE_SCALE, TILE_SCALE),
  })
  GltfContainer.create(e, {
    src: TILES[p.type].model,
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
  })
}

// Validate: every opening on every placed tile must connect to a matching neighbor.
function validate(): boolean {
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
      if (!connected && ny >= STEP) {
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
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

// Collect empty neighbor cells reached by the placed tile's open edges
function frontierFrom(p: Placed, into: { x: number; z: number; y: number }[]) {
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

function generate() {
  const frontier: { x: number; z: number; y: number }[] = []

  // Seed count: roughly 1 seed per 25 parcels. For 10x10 that's 4 seeds —
  // enough for horizontal variety without exploding the retry budget.
  const SEED_COUNT = Math.max(1, Math.round((GRID_W * GRID_H) / 25))
  let seedsPlaced = 0
  let attempts = 0
  while (seedsPlaced < SEED_COUNT && attempts++ < 100) {
    const sx = Math.floor(Math.random() * GRID_W)
    const sz = Math.floor(Math.random() * GRID_H)
    if (grid.has(key(sx, sz, 0))) continue
    for (const r of shuffle([0, 1, 2, 3])) {
      if (canPlace('end', r, sx, sz, 0)) {
        placeTile('end', r, sx, sz, 0)
        frontierFrom(grid.get(key(sx, sz, 0))!, frontier)
        seedsPlaced++
        break
      }
    }
  }

  let safety = 5000
  while (frontier.length > 0 && safety-- > 0) {
    // Process by lowest Y first (random tiebreak within a level).
    // This lets each floor fill out horizontally before ramps climb to the next.
    const minY = Math.min(...frontier.map(f => f.y))
    const candidates: number[] = []
    for (let i = 0; i < frontier.length; i++) if (frontier[i].y === minY) candidates.push(i)
    const idx = candidates[Math.floor(Math.random() * candidates.length)]
    const f = frontier.splice(idx, 1)[0]
    if (grid.has(key(f.x, f.z, f.y))) continue

    let placed = false
    // Two passes: try branching/ramp/2-way tiles first, then `end` as a fallback cap.
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
    // If nothing fits, leave the cell empty (rare with 6 tile types × 4 rotations)
  }
}

export function main() {
  //setupUi()
  // Retry generation until we get a maze with no dangling openings.
  const MAX_ATTEMPTS = 500
  let success = false
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    grid.clear()
    generate()
    if (validate()) {
      console.log(`Maze generated in ${i + 1} attempt(s), ${grid.size} tiles`)
      success = true
      break
    }
  }
  if (!success) {
    console.log(`⚠️ Maze exhausted ${MAX_ATTEMPTS} attempts — showing last (invalid) attempt for debugging`)
  }
  // Materialize entities from the (final) grid state
  for (const p of grid.values()) spawnTile(p)
}
