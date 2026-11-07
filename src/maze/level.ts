/**
 * level.ts — level-mode switch and sky-level tuning knobs.
 *
 * Pure constants, no engine imports: read by the generator (client and
 * server), paint, the bot graph and the verify scripts, so every side
 * builds the same layout from the same seed.
 *
 *   LEVEL_MODE = 'classic' → the original 5×5 centre-seeded maze (176 m, Y=0).
 *     Also switch scene.json back to the 11×11 parcel list + CenterSpawn.
 *   LEVEL_MODE = 'sky'     → SKY_PARCELS × SKY_PARCELS (a World; no LAND cost).
 *     The play grid stays 5×5. The extra parcels are open water so the sea is
 *     inside the scene bounds (explorers clip anything outside). See waterLook.ts.
 *
 * World size (sky only). 'large' is 100×100 (1600 m), the deploy default.
 * The arena stays centred and our sea fills the box out to the haze.
 * 'small' is 20×20, 'medium' is 64×64, 'wide' is 150×150, 'full' is 300×300.
 * After changing this, run `npx tsx scripts/write-scene.ts`. The swell meshes
 * are built for 'large'; run `npx tsx scripts/build-water-swell.ts` after a
 * size change so the rings still meet the parcel edge.
 */

export type LevelMode = 'sky' | 'classic'
export const LEVEL_MODE: LevelMode = 'sky'
export const IS_SKY: boolean = LEVEL_MODE === 'sky'

// ─── Sky tuning ─────────────────────────────────────────────────────
/**
 * Added to every sky height (floors, spawns, rescue, water). The swell
 * troughs were clipped by the world floor at y 0. 100 lifts the old layout
 * clear of that floor. scene.json spawn y must match baseSpawn (L0 + 1.5).
 */
export const LEVEL_Y_OFFSET = 100
/** World Y of the top level (L+1). The 100 is the pre-offset roof. */
export const SKY_TOP_Y = 100 + LEVEL_Y_OFFSET
/** L0 world Y = top minus one level rise (generator STEP = 5.3835 x TILE_SCALE 2
 *  = 10.767). With the offset: L-1 178.466 / L0 189.233 / L+1 200; spawns at
 *  L0 + 1.5 = 190.733; fall line MIN_Y - FALL_RESPAWN_DROP ≈ 112.47. */
export const SKY_ALTITUDE = SKY_TOP_Y - 5.3835 * 2
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
/**
 * Parcels on a side. 16 m each. `full` is the World maximum (300×300 = 90,000
 * parcels, 4800 m). `large` is 100×100 (1600 m). `medium` is 64×64.
 * `small` is 20×20. The play grid stays 5×5 because the inset grows with
 * the scene. Keep scene.json in step via scripts/write-scene.ts.
 */
export const MEDIUM_PARCELS = 64
export const LARGE_PARCELS = 100
export const WIDE_PARCELS = 150
export const WORLD_SIZE = 'large' as 'small' | 'medium' | 'large' | 'wide' | 'full'
export const SKY_PARCELS =
  WORLD_SIZE === 'full' ? 300
    : WORLD_SIZE === 'wide' ? WIDE_PARCELS
      : WORLD_SIZE === 'large' ? LARGE_PARCELS
        : WORLD_SIZE === 'medium' ? MEDIUM_PARCELS
          : 20

/** Southwest parcel. The 300×300 block must start at -150. Smaller blocks are
 *  centred on parcel 0,0 and stay inside the publisher range (-150..149). */
export function sceneOriginParcel(parcels = SKY_PARCELS): number {
  if (parcels >= 300) return -150
  const origin = -Math.floor(parcels / 2)
  const end = origin + parcels - 1
  if (end > 149) return 149 - (parcels - 1)
  if (origin < -150) return -150
  return origin
}
export const SKY_SCENE_M = SKY_PARCELS * 16
/** Inset that leaves a 5×32 m grid centred in the scene. */
export const SKY_EDGE_INSET = (SKY_SCENE_M - 5 * 32) / 2
/** Empty grid rows between a base and its scene edge. Bases-only: 0 = true
 *  corners (the ring has no outward openings). Full mode needs ≥1. */
export const SKY_BASE_MARGIN = 0
/** true = every layout is a 180° image of itself (and the teleporter pair is
 *  A <-> mirror(A)). false = asymmetric layouts held to a fairness check
 *  instead (RED/BLUE walking distance to centre, nearest L+1 and nearer
 *  teleporter end within FAIR_TOL tiles); needed for grids below 6×6. */
export const SKY_SYMMETRIC = false
/** Put a 2×2 cross hub at the grid centre (the main path's meeting point). */
export const SKY_CENTRE_HUB = true
/** 0..1. Chance a branch frontier cell keeps branching instead of being
 *  capped with an `end` tile. Lower = sparser level, fewer paint cells. */
export const SKY_BRANCH_DENSITY = 0.6
/** Ramp weight in the growth pool (classic uses 3). Higher = more vertical. */
export const SKY_RAMP_WEIGHT = 3
/** Optional cap on placed tiles (pairs are placed, so it is approximate). 0 = no cap. */
export const SKY_MAX_TILES = 0

/** Bases locked to their team colour (unpaintable)? Off (Luke): base cells start unpainted and can be painted/captured like any cell. */
export const BASE_PAINT_LOCK = false
/** Spawn the teleport orb pair in-world? Off (Luke): playtesters found them unclear. The generator still
 *  places and fairness-checks the pair, so layouts are unchanged and turning this back on is one flag. */
export const TELEPORT_ORBS = false
/** The fall rescue (and anvil respawn) triggers this far below the lowest floor (MIN_Y ≈ 178.5 → line ≈ 112.5).
 *  Luke: was 12 (line ~66.5); lowered so a fall costs a couple more seconds of free fall. Keep the line
 *  above the ground (y 0) and MIN_Y > this value, or the rescue disables itself. */
export const FALL_RESPAWN_DROP = 66
