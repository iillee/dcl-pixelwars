import {
  engine,
  Transform,
  GltfContainer,
  ColliderLayer,
  Schemas,
  Tween,
  EasingFunction,
  PointerEvents,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  Billboard,
  BillboardMode,
  TextShape,
  Font,
  AudioSource,
  MeshCollider,
  InputAction,
  pointerEventsSystem,
  Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
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

// ─── Seeded RNG ──────────────────────────────────────────────────────
// Mulberry32: tiny deterministic PRNG. Given the same seed, the same maze is
// produced every time — in preview, in the deployed World, everywhere. Makes
// generator bugs reproducible: note the logged seed, and we can inspect the
// exact same tile layout offline.
let _seed = 0
function rand(): number {
  _seed |= 0
  _seed = (_seed + 0x6D2B79F5) | 0
  let t = _seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function setSeed(s: number) { _seed = s | 0 }

// ─── Grid ────────────────────────────────────────────────────────────
const TILE_SCALE = 2            // uniform scale applied to every tile
const CELL = 16 * TILE_SCALE    // world-space size of one grid cell (m)
const GRID_W = Math.floor(160 / CELL), GRID_H = Math.floor(160 / CELL)  // cells across the 160m scene
const STEP = 5 * TILE_SCALE     // ramp Y increment (scales with tile height)
const MAX_Y = 120               // max stack height (still bound by scene ceiling)

interface Placed { type: TileType; r: number; x: number; z: number; y: number; order: number }
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
      if (ny >= STEP) {
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

// Record a tile in the grid (no entity spawned yet). `order` reflects the BFS
// frontier walk in generate(): seeds first, then their neighbors, then their
// neighbors' neighbors, with ramps carrying the wave upward. Used later to
// spawn tiles in growth order for the reveal animation.
let placeCounter = 0
function placeTile(t: TileType, r: number, x: number, z: number, y: number) {
  grid.set(key(x, z, y), { type: t, r, x, z, y, order: placeCounter++ })
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
    const j = Math.floor(rand() * (i + 1))
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
    const sx = Math.floor(rand() * GRID_W)
    const sz = Math.floor(rand() * GRID_H)
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
    const idx = candidates[Math.floor(rand() * candidates.length)]
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

// ─── Shared seed (synced across all players) ─────────────────────────
// A single synced component holds the current maze seed. All clients converge
// on the same value via CRDT last-write-wins, so everyone sees the same maze.
// seed=0 means "uninitialized" — no maze rendered yet, late joiners wait.
const SeedHolder = engine.defineComponent('maze::seed-holder', { seed: Schemas.Int })
const seedHolder = engine.addEntity()
SeedHolder.create(seedHolder, { seed: 0 })

// ─── Rebuild pipeline ────────────────────────────────────────────────
const spawnedEntities: Entity[] = []
interface SpawnStep { p: Placed; delay: number }
let spawnQueue: SpawnStep[] = []
let spawnClock = 0
let currentSeed = 0

function rebuildMaze(seed: number) {
  // Tear down previous maze
  for (const e of spawnedEntities) engine.removeEntity(e)
  spawnedEntities.length = 0
  spawnQueue = []
  spawnClock = 0
  grid.clear()
  placeCounter = 0

  // Deterministic generation — iterate seeds until one validates. Both the
  // starting seed and the iteration order are the same on every client, so
  // everyone lands on the same winning seed and identical tile layout.
  const MAX_ATTEMPTS = 500
  let success = false
  let winningSeed = 0
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const trySeed = seed + i
    setSeed(trySeed)
    grid.clear()
    placeCounter = 0
    generate()
    if (validate()) {
      winningSeed = trySeed
      success = true
      break
    }
  }
  if (!success) {
    console.log(`⚠️ Maze exhausted ${MAX_ATTEMPTS} seeds starting at ${seed} — aborting spawn`)
    return
  }
  console.log(`Maze rebuilt from seed ${seed} → winning seed ${winningSeed}, ${grid.size} tiles`)

  // Queue tiles to spawn in generation order: seeds first, then their
  // neighbors, and so on — with ramps carrying the wave upward. Late joiners
  // see the maze visibly grow from its origin points and climb.
  const tiles = [...grid.values()].sort((a, b) => a.order - b.order)
  const STAGGER = 0.03 // seconds between successive tile spawns
  spawnQueue = tiles.map((p, i) => ({ p, delay: i * STAGGER }))
}

// Per-frame drain: pop tiles whose scheduled delay has elapsed and spawn them
// with a scale-tween grow-in.
engine.addSystem((dt: number) => {
  if (spawnQueue.length === 0) return
  spawnClock += dt
  while (spawnQueue.length && spawnQueue[0].delay <= spawnClock) {
    spawnTileWithGrow(spawnQueue.shift()!.p)
  }
})

function spawnTileWithGrow(p: Placed) {
  const [dx, dz] = ROT_OFFSET[p.r]
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(p.x * CELL + dx, p.y, p.z * CELL + dz),
    rotation: Quaternion.fromEulerDegrees(0, p.r * 90, 0),
    scale: Vector3.create(0.001, 0.001, 0.001),
  })
  GltfContainer.create(e, {
    src: TILES[p.type].model,
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
  })
  Tween.create(e, {
    mode: Tween.Mode.Scale({
      start: Vector3.create(0.001, 0.001, 0.001),
      end: Vector3.create(TILE_SCALE, TILE_SCALE, TILE_SCALE),
    }),
    duration: 500,
    easingFunction: EasingFunction.EF_EASEOUTBACK,
  })
  // Soft pop as the tile appears. Positional (attached to the tile itself),
  // low volume so the cascade of ~100 tiles reads as ambient sparkle rather
  // than noise.
  // Only every other tile pops — halves the sound density so the cascade
  // reads as rhythmic sparkle rather than a rapid-fire buzz.
  if (p.order % 2 === 0) {
    AudioSource.create(e, {
      audioClipUrl: 'assets/sounds/pop.mp3',
      playing: true,
      loop: false,
      volume: 0.25,
      global: true,
    })
  }
  spawnedEntities.push(e)
}

// ─── Seed watcher ────────────────────────────────────────────────────
// Reacts to any change in the synced seed (from another player pulling the
// lever, or from our own first-joiner init). Also locks every known lever so
// the cooldown is symmetric across all clients — nobody can repull until the
// rebuild has finished on all machines.
engine.addSystem(() => {
  const s = SeedHolder.get(seedHolder).seed
  if (s !== 0 && s !== currentSeed) {
    currentSeed = s
    rebuildMaze(s)
    for (const e of knownLevers) lockLever(e)
    cooldownRemaining = POST_REBUILD_COOLDOWN
  }
})

// ─── Lever watcher ───────────────────────────────────────────────────
// The lever is a Creator Hub composite entity with an `asset-packs::States`
// component that flips between "Activated"/"Deactivated" on click. When we
// detect a fresh transition into "Activated", we generate a new random seed
// and write it to SeedHolder — the seed watcher above then rebuilds the maze
// on every client via CRDT sync.
let leverStatesComp: any = null
const leverLastState = new Map<Entity, string>()
// Every entity we've ever seen with asset-packs::States — used so the seed
// watcher can lock every lever, not just the one the local player pulled.
const knownLevers = new Set<Entity>()
// Snapshot of each lever's PointerEvents and GLTF collision masks so we can
// restore them after cooldown.
const leverSavedPointerEvents = new Map<Entity, any>()
const leverSavedColliders = new Map<Entity, { visible: number; invisible: number }>()
const leverBusy = new Set<Entity>()
const POST_REBUILD_COOLDOWN = 30 // extra seconds after grow-in completes — gives climbers time to explore before someone regens
let cooldownRemaining = 0

function lockLever(entity: Entity) {
  if (leverBusy.has(entity)) return
  leverBusy.add(entity)

  // 1) Clear PointerEvents so any hover tooltip / feedback disappears.
  const pe = PointerEvents.getOrNull(entity)
  if (pe) {
    leverSavedPointerEvents.set(entity, { pointerEvents: pe.pointerEvents.map(e => ({ ...e, eventInfo: { ...e.eventInfo } })) })
  }
  PointerEvents.createOrReplace(entity, { pointerEvents: [] })

  // 2) Strip the CL_POINTER bit from the GLTF colliders. Without a pointer
  // collider, raycasts can't hit the lever — so clicks (and the associated
  // pull animation) are physically impossible until we restore it. This
  // survives even if the asset-packs runtime re-injects PointerEvents.
  const gltf = GltfContainer.getOrNull(entity)
  if (gltf) {
    const vis = gltf.visibleMeshesCollisionMask ?? 0
    const inv = gltf.invisibleMeshesCollisionMask ?? 0
    leverSavedColliders.set(entity, { visible: vis, invisible: inv })
    GltfContainer.createOrReplace(entity, {
      ...gltf,
      visibleMeshesCollisionMask: vis & ~ColliderLayer.CL_POINTER,
      invisibleMeshesCollisionMask: inv & ~ColliderLayer.CL_POINTER,
    })
  }

  // 3) Move the invisible click-proxy on top of the lever so attempted clicks
  // during cooldown land on it and play the error sound.
  if (leverClickProxy) {
    const t = Transform.getOrNull(entity)
    if (t) {
      Transform.getMutable(leverClickProxy).position = Vector3.create(t.position.x, t.position.y + 1.3, t.position.z)
    }
  }
}

function unlockLever(entity: Entity) {
  if (!leverBusy.has(entity)) return
  leverBusy.delete(entity)

  const saved = leverSavedPointerEvents.get(entity)
  if (saved) {
    PointerEvents.createOrReplace(entity, saved)
    leverSavedPointerEvents.delete(entity)
  }

  const savedCol = leverSavedColliders.get(entity)
  const gltf = GltfContainer.getOrNull(entity)
  if (savedCol && gltf) {
    GltfContainer.createOrReplace(entity, {
      ...gltf,
      visibleMeshesCollisionMask: savedCol.visible,
      invisibleMeshesCollisionMask: savedCol.invisible,
    })
    leverSavedColliders.delete(entity)
  }

  // Park the click-proxy far below the scene so it can't be interacted with.
  if (leverClickProxy && leverBusy.size === 0) {
    Transform.getMutable(leverClickProxy).position = Vector3.create(0, -200, 0)
  }
}

engine.addSystem((dt: number) => {
  if (!leverStatesComp) {
    leverStatesComp = engine.getComponentOrNull('asset-packs::States')
    if (!leverStatesComp) return
  }
  for (const [entity, states] of engine.getEntitiesWith(leverStatesComp)) {
    knownLevers.add(entity)
    const cur: string = (states as any).currentValue ?? (states as any).defaultValue ?? ''
    const prev = leverLastState.get(entity)
    // Trigger on ANY transition (Activated ↔ Deactivated). The lever's toggle
    // model would otherwise create a dead pull after every rebuild where the
    // animation plays but no regeneration fires.
    if (prev !== undefined && prev !== cur && !leverBusy.has(entity)) {
      const newSeed = Math.floor(Math.random() * 0x7fffffff) || 1
      SeedHolder.createOrReplace(seedHolder, { seed: newSeed })
      console.log(`Lever pulled → new seed ${newSeed}`)
      const t = Transform.getOrNull(entity)
      if (t) playSoundAt(pullSoundEnt, t.position, 'assets/sounds/pull.mp3')
      // Lock immediately so the local player can't spam-click before the seed
      // watcher runs next frame. The seed watcher will also lock every other
      // known lever (and lock this one on remote clients).
      lockLever(entity)
      cooldownRemaining = POST_REBUILD_COOLDOWN
    }
    leverLastState.set(entity, cur)
  }

  // Unlock once the rebuild has fully finished (queue drained) AND a short
  // post-rebuild grace period has elapsed — gives the grow-in time to settle.
  if (leverBusy.size > 0) {
    if (spawnQueue.length === 0) {
      cooldownRemaining -= dt
      if (cooldownRemaining <= 0) {
        for (const e of [...leverBusy]) unlockLever(e)
      }
    } else {
      cooldownRemaining = POST_REBUILD_COOLDOWN
    }
  }
})

// ─── First-joiner initialization ─────────────────────────────────────
// If we've been in-scene for a grace period and the synced seed is still 0,
// nobody has ever set it — we're the first player. Roll a seed so the scene
// isn't empty forever. Subsequent joiners will receive the current seed via
// CRDT sync before their timer fires, and skip this path.
let initTimer = 0
let initDone = false
const INIT_GRACE = 1.5 // seconds
engine.addSystem((dt: number) => {
  if (initDone) return
  initTimer += dt
  if (initTimer < INIT_GRACE) return
  initDone = true
  if (SeedHolder.get(seedHolder).seed === 0) {
    const s = Math.floor(Math.random() * 0x7fffffff) || 1
    console.log(`No existing maze seed after ${INIT_GRACE}s — initializing with ${s}`)
    SeedHolder.createOrReplace(seedHolder, { seed: s })
  }
})

// ─── Lever sounds ───────────────────────────────────────────────────
// Two dedicated audio entities we reposition to the lever each time we fire a
// sound. Recreating AudioSource with playing:true retriggers playback even if
// the previous play hadn't finished.
let pullSoundEnt: Entity = 0 as Entity
let errorSoundEnt: Entity = 0 as Entity

function playSoundAt(entity: Entity, pos: Vector3, src: string, volume = 1) {
  Transform.getMutable(entity).position = pos
  AudioSource.createOrReplace(entity, { audioClipUrl: src, playing: true, loop: false, volume })
}

// Invisible clickable proxy: enabled (moved on top of the lever) while the
// lever is locked so that clicks land on _it_ instead of passing through, and
// play the error sound. When unlocked we teleport it far away so it can't be
// clicked, restoring normal lever behavior.
let leverClickProxy: Entity = 0 as Entity

function setupLeverAudio() {
  pullSoundEnt = engine.addEntity()
  Transform.create(pullSoundEnt, { position: Vector3.create(0, -200, 0) })
  errorSoundEnt = engine.addEntity()
  Transform.create(errorSoundEnt, { position: Vector3.create(0, -200, 0) })

  leverClickProxy = engine.addEntity()
  Transform.create(leverClickProxy, {
    position: Vector3.create(0, -200, 0),
    scale: Vector3.create(1.6, 2.6, 1.6),
  })
  MeshCollider.setBox(leverClickProxy, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: leverClickProxy, opts: { button: InputAction.IA_POINTER, hoverText: 'Regenerating...' } },
    () => {
      const pos = Transform.get(leverClickProxy).position
      playSoundAt(errorSoundEnt, pos, 'assets/sounds/error.mp3')
    }
  )
}

