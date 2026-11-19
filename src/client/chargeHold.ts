/**
 * chargeHold.ts — one shared hold-to-charge at a time for Lunge and Burst.
 *
 * Feel is a simplified take on flagtag's blue boomerang charge: a progressive
 * fill (here a team ring at the feet, plus the hotbar meter) and a pulse when
 * the hold is full. Unlike flagtag, movement does not slow the player and a
 * full hold does not burn out — moving or jumping fires the normal action
 * immediately, and a full 3 s stationary hold fires the charged action.
 */
import { CHARGE_MS } from '../shared/pvp'
import { Team } from '../shared/team'
import { sendChargeStart } from './clientHandler'
import { hideChargeHold, setChargeFrac, showChargeHold } from './chargeVfx'

export type ChargeKind = 'lunge' | 'burst'

let kind: ChargeKind | null = null
let startMs = 0
let sx = 0, sy = 0, sz = 0

export function isChargeHolding(k?: ChargeKind): boolean {
  return k ? kind === k : kind !== null
}

export function chargeFrac(): number {
  if (!kind) return 0
  return Math.min(1, (Date.now() - startMs) / CHARGE_MS)
}

export function chargeHud(k: ChargeKind): { charging: number; charged: boolean } {
  if (kind !== k) return { charging: 0, charged: false }
  const u = chargeFrac()
  return { charging: u, charged: u >= 1 }
}

/** Start a hold. Returns false if another hold is already active. */
export function beginChargeHold(k: ChargeKind, x: number, y: number, z: number, team: Team): boolean {
  if (kind) return false
  kind = k
  startMs = Date.now()
  sx = x; sy = y; sz = z
  showChargeHold(team)
  sendChargeStart(k === 'lunge' ? 0 : 1, x, y, z)
  return true
}

export function tickChargeVfx(): void {
  if (!kind) return
  const u = chargeFrac()
  setChargeFrac(u, u >= 1)
}

/** End the hold and hide VFX. Does not fire the ability. */
export function takeChargeHold(): { kind: ChargeKind; heldMs: number; charged: boolean; x: number; y: number; z: number } | null {
  if (!kind) return null
  const out = {
    kind,
    heldMs: Date.now() - startMs,
    charged: Date.now() - startMs >= CHARGE_MS,
    x: sx, y: sy, z: sz,
  }
  hideChargeHold()
  kind = null
  startMs = 0
  return out
}

/** Drop a hold without firing (rescue, interrupt, round reset, respawn). */
export function cancelChargeHold(): void {
  if (!kind) return
  hideChargeHold()
  kind = null
  startMs = 0
}
