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
  engine, Transform, GltfContainer, GltfContainerLoadingState, LoadingState, ColliderLayer,
  Tween, EasingFunction, AudioSource, Entity,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import {
  Placed, TILE_SCALE, CELL, STEP, ROT_OFFSET, MAZE_ORIGIN,
  isPersistentTile, spawnFloorPlaced,
  generateWithRetry, getPlacedTilesInOrder, gridSize, placeLobbyLayout,
} from './generator'
import { TILES } from './tiles'
import { spawnCellsForTile, removePaintForTile, resetPaintForTile } from '../paint'
import { events } from '../shared/events'
import { installLobbyHoldFloor } from '../lobbyHoldFloor'
import { SeedHolder, seedHolder } from '../shared/components'
import { ServerWorld, isStaleWorld, parseWorldLayout, shouldRebuildWorld } from '../shared/worldState'
import { abortRoundCurtain, isCurtainCovering, startRoundCurtain } from '../shared/roundCurtain'

// ─── Pipeline state ─────────────────────────────────────────────────
const spawnedEntities: Entity[] = []
interface SpawnStep { p: Placed; delay: number }
let spawnQueue: SpawnStep[] = []
let spawnClock = 0
let currentSeed = 0
const teardownQueue: Entity[] = []
/** Previous layout's shells kept until the player has landed on the next floor.
 *  Deleting them in the same turn as a lobby↔arena swap drops the avatar
 *  through empty space before movePlayerTo and the new GLB colliders are in. */
const heldFloor: Entity[] = []
let releaseHeldAt = 0
/** Team spawn / base tiles placed at full scale as soon as the arena is laid. */
const spawnFloorEntities: Entity[] = []
/** Lobby platform, placed at full scale before teleport. */
const lobbyFloorEntities: Entity[] = []

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
  if (nextLobby && layoutKind === 'lobby' && spawnQueue.length === 0 && gridSize() === 5) {
    console.log(`[Lobby] rebuild skipped (${why}) — 5-tile floor already up`)
    return
  }
  const layoutChanged = (nextLobby && layoutKind !== 'lobby') || (!nextLobby && layoutKind !== 'arena')
  console.log(`[Lobby] rebuild ${layout} (${why})`)
  // A layout change drops latched bases. Lobby tiles themselves never latch,
  // so the next arena can place its own bases instead of keeping the cross.
  const dropLatched = nextLobby || layoutKind === 'lobby'
  const previous = spawnedEntities.slice()
  if (heldFloor.length) {
    previous.push(...heldFloor)
    heldFloor.length = 0
    releaseHeldAt = 0
  }

  const early: Entity[] = []
  if (nextLobby) {
    layoutKind = 'lobby'
    placeLobbyLayout()
    // One lobby.glb at the old hub pose stands in for the five logical cells.
    const hub = getPlacedTilesInOrder().filter(p => p.type === 'cross')
    lobbyFloorEntities.length = 0
    for (const p of hub) early.push(spawnTile(p, true))
    for (const e of early) lobbyFloorEntities.push(e)
    if (early.length) events.emit('lobby:floor', { ready: true })
  }

  // Returning to the lobby: keep the arena shells until the teleport has
  // landed. Deleting them in this same turn drops the camera through the
  // hollow blocks for a frame.
  // Leaving the lobby: do not keep the voting floor. The lobby platform sits
  // on the same cells as the new maze, so holding it until spawn-floor
  // colliders load left two layouts overlapping for seconds. The primitive
  // hold pads (already under the cross, and reinstalled at the bases when
  // the player teleports) cover that gap without a visible second maze.
  const returning = nextLobby && layoutChanged
  const leavingLobby = !nextLobby && layoutChanged
  // Behind the opaque curtain the hollow arena shells can come down immediately.
  // Holding them while the lobby grows in is what let the camera look inside a tile.
  const holdOutgoing = returning && !isCurtainCovering()
  if (leavingLobby) installLobbyHoldFloor()
  for (const e of previous) {
    if (!dropLatched && persistentSet.has(e)) resetPaintForTile(e)
    else if (holdOutgoing) heldFloor.push(e)
    else teardownQueue.push(e)
  }
  if (dropLatched) {
    persistentEntities.clear()
    persistentSet.clear()
  }
  // Layout switches must not leave the previous floor's GLBs mixed with the
  // new paint grid (mode changes, a return to the lobby, a late joiner, or
  // leaving the lobby). Returning still holds the arena for the teleport
  // unless the curtain is already covering the swap.
  if (layoutChanged && !holdOutgoing) flushTeardown()
  if (holdOutgoing) releaseHeldAt = Date.now() + 250
  spawnedEntities.length = 0
  for (const e of early) spawnedEntities.push(e)
  if (!dropLatched) for (const e of persistentSet) spawnedEntities.push(e)
  spawnQueue = []
  spawnClock = 0

  if (nextLobby) {
    spawnFloorEntities.length = 0
    currentSeed = seed
    spawnQueue = []
    console.log(`Lobby laid, ${gridSize()} cells, one platform`)
    return
  }

  layoutKind = 'arena'
  lobbyFloorEntities.length = 0
  requestedSeed = seed
  const winningSeed = generateWithRetry(seed)
  if (winningSeed === null) {
    console.log(`⚠️ Maze exhausted seeds starting at ${seed} — aborting spawn`)
    return
  }
  currentSeed = winningSeed
  console.log(`Maze rebuilt from seed ${seed} → winning seed ${winningSeed}, ${gridSize()} tiles`)

  const tiles = getPlacedTilesInOrder()
  // Place every team spawn / base tile at full scale now, before the reveal
  // cascade. The match-start teleport lands on these, and delayed GLB
  // colliders on a tweening shell are what let the avatar fall through.
  spawnFloorEntities.length = 0
  const floorTiles = spawnFloorPlaced(tiles)
  const floorKeys = new Set(floorTiles.map(tileKey))
  for (const p of floorTiles) {
    const existing = persistentEntities.get(tileKey(p))
    if (existing) spawnFloorEntities.push(existing)
    else spawnFloorEntities.push(spawnTile(p, true))
  }
  // Skip spawn floors (already out) and persistent tiles that already exist.
  spawnQueue = tiles
    .filter(p => !floorKeys.has(tileKey(p)) && !(isPersistentTile(p) && persistentEntities.has(tileKey(p))))
    .map((p, i) => ({ p, delay: i * STAGGER }))
}

