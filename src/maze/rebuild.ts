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
  Tween, EasingFunction, AudioSource, Entity,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET, MAZE_ORIGIN,
  isPersistentTile,
  generateWithRetry, getPlacedTilesInOrder, gridSize, placeLobbyLayout,
} from './generator'
import { TILES } from './tiles'
import { spawnCellsForTile, removePaintForTile, resetPaintForTile } from '../paint'
import { clearTeleportOrbs, spawnTeleportOrbsForMaze } from '../teleportOrbs'
import { events } from '../shared/events'
import { SeedHolder, seedHolder } from '../shared/components'

// ─── Pipeline state ─────────────────────────────────────────────────
const spawnedEntities: Entity[] = []
interface SpawnStep { p: Placed; delay: number }
let spawnQueue: SpawnStep[] = []
let spawnClock = 0
let currentSeed = 0
const teardownQueue: Entity[] = []

// ─── Persistent tiles ───────────────────────────────────────────────
// Classic: the centre cross. Sky: both team bases. These are at the same
// place every round (see isPersistentTile in generator.ts), and players
// are teleported onto them at a round boundary, so we spawn them once and
// keep the entities forever instead of tearing them down / growing them in.
// On rebuilds we skip them in both queues and reset their paint in place
// (resetPaintForTile keeps a locked base's team colour).
const persistentEntities = new Map<string, Entity>() // "x,z,y" → tile entity
const tileKey = (p: Placed) => `${p.x},${p.z},${Math.round(p.y * 1000) / 1000}`
const persistentSet = new Set<Entity>()
const TILE_TEARDOWN_PER_FRAME = 25
const STAGGER = 0.03 // seconds between successive tile spawns

/** True while the reveal cascade is still in-flight for the current maze. */
export function isRebuilding(): boolean {
  return spawnQueue.length > 0
}

export type MazeLayout = 'arena' | 'lobby'
let layoutKind: MazeLayout = 'arena'
let requestedSeed = 0
/** True while the voting cross is the floor. A synced maze seed must not replace it. */
export function isLobbyLayout(): boolean {
  return layoutKind === 'lobby'
}

// ─── Rebuild entry point ────────────────────────────────────────────
export function rebuildMaze(seed: number, layout: MazeLayout = 'arena', why = 'call'): void {
  const nextLobby = layout === 'lobby'
  if (nextLobby && layoutKind === 'lobby' && spawnQueue.length === 0 && gridSize() === 4) {
    console.log(`[Lobby] rebuild skipped (${why}) — 4-tile floor already up`)
    return
  }
  console.log(`[Lobby] rebuild ${layout} (${why})`)
  // A layout change drops latched bases. Lobby tiles themselves never latch,
  // so the next arena can place its own bases instead of keeping the cross.
  const dropLatched = nextLobby || layoutKind === 'lobby'
  const previous = spawnedEntities.slice()

  let crossEnt: Entity | null = null
  if (nextLobby) {
    layoutKind = 'lobby'
    placeLobbyLayout()
    const cross = getPlacedTilesInOrder().find(p => p.type !== 'end')
    if (cross) {
      // Full-size floor first, then the teleport, then the old tiles go away.
      crossEnt = spawnTile(cross, true)
      events.emit('lobby:floor', { ready: true })
    }
  }

  for (const e of previous) {
    if (!dropLatched && persistentSet.has(e)) resetPaintForTile(e)
    else teardownQueue.push(e)
  }
  if (dropLatched) {
    persistentEntities.clear()
    persistentSet.clear()
  }
  spawnedEntities.length = 0
  if (crossEnt) spawnedEntities.push(crossEnt)
  if (!dropLatched) for (const e of persistentSet) spawnedEntities.push(e)
  spawnQueue = []
  spawnClock = 0

  if (nextLobby) {
    currentSeed = seed
    const arms = getPlacedTilesInOrder().filter(p => p.type === 'end')
    spawnQueue = arms.map((p, i) => ({ p, delay: i * STAGGER }))
    clearTeleportOrbs()
    console.log(`Lobby laid, ${gridSize()} tiles`)
    return
  }

  layoutKind = 'arena'
  requestedSeed = seed
  const winningSeed = generateWithRetry(seed)
  if (winningSeed === null) {
    console.log(`⚠️ Maze exhausted seeds starting at ${seed} — aborting spawn`)
    return
  }
  currentSeed = winningSeed
  console.log(`Maze rebuilt from seed ${seed} → winning seed ${winningSeed}, ${gridSize()} tiles`)

  const tiles = getPlacedTilesInOrder()
  // Skip persistent tiles that already exist. On the very first rebuild
  // they spawn like any other tile; spawnTile() latches onto them.
  spawnQueue = tiles
    .filter(p => !(isPersistentTile(p) && persistentEntities.has(tileKey(p))))
    .map((p, i) => ({ p, delay: i * STAGGER }))

  // Teleport orb pair — deterministic on the current seed: generateWithRetry
  // leaves the RNG in a fixed state, so every client picks the same tile
  // pair without any network sync. Called after tiles are queued so the
  // tiles array is stable.
  spawnTeleportOrbsForMaze(tiles)
}

