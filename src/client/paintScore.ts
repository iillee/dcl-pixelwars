/**
 * paintScore.ts — the local player's tiles-painted total for this round.
 * The server is the authority (roundCells); this only mirrors the batched
 * paintScore message for the HUD.
 */
import { events } from '../shared/events'

let painted = 0
let plusN = 0
let plusUntil = 0
const PLUS_MS = 900
let wired = false

export function initPaintScore(): void {
  if (wired) return
  wired = true
  events.on('paint:score', ({ n }) => setPainted(n))
  events.on('round:reset', () => setPainted(0))
}

export function paintedHud(): { n: number; plus: number } {
  const plus = Date.now() < plusUntil ? plusN : 0
  return { n: painted, plus }
}

/**
 * Soft fill cap for the side tile tracker. Starts at 25 and doubles
 * whenever the count exceeds the cap, so the bar can grow through a
 * long round without pinning at 100%. The numeric count is always shown
 * on its own, independent of this scale.
 */
export const PAINT_TILE_CAP_MIN = 25

export function paintTileCap(n: number): number {
  const v = Math.max(0, Math.floor(n))
  let cap = PAINT_TILE_CAP_MIN
  while (v > cap) cap *= 2
  return cap
}

export function paintTileFill(n: number): number {
  const cap = paintTileCap(n)
  if (cap <= 0) return 0
  return Math.max(0, Math.min(1, Math.max(0, n) / cap))
}

function setPainted(n: number): void {
  const next = Math.max(0, Math.floor(n))
  const d = next - painted
  painted = next
  if (next === 0) { plusN = 0; plusUntil = 0; return }
  // Only flash when several tiles land in the same batch; skip single-tile ticks.
  if (d > 1) { plusN = d; plusUntil = Date.now() + PLUS_MS }
}
