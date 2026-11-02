/**
 * knocks.ts — what each hit does to its victim, in Physics-API units.
 *
 * A human victim's client feeds these straight into applyImpulseToPlayer /
 * applyForceToPlayerForDuration. A bot's server body (shared/botBody.ts)
 * applies the same numbers through BOT_KNOCK_UNIT, so a bot and a human get
 * the same knock from the same hit. (dx, dz) is the unit knock direction the
 * server sends with the impact.
 */
import {
  LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S, LUNGE_KNOCKBACK_LOCK, LUNGE_KNOCKBACK_LOCK_S,
  BURST_KNOCKBACK, BURST_KNOCK_LIFT, BURST_KNOCK_FORCE, BURST_KNOCK_FORCE_S,
  AIR_SPIKE_DOWN, AIR_SPIKE_OUT, AIR_SPIKE_FORCE, AIR_SPIKE_FORCE_S, AIR_SPIKE_GROUND_OUT, AIR_SPIKE_GROUND_LIFT,
} from './pvp'

/** Log how far each knock carries its victim ("[KnockTrace] ..."), on the human victim's client and
 *  for bots on the server, so the bot body can be tuned until both lines match. */
export const KNOCK_TRACE = true

export type KnockV3 = { x: number; y: number; z: number }
export type KnockKind = 'lunge' | 'burst' | 'spike'
export type KnockSpec = {
  kind: KnockKind
  /** One-shot impulse. */
  impulse: KnockV3
  /** Held force: unit direction and magnitude. */
  forceDir: KnockV3
  force: number
  forceS: number
  /** Seconds the victim cannot steer (0 = none). */
  lockS: number
}

const lock = LUNGE_KNOCKBACK_LOCK ? LUNGE_KNOCKBACK_LOCK_S : 0

/** Follows one victim from the knock until it stops, drops 10 m below the start, or 5 s pass. */
export class KnockTrace {
  private t = 0
  private still = 0
  private peak = 0
  private last: KnockV3
  constructor(private kind: KnockKind, private who: string, private start: KnockV3) {
    this.last = { ...start }
  }

  /** Returns the log line once the trace ends, else null. */
  sample(dt: number, p: KnockV3 | null): string | null {
    if (!p) return this.line('lost', this.last)
    this.t += dt
    this.peak = Math.max(this.peak, p.y - this.start.y)
    const speed = dt > 1e-4 ? Math.hypot(p.x - this.last.x, p.y - this.last.y, p.z - this.last.z) / dt : 0
    this.last = { x: p.x, y: p.y, z: p.z }
    this.still = speed < 0.5 ? this.still + dt : 0
    if (p.y < this.start.y - 10) return this.line('fell', p)
    if (this.t > 0.15 && this.still >= 0.3) return this.line('stopped', p)
    if (this.t >= 5) return this.line('timeout', p)
    return null
  }

  private line(end: string, p: KnockV3): string {
    const d = Math.hypot(p.x - this.start.x, p.z - this.start.z)
    const t = end === 'stopped' ? this.t - this.still : this.t
    return `[KnockTrace] ${this.who} ${this.kind}: ${d.toFixed(1)} m in ${t.toFixed(2)} s, peak +${this.peak.toFixed(2)} m, ${end}`
  }
}

export function lungeKnock(dx: number, dz: number): KnockSpec {
  return {
    kind: 'lunge',
    impulse: { x: dx * LUNGE_KNOCKBACK, y: LUNGE_KNOCK_LIFT, z: dz * LUNGE_KNOCKBACK },
    forceDir: { x: dx, y: 0, z: dz }, force: LUNGE_KNOCK_FORCE, forceS: LUNGE_KNOCK_FORCE_S,
    lockS: lock,
  }
}

export function burstKnock(dx: number, dz: number): KnockSpec {
  return {
    kind: 'burst',
    impulse: { x: dx * BURST_KNOCKBACK, y: BURST_KNOCK_LIFT, z: dz * BURST_KNOCKBACK },
    forceDir: { x: dx, y: 0, z: dz }, force: BURST_KNOCK_FORCE, forceS: BURST_KNOCK_FORCE_S,
    lockS: 0,
  }
}

/** Air spike. A victim on a floor is launched (a downward impulse would only meet the ground);
 *  an airborne victim is driven down with a little outward push. */
export function spikeKnock(dx: number, dz: number, grounded: boolean): KnockSpec {
  if (grounded) {
    return {
      kind: 'spike',
      impulse: { x: dx * AIR_SPIKE_GROUND_OUT, y: AIR_SPIKE_GROUND_LIFT, z: dz * AIR_SPIKE_GROUND_OUT },
      forceDir: { x: dx, y: 0, z: dz }, force: BURST_KNOCK_FORCE, forceS: BURST_KNOCK_FORCE_S,
      lockS: lock,
    }
  }
  const ox = dx * 0.35, oz = dz * 0.35
  const fl = Math.hypot(ox, oz, 1)
  return {
    kind: 'spike',
    impulse: { x: dx * AIR_SPIKE_OUT, y: -AIR_SPIKE_DOWN, z: dz * AIR_SPIKE_OUT },
    forceDir: { x: ox / fl, y: -1 / fl, z: oz / fl }, force: AIR_SPIKE_FORCE, forceS: AIR_SPIKE_FORCE_S,
    lockS: lock,
  }
}
