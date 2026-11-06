/**
 * Analytic swell height. The morph clip in build-water-swell.ts is this
 * same sum: each train is sin(k·x + phase + ωt), and ω is one shared cycle
 * per swellPeriodS. Foam rings and the fall check both call this.
 */
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { SWELL_TRAINS, WATER, resolvedWaterY } from './waterLook'

export type SwellPart = {
  k: number
  dx: number
  dz: number
  weight: number
  phase: number
}

export const SWELL_PARTS: SwellPart[] = SWELL_TRAINS.map((t) => {
  const rad = (t.dirDeg * Math.PI) / 180
  return {
    k: (Math.PI * 2) / t.wavelengthM,
    dx: Math.cos(rad),
    dz: Math.sin(rad),
    weight: t.weight,
    phase: t.phase,
  }
})

/** One morph shape. kind 0 is sin, kind 1 is cos, before the global scale. */
export function swellPartY(x: number, z: number, part: SwellPart, kind: 0 | 1): number {
  const theta = part.k * (x * part.dx + z * part.dz) + part.phase
  return part.weight * (kind === 0 ? Math.sin(theta) : Math.cos(theta))
}

/** Unnormalised sum at local XZ (metres from the scene centre). */
export function swellSum(x: number, z: number, ang: number): number {
  let y = 0
  for (const part of SWELL_PARTS) {
    const theta = part.k * (x * part.dx + z * part.dz) + part.phase + ang
    y += part.weight * Math.sin(theta)
  }
  return y
}

function sampleNorm(): number {
  let hi = -Infinity
  let lo = Infinity
  const extent = 2200
  const step = 40
  for (let z = -extent; z <= extent; z += step) {
    for (let x = -extent; x <= extent; x += step) {
      for (let a = 0; a < 24; a++) {
        const y = swellSum(x, z, (a / 24) * Math.PI * 2)
        if (y > hi) hi = y
        if (y < lo) lo = y
      }
    }
  }
  return Math.max(hi, -lo, 1e-6)
}

/** Peak of the unnormalised sum. The mesh divides by this, then multiplies by swellAmplitudeM. */
export const SWELL_NORM = sampleNorm()

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
  const t = WATER.swellPeriodS
  return ((nowMs / 1000) % t + t) % t
}

export function swellAngle(cycleSeconds: number): number {
  return (cycleSeconds / WATER.swellPeriodS) * Math.PI * 2
}

/** World Y of the visible surface. `cycleSeconds` is the clip time. */
export function swellSurfaceY(x: number, z: number, cycleSeconds: number = swellCycleSeconds()): number {
  const mid = SCENE_SIZE / 2
  const lx = x - mid
  const lz = z - mid
  const mean = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  const disp = (swellSum(lx, lz, swellAngle(cycleSeconds)) * swellFade(lx, lz) * WATER.swellAmplitudeM) / SWELL_NORM
  return mean + disp
}

/**
 * Falling through the fixed rescue line or through the crest, whichever
 * is higher. A crest above y 112 still counts as a fall.
 */
export function fallTriggerY(x: number, z: number, cycleSeconds: number = swellCycleSeconds()): number {
  return Math.max(MIN_Y - FALL_RESPAWN_DROP, swellSurfaceY(x, z, cycleSeconds))
}
