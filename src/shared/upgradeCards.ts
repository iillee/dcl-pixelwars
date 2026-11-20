/**
 * upgradeCards.ts — timing and motion for the compact upgrade cluster.
 * Auto-open lasts CARD_AUTO_MS; the pop/slide uses CARD_POP_MS.
 * After a pick that immediately unlocks another upgrade, wait
 * CARD_REOPEN_MS before opening again.
 */
export const CARD_POP_MS = 250
export const CARD_AUTO_MS = 5000
export const CARD_REOPEN_MS = 500
/** Resting compact size vs the tall card overlay they replaced. */
export const CARD_COMPACT_SCALE = 0.65
const SCALE_FROM = 0.86
const SLIDE_PX = 28

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

export function cardPopT(elapsedMs: number): number {
  return clamp01(elapsedMs / CARD_POP_MS)
}

/** Scale of the cluster. `closing` plays the motion in reverse. */
export function cardPopScale(elapsedMs: number, closing: boolean): number {
  const t = cardPopT(elapsedMs)
  if (!closing) return SCALE_FROM + easeOutCubic(t) * (1 - SCALE_FROM)
  return 1 + easeInCubic(t) * (SCALE_FROM - 1)
}

/** Extra pixels toward the bottom of the screen (0 at rest). */
export function cardSlidePx(elapsedMs: number, closing: boolean): number {
  const t = cardPopT(elapsedMs)
  if (!closing) return SLIDE_PX * (1 - easeOutCubic(t))
  return SLIDE_PX * easeInCubic(t)
}

/** Remaining auto-open time as 1 → 0. 0 when the timer is inactive. */
export function autoTimerFrac(now: number, autoUntil: number): number {
  if (autoUntil <= 0) return 0
  return clamp01((autoUntil - now) / CARD_AUTO_MS)
}

/**
 * When a new pending upgrade arrives: open immediately, unless this
 * pending was unlocked by a pick that just resolved — then wait.
 */
export function autoOpenDelayMs(justPicked: boolean): number {
  return justPicked ? CARD_REOPEN_MS : 0
}
