/**
 * recoveryOrb.ts — shared placement and pickup rules for the recovery orb.
 *
 * One orb per arena generation, hanging under a tile-seam arch. The server
 * is authoritative; this module only does the math.
 */
import { CELL, GRID_H, GRID_W, MAZE_ORIGIN, MIN_Y, TILE_SCALE, type Placed } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { ALL_DIRS, DX, DZ, OPP, highDirAt, openingsAt, type Dir } from '../maze/tiles'
import { liveSwell } from './swell'
import { resolvedWaterY } from './waterLook'

export const RECOVERY_ORB_RADIUS = 3
export const RECOVERY_ORB_COOLDOWN_S = 2
export const RECOVERY_ORB_SCALE = 0.8
/**
 * 0 = at the live swell crest, 1 = at the lowest tile deck.
 * Midway (0.5) is the intended hang height.
 */
export const RECOVERY_ORB_HEIGHT_T = 0.5

/**
 * Midpoint between the lowest tile deck and the live 48 m swell crest.
 * Uses `liveSwell().amplitudeM` (24), not `WATER.swellAmplitudeM` (55),
 * because `swellPeakY` still describes the unused 110 m set.
 */
export function recoveryOrbY(): number {
  const deck = MIN_Y + 0.25 * TILE_SCALE
  const crest = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP) + liveSwell().amplitudeM
  return crest + (deck - crest) * RECOVERY_ORB_HEIGHT_T
}

export type RecoverySeam = {
  id: string
  x: number
  y: number
  z: number
  ax: number
  az: number
  bx: number
  bz: number
  tileY: number
  /** Smaller is closer to the grid rim. */
  rim: number
}

function sameY(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001
}

function tileLookupKey(x: number, z: number, y: number): string {
  return `${x},${z},${Math.round(y * 1000) / 1000}`
}

function rimOf(x: number, z: number): number {
  return Math.min(x, z, GRID_W - 1 - x, GRID_H - 1 - z)
}

function seamId(ax: number, az: number, bx: number, bz: number, tileY: number): string {
  const aFirst = ax < bx || (ax === bx && az <= bz)
  const x0 = aFirst ? ax : bx
  const z0 = aFirst ? az : bz
  const x1 = aFirst ? bx : ax
  const z1 = aFirst ? bz : az
  return `${x0},${z0}|${x1},${z1}|${Math.round(tileY * 1000) / 1000}`
}

/**
 * Shared-edge midpoints between two orthogonally adjacent, same-Y tiles
 * whose openings actually meet (a full arch under the seam). Ramp high
 * sides are skipped because those openings lead to a different level.
 */
export function recoverySeams(tiles: Placed[]): RecoverySeam[] {
  const byKey = new Map<string, Placed>()
  for (const p of tiles) byKey.set(tileLookupKey(p.x, p.z, p.y), p)
  const y = recoveryOrbY()
  const out: RecoverySeam[] = []
  const seen = new Set<string>()
  for (const a of tiles) {
    const opens = openingsAt(a.type, a.r)
    const aHigh = highDirAt(a.type, a.r)
    for (const d of ALL_DIRS) {
      if (!opens.has(d)) continue
      if (aHigh === d) continue
      const bx = a.x + DX[d]
      const bz = a.z + DZ[d]
      const b = byKey.get(tileLookupKey(bx, bz, a.y))
      if (!b || !sameY(a.y, b.y)) continue
      const back = OPP[d] as Dir
      if (highDirAt(b.type, b.r) === back) continue
      if (!openingsAt(b.type, b.r).has(back)) continue
      const id = seamId(a.x, a.z, b.x, b.z, a.y)
      if (seen.has(id)) continue
      seen.add(id)
      const ac = { x: (a.x + 0.5) * CELL + MAZE_ORIGIN, z: (a.z + 0.5) * CELL + MAZE_ORIGIN }
      const wx = ac.x + DX[d] * (CELL / 2)
      const wz = ac.z + DZ[d] * (CELL / 2)
      out.push({
        id, x: wx, y, z: wz,
        ax: a.x, az: a.z, bx: b.x, bz: b.z,
        tileY: a.y,
        rim: Math.min(rimOf(a.x, a.z), rimOf(b.x, b.z)),
      })
    }
  }
  return out
}

/** Prefer lowest-level seams, then those nearest the rim, then a random pick. */
export function pickRecoverySeam(tiles: Placed[], avoidId?: string, rng: () => number = Math.random): RecoverySeam | null {
  let seams = recoverySeams(tiles)
  const other = avoidId ? seams.filter(s => s.id !== avoidId) : seams
  if (other.length) seams = other
  if (!seams.length) return null
  const minY = Math.min(...seams.map(s => s.tileY))
  const low = seams.filter(s => sameY(s.tileY, minY))
  const pool0 = low.length ? low : seams
  const minRim = Math.min(...pool0.map(s => s.rim))
  const rim = pool0.filter(s => s.rim === minRim)
  const pool = rim.length ? rim : pool0
  return pool[Math.floor(rng() * pool.length)] ?? null
}