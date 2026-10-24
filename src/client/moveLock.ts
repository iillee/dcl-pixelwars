/**
 * moveLock.ts — fall-rescue movement hold, read by lunge.ts when it writes InputModifier.
 *
 * One writer of that component (applyControl). This flag is the extra reason,
 * so a pickup lock can't fight a lunge recovery or a knockback lock.
 *
 *   frozen — no walk / jog / run / jump (the out-of-action pickup)
 *   walk   — walk only, same shape as Lunge recovery (the land brace)
 *   open   — this hold is out of the way
 *
 * Abilities (paint, Lunge, Burst) stay off for both frozen and walk.
 */

export type MoveLock = 'open' | 'walk' | 'frozen'

let lock: MoveLock = 'open'

export function setMoveLock(next: MoveLock): void { lock = next }
export function getMoveLock(): MoveLock { return lock }
export function isMoveLocked(): boolean { return lock !== 'open' }
