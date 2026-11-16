/**
 * Client paint-bar predictor for Prototype.
 * The bar deducts and refills locally, then eases toward a trusted server
 * wallet. Stale echoes (spends or refill the server has not caught up to)
 * are ignored so the bar does not lag tiles or bounce during a refill.
 */
import { PAINT_CAPACITY, PAINT_COST, PAINT_REFILL_PER_SEC } from './territory'

/** Ignore a server disagreement smaller than this, in paint units. */
export const PAINT_BAR_DRIFT = 3
/** Ease rate toward a trusted correction, per second. */
export const PAINT_BAR_EASE = 8
/** After leaving a depot, ignore lagging lower wallets for this long. */
export const PAINT_BAR_REFILL_GRACE_MS = 1000

const SETTLE = 0.25
const MAX_EASE_STEP = 0.4

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(PAINT_CAPACITY, n))
}

export class PaintBarPredict {
  tank = PAINT_CAPACITY
  refilling = false
  private serverTank = PAINT_CAPACITY
  private pendingSpend = 0
  private target: number | null = null
  private refillUntil = 0

  reset(tank = PAINT_CAPACITY): void {
    this.tank = clamp(tank)
    this.serverTank = this.tank
    this.pendingSpend = 0
    this.target = null
    this.refilling = false
    this.refillUntil = 0
  }

  fill(): void {
    this.reset(PAINT_CAPACITY)
  }

  /** Deduct one flip. Returns false when the tank cannot pay PAINT_COST. */
  spend(): boolean {
    if (this.tank < PAINT_COST) return false
    this.tank = Math.max(0, this.tank - PAINT_COST)
    this.pendingSpend += PAINT_COST
    if (this.target !== null) this.target = Math.max(0, this.target - PAINT_COST)
    return true
  }

  /** Credit back a flip the server denied. */
  refund(): void {
    this.tank = Math.min(PAINT_CAPACITY, this.tank + PAINT_COST)
    this.pendingSpend = Math.max(0, this.pendingSpend - PAINT_COST)
    if (this.target !== null) this.target = Math.min(PAINT_CAPACITY, this.target + PAINT_COST)
  }

  /**
   * Climb while eligible and ease toward any trusted correction.
   * Always climbs from the current predicted tank, never a server snapshot.
   */
  tick(dt: number, eligible: boolean, now = Date.now()): void {
    if (eligible) this.refillUntil = now + PAINT_BAR_REFILL_GRACE_MS
    if (eligible && dt > 0 && this.tank < PAINT_CAPACITY) {
      this.tank = Math.min(PAINT_CAPACITY, this.tank + PAINT_REFILL_PER_SEC * dt)
      if (this.target !== null && this.target < this.tank) this.target = null
      else if (this.target !== null) this.target = Math.min(PAINT_CAPACITY, this.target + PAINT_REFILL_PER_SEC * dt)
    }
    this.ease(dt)
    this.refilling = eligible && this.tank < PAINT_CAPACITY
  }

  private ease(dt: number): void {
    if (this.target === null || dt <= 0) return
    const d = this.target - this.tank
    if (Math.abs(d) <= SETTLE) {
      this.tank = clamp(this.target)
      this.target = null
      return
    }
    const step = Math.min(MAX_EASE_STEP, 1 - Math.exp(-PAINT_BAR_EASE * dt))
    this.tank = clamp(this.tank + d * step)
  }

  /** Reconcile a server wallet echo without snapping the bar. */
  adopt(server: number, now = Date.now()): void {
    const s = clamp(server)
    const filling = this.refilling || now < this.refillUntil

    // Stale: the server has not seen local deducts and is still high.
    if (this.pendingSpend > 0 && s > this.tank + PAINT_BAR_DRIFT) {
      if (s < this.serverTank - 1e-6) {
        this.pendingSpend = Math.max(0, this.pendingSpend - (this.serverTank - s))
        this.serverTank = s
      }
      return
    }

    if (this.pendingSpend > 0 && s < this.serverTank - 1e-6) {
      this.pendingSpend = Math.max(0, this.pendingSpend - (this.serverTank - s))
    }
    this.serverTank = s
    if (Math.abs(s - this.tank) <= PAINT_BAR_DRIFT) {
      this.pendingSpend = 0
      this.target = null
      return
    }

    // Lagging refill echo. Do not pull the bar down or it will bounce.
    if (s < this.tank && filling) return

    this.target = s
  }
}
