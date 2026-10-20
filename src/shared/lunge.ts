/**
 * lunge.ts — pure Lunge logic shared by client (client/lunge.ts), server
 * (server.ts lungeStart / lungeHit) and scripts/verify-lunge.ts.
 * No engine imports so it runs under plain node/tsx.
 */
import {
  LUNGE_HIT_RADIUS, LUNGE_HIT_MAX_DY, LUNGE_HIT_BEHIND, LUNGE_KNOCK_FACING_WEIGHT,
  SERVER_MIN_LUNGE_GAP_S, SERVER_LUNGE_HIT_WINDOW_S,
} from './pvp'

export type V3 = { x: number; y: number; z: number }

/**
 * Swept hitbox: does the target touch the capsule swept by the attacker
 * this frame (segment a0→a1, radius LUNGE_HIT_RADIUS)? `start` is where the
 * lunge began and (dx, dz) its unit direction: targets more than
 * LUNGE_HIT_BEHIND m behind the start line never count (directional).
 */
export function sweptHit(a0: V3, a1: V3, t: V3, start: V3, dx: number, dz: number): boolean {
  if (Math.abs(t.y - a1.y) > LUNGE_HIT_MAX_DY) return false
  if ((t.x - start.x) * dx + (t.z - start.z) * dz < -LUNGE_HIT_BEHIND) return false
  const sx = a1.x - a0.x, sz = a1.z - a0.z
  const l2 = sx * sx + sz * sz
  let u = l2 > 1e-9 ? ((t.x - a0.x) * sx + (t.z - a0.z) * sz) / l2 : 0
  u = Math.max(0, Math.min(1, u))
  const cx = a0.x + sx * u, cz = a0.z + sz * u
  return Math.hypot(t.x - cx, t.z - cz) <= LUNGE_HIT_RADIUS
}

/** Knockback direction: mostly away from the attacker, biased along the lunge. Unit (x, z). */
export function knockDir(attacker: V3, target: V3, dx: number, dz: number): { x: number; z: number } {
  let rx = target.x - attacker.x, rz = target.z - attacker.z
  const rl = Math.hypot(rx, rz)
  const w = LUNGE_KNOCK_FACING_WEIGHT
  if (rl < 0.2) { rx = dx; rz = dz } else { rx /= rl; rz /= rl }
  let x = dx * w + rx * (1 - w), z = dz * w + rz * (1 - w)
  const l = Math.hypot(x, z)
  if (l < 1e-3) return { x: dx, z: dz }
  return { x: x / l, z: z / l }
}

/**
 * Server bookkeeping: one live lunge per attacker. start() enforces the
 * cooldown; hit() accepts a target once per (attacker, lunge id) and only
 * within SERVER_LUNGE_HIT_WINDOW_S of the accepted start.
 */
export class LungeLedger {
  private last = new Map<string, { id: number; at: number; hits: Set<string> }>()
  start(from: string, id: number, now: number): boolean {
    const prev = this.last.get(from)
    if (prev && now - prev.at < SERVER_MIN_LUNGE_GAP_S * 1000) return false
    this.last.set(from, { id, at: now, hits: new Set() })
    return true
  }
  hit(from: string, id: number, target: string, now: number): 'ok' | 'unknown' | 'stale' | 'dup' {
    const l = this.last.get(from)
    if (!l || l.id !== id) return 'unknown'
    if (now - l.at > SERVER_LUNGE_HIT_WINDOW_S * 1000) return 'stale'
    const key = target.toLowerCase()
    if (l.hits.has(key)) return 'dup'
    l.hits.add(key)
    return 'ok'
  }
  forget(from: string): void { this.last.delete(from) }
}

/**
 * Victim side: drop an impact that arrives too long after we saw that
 * lunge start (both arrive through the same server relay, so the gap is
 * hit time + attacker→server jitter, independent of clock skew), and
 * apply each (attacker, lunge id) at most once.
 */
export class ImpactGate {
  private seenStart = new Map<string, number>() // `${attacker}#${id}` → local ms
  private applied = new Set<string>()
  constructor(private maxAgeMs: number) {}
  sawStart(attacker: string, id: number, now: number): void {
    this.seenStart.set(`${attacker.toLowerCase()}#${id}`, now)
    if (this.seenStart.size > 64) this.seenStart.delete(this.seenStart.keys().next().value as string)
  }
  accept(attacker: string, id: number, now: number): 'ok' | 'stale' | 'dup' {
    const k = `${attacker.toLowerCase()}#${id}`
    if (this.applied.has(k)) return 'dup'
    const s = this.seenStart.get(k)
    // Start never seen (dropped/out of order): accept rather than lose a real hit.
    if (s !== undefined && now - s > this.maxAgeMs) return 'stale'
    this.applied.add(k)
    if (this.applied.size > 64) this.applied.delete(this.applied.values().next().value as string)
    return 'ok'
  }
}
