/**
 * level.ts — level-mode switch and sky-level tuning knobs.
 *
 * Pure constants, no engine imports: read by the generator (client and
 * server), paint, the bot graph and the verify scripts, so every side
 * builds the same layout from the same seed.
 *
 *   LEVEL_MODE = 'classic' → the original 5×5 centre-seeded maze (176 m, Y=0).
 *     Also switch scene.json back to the 11×11 parcel list + CenterSpawn.
 *   LEVEL_MODE = 'sky'     → 10×10 grid on 20×20 parcels (320 m), floating
 *     SKY_ALTITUDE m up, two point-symmetric team bases (RED south, BLUE
 *     north) that double as spawns, ≤ SKY_LEVEL_COUNT levels.
 */

export type LevelMode = 'sky' | 'classic'
export const LEVEL_MODE: LevelMode = 'sky'
export const IS_SKY: boolean = LEVEL_MODE === 'sky'

// ─── Sky tuning ─────────────────────────────────────────────────────
/** Floor of the lowest level (m). Base tiles sit here; WALKABLE_TOP is +0.5. */
export const SKY_ALTITUDE = 0 // troubleshooting: bases on the ground (was 80)
/** Total levels including the base level (base level + ramps up). */
export const SKY_LEVEL_COUNT = 3
/** Bases-only mode: generate ONLY the two corner bases (closed 2×2 rings of
 *  `turn` tiles) — no main path, branches, hub or teleport orbs. Set false
 *  to grow the full sky level again (bases then sit mid-edge, see baseCells). */
export const SKY_BASES_ONLY = true
/** Base is a SKY_BASE_SIZE × SKY_BASE_SIZE square of cross tiles. */
export const SKY_BASE_SIZE = 2
/** World-space inset of the sky grid from every scene edge (m). 64 = four
 *  parcels → 6×6 tiles over 64–256 m. Must keep (320 - 2·inset) a multiple
 *  of 32 for the grid to stay centred. */
export const SKY_EDGE_INSET = 64
/** Empty grid rows between a base and its scene edge. Bases-only: 0 = true
 *  corners (the ring has no outward openings). Full mode needs ≥1. */
export const SKY_BASE_MARGIN = 0
/** Put a 2×2 cross hub at the grid centre (the main path's meeting point). */
export const SKY_CENTRE_HUB = true
/** 0..1. Chance a branch frontier cell keeps branching instead of being
 *  capped with an `end` tile. Lower = sparser level, fewer paint cells. */
export const SKY_BRANCH_DENSITY = 0.6
/** Ramp weight in the growth pool (classic uses 3). Higher = more vertical. */
export const SKY_RAMP_WEIGHT = 3
/** Optional cap on placed tiles (pairs are placed, so it is approximate). 0 = no cap. */
export const SKY_MAX_TILES = 0

/** Bases are locked to their team colour and can't be painted. */
export const BASE_PAINT_LOCK = true
/** Respawn at the team base when the player drops this far below the base floor. */
export const FALL_RESPAWN_DROP = 12
