/**
 * starPop.ts — timings for the flagtag-style head-bounce when a star is picked up.
 * The motion is 200 ms ease-out up, then 350 ms ease-in shrink-fall (550 ms of
 * travel). The rig is parked at 600 ms, before the TweenSequence would YOYO.
 * The upgrade cards wait that duration plus a short pad so they open after
 * the bounce finishes.
 */
export const STAR_POP_UP_MS = 200
export const STAR_POP_DOWN_MS = 350
export const STAR_POP_MS = 600
export const STAR_POP_OPEN_PAD_MS = 100

/** Delay before the upgrade card cluster (and its auto-tuck) opens after a star pickup. */
export function starPickupOpenDelayMs(): number {
  return STAR_POP_MS + STAR_POP_OPEN_PAD_MS
}
