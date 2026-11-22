/**
 * overdriveBook.ts — live star orbs. Pickup grants an upgrade; nothing is "held".
 */
import type { StarOrb } from '../shared/overdrive'

export class OverdriveBook {
  private orbs = new Map<number, StarOrb>()
  private nextOrb = 1

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

  clearRound(): StarOrb[] {
    const orbs = this.liveOrbs()
    this.orbs.clear()
    return orbs
  }
}