// ─── Cooldown countdown label ────────────────────────────────────────
// A billboarded 3D text label floating above the lever. Shows "Building..."
// while tiles are spawning, then a live countdown of remaining cooldown seconds.
// Hidden entirely when the lever is free to pull.
let cooldownLabel: Entity = 0 as Entity
let cooldownTickEnt: Entity = 0 as Entity
let lastTickSecond = -1
// Independent countdown clock: starts the instant leverBusy becomes non-empty
// and ticks up every frame, so the displayed number begins falling immediately
// (even while tiles are still growing in).
let displayClock = 0
const COOLDOWN_LABEL_Y_OFFSET = 2.2

function setupCooldownLabel() {
  cooldownLabel = engine.addEntity()
  Transform.create(cooldownLabel, { position: Vector3.create(0, -200, 0) })
  Billboard.create(cooldownLabel, { billboardMode: BillboardMode.BM_Y })
  cooldownTickEnt = engine.addEntity()
  Transform.create(cooldownTickEnt, { position: Vector3.create(0, -200, 0) })
  TextShape.create(cooldownLabel, {
    text: '',
    fontSize: 6,
    font: Font.F_SANS_SERIF,
    textColor: Color4.White(),
  })
}

engine.addSystem((dt: number) => {
  if (!cooldownLabel) return
  if (leverBusy.size > 0) displayClock += dt
  else displayClock = 0
  // Find the lever position (first known lever).
  let leverPos: Vector3 | null = null
  for (const e of knownLevers) {
    const t = Transform.getOrNull(e)
    if (t) { leverPos = t.position; break }
  }
  const tt = Transform.getMutable(cooldownLabel)
  const ts = TextShape.getMutable(cooldownLabel)
  if (!leverPos || leverBusy.size === 0) {
    tt.position = Vector3.create(0, -200, 0)
    ts.text = ''
    lastTickSecond = -1
    return
  }
  tt.position = Vector3.create(leverPos.x, leverPos.y + COOLDOWN_LABEL_Y_OFFSET, leverPos.z)
  const displayRemaining = Math.max(0, POST_REBUILD_COOLDOWN - displayClock)
  const secs = Math.max(0, Math.ceil(displayRemaining))
  ts.text = `${secs}`
  if (secs !== lastTickSecond && secs > 0) {
    lastTickSecond = secs
    playSoundAt(cooldownTickEnt, tt.position, 'assets/sounds/click.wav', 0.25)
  }
  const frac = displayRemaining - Math.floor(displayRemaining)
  const pulse = 1 + 0.4 * frac * frac
  tt.scale = Vector3.create(pulse, pulse, pulse)
})