/** Build the maze for this synced seed unless it's already the one built (seed watcher + snapshot). */
/** Set while the server says we are in the lobby, so a late seed cannot grow an arena on top. */
let holdSeed = false
export function setHoldMazeSeed(on: boolean): void {
  holdSeed = on
}

/** Last server world this client applied. Peer SeedHolder values cannot override it. */
let appliedWorld: ServerWorld | null = null

function flushTeardown(): void {
  while (teardownQueue.length) {
    const e = teardownQueue.pop()!
    removePaintForTile(e)
    engine.removeEntity(e)
  }
}

/** Push the swap-floor removal later. A late teleport waits; an early one does not cut the hold short. */
export function releaseHeldFloorAfter(ms: number): void {
  if (!heldFloor.length) return
  const at = Date.now() + ms
  releaseHeldAt = Math.max(releaseHeldAt, at)
}

function releaseHeldFloor(): void {
  if (!heldFloor.length) {
    releaseHeldAt = 0
    return
  }
  for (const e of heldFloor) teardownQueue.push(e)
  heldFloor.length = 0
  releaseHeldAt = 0
  flushTeardown()
}

/**
 * True when every team spawn / base tile exists at full scale, its GLB has
 * finished loading, and its visible mesh has a physics collider. isMazeReady()
 * only means the reveal cascade finished, which is too early on a load that
 * still has no mesh collider under the avatar.
 */
export function isSpawnFloorReady(): boolean {
  if (layoutKind !== 'arena' || spawnFloorEntities.length === 0) return false
  return floorEntitiesReady(spawnFloorEntities)
}

/**
 * True when every early lobby tile exists at full scale, its GLB has finished
 * loading, and its visible mesh has a physics collider. Compatible with a
 * delayed mask write: ready is false while the mask is still 0.
 */
