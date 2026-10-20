/**
 * dash.ts — Dash PvP prototype config (EXPERIMENT, not approved V1 scope).
 *
 * Pure constants + helpers, no engine imports: read by the client
 * (client/dash.ts, client/dashUi.tsx) and the server (dashHit validation),
 * so both sides agree on whether Dash is live this round.
 *
 * Every magnitude below is a first guess — the SDK does not document the
 * units of Physics impulses/forces (the docs examples use 40–50). Tune in
 * a two-player playtest. See design/dash-prototype.md.
 */

/**
 * 'on'        — Dash every round.
 * 'off'       — Dash disabled everywhere (no button, server drops hits).
 * 'alternate' — Dash only on even UTC round indices, so a paint-only round
 *               and a Dash round alternate (playtest comparison).
 */
export type DashMode = 'on' | 'off' | 'alternate'
export const DASH_MODE: DashMode = 'on'

// ─── Attacker burst ─────────────────────────────────────────────────
/** Length of the dash (s): the sustain force and the hit window. */
export const DASH_DURATION_S = 0.4
/** Seconds between dashes. Keeps running through respawn (never reset). */
export const DASH_COOLDOWN_S = 5
/** One-shot horizontal impulse at dash start (direction × this). */
export const DASH_IMPULSE = 20
/** Small upward part of the start impulse so ground friction doesn't eat it. */
export const DASH_LIFT = 3
/** Horizontal force held for DASH_DURATION_S to sustain the burst. 0 = impulse only. */
export const DASH_FORCE = 25
/** Stop the sustain force on the first hit (attacker "spends" the dash on the target). */
export const DASH_STOP_ON_HIT = true
/** Above this horizontal speed (m/s) dash goes along movement; below, along avatar facing. */
export const DASH_MIN_MOVE_SPEED = 1

// ─── Hit detection (attacker's client) ──────────────────────────────
/** Horizontal distance (m) between attacker and enemy avatar that counts as contact. */
export const HIT_RADIUS = 1.6
/** Max vertical offset (m) for a hit — ramps/levels must not hit through floors. */
export const HIT_MAX_DY = 2
/** Hit window after dash start (s); slightly longer than the dash to cover avatar lag. */
export const HIT_WINDOW_S = DASH_DURATION_S + 0.1
/** Weight of the dash direction vs the attacker→target direction in the knockback push. */
export const KNOCKBACK_DASH_DIR_WEIGHT = 0.5

// ─── Victim knockback (victim's own client) ─────────────────────────
/** Horizontal knockback impulse. */
export const KNOCKBACK_IMPULSE = 40
/** Upward part of the knockback impulse (lifts the victim off the floor). */
export const KNOCKBACK_LIFT = 12
/** Horizontal force held after the impulse to carry the victim further. 0 = impulse only. */
export const KNOCKBACK_FORCE = 20
export const KNOCKBACK_FORCE_S = 0.3
/** No knockback for this long after any respawn/teleport home (s). */
export const RESPAWN_IMMUNITY_S = 1.5

// ─── Server validation ──────────────────────────────────────────────
/** Hits from one attacker are accepted within this window from its first hit (s). */
export const SERVER_HIT_WINDOW_S = 0.6
/** Next hit window opens no sooner than this after the previous one (s). */
export const SERVER_MIN_DASH_GAP_S = DASH_COOLDOWN_S - 0.5
/** Max distinct targets per hit window. */
export const SERVER_MAX_HITS_PER_DASH = 3

/** Is Dash live for this UTC round index (shared/roundTiming getRoundIndex)? */
export function dashEnabledForRound(roundIndex: number): boolean {
  if (DASH_MODE === 'on') return true
  if (DASH_MODE === 'off') return false
  return roundIndex % 2 === 0
}
