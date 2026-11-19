/**
 * overdrive.ts — star-power combat, brush size, and pickup spawn/claim rules.
 * Pure logic: the server is the authority; the client and verify script share this.
 */
import {
  OVERDRIVE_TOUCH_RADIUS, OVERDRIVE_TOUCH_MAX_DY, OVERDRIVE_HIT_WINDOW_MS,
  OVERDRIVE_PAINT_RADIUS_MULT, OVERDRIVE_FEET_STALE_MS,
  STAR_MS, STAR_PICKUP_RADIUS, STAR_PICKUP_MAX_DY, STAR_SPAWN_CLEAR_M,
  STAR_MAX_ACTIVE, STAR_SPAWN_GRACE_MS,
} from './pvp'

export const PAINT_BRUSH_RADIUS_CELLS = 1

export type StarHold = { activeUntil: number }
export type StarOrb = { i: number; x: number; y: number; z: number; cell: string }
export type StarCell = { id: string; x: number; y: number; z: number }

export function emptyStarHold(): StarHold { return { activeUntil: 0 } }

export function isStarActive(hold: StarHold, now: number): boolean {
  return hold.activeUntil > now
}

export function grantStarHold(now: number, durationMs = STAR_MS): StarHold {
  return { activeUntil: now + durationMs }
}

export function expireStarHold(hold: StarHold, now: number): StarHold {
  if (hold.activeUntil !== 0 && hold.activeUntil <= now) return emptyStarHold()
  return hold
}

export function overdrivePaintRadiusCells(active: boolean): number {
  const base = PAINT_BRUSH_RADIUS_CELLS
  return active ? Math.max(base, Math.round(base * OVERDRIVE_PAINT_RADIUS_MULT)) : base
}

/** Square brush offsets in world metres, same shape as the default 3x3 (radius 1). */
export function paintBrushOffsets(cellMeters: number, radiusCells: number): Array<[number, number]> {
  const r = Math.max(0, Math.floor(radiusCells))
  const out: Array<[number, number]> = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) out.push([dx * cellMeters, dz * cellMeters])
  }
  return out
}

export function overdriveCanTouch(opts: {
  attacker: string
  victim: string
  attackerTeam: number
  victimTeam: number
  distH: number
  distY: number
  lastHitAt: number
  now: number
  attackerActive: boolean
  victimImmune: boolean
}): boolean {
  if (!opts.attackerActive) return false
  if (opts.victimImmune) return false
  if (!opts.attacker || !opts.victim || opts.attacker === opts.victim) return false
  if (opts.attacker.startsWith('bot:')) return false
  if (opts.attackerTeam === opts.victimTeam) return false
  if (opts.distH > OVERDRIVE_TOUCH_RADIUS || opts.distY > OVERDRIVE_TOUCH_MAX_DY) return false
  if (opts.now - opts.lastHitAt < OVERDRIVE_HIT_WINDOW_MS) return false
  return true
}

export function overdriveTouchDir(ax: number, az: number, vx: number, vz: number): { x: number; z: number } {
  const dx = vx - ax, dz = vz - az
  const len = Math.hypot(dx, dz)
  if (len < 1e-3) return { x: 0, z: 1 }
  return { x: dx / len, z: dz / len }
}

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
  holderActive: boolean
}): boolean {
  if (opts.holderActive) return false
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

/** First human in range wins. Closest, then lower id, so a tie is stable. Bots never win. */
export function starPickupWinner(touches: readonly { id: string; isBot: boolean; distH: number; distY: number }[], radius = STAR_PICKUP_RADIUS, maxDy = STAR_PICKUP_MAX_DY): string | null {
  const ok = touches.filter(t => !t.isBot && !!t.id && t.distH <= radius && t.distY <= maxDy)
  if (!ok.length) return null
  const ranked = ok.slice().sort((a, b) => a.distH - b.distH || a.id.localeCompare(b.id))
  return ranked[0].id
}
