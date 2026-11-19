/**
 * overdriveBook.ts — server-side star-power bookkeeping for human players.
 * Bots never receive charge or activation.
 */
import { OVERDRIVE_TILES } from '../shared/pvp'
import {
  accrueOverdriveCharge, emptyOverdrive, expireOverdrive, isOverdriveActive, isOverdriveReady,
  resetOverdriveOnDeath, tryActivateOverdrive, type OverdriveState,
} from '../shared/overdrive'

const keyOf = (id: string) => id.toLowerCase()

export class OverdriveBook {
  private states = new Map<string, OverdriveState>()
  private lastHit = new Map<string, number>()
  private dirty = new Set<string>()

  private get(id: string): OverdriveState {
    return this.states.get(keyOf(id)) ?? emptyOverdrive()
  }

  private set(id: string, state: OverdriveState): void {
    const k = keyOf(id)
    this.states.set(k, state)
    this.dirty.add(k)
  }

  paintedGain(id: string, gained: number, now: number): void {
    if (!id || id.startsWith('bot:') || gained <= 0) return
    this.set(id, accrueOverdriveCharge(this.get(id), gained, now))
  }

  tryUse(id: string, now: number): boolean {
    if (!id || id.startsWith('bot:')) return false
    const result = tryActivateOverdrive(this.get(id), now)
    if (!result.ok) return false
    this.set(id, result.state)
    return true
  }

  /** Returns true if a running star was cancelled. */
  onDeath(id: string): boolean {
    if (!id || id.startsWith('bot:')) return false
    const was = isOverdriveActive(this.get(id), Date.now())
    this.set(id, resetOverdriveOnDeath(this.get(id)))
    return was
  }

  isActive(id: string, now: number): boolean {
    if (!id || id.startsWith('bot:')) return false
    return isOverdriveActive(this.get(id), now)
  }

  expire(now: number): string[] {
    const ended: string[] = []
    for (const [id, state] of this.states) {
      const next = expireOverdrive(state, now)
      if (next === state) continue
      this.set(id, next)
      ended.push(id)
    }
    return ended
  }

  actives(now: number): Array<{ id: string; until: number }> {
    const out: Array<{ id: string; until: number }> = []
    for (const [id, state] of this.states) {
      if (isOverdriveActive(state, now)) out.push({ id, until: state.activeUntil })
    }
    return out
  }

  ownerState(id: string, now: number): { charge: number; ready: number; active: number; until: number } {
    const s = expireOverdrive(this.get(id), now)
    const active = isOverdriveActive(s, now)
    return {
      charge: s.charge,
      ready: !active && s.charge >= OVERDRIVE_TILES ? 1 : 0,
      active: active ? 1 : 0,
      until: active ? s.activeUntil : 0,
    }
  }

  rememberHit(attacker: string, victim: string, now: number): void {
    this.lastHit.set(`${keyOf(attacker)}|${keyOf(victim)}`, now)
  }

  lastHitAt(attacker: string, victim: string): number {
    return this.lastHit.get(`${keyOf(attacker)}|${keyOf(victim)}`) ?? 0
  }

  takeDirty(): string[] {
    const ids = [...this.dirty]
    this.dirty.clear()
    return ids
  }

  clearRound(): string[] {
    const ids = new Set<string>([...this.states.keys(), ...this.dirty])
    this.states.clear()
    this.lastHit.clear()
    this.dirty.clear()
    return [...ids]
  }

  forget(id: string): void {
    const k = keyOf(id)
    this.states.delete(k)
    this.dirty.delete(k)
    for (const hit of [...this.lastHit.keys()]) {
      if (hit.startsWith(k + '|') || hit.endsWith('|' + k)) this.lastHit.delete(hit)
    }
  }
}