export function isLobbyFloorReady(): boolean {
  if (layoutKind !== 'lobby' || lobbyFloorEntities.length === 0) return false
  return floorEntitiesReady(lobbyFloorEntities)
}

function floorEntitiesReady(list: Entity[]): boolean {
  for (const e of list) {
    const tr = Transform.getOrNull(e)
    if (!tr || tr.scale.y < TILE_SCALE * 0.99) return false
    const gltf = GltfContainer.getOrNull(e)
    if (!gltf) return false
    const mask = gltf.visibleMeshesCollisionMask ?? 0
    if ((mask & ColliderLayer.CL_PHYSICS) === 0) return false
    const st = GltfContainerLoadingState.getOrNull(e)?.currentState
    if (st !== LoadingState.FINISHED) return false
  }
  return true
}

/** When armed, arena→lobby rebuilds wait until the curtain is opaque. */
let lobbySwapDeferral = false
export function armLobbySwapDeferral(): void {
  lobbySwapDeferral = true
}

let pendingLobbyWorld: ServerWorld | null = null
let pendingLobbyWhy = ''

export function hasPendingLobbyWorld(): boolean {
  return pendingLobbyWorld !== null
}

/** Run a deferred lobby rebuild. No-op when nothing is waiting. */
export function flushPendingLobbyWorld(): boolean {
  if (!pendingLobbyWorld) return false
  const next = pendingLobbyWorld
  const why = pendingLobbyWhy || 'curtain'
  pendingLobbyWorld = null
  pendingLobbyWhy = ''
  rebuildMaze(next.seed, 'lobby', why)
  return true
}


/**
 * Build the floor the server is on. A lower seq is ignored so a stale match
 * clock cannot replace the lobby, and a late joiner rebuilds if they differ.
 */
export function applyServerWorld(next: ServerWorld, why: string): boolean {
  if (isStaleWorld(appliedWorld, next)) {
    console.log(`[World] ignore stale ${why} seq=${next.seq} have=${appliedWorld?.seq}`)
    return false
  }
  const rebuild = shouldRebuildWorld(appliedWorld, next)
  appliedWorld = next
  setHoldMazeSeed(next.layout === 'lobby')
  if (next.layout === 'arena' && next.seed) SeedHolder.createOrReplace(seedHolder, { seed: next.seed })
  else SeedHolder.createOrReplace(seedHolder, { seed: 0 })
  // A new match must never stay hidden behind the win curtain.
  if (next.layout === 'arena') {
    pendingLobbyWorld = null
    pendingLobbyWhy = ''
    abortRoundCurtain()
  }
  // Keep the arena on screen until the mask is opaque, then rebuild behind it.
  if (rebuild && next.layout === 'lobby' && layoutKind === 'arena' && lobbySwapDeferral) {
    startRoundCurtain()
    pendingLobbyWorld = next
    pendingLobbyWhy = why
    return true
  }
  if (rebuild) rebuildMaze(next.seed, next.layout, why)
  return true
}

export function appliedServerWorld(): ServerWorld | null {
  return appliedWorld
}