// ─── Lever beacon ────────────────────────────────────────────────────
// Two stacked billboarded planes (inner narrow + outer wide) with a pulsing
// scale, planted above the lever so players can spot it from anywhere in the
// 160m maze. Adapted from the power-scene staff beacon.
const BEACON_HEIGHT = 30
const BEACON_Y_OFFSET = 3.0
const INNER_WIDTH = 0.35
const OUTER_WIDTH = 1.2
const INNER_ALPHA = 0.45
const OUTER_ALPHA = 0.18
const EMISSIVE_INNER = 3.0
const EMISSIVE_OUTER = 2.0
const PULSE_SPEED = 2.5
const PULSE_RANGE = 0.15
// Warm amber — pairs well with the pirate lever's brass fittings.
const BEACON_COLOR = { r: 1.0, g: 0.75, b: 0.35 }
const HIDDEN_POS = Vector3.create(0, -200, 0)

let innerBeacon: Entity = 0 as Entity
let outerBeacon: Entity = 0 as Entity
let beaconPulseTime = 0

function setupBeacon() {
  innerBeacon = engine.addEntity()
  Transform.create(innerBeacon, { position: HIDDEN_POS, scale: Vector3.create(INNER_WIDTH, BEACON_HEIGHT, 1) })
  MeshRenderer.setPlane(innerBeacon)
  Billboard.create(innerBeacon, { billboardMode: BillboardMode.BM_Y })

  outerBeacon = engine.addEntity()
  Transform.create(outerBeacon, { position: HIDDEN_POS, scale: Vector3.create(OUTER_WIDTH, BEACON_HEIGHT, 1) })
  MeshRenderer.setPlane(outerBeacon)
  Billboard.create(outerBeacon, { billboardMode: BillboardMode.BM_Y })

  const c = BEACON_COLOR
  const gradient = Material.Texture.Common({ src: 'assets/images/beacon-gradient.png' })
  const alpha = Material.Texture.Common({ src: 'assets/images/beacon-alpha.png' })
  Material.setPbrMaterial(innerBeacon, {
    texture: gradient,
    alphaTexture: alpha,
    albedoColor: Color4.create(c.r, c.g, c.b, INNER_ALPHA),
    emissiveColor: Color3.create(c.r, c.g, c.b),
    emissiveIntensity: EMISSIVE_INNER,
    transparencyMode: MaterialTransparencyMode.MTM_AUTO,
    castShadows: false,
  })
  Material.setPbrMaterial(outerBeacon, {
    texture: gradient,
    alphaTexture: alpha,
    albedoColor: Color4.create(c.r, c.g, c.b, OUTER_ALPHA),
    emissiveColor: Color3.create(c.r, c.g, c.b),
    emissiveIntensity: EMISSIVE_OUTER,
    transparencyMode: MaterialTransparencyMode.MTM_AUTO,
    castShadows: false,
  })
}

