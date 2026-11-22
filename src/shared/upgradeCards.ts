/**
 * upgradeCards.ts — timing and motion for the centered upgrade cards.
 * Auto-open lasts CARD_AUTO_MS; the pop uses CARD_POP_MS.
 * After a pick that immediately unlocks another upgrade, wait
 * CARD_REOPEN_MS before opening again. The cards auto-tuck when the
 * timer expires; there is no visible countdown bar.
 */
export const CARD_POP_MS = 250
export const CARD_AUTO_MS = 5000
export const CARD_REOPEN_MS = 500
/** Hover grow on a card (desktop pointer only). */
export const CARD_HOVER_SCALE = 1.08
/** Target desktop card width, in UI pixels, before viewport fitting. */
export const CARD_TARGET_W = 280
/** Tall-card aspect (width / height) from the original overlay. */
export const CARD_ASPECT = 228 / 348
/** Red pending-pick badge bob: a few pixels at 1.5 Hz. */
export const BADGE_BOB_HZ = 1.5
export const BADGE_BOB_PX = 5
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

/** Selected card: shrink fast, then glide into the buff icon. */
export const CARD_FLY_MS = 560

const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export function cardFlyT(elapsedMs: number): number {
  return clamp01(elapsedMs / CARD_FLY_MS)
}

/** 0 at full card size, 1 at icon size. Finishes in the first third of the flight. */
export function cardFlyShrink(t: number): number {
  return easeOutCubic(clamp01(t / 0.34))
}

/** 0 at the card, 1 at the icon. Smooth across the whole flight. */
export function cardFlyMove(t: number): number {
  return easeInOutCubic(clamp01(t))
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

/** Vertical offset for the pending-pick badge. Negative is up. */
export function badgeBobPx(now: number, originMs = 0): number {
  return Math.sin(((now - originMs) / 1000) * BADGE_BOB_HZ * Math.PI * 2) * BADGE_BOB_PX
}
