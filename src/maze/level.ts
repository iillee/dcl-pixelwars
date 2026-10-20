/**
 * level.ts — level-mode switch and sky-level tuning knobs.
 *
 * Pure constants, no engine imports: read by the generator (client and
 * server), paint, the bot graph and the verify scripts, so every side
 * builds the same layout from the same seed.
 *
 *   LEVEL_MODE = 'classic' → the original 5×5 centre-seeded maze (176 m, Y=0).
 *     Also switch scene.json back to the 11×11 parcel list + CenterSpawn.
 *   LEVEL_MODE = 'sky'     → 20×20 parcels (320 m). With the flags below
 *     (bases-only + base line): a 5×5 asymmetric-but-fair woven network over 80–240 m at
 *     SKY_ALTITUDE, three levels, 1-tile team bases in opposite corners
 *     (RED (0,0), BLUE (4,4)) that double as spawns. See generator.ts.
 */

export type LevelMode = 'sky' | 'classic'
export const LEVEL_MODE: LevelMode = 'sky'
export const IS_SKY: boolean = LEVEL_MODE === 'sky'

// ─── Sky tuning ─────────────────────────────────────────────────────
/** Floor of the lowest level (m). Base tiles sit here; WALKABLE_TOP is +0.5. */
export const SKY_ALTITUDE = 32 // raised from 0 (troubleshooting); fall respawn active (>= FALL_RESPAWN_DROP)
/** Total levels including the base level (base level + ramps up). */
export const SKY_LEVEL_COUNT = 3
/** Bases-only mode: corner bases (+ the woven network when SKY_BASE_LINE).
 *  false = the older full sky growth (bases mid-edge, see baseCells). */
export const SKY_BASES_ONLY = true
/** Bases-only sub-mode: grow the seeded woven network between the bases
 *  (generator.ts layBaseLine/netAttempt). false = bases alone. */
export const SKY_BASE_LINE = true
/** Base is SKY_BASE_SIZE × SKY_BASE_SIZE tiles (1 = a single team-locked turn tile). */
export const SKY_BASE_SIZE = 1 // bases-only: one team-locked corner tile each
/** World-space inset of the sky grid from every scene edge (m). 80 = five
 *  parcels → 5×5 tiles over 80–240 m (64 → 6×6 over 64–256, 96 → 4×4 over
 *  96–224 but only ~24 distinct 3-level layouts). Keep (320 - 2·inset) a
 *  multiple of 32 so the grid stays centred, and update scene.json spawns. */
export const SKY_EDGE_INSET = 80
/** Empty grid rows between a base and its scene edge. Bases-only: 0 = true
 *  corners (the ring has no outward openings). Full mode needs ≥1. */
export const SKY_BASE_MARGIN = 0
/** true = every layout is a 180° image of itself (and the teleporter pair is
 *  A <-> mirror(A)). false = asymmetric layouts held to a fairness check
 *  instead (RED/BLUE walking distance to centre, nearest L+1 and nearer
 *  teleporter end within FAIR_TOL tiles); needed for grids below 6×6. */
export const SKY_SYMMETRIC = false
/** Greybox stilts: a lavender box pillar under every sky tile, down to y 0
 *  (visual only, no collider). See rebuild.ts. */
export const SKY_PILLARS = true
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
