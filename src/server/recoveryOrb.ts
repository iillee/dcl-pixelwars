/**
 * recoveryOrb.ts — server-authoritative recovery orb. One per arena
 * generation, hanging under a tile-seam arch. Humans only; bots ignore it.
 */
import { getPlacedTilesInOrder } from '../maze/generator'
import {
  pickRecoverySeam, recoveryOrbY, RECOVERY_ORB_COOLDOWN_S, RECOVERY_ORB_RADIUS,
  type RecoverySeam,
} from '../shared/recoveryOrb'

export type RecoveryPos = { x: number; y: number; z: number }

export type RecoveryUse =
  | { ok: true; from: string; next: { seam: string; x: number; y: number; z: number } | null }
  | { ok: false; reason: string }

type Live = { seam: RecoverySeam; x: number; y: number; z: number }

let live: Live | null = null
const cooldownUntil = new Map<string, number>()

function place(seam: RecoverySeam): Live {
  const y = recoveryOrbY()
  return { seam, x: seam.x, y, z: seam.z }
}

export function recoveryLive(): { seam: string; x: number; y: number; z: number } | null {
  return live ? { seam: live.seam.id, x: live.x, y: live.y, z: live.z } : null
}

export function clearRecovery(): boolean {
  const had = live !== null
  live = null
  cooldownUntil.clear()
  return had
}

export function spawnRecovery(avoidId?: string): { seam: string; x: number; y: number; z: number } | null {
  const seam = pickRecoverySeam(getPlacedTilesInOrder(), avoidId)
  if (!seam) {
    live = null
    return null
  }
  live = place(seam)
  return { seam: seam.id, x: live.x, y: live.y, z: live.z }
}

export function tryUseRecovery(id: string, feet: RecoveryPos | null, now: number): RecoveryUse {
  const who = id.toLowerCase()
  if (who.startsWith('bot:')) return { ok: false, reason: 'bot' }
  if (!live) return { ok: false, reason: 'no-orb' }
  const until = cooldownUntil.get(who) ?? 0
  if (now < until) return { ok: false, reason: 'cooldown' }
  if (!feet) return { ok: false, reason: 'no-position' }
  const dist = Math.hypot(feet.x - live.x, feet.y - live.y, feet.z - live.z)
  if (dist > RECOVERY_ORB_RADIUS) return { ok: false, reason: 'too-far' }
  const from = live.seam.id
  cooldownUntil.set(who, now + RECOVERY_ORB_COOLDOWN_S * 1000)
  const next = spawnRecovery(from)
  return { ok: true, from, next }
}