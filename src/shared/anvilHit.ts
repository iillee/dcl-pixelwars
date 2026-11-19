/**
 * anvilHit.ts — pure rules for a launched anvil striking a player or bot.
 * The server is the authority; this only answers "is this strike legal?"
 * and "which way does the victim fly?".
 */
import {
  ANVIL_HIT_MIN_SPEED, ANVIL_HIT_RADIUS, ANVIL_HIT_MAX_DY, ANVIL_HIT_WINDOW_MS, ANVIL_HITTER_IMMUNE_MS,
} from './pvp'

export function anvilLaunchActive(heldMs: number, speed: number): boolean {
  return heldMs >= 0 && heldMs <= ANVIL_HIT_WINDOW_MS && speed >= ANVIL_HIT_MIN_SPEED
}

/** Horizontal knock direction: the anvil's travel, or the offset toward the victim if it's still. */
export function anvilStrikeDir(vx: number, vz: number, ox: number, oz: number): { x: number; z: number } {
  const s = Math.hypot(vx, vz)
  if (s > 1e-3) return { x: vx / s, z: vz / s }
  const d = Math.hypot(ox, oz)
  if (d > 1e-3) return { x: ox / d, z: oz / d }
  return { x: 0, z: 1 }
}

export function anvilStrikeAccepted(opts: {
  alive: boolean
  heldMs: number
  speed: number
  distH: number
  distY: number
  radius: number
  victim: string
  hitter: string
  alreadyHit: boolean
}): boolean {
  if (!opts.alive || opts.alreadyHit) return false
  if (!anvilLaunchActive(opts.heldMs, opts.speed)) return false
  if (opts.victim === opts.hitter && opts.heldMs < ANVIL_HITTER_IMMUNE_MS) return false
  if (opts.distH > opts.radius) return false
  if (Math.abs(opts.distY) > ANVIL_HIT_MAX_DY) return false
  return true
}

/** Default contact radius (server bot tests; client reports use this plus slack). */
export function anvilHitRadius(): number { return ANVIL_HIT_RADIUS }
