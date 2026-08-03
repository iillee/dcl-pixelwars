/**
 * tiles.ts — pure tile catalog and direction math.
 *
 * No engine imports, no state, no side effects. Safe to import from
 * anywhere (including tests). Every generator/validator/renderer in the
 * maze package reads from here.
 *
 * Coordinate convention: N=+Z, E=+X, S=-Z, W=-X. Rotation `r` is a
 * 0..3 quarter-turn count applied clockwise (viewed from above).
 */

export type Dir = 0 | 1 | 2 | 3
export const N: Dir = 0
export const E: Dir = 1
export const S: Dir = 2
export const W: Dir = 3
export const ALL_DIRS: Dir[] = [N, E, S, W]
export const OPP: Dir[] = [S, W, N, E]
export const DX = [0, 1, 0, -1]
export const DZ = [1, 0, -1, 0]

export const rotDir = (d: Dir, r: number): Dir =>
  (((d + r) % 4) + 4) % 4 as Dir

// ─── Tile catalog (canonical orientations) ──────────────────────────
export type TileType = 'end' | 'straight' | 'turn' | 'fork' | 'cross' | 'ramp'

export interface TileDef {
  openings: Dir[]
  model: string
  isRamp?: boolean
  /** Which opening is the "high" (Y + STEP) side in canonical orientation. */
  rampHighDir?: Dir
}

export const TILES: Record<TileType, TileDef> = {
  end:      { openings: [N],           model: 'assets/models/tile-end.glb' },
  straight: { openings: [N, S],        model: 'assets/models/tile-straight.glb' },
  turn:     { openings: [N, E],        model: 'assets/models/tile-turn.glb' },
  fork:     { openings: [N, S, W],     model: 'assets/models/tile-fork.glb' },
  cross:    { openings: [N, E, S, W],  model: 'assets/models/tile-cross.glb' },
  ramp:     { openings: [N, S],        model: 'assets/models/tile-ramp.glb', isRamp: true, rampHighDir: N },
}

export const TYPES: TileType[] = ['end', 'straight', 'turn', 'fork', 'cross', 'ramp']

/**
 * Growth priority pool. Weighted by repetition: ramps are boosted to
 * counteract their higher validation-failure rate, so surviving mazes
 * still feature elevation. `end` is the fallback cap only.
 */
export const GROWTH_PRIMARY: TileType[] = [
  'ramp', 'ramp', 'ramp',
  'cross', 'cross',
  'fork', 'fork',
  'turn',
  'straight',
]
export const GROWTH_FALLBACK: TileType[] = ['end']

/** Set of world-facing opening directions for a tile at rotation `r`. */
export const openingsAt = (t: TileType, r: number): Set<Dir> =>
  new Set(TILES[t].openings.map(d => rotDir(d, r)))

/** For ramps: the world-facing direction of the high (upper) side, else null. */
export const highDirAt = (t: TileType, r: number): Dir | null => {
  const def = TILES[t]
  return def.isRamp && def.rampHighDir !== undefined
    ? rotDir(def.rampHighDir, r)
    : null
}
