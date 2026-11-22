/**
 * overdrive.ts — star orb spawn and pickup rules.
 * Pure logic: the server is the authority; the client and verify script share this.
 * Pickup grants a normal upgrade. Nothing is held.
 */
import {
  STAR_PICKUP_RADIUS, STAR_PICKUP_MAX_DY, STAR_SPAWN_CLEAR_M,
  STAR_MAX_ACTIVE, STAR_SPAWN_GRACE_MS, OVERDRIVE_FEET_STALE_MS,
} from './pvp'

export const PAINT_BRUSH_RADIUS_CELLS = 1

export type StarOrb = { i: number; x: number; y: number; z: number; cell: string }
export type StarCell = { id: string; x: number; y: number; z: number }

export function overdriveFeetFresh(t: number, now: number): boolean {
  return now - t <= OVERDRIVE_FEET_STALE_MS
}

export function nextStarSpawnAt(now: number, minMs: number, maxMs: number, rand: () => number): number {
  const lo = Math.max(0, Math.floor(minMs))
  const hi = Math.max(lo, Math.floor(maxMs))
  return now + lo + Math.floor(rand() * (hi - lo + 1))
}

export function canSpawnStar(opts: {
  now: number
  roundStartAt: number
  nextAt: number
  graceMs?: number
  activeOrbs: number
  maxActive?: number
}): boolean {
  if (opts.activeOrbs >= (opts.maxActive ?? STAR_MAX_ACTIVE)) return false
  if (opts.now < opts.roundStartAt + (opts.graceMs ?? STAR_SPAWN_GRACE_MS)) return false
  if (opts.now < opts.nextAt) return false
  return true
}

/** Prefer a walkable cell away from players. Returns null if none are free. */
export function pickStarSpawn(cells: readonly StarCell[], avoid: readonly { x: number; z: number }[], clearM = STAR_SPAWN_CLEAR_M, rand: () => number = Math.random): StarCell | null {
  if (!cells.length) return null
  const ok = cells.filter(c => avoid.every(a => Math.hypot(c.x - a.x, c.z - a.z) >= clearM))
  const pool = ok.length ? ok : []
  if (!pool.length) return null
  return pool[Math.floor(rand() * pool.length)]
}

/** First in range wins. Closest, then lower id, so a tie is stable. Bots do not claim. */
export function starPickupWinner(touches: readonly { id: string; isBot: boolean; distH: number; distY: number }[], radius = STAR_PICKUP_RADIUS, maxDy = STAR_PICKUP_MAX_DY): string | null {
  const ok = touches.filter(t => !!t.id && !t.isBot && t.distH <= radius && t.distY <= maxDy)
  if (!ok.length) return null
  const ranked = ok.slice().sort((a, b) => a.distH - b.distH || a.id.localeCompare(b.id))
  return ranked[0].id
}
