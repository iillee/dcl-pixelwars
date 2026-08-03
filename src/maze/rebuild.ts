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
 * preserves cellTeam and lets the spawn code adopt pre-existing colors.
 */

import {
  engine, Transform, GltfContainer, ColliderLayer,
  Tween, EasingFunction, AudioSource, Entity, MeshRenderer, Material,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET,
  generateWithRetry, getPlacedTilesInOrder, gridSize,
} from './generator'
import { TILES } from './tiles'
import { spawnCellsForTile, removePaintForTile } from '../paint'
import { events } from '../shared/events'
import { SeedHolder, seedHolder } from '../shared/components'

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
const TILE_TEARDOWN_PER_FRAME = 25
const STAGGER = 0.03 // seconds between successive tile spawns

/** True while the reveal cascade is still in-flight for the current maze. */
export function isRebuilding(): boolean {
  return spawnQueue.length > 0
}

// ─── Rebuild entry point ────────────────────────────────────────────
export function rebuildMaze(seed: number): void {
  // Push existing tiles into the teardown queue (drained per-frame below).
  for (const e of spawnedEntities) teardownQueue.push(e)
  spawnedEntities.length = 0
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
  spawnQueue = tiles.map((p, i) => ({ p, delay: i * STAGGER }))
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
  events.on('round:reset', ({ seed }) => {
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
