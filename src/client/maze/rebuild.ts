/**
 * rebuild.ts — round-to-round maze rebuild pipeline.
 *
 * Owns the visual side of the maze:
 *   - Queueing tile entities to spawn (in BFS-growth order for the reveal cascade)
 *   - Per-frame drain of the spawn queue with a scale-tween grow-in
 *   - Chunked teardown of previous tiles (each tile carries its paint cells with it)
 *
 * Import graph: uses generator (pure, no engine) + paint (spawnCellsForTile,
 * removePaintForTile). Nothing else in the client should call rebuildMaze;
 * the seed watcher in client/index.ts (or wherever it ends up) drives it.
 *
 * NOTE: we intentionally do NOT clear paint state here. That call lives
 * in the round:reset subscriber so genuine round transitions get a clean
 * slate, while a mid-round rebuild (e.g. late-join snapshot arrival)
 * lets spawn adopt PaintCell CRDT colors that arrived during grow-in.
 */

import {
  engine, Transform, GltfContainer, ColliderLayer,
  Tween, EasingFunction, AudioSource, Entity, MeshRenderer, Material,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import { SeedHolder, seedHolder } from 'src/shared/components'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET, MAZE_ORIGIN,
  GRID_W, GRID_H,
  generateWithRetry, getPlacedTilesInOrder, gridSize,
} from 'src/client/maze/generator'
import { TILES } from 'src/client/maze/tiles'
import { spawnCellsForTile, removePaintForTile, resetPaintForTile } from 'src/client/paint'
import { spawnTeleportOrbsForMaze } from 'src/client/teleportOrbs'

// Suppress unused-import complaint from the linter — MeshRenderer/Material
// are only kept in the import list for future tile decoration; harmless.
void MeshRenderer; void Material

// ─── Pipeline state ─────────────────────────────────────────────────
const spawnedEntities: Entity[] = []
interface SpawnStep { p: Placed; delay: number }
let spawnQueue: SpawnStep[] = []
let spawnClock = 0
let currentSeed = 0
const teardownQueue: Entity[] = []

// ─── Persistent center cross ────────────────────────────────────────
// The generator always places a `cross` tile at grid center (see
// generate() in generator.ts). We spawn it once on the first rebuild
// and keep the same entity forever so players standing on it during a
// round boundary aren't shoved by the tear-down / grow-in animation.
// On subsequent rebuilds we skip it in both teardown and spawn queues,
// and reset its paint via resetPaintForTile() instead.
let centerTileEntity: Entity | null = null
const CENTER_X = Math.floor(GRID_W / 2)
const CENTER_Z = Math.floor(GRID_H / 2)
const isCenterTile = (p: Placed) =>
  p.x === CENTER_X && p.z === CENTER_Z && p.y === 0
const TILE_TEARDOWN_PER_FRAME = 25
const STAGGER = 0.03 // seconds between successive tile spawns

/** True while the reveal cascade is still in-flight for the current maze. */
export function isRebuilding(): boolean {
  return spawnQueue.length > 0
}

// ─── Rebuild entry point ────────────────────────────────────────────
export function rebuildMaze(seed: number): void {
  // Push existing tiles into the teardown queue (drained per-frame below).
  // The center tile is preserved: skip its teardown and reset its paint
  // in place so players standing on it aren't disturbed.
  for (const e of spawnedEntities) {
    if (e === centerTileEntity) {
      resetPaintForTile(e)
    } else {
      teardownQueue.push(e)
    }
  }
  spawnedEntities.length = 0
  if (centerTileEntity !== null) spawnedEntities.push(centerTileEntity)
  spawnQueue = []
  spawnClock = 0

  const winningSeed = generateWithRetry(seed)
  if (winningSeed === null) {
    console.log(`⚠️ Maze exhausted seeds starting at ${seed} — aborting spawn`)
    return
  }
  currentSeed = winningSeed
  console.log(`Maze rebuilt from seed ${seed} → winning seed ${winningSeed}, ${gridSize()} tiles`)

  const tiles = getPlacedTilesInOrder()
  // Skip the center tile on rebuilds — it already exists as a persistent
  // entity. On the very first rebuild (centerTileEntity === null) we spawn
  // it like any other tile; spawnTileWithGrow() will latch onto it.
  const skipCenter = centerTileEntity !== null
  spawnQueue = tiles
    .filter(p => !(skipCenter && isCenterTile(p)))
    .map((p, i) => ({ p, delay: i * STAGGER }))

  // Teleport orb pair — deterministic on the current seed: generateWithRetry
  // leaves the RNG in a fixed state, so every client picks the same tile
  // pair without any network sync. Called after tiles are queued so the
  // tiles array is stable.
  spawnTeleportOrbsForMaze(tiles)
}

/** For diagnostics / debug HUD only. */
export function getCurrentSeed(): number {
  return currentSeed
}

/**
 * initMazeNet — wire this module's server-event subscribers.
 *
 * On round:reset we push the new seed into SeedHolder. The seed watcher
 * in client.ts observes the change and calls rebuildMaze(). Kept as two
 * steps (SeedHolder update, then rebuild) rather than calling rebuildMaze
 * directly so late-joining clients receiving the seed via CRDT sync go
 * through the exact same path as an authoritative roundReset.
 */
export function initMazeNet(): void {
  eventBus.on(ClientEvents.RoundReset, ({ seed }) => {
    SeedHolder.createOrReplace(seedHolder, { seed })
  })
}

// ─── Per-frame spawn drain ──────────────────────────────────────────
engine.addSystem((dt: number) => {
  if (spawnQueue.length === 0) return
  spawnClock += dt
  while (spawnQueue.length && spawnQueue[0].delay <= spawnClock) {
    spawnTileWithGrow(spawnQueue.shift()!.p)
  }
})

function spawnTileWithGrow(p: Placed): void {
  const [dx, dz] = ROT_OFFSET[p.r]
  const e = engine.addEntity()
  // Latch the center tile's entity on first spawn so all future rebuilds
  // can preserve it. (Only reached when centerTileEntity is null; the
  // rebuild filter skips this tile on subsequent rounds.)
  if (centerTileEntity === null && isCenterTile(p)) {
    centerTileEntity = e
  }
  Transform.create(e, {
    position: Vector3.create(p.x * CELL + dx + MAZE_ORIGIN, p.y, p.z * CELL + dz + MAZE_ORIGIN),
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
  // Soft positional "pop" as each tile appears. Every-other only, so a
  // cascade of ~100 tiles reads as rhythmic sparkle rather than a buzz.
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

  // Painting overlay: spawns per-cell plane entities parented to this
  // tile. No-op unless a mask is defined for the tile type in paint.ts.
  spawnCellsForTile(p.type, p.r, p.x, p.z, p.y, CELL, STEP, e)
}

// ─── Chunked teardown ───────────────────────────────────────────────
// Each tile carries its paint cells with it via removePaintForTile(), so
// paint disappears the same frame as its parent tile — no ghost paint
// hanging in the air. Draining 25 tiles per frame spreads the ~30k-entity
// cost of a full maze over ~5-10 frames.
engine.addSystem(() => {
  if (teardownQueue.length === 0) return
  const n = Math.min(TILE_TEARDOWN_PER_FRAME, teardownQueue.length)
  for (let i = 0; i < n; i++) {
    const e = teardownQueue.pop()!
    removePaintForTile(e)
    engine.removeEntity(e)
  }
})