/** Build the maze for this synced seed unless it's already the one built (seed watcher + snapshot). */
/** Set while the server says we are in the lobby, so a late seed cannot grow an arena on top. */
let holdSeed = false
export function setHoldMazeSeed(on: boolean): void {
  holdSeed = on
}
export function ensureMazeSeed(seed: number): void {
  if (holdSeed || layoutKind === 'lobby') return
  if (seed === 0 || seed === requestedSeed) return
  requestedSeed = seed
  rebuildMaze(seed, 'arena', 'seed')
}

/** True once a maze has been generated and its reveal cascade has finished. */
export function isMazeReady(): boolean {
  return requestedSeed !== 0 && spawnQueue.length === 0
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
  events.on('round:reset', ({ seed, layout }) => {
    if (layout === 'lobby') {
      // Do not write SeedHolder. The arena seed stays put, and ensureMazeSeed ignores it.
      rebuildMaze(seed, 'lobby', 'roundReset')
      return
    }
    // Arena seed goes through the watcher so a late joiner on the CRDT takes the same path.
    // requestedSeed is set inside rebuildMaze only for the lobby; the watcher still owns the arena.
    if (layoutKind === 'lobby') {
      // Leaving the lobby: build now. The watcher would no-op while layoutKind is still lobby.
      rebuildMaze(seed, 'arena', 'roundReset')
    }
    SeedHolder.createOrReplace(seedHolder, { seed })
  })
}

// ─── Per-frame spawn drain ──────────────────────────────────────────
engine.addSystem((dt: number) => {
  if (spawnQueue.length === 0) return
  spawnClock += dt
  while (spawnQueue.length && spawnQueue[0].delay <= spawnClock) {
    spawnTile(spawnQueue.shift()!.p, false)
  }
})

function spawnTile(p: Placed, full: boolean): Entity {
  const [dx, dz] = ROT_OFFSET[p.r]
  const e = engine.addEntity()
  // Arena bases latch. Lobby tiles never do, including the cross.
  if (layoutKind === 'arena' && isPersistentTile(p) && !persistentEntities.has(tileKey(p))) {
    persistentEntities.set(tileKey(p), e)
    persistentSet.add(e)
  }
  const scale = full ? TILE_SCALE : 0.001
  Transform.create(e, {
    position: Vector3.create(p.x * CELL + dx + MAZE_ORIGIN, p.y, p.z * CELL + dz + MAZE_ORIGIN),
    rotation: Quaternion.fromEulerDegrees(0, p.r * 90, 0),
    scale: Vector3.create(scale, scale, scale),
  })
  GltfContainer.create(e, {
    src: TILES[p.type].model,
    // PHYSICS + POINTER on the same (visible) geometry: the Explorer's 3rd-person camera is only
    // blocked when both layers sit on one mesh (docs: Colliders → Cameras and colliders). No scene
    // pointer events or CL_POINTER raycasts use these tiles; gameplay raycasts stay CL_PHYSICS.
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
  })
  if (!full) {
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
  }
  spawnedEntities.push(e)

  // Lobby floors have no paint masks. A mask would be a second paintable arena.
  if (layoutKind !== 'lobby') spawnCellsForTile(p.type, p.r, p.x, p.z, p.y, CELL, STEP, e)
  return e
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