export function ensureMazeSeed(seed: number): void {
  if (holdSeed || layoutKind === 'lobby') return
  // Only confirm the server's current arena seed. A peer CRDT or a rolled
  // local seed must not build a different maze.
  if (!appliedWorld || appliedWorld.layout !== 'arena' || seed !== appliedWorld.seed) return
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
  events.on('round:reset', ({ seed, layout, format, seq }) => {
    applyServerWorld({
      seq: seq ?? 0,
      seed,
      layout: parseWorldLayout(layout, layout !== 'lobby'),
      format: format ?? '',
      phase: layout === 'lobby' ? 'idle' : 'match',
    }, 'roundReset')
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

const TILE_MASK = ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
type TileLoad = { ent: Entity; src: string; age: number; wait: number; tries: number; wrote: boolean }
const tileLoads: TileLoad[] = []
let tileWatch = false
let tileRetryGap = 0
let tileSealLogged = false

function armTileCollider(ent: Entity): void {
  const src = GltfContainer.getOrNull(ent)?.src ?? ''
  tileLoads.push({ ent, src, age: 0, wait: 0, tries: 0, wrote: false })
  if (tileWatch) return
  tileWatch = true
  engine.addSystem(pumpTileColliders)
}

function pumpTileColliders(dt: number): void {
  tileRetryGap = Math.max(0, tileRetryGap - dt)
  const keep: TileLoad[] = []
  let retried = false
  for (const item of tileLoads) {
    if (!GltfContainer.getOrNull(item.ent)) continue
    item.age += dt
    const state = GltfContainerLoadingState.getOrNull(item.ent)?.currentState
    const scale = Transform.getOrNull(item.ent)?.scale.y ?? 0
    // First collider is this write. A mask on the spawn frame bakes on the
    // origin, half a meter under the deck, and a later rewrite can leave it there.
    if (state === LoadingState.FINISHED && scale >= TILE_SCALE * 0.99) {
      const mesh = GltfContainer.getMutable(item.ent)
      mesh.visibleMeshesCollisionMask = TILE_MASK
      mesh.invisibleMeshesCollisionMask = 0
      if (item.wrote) {
        if (!tileSealLogged) {
          tileSealLogged = true
          console.log('[Tiles] collider on the loaded deck')
        }
        continue
      }
      item.wrote = true
      keep.push(item)
      continue
    }
    const failed = state === LoadingState.NOT_FOUND || state === LoadingState.FINISHED_WITH_ERROR
    const never = state === undefined || state === LoadingState.UNKNOWN
    item.wait += dt
    const giveUp = item.tries >= 3
    if (!giveUp && !retried && tileRetryGap <= 0 && ((failed && item.wait >= 1) || (never && item.wait >= 6))) {
      retried = true
      tileRetryGap = 0.75
      item.tries += 1
      item.wait = 0
      item.wrote = false
      console.log(`[Tiles] mesh not in, retry ${item.tries} src=${item.src} state=${state ?? 'none'}`)
      GltfContainer.deleteFrom(item.ent)
      GltfContainer.create(item.ent, {
        src: item.src,
        visibleMeshesCollisionMask: 0,
        invisibleMeshesCollisionMask: 0,
      })
    }
    if (!giveUp) keep.push(item)
  }
  tileLoads.length = 0
  for (const item of keep) tileLoads.push(item)
  if (!tileLoads.length) {
    engine.removeSystem(pumpTileColliders)
    tileWatch = false
    tileSealLogged = false
  }
}

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
    // lobby.glb sits 1.6 m lower than the old hub cross.
    position: Vector3.create(p.x * CELL + dx + MAZE_ORIGIN, layoutKind === 'lobby' ? p.y - 1.6 : p.y, p.z * CELL + dz + MAZE_ORIGIN),
    rotation: Quaternion.fromEulerDegrees(0, p.r * 90, 0),
    scale: Vector3.create(scale, scale, scale),
  })
  GltfContainer.create(e, {
    src: layoutKind === 'lobby' ? 'assets/models/lobby.glb' : TILES[p.type].model,
    // No shape yet. The deck is 0.25 local (0.5 m) above the origin. A collider
    // baked before this GLB is in, or while the grow-in scale is still tiny,
    // sits on that origin and other clients show the body knee-deep. The mask
    // (physics and camera on the visible mesh) is written once the load and
    // the full scale are both in.
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  armTileCollider(e)
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
  // Held shells are only the outgoing arena when returning to the lobby.
  // Release on the short cap or when the lobby teleport lands. Do not wait
  // for arena GLB colliders — that kept two floors on screen for seconds.
  if (releaseHeldAt > 0 && Date.now() >= releaseHeldAt) releaseHeldFloor()
  if (teardownQueue.length === 0) return
  const n = Math.min(TILE_TEARDOWN_PER_FRAME, teardownQueue.length)
  for (let i = 0; i < n; i++) {
    const e = teardownQueue.pop()!
    removePaintForTile(e)
    engine.removeEntity(e)
  }
})

/** [Sink] probe: the live tile entities, read-only. */
export function sinkProbeTiles(): readonly Entity[] {
  return spawnedEntities
}
