/**
 * pvp.ts — PvP prototype config: Dash (E) and Paint Bomb (F).
 * EXPERIMENT, not approved V1 scope. See design/pvp-prototype.md.
 *
 * Pure constants + helpers, no engine imports: read by the client
 * (client/dash.ts, client/paintBomb.ts, client/abilityHotbar.tsx) and the
 * server (dashHit / bombDrop validation), so both sides agree on whether
 * an ability is live this round.
 *
 * Dash magnitudes are first guesses — the SDK does not document the units
 * of Physics impulses/forces (the docs examples use 40–50). Paint Bomb
 * knockback reuses flagtag's tuned bomb values. Tune in a two-player playtest.
 */

/**
 * 'on'        — every round.
 * 'off'       — disabled everywhere (no slot, server drops requests).
 * 'alternate' — only on even UTC round indices, so a paint-only round and
 *               an ability round alternate (playtest comparison).
 */
export type AbilityMode = 'on' | 'off' | 'alternate'
export const DASH_MODE: AbilityMode = 'on'
export const BOMB_MODE: AbilityMode = 'on'

export function modeEnabledForRound(mode: AbilityMode, roundIndex: number): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return roundIndex % 2 === 0
}

// ═══ Dash (E) ═══════════════════════════════════════════════════════
// ─── Attacker burst ─────────────────────────────────────────────────
/** Length of the dash (s): the sustain force and the hit window. */
export const DASH_DURATION_S = 0.4
/** Seconds between dashes. Keeps running through respawn (never reset). */
export const DASH_COOLDOWN_S = 5
/** One-shot horizontal impulse at dash start (direction × this). Tuned up for a snappy burst. */
export const DASH_IMPULSE = 40
/** Small upward part of the start impulse so ground friction doesn't eat it. */
export const DASH_LIFT = 4
/** Horizontal force held for DASH_DURATION_S to sustain the burst. 0 = impulse only. */
export const DASH_FORCE = 55
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
  return modeEnabledForRound(DASH_MODE, roundIndex)
}

// ═══ Paint Bomb (F) ═════════════════════════════════════════════════
// Starting point: flagtag's bomb (src/systems/bombSystem.ts,
// src/server/combat.ts). Kept from flagtag: 6 m blast radius, knockback
// Physics.applyKnockbackToPlayer(blast, 40, radius, LINEAR), fireball +
// shockwave + debris FX, blinking Bomb_01/Bomb_red model, fuse +
// bomb_exploding sounds. Changed for pixelwars: 0.4 s fuse (flagtag 5 s),
// 8 s cooldown (flagtag 10 s), no stun/emote/input lock, paints a circle.

/** Telegraph time between the press and the blast (s). */
export const BOMB_FUSE_S = 0.4
/** Seconds between bombs. Keeps running through respawn (never reset). */
export const BOMB_COOLDOWN_S = 8
/** Walkable cells whose centre is within this horizontal distance get painted (m). ~2× the first prototype. */
export const BOMB_PAINT_RADIUS = 11
/** Only cells within this height of the blast are painted (no painting through levels). */
export const BOMB_PAINT_MAX_DY = 4
/** Opponents within this 3D distance of the blast are knocked back (~2× flagtag's 6). */
export const BOMB_KNOCKBACK_RADIUS = 12
/** applyKnockbackToPlayer magnitude at the centre, LINEAR falloff to 0 at the radius. */
export const BOMB_KNOCKBACK = 48
/** Extra upward impulse at the centre (same falloff), so floor friction doesn't eat the push. 0 = off. */
export const BOMB_KNOCKBACK_LIFT = 10
/** Server snaps the bomb down onto the floor if a walkable cell is this close below (m). */
export const BOMB_SNAP_MAX_DROP = 4
/** Server cooldown slack: accept the next bomb this long after the previous one (s). */
export const SERVER_MIN_BOMB_GAP_S = BOMB_COOLDOWN_S - 0.5

/** Is Paint Bomb live for this UTC round index? */
export function bombEnabledForRound(roundIndex: number): boolean {
  return modeEnabledForRound(BOMB_MODE, roundIndex)
}
