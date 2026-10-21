/**
 * dayNight.ts — sped-up day/night cycle on the round clock (ported from dcl-snowdrift's
 * phase-driven SkyboxTime lock). Pure; no engine imports.
 *
 * One full cycle = 2 rounds: EVEN round index = day (sunrise → sunset), ODD = night
 * (sunset → sunrise). The sky time is a linear function of the shared UTC round clock
 * (getRoundIndex / ROUND_INTERVAL_MS, the same clock the countdown uses), so every client
 * agrees and late joiners land mid-cycle. Day's end equals night's start (and vice versa), so
 * there is no jump at a round boundary either.
 */
import { ROUND_INTERVAL_MS, getRoundIndex, getRoundEndMs, isRoundActive } from './roundTiming'

export const DAY_NIGHT_ENABLED = true
/** Skybox seconds in a full day. 0 = midnight, 43200 = noon. */
export const SKYBOX_DAY_SEC = 86400
/** Day round runs DAY_FROM → DAY_TO; night round runs DAY_TO → DAY_FROM (wrapping midnight).
 *  Snowdrift's dawn start (06:20, sun still below the horizon) and night start (19:00). */
export const DAY_FROM_SEC = 6 * 3600 + 20 * 60
export const DAY_TO_SEC = 19 * 3600

/** Forward interpolation that can wrap midnight (snowdrift lerpSkyboxSeconds). */
export function lerpSkyboxSeconds(from: number, to: number, t01: number): number {
  let delta = to - from
  if (delta < 0) delta += SKYBOX_DAY_SEC
  return (from + delta * Math.min(1, Math.max(0, t01))) % SKYBOX_DAY_SEC
}

/** Skybox seconds now on the synced (server-owned) round: parity of the round counter, progress from its end time. */
export function skySecondsNow(): number {
  const now = Date.now()
  const t01 = isRoundActive() ? 1 - (getRoundEndMs() - now) / ROUND_INTERVAL_MS : 0
  return getRoundIndex() % 2 === 0 ? lerpSkyboxSeconds(DAY_FROM_SEC, DAY_TO_SEC, t01) : lerpSkyboxSeconds(DAY_TO_SEC, DAY_FROM_SEC, t01)
}

/** Skybox seconds at `nowMs` on the UTC round clock (verify-daynight). */
export function skySecondsAt(nowMs: number = Date.now()): number {
  const idx = Math.floor(nowMs / ROUND_INTERVAL_MS)
  const t01 = (nowMs - idx * ROUND_INTERVAL_MS) / ROUND_INTERVAL_MS
  return idx % 2 === 0 ? lerpSkyboxSeconds(DAY_FROM_SEC, DAY_TO_SEC, t01) : lerpSkyboxSeconds(DAY_TO_SEC, DAY_FROM_SEC, t01)
}