// Follows the first known lever's world position. Uses the same knownLevers
// set the cooldown system maintains, so no extra discovery logic needed.
engine.addSystem((dt: number) => {
  if (!innerBeacon) return
  beaconPulseTime += dt
  const pulse = 1 + PULSE_RANGE * Math.sin(beaconPulseTime * PULSE_SPEED)

  let leverPos: Vector3 | null = null
  for (const e of knownLevers) {
    const t = Transform.getOrNull(e)
    if (t) { leverPos = t.position; break }
  }

  if (!leverPos) {
    Transform.getMutable(innerBeacon).position = HIDDEN_POS
    Transform.getMutable(outerBeacon).position = HIDDEN_POS
    return
  }

  const beaconY = leverPos.y + BEACON_Y_OFFSET + BEACON_HEIGHT / 2
  const iT = Transform.getMutable(innerBeacon)
  iT.position = Vector3.create(leverPos.x, beaconY, leverPos.z)
  iT.scale = Vector3.create(INNER_WIDTH * pulse, BEACON_HEIGHT, 1)
  const oT = Transform.getMutable(outerBeacon)
  oT.position = Vector3.create(leverPos.x, beaconY, leverPos.z)
  oT.scale = Vector3.create(OUTER_WIDTH * (2 - pulse), BEACON_HEIGHT, 1)
})

