/**
 * overdriveBook.ts — server book for star pickups and the active holder.
 * Humans and bots can both hold the star.
 */
import { STAR_MS } from '../shared/pvp'
import {
  emptyStarHold, expireStarHold, grantStarHold, isStarActive,
  type StarHold, type StarOrb,
} from '../shared/overdrive'

const keyOf = (id: string) => id.toLowerCase()

export class OverdriveBook {
  private holds = new Map<string, StarHold>()
  private lastHit = new Map<string, number>()
  private orbs = new Map<number, StarOrb>()
  private nextOrb = 1

  private get(id: string): StarHold {
    return this.holds.get(keyOf(id)) ?? emptyStarHold()
  }

  grant(id: string, now: number): number {
    if (!id) return 0
    if (isStarActive(this.get(id), now)) return this.get(id).activeUntil
    const hold = grantStarHold(now, STAR_MS)
    this.holds.set(keyOf(id), hold)
    return hold.activeUntil
  }

  onDeath(id: string, now = Date.now()): boolean {
    if (!id) return false
    const was = isStarActive(this.get(id), now)
    this.holds.set(keyOf(id), emptyStarHold())
    return was
  }

  isActive(id: string, now: number): boolean {
    if (!id) return false
    return isStarActive(this.get(id), now)
  }

  expire(now: number): string[] {
    const ended: string[] = []
    for (const [id, hold] of this.holds) {
      const next = expireStarHold(hold, now)
      if (next === hold) continue
      this.holds.set(id, next)
      ended.push(id)
    }
    return ended
  }

  actives(now: number): Array<{ id: string; until: number }> {
    const out: Array<{ id: string; until: number }> = []
    for (const [id, hold] of this.holds) {
      if (isStarActive(hold, now)) out.push({ id, until: hold.activeUntil })
    }
    return out
  }

  holderActive(now: number): boolean {
    return this.actives(now).length > 0
  }

  rememberHit(attacker: string, victim: string, now: number): void {
    this.lastHit.set(`${keyOf(attacker)}|${keyOf(victim)}`, now)
  }

  lastHitAt(attacker: string, victim: string): number {
    return this.lastHit.get(`${keyOf(attacker)}|${keyOf(victim)}`) ?? 0
  }

  addOrb(pos: { x: number; y: number; z: number; cell: string }): StarOrb {
    const orb: StarOrb = { i: this.nextOrb++, x: pos.x, y: pos.y, z: pos.z, cell: pos.cell }
    this.orbs.set(orb.i, orb)
    return orb
  }

  removeOrb(i: number): StarOrb | null {
    const orb = this.orbs.get(i) ?? null
    if (orb) this.orbs.delete(i)
    return orb
  }

  liveOrbs(): StarOrb[] { return [...this.orbs.values()] }
  orbCount(): number { return this.orbs.size }
  getOrb(i: number): StarOrb | undefined { return this.orbs.get(i) }

  clearOrbs(): StarOrb[] {
    const all = this.liveOrbs()
    this.orbs.clear()
    return all
  }

  clearRound(): { holders: string[]; orbs: StarOrb[] } {
    const holders = [...this.holds.keys()]
    const orbs = this.clearOrbs()
    this.holds.clear()
    this.lastHit.clear()
    return { holders, orbs }
  }

  forget(id: string): void {
    const k = keyOf(id)
    this.holds.delete(k)
    for (const hit of [...this.lastHit.keys()]) {
      if (hit.startsWith(k + '|') || hit.endsWith('|' + k)) this.lastHit.delete(hit)
    }
  }
}
