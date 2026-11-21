/**
 * upgradeBook.ts — server-side paint-earned upgrade bookkeeping for human players.
 * Bots never receive charge, pending selections, or modifiers.
 */
import {
  emptyUpgrade, accrueUpgradeCharge, stripUpgradesOnFall, trySelectUpgrade, type UpgradeKind, type UpgradeState,
} from '../shared/upgrades'

const keyOf = (id: string) => id.toLowerCase()

export class UpgradeBook {
  private states = new Map<string, UpgradeState>()
  private dirty = new Set<string>()

  private get(id: string): UpgradeState {
    return this.states.get(keyOf(id)) ?? emptyUpgrade()
  }

  private set(id: string, state: UpgradeState): void {
    const k = keyOf(id)
    this.states.set(k, state)
    this.dirty.add(k)
  }

  gain(id: string, charge: number): void {
    if (!id || id.startsWith('bot:') || charge <= 0) return
    this.set(id, accrueUpgradeCharge(this.get(id), charge))
  }

  trySelect(id: string, kind: UpgradeKind): boolean {
    if (!id || id.startsWith('bot:')) return false
    const result = trySelectUpgrade(this.get(id), kind)
    if (!result.ok) return false
    this.set(id, result.state)
    return true
  }

  stateOf(id: string): UpgradeState {
    return this.get(id)
  }

  /** Non-zero Speed / Paint / Haste counts for every human, for nametag icons. */
  buffEntries(): Array<{ id: string; speed: number; paint: number; haste: number }> {
    const out: Array<{ id: string; speed: number; paint: number; haste: number }> = []
    for (const [id, s] of this.states) {
      if (!id || id.startsWith('bot:')) continue
      if (s.speed <= 0 && s.paint <= 0 && s.haste <= 0) continue
      out.push({ id, speed: s.speed, paint: s.paint, haste: s.haste })
    }
    return out
  }

  buffOf(id: string): { id: string; speed: number; paint: number; haste: number } {
    const s = this.get(id)
    return { id: keyOf(id), speed: s.speed, paint: s.paint, haste: s.haste }
  }

  ownerState(id: string): {
    charge: number; pending: number; earned: number; speed: number; paint: number; haste: number
  } {
    const s = this.get(id)
    return {
      charge: s.charge,
      pending: s.pending ? 1 : 0,
      earned: s.earned,
      speed: s.speed,
      paint: s.paint,
      haste: s.haste,
    }
  }

  level(id: string, kind: UpgradeKind): number {
    if (!id || id.startsWith('bot:')) return 0
    return this.get(id)[kind]
  }

  takeDirty(): string[] {
    const ids = [...this.dirty]
    this.dirty.clear()
    return ids
  }

  /**
   * Falling off the level clears buffs and any pending pick. Charge is kept;
   * already-crossed thresholds stay spent. Returns true if the client should
   * be notified.
   */
  loseBuffsOnFall(id: string): boolean {
    if (!id || id.startsWith('bot:')) return false
    const cur = this.get(id)
    const next = stripUpgradesOnFall(cur)
    if (
      next.speed === cur.speed
      && next.paint === cur.paint
      && next.haste === cur.haste
      && next.pending === cur.pending
      && next.earned === cur.earned
      && next.charge === cur.charge
    ) {
      return false
    }
    this.set(id, next)
    return true
  }

  clearRound(): string[] {
    const ids = new Set<string>([...this.states.keys(), ...this.dirty])
    this.states.clear()
    this.dirty.clear()
    return [...ids]
  }

  forget(id: string): void {
    const k = keyOf(id)
    this.states.delete(k)
    this.dirty.delete(k)
  }
}
