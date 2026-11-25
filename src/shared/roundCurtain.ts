/**
 * Round-end curtain timings and clock.
 *
 * Pure functions plus a small client clock. No engine imports — safe for
 * tests and for both the rebuild pipeline and the HUD. The server never
 * waits on this: it still opens the lobby the moment the round ends. The
 * curtain only hides the client's presentation of that swap.
 */

import { TEAM_RGB, isPlayingTeam } from './team'

export const CURTAIN_DOWN_S = 0.45
export const CURTAIN_UP_S = 0.4
/** Longest the opaque hold may last while the lobby floor / colliders load. */
export const CURTAIN_READY_CAP_S = 5
/** Hold after the curtain is down: at least this long, and until the lobby is ready. */
export const CURTAIN_COVER_MIN_S = 2
/** Virtual px the mask extends past every edge of the HUD root (phone safe areas). */
export const CURTAIN_BLEED = 4000

/** Original dark ink, used only if no team leaders are available yet. */
export const CURTAIN_NEUTRAL_RGB = { r: 0.07, g: 0.07, b: 0.09 }

/**
 * Fill colours for the round-end curtain, as 0..1 RGB.
 *
 * A single winner uses that team's palette colour (TEAM_RGB / TEAM_HEX:
 * red #FF7577, blue #6A99FC, green #4FD68C, yellow #FFE04A).
 * A tie or draw uses equal vertical stripes of every leading team, in
 * team-id order (red, blue, green, yellow). A 3- or 4-way tie, including
 * a zero-score board, follows the same rule. An empty leader list falls
 * back to the original dark ink.
 */
export function curtainFillRgbs(leaders: readonly number[]): Array<{ r: number; g: number; b: number }> {
  const cols: Array<{ r: number; g: number; b: number }> = []
  for (const t of leaders) {
    if (!isPlayingTeam(t)) continue
    const c = TEAM_RGB[t]
    if (c) cols.push({ r: c.r, g: c.g, b: c.b })
  }
  return cols.length > 0 ? cols : [CURTAIN_NEUTRAL_RGB]
}

export type CurtainPhase = 'idle' | 'down' | 'cover' | 'up'

/** Same smoothstep the summary open/close already uses. */
export function easeCurtain(lin: number): number {
  const x = Math.max(0, Math.min(1, lin))
  return x * x * (3 - 2 * x)
}

export function curtainDropAt(phase: CurtainPhase, phaseAt: number, now: number): number {
  if (phase === 'idle') return 0
  if (phase === 'cover') return 1
  if (phase === 'down') return easeCurtain((now - phaseAt) / 1000 / CURTAIN_DOWN_S)
  return 1 - easeCurtain((now - phaseAt) / 1000 / CURTAIN_UP_S)
}

export function isCurtainOpaqueAt(phase: CurtainPhase, phaseAt: number, now: number): boolean {
  return curtainDropAt(phase, phaseAt, now) >= 0.995
}

let phase: CurtainPhase = 'idle'
let phaseAt = 0

export function resetCurtain(): void {
  phase = 'idle'
  phaseAt = 0
}

/** Idempotent while the curtain is already dropping or covering. */
export function startRoundCurtain(now = Date.now()): void {
  if (phase === 'down' || phase === 'cover') return
  phase = 'down'
  phaseAt = now
}

/** Drop immediately — used when a match starts so gameplay is never hidden. */
export function abortRoundCurtain(): void {
  phase = 'idle'
  phaseAt = 0
}

export function curtainPhase(): CurtainPhase {
  return phase
}

export function curtainPhaseAt(): number {
  return phaseAt
}

export function isCurtainIdle(): boolean {
  return phase === 'idle'
}

export function isCurtainCovering(): boolean {
  return phase === 'cover'
}

/** Block click-to-dismiss until the lobby is showing again. */
export function isCurtainBlockingDismiss(): boolean {
  return phase === 'down' || phase === 'cover'
}

export function curtainDrop(now = Date.now()): number {
  const d = curtainDropAt(phase, phaseAt, now)
  return Math.max(0, Math.min(1, d))
}

export function isCurtainOpaque(now = Date.now()): boolean {
  return isCurtainOpaqueAt(phase, phaseAt, now)
}

/**
 * Advance the clock. Returns 'opaque' the frame the cover starts (rebuild
 * now), or 'done' the frame the retract finishes.
 */
export function advanceCurtain(now: number, lobbyReady: boolean): 'opaque' | 'done' | null {
  if (phase === 'down') {
    if ((now - phaseAt) / 1000 >= CURTAIN_DOWN_S) {
      phase = 'cover'
      phaseAt = now
      return 'opaque'
    }
    return null
  }
  if (phase === 'cover') {
    const waited = (now - phaseAt) / 1000
    if ((lobbyReady && waited >= CURTAIN_COVER_MIN_S) || waited >= CURTAIN_READY_CAP_S) {
      phase = 'up'
      phaseAt = now
    }
    return null
  }
  if (phase === 'up' && (now - phaseAt) / 1000 >= CURTAIN_UP_S) {
    phase = 'idle'
    phaseAt = 0
    return 'done'
  }
  return null
}
