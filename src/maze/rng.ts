/**
 * rng.ts — seeded pseudo-random number generator (mulberry32).
 *
 * Tiny, deterministic, ~200 bits of state. Given the same seed, produces
 * the same sequence — in preview, in the deployed World, in tests. Makes
 * generator bugs reproducible: log the seed, replay offline.
 *
 * Not cryptographically secure. Do not use for anti-cheat or auth.
 *
 * Module-scoped state is intentional: the generator calls `setSeed()`
 * once per attempt and then consumes `rand()` freely. Passing a state
 * object through every helper would add noise for zero benefit here.
 */

let _seed = 0

export function setSeed(s: number): void {
  _seed = s | 0
}

export function rand(): number {
  _seed |= 0
  _seed = (_seed + 0x6D2B79F5) | 0
  let t = _seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
