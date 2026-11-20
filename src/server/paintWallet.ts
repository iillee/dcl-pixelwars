/**
 * Per-painter paint remaining. Missing entries are a full tank.
 * Only the Prototype round reads this. Round start clears it.
 */
import { PAINT_CAPACITY } from '../shared/territory'

const tanks = new Map<string, number>()

export function resetWallets(): void {
  tanks.clear()
}

export function walletOf(id: string): number {
  return tanks.get(id) ?? PAINT_CAPACITY
}

export function setWallet(id: string, n: number): void {
  tanks.set(id, Math.max(0, Math.min(PAINT_CAPACITY, n)))
}

export function refillWallet(id: string): void {
  tanks.set(id, PAINT_CAPACITY)
}
