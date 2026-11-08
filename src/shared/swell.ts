/**
 * Analytic swell height. The morph clip in build-water-swell.ts is this
 * same sum: each train is sin(k·x + phase + ωt), and ω is one shared cycle
 * per swellPeriodS. Foam rings and the fall check both call this.
 */
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { LOOK, SWELL_48_AMPLITUDE_M, SWELL_48_PERIOD_S, SWELL_TRAINS, SWELL_TRAINS_48, SWELL_VARIANT, WATER, resolvedWaterY } from './waterLook'

export type SwellPart = {
  k: number
  dx: number
  dz: number
  weight: number
  phase: number
}

function toParts(trains: typeof SWELL_TRAINS): SwellPart[] {
  return trains.map((t) => {
    const rad = (t.dirDeg * Math.PI) / 180
    return {
      k: (Math.PI * 2) / t.wavelengthM,
      dx: Math.cos(rad),
      dz: Math.sin(rad),
      weight: t.weight,
      phase: t.phase,
    }
  })
}

/** 110 m set. The mesh builder uses this. */
export const SWELL_PARTS: SwellPart[] = toParts(SWELL_TRAINS)
export const SWELL_PARTS_48: SwellPart[] = toParts(SWELL_TRAINS_48)
const PARTS_48 = SWELL_PARTS_48

export function liveSwell(): { parts: SwellPart[]; amplitudeM: number; periodS: number } {
  if (SWELL_VARIANT === '48m') return { parts: PARTS_48, amplitudeM: SWELL_48_AMPLITUDE_M, periodS: SWELL_48_PERIOD_S }
  return { parts: SWELL_PARTS, amplitudeM: WATER.swellAmplitudeM, periodS: WATER.swellPeriodS }
}

/** One morph shape. kind 0 is sin, kind 1 is cos, before the global scale. */
export function swellPartY(x: number, z: number, part: SwellPart, kind: 0 | 1): number {
  const theta = part.k * (x * part.dx + z * part.dz) + part.phase
  return part.weight * (kind === 0 ? Math.sin(theta) : Math.cos(theta))
}

/** Unnormalised sum at local XZ (metres from the scene centre). */
export function swellSumParts(parts: SwellPart[], x: number, z: number, ang: number): number {
  let y = 0
  for (const part of parts) {
    const theta = part.k * (x * part.dx + z * part.dz) + part.phase + ang
    y += part.weight * Math.sin(theta)
  }
  return y
}

export function swellSum(x: number, z: number, ang: number): number {
  return swellSumParts(liveSwell().parts, x, z, ang)
}

function sampleNorm(parts: SwellPart[]): number {
  let hi = -Infinity
  let lo = Infinity
  const extent = 2200
  const step = 40
  for (let z = -extent; z <= extent; z += step) {
    for (let x = -extent; x <= extent; x += step) {
      for (let a = 0; a < 24; a++) {
        const y = swellSumParts(parts, x, z, (a / 24) * Math.PI * 2)
        if (y > hi) hi = y
        if (y < lo) lo = y
      }
    }
  }
  return Math.max(hi, -lo, 1e-6)
}

/** Peak of the unnormalised 110 m sum. The mesh builder divides by this. */
export const SWELL_NORM = sampleNorm(SWELL_PARTS)
export const SWELL_NORM_48 = sampleNorm(PARTS_48)
const NORM_48 = SWELL_NORM_48

export function liveSwellNorm(): number {
  return SWELL_VARIANT === '48m' ? NORM_48 : SWELL_NORM
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** 1 over the arena, easing to 0 at the outer swell ring. Local metres from centre. */
export function swellFade(localX: number, localZ: number): number {
  const d = Math.max(Math.abs(localX), Math.abs(localZ))
  const inner = WATER.swellMidM
  const outer = WATER.swellFarM
  if (d <= inner) return 1
  if (d >= outer) return 0
  return 1 - smooth((d - inner) / (outer - inner))
}

/** Seconds into the shared cycle. Wall clock, so server and clients agree. */
export function swellCycleSeconds(nowMs: number = Date.now()): number {
  const t = liveSwell().periodS
  return ((nowMs / 1000) % t + t) % t
}

export function swellAngle(cycleSeconds: number): number {
  return (cycleSeconds / liveSwell().periodS) * Math.PI * 2
}

/** World Y of the visible surface. `cycleSeconds` is the clip time of the live variant. */
export function swellSurfaceY(x: number, z: number, cycleSeconds: number = swellCycleSeconds()): number {
  const mid = SCENE_SIZE / 2
  const lx = x - mid
  const lz = z - mid
  const mean = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  const spec = liveSwell()
  const disp = (swellSum(lx, lz, swellAngle(cycleSeconds)) * swellFade(lx, lz) * spec.amplitudeM) / liveSwellNorm()
  return mean + disp
}

/**
 * Falling through the fixed rescue line or through the crest, whichever
 * is higher. A crest above y 112 still counts as a fall.
 */
const FLAT_FALL_Y = MIN_Y - FALL_RESPAWN_DROP

export function fallTriggerY(x: number, z: number, cycleSeconds?: number): number {
  // Sea off: the pre-water rescue line. No sine, no clock read.
  if (!LOOK.sea) return FLAT_FALL_Y
  return Math.max(FLAT_FALL_Y, swellSurfaceY(x, z, cycleSeconds ?? swellCycleSeconds()))
}

/** Metres under the lowest tile that still counts as standing on that floor. */
export const FLOOR_RESCUE_MARGIN = 4

/**
 * Rescue when they have fallen through the live line and the maze can catch
 * them, or when they are already on the base ground well under the floor.
 * The lobby never marks the maze ready, so the ground case must not wait.
 */
export function shouldBeginRescue(y: number, mazeReady: boolean, triggerY: number, floorY: number): boolean {
  if (y < floorY - FLOOR_RESCUE_MARGIN) return true
  return mazeReady && y < triggerY
}
