/**
 * lunge.ts — pure Lunge logic shared by client (client/lunge.ts), server
 * (server.ts lungeStart / lungeHit) and scripts/verify-lunge.ts.
 * No engine imports so it runs under plain node/tsx.
 */
import {
  LUNGE_HITBOX_W, LUNGE_HITBOX_D, LUNGE_HITBOX_H, LUNGE_HITBOX_FORWARD, LUNGE_HIT_OVERLAP, LUNGE_HIT_BEHIND, LUNGE_KNOCK_FACING_WEIGHT,
  SERVER_MIN_LUNGE_GAP_S, SERVER_LUNGE_HIT_WINDOW_S,
} from './pvp'

export type V3 = { x: number; y: number; z: number }

/** Hitbox geometry for an attacker standing at `a` lunging along unit (dx, dz):
 *  centre + yaw (rad, about +y, Transform convention) + size. Single source for
 *  the hit test (boxHit) and the visual box (client/lungeHitbox.ts). */
export function hitboxAt(a: V3, dx: number, dz: number): { c: V3; yaw: number; w: number; d: number; h: number } {
  const mid = LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D / 2
  return {
    c: { x: a.x + dx * mid, y: a.y + LUNGE_HITBOX_H / 2, z: a.z + dz * mid },
    yaw: Math.atan2(dx, dz), w: LUNGE_HITBOX_W, d: LUNGE_HITBOX_D, h: LUNGE_HITBOX_H,
  }
}

/**
 * Swept box hit: the box (LUNGE_HITBOX_W wide, LUNGE_HITBOX_D deep, near face
 * LUNGE_HITBOX_FORWARD ahead, oriented along (dx, dz)) placed at the attacker's
 * position a0 last frame and a1 this frame; does any box in between contain the
 * target (feet within LUNGE_HITBOX_H vertically)? Point-blank targets (within
 * LUNGE_HIT_OVERLAP of the attacker) hit at any angle. `start` is where the
 * lunge began: targets more than LUNGE_HIT_BEHIND m behind the start line
 * never count (directional).
 */
export function boxHit(a0: V3, a1: V3, t: V3, start: V3, dx: number, dz: number): boolean {
  if (Math.abs(t.y - a1.y) > LUNGE_HITBOX_H) return false
  if ((t.x - start.x) * dx + (t.z - start.z) * dz < -LUNGE_HIT_BEHIND) return false
  if (Math.hypot(t.x - a1.x, t.z - a1.z) <= LUNGE_HIT_OVERLAP) return true
  // Local frame: u along the lunge, v across. Box at λ: u ∈ [F + λsu, F + D + λsu], |v − λsv| ≤ W/2.
  const rx = t.x - a0.x, rz = t.z - a0.z
  const tu = rx * dx + rz * dz, tv = rx * dz - rz * dx
  const mx = a1.x - a0.x, mz = a1.z - a0.z
  const su = mx * dx + mz * dz, sv = mx * dz - mz * dx
  let lo = 0, hi = 1
  const slab = (p: number, s: number, min: number, max: number): boolean => {
    // need min ≤ p − λs ≤ max
    if (Math.abs(s) < 1e-9) return p >= min && p <= max
    let l1 = (p - max) / s, l2 = (p - min) / s
    if (l1 > l2) { const k = l1; l1 = l2; l2 = k }
    lo = Math.max(lo, l1); hi = Math.min(hi, l2)
    return lo <= hi
  }
  return slab(tu, su, LUNGE_HITBOX_FORWARD, LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D)
    && slab(tv, sv, -LUNGE_HITBOX_W / 2, LUNGE_HITBOX_W / 2)
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
