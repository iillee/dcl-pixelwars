/**
 * settings.ts — single source of truth for world / maze / paint knobs.
 *
 * Edit this file to change scene extent, maze tile GLB scale, or paint
 * resolution. Names are prefixed (SCENE_ / MAZE_ / PAINT_) so they stay
 * unambiguous when mixed with domain-local aliases (CELL, STEP, etc.).
 *
 * Safe for client and server — pure constants, no engine imports.
 */

// MARK: Debug vars
// Bundler inlines process.env.NODE_ENV when present; guard for runtimes
// (e.g. headless server) where `process` is undefined.
declare var process: { env: { NODE_ENV?: string } } | undefined

export const IS_DEV =
	typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'


// MARK: Scene

/** Full scene extent in meters (11×11 parcels × 16 m). */
export const SCENE_WORLD_SIZE_METERS = 176


// MARK: Maze tiles

/** Uniform scale applied to maze tile GLBs. */
export const MAZE_TILE_GLTF_SCALE = 2

/** Unscaled tile footprint in meters (one parcel edge). */
export const MAZE_TILE_UNSCALED_METERS = 16

/** World-space size of one maze tile after GLTF scale. */
export const MAZE_TILE_WORLD_METERS = MAZE_TILE_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/** Unscaled ramp floor-to-floor rise baked into the tile GLBs. */
export const MAZE_RAMP_STEP_UNSCALED_METERS = 5.3835

/** World-space Y rise per ramp after GLTF scale. */
export const MAZE_RAMP_STEP_METERS = MAZE_RAMP_STEP_UNSCALED_METERS * MAZE_TILE_GLTF_SCALE

/**
 * Cap on stacked tile Y (meters). With the current step this allows levels
 * 0..3 and blocks level 4 — keeps play flatter / more contested.
 */
export const MAZE_MAX_STACK_Y_METERS = 40

/** Inclusive max stack level index (0 .. this). */
export const MAZE_MAX_LEVEL_INDEX = Math.floor(MAZE_MAX_STACK_Y_METERS / MAZE_RAMP_STEP_METERS)

/** Maze tile grid width (X), derived from scene ÷ tile world size. */
export const MAZE_GRID_WIDTH = Math.floor(SCENE_WORLD_SIZE_METERS / MAZE_TILE_WORLD_METERS)

/** Maze tile grid height (Z), derived from scene ÷ tile world size. */
export const MAZE_GRID_HEIGHT = Math.floor(SCENE_WORLD_SIZE_METERS / MAZE_TILE_WORLD_METERS)

/** World offset so the maze grid is centered in the scene. */
export const MAZE_ORIGIN_OFFSET_METERS =
	(SCENE_WORLD_SIZE_METERS - MAZE_GRID_WIDTH * MAZE_TILE_WORLD_METERS) / 2


// MARK: Paint

/**
 * Paint cells along one edge of a maze tile.
 * Cell world size = MAZE_TILE_WORLD_METERS / PAINT_CELLS_PER_TILE_AXIS.
 * 16 → 2 m cells; 32 → 1 m cells.
 */
export const PAINT_CELLS_PER_TILE_AXIS = 32

/**
 * Default player brush footprint as an odd square of paint cells
 * (e.g. 3 → 3×3 centered on the player). Must be odd so there is a
 * center cell. World span ≈ size × (MAZE_TILE_WORLD_METERS / PAINT_CELLS_PER_TILE_AXIS).
 */
export const PAINT_BRUSH_SIZE_CELLS = 3

/**
 * Client → server paintTick flush rate. Inbound room traffic is capped per
 * peer (~300/s); this stays well under that. Not tied to scene population.
 */
export const PAINT_TICK_HZ = 10

/**
 * Max cell ids per paintTick message. One brush footprint plus headroom.
 * Client chunks the outbox to this size; server drops oversized ticks.
 */
export const PAINT_TICK_MAX_IDS = PAINT_BRUSH_SIZE_CELLS * PAINT_BRUSH_SIZE_CELLS + 16


// MARK: Server publish rates
// In-memory game state may change every paintTick; CRDT component writes
// are coalesced to these rates so the sync bus is not saturated.

/**
 * How often the server writes PaintCoverage to the CRDT (Hz).
 * Only publishes when coverage is dirty.
 */
export const PAINT_COVERAGE_PUBLISH_HZ = 5

/** How often the server writes ServerStats to the CRDT (Hz). */
export const SERVER_STATS_PUBLISH_HZ = 1