// ─── Background music ──────────────────────────────────────────────────
// Looped ambient track. Parented to the camera so it's always at ear-level
// regardless of where the player wanders in the 160m scene.
const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
let musicEnt: Entity = 0 as Entity
let musicMuted = false
// Track playback position across pause/resume so the song continues where it
// left off instead of restarting. Pattern borrowed from flagtag's boomboxState:
// the SDK reads currentTime on the playing:false→true transition, so we must
// seek BEFORE setting playing=true.
let playStartMs = 0
let pausedPositionSec = 0
let muteClickEnt: Entity = 0 as Entity
export function isMusicMuted() { return musicMuted }
export function toggleMusic() {
  // UI click feedback — same click.wav used by the cooldown ticker.
  if (muteClickEnt) {
    AudioSource.createOrReplace(muteClickEnt, {
      audioClipUrl: 'assets/sounds/click.wav',
      playing: true, loop: false, volume: 0.5, global: true,
    })
  }
  const a = AudioSource.getMutableOrNull(musicEnt) as
    { volume: number; playing: boolean; currentTime?: number } | null
  if (!a) return
  if (!musicMuted) {
    // Pause: bank the elapsed play time and stop.
    pausedPositionSec += (Date.now() - playStartMs) / 1000
    a.playing = false
    musicMuted = true
  } else {
    // Resume: seek first, THEN flip playing on.
    a.currentTime = pausedPositionSec
    a.playing = true
    playStartMs = Date.now()
    musicMuted = false
  }
}
function setupMusic() {
  muteClickEnt = engine.addEntity()
  Transform.create(muteClickEnt, { parent: engine.CameraEntity })
  musicEnt = engine.addEntity()
  Transform.create(musicEnt, { parent: engine.CameraEntity })
  AudioSource.create(musicEnt, {
    audioClipUrl: MUSIC_SRC,
    playing: true,
    loop: true,
    volume: MUSIC_VOLUME,
    global: true,
  })
  playStartMs = Date.now()
}

export function main() {
  setupUi()
  setupMusic()
  setupBeacon()
  setupLeverAudio()
  setupCooldownLabel()
  // Register the SeedHolder for cross-client sync. Doing this inside main()
  // (rather than at module top level) ensures the networking layer is ready.
  // Fixed networkId so every client's SeedHolder maps to the same synced entity.
  syncEntity(seedHolder, [SeedHolder.componentId], 3000)
  // Maze construction is fully event-driven from here: the seed watcher will
  // build the maze the moment a non-zero seed arrives (from sync or init).
}
