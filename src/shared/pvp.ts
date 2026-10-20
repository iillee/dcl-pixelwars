/**
 * pvp.ts — PvP prototype config: Lunge (E) + Paint Bomb (F). Dash parked (mode 'off').
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
// Dash is parked (Luke, Oct 2026 pivot to Lunge): client/dash.ts stays but isn't
// wired into client/index.ts or the hotbar, and with 'off' the server drops
// dashHit. Paint Bomb (F) is back on alongside Lunge (E).
export const DASH_MODE: AbilityMode = 'off'
export const BOMB_MODE: AbilityMode = 'on' // back on (Luke, 2026-10-20), as at 9bd8b2b

export function modeEnabledForRound(mode: AbilityMode, roundIndex: number): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return roundIndex % 2 === 0
}

// ═══ Dash (E) ═══════════════════════════════════════════════════════
// ─── Attacker burst ─────────────────────────────────────────────────
/** Length of the dash (s): the sustain force and the hit window. */
export const DASH_DURATION_S = 0.22 // was 0.4: shorter + faster (Luke). Trail and HIT_WINDOW_S follow this.
/** Seconds between dashes. Keeps running through respawn (never reset). */
export const DASH_COOLDOWN_S = 5
/** One-shot horizontal impulse at dash start (direction × this). Tuned up for a snappy burst. */
export const DASH_IMPULSE = 50 // was 40
/** Small upward part of the start impulse so ground friction doesn't eat it. */
export const DASH_LIFT = 3 // was 4; low so the faster burst doesn't hop
/** Horizontal force held for DASH_DURATION_S to sustain the burst. 0 = impulse only. */
export const DASH_FORCE = 80 // was 55
// Rough no-drag estimate (impulse as Δv m/s, force as m/s², carry after the
// burst ignored): old 40·0.4 + ½·55·0.4² ≈ 20.4 m, peak ≈ 62 m/s;
// new 50·0.22 + ½·80·0.22² ≈ 12.9 m (≈63%), peak ≈ 68 m/s. Units unconfirmed in Explorer.
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

// ═══ Lunge (E) ══════════════════════════════════════════════════════
// Shoulder-charge (Mario Party Bumper Brawl): a short committed lunge along
// avatar facing; opponents touched during it get a big knockback toward the
// sky-arena edges. Code: client/lunge.ts, shared/lunge.ts, server.ts.
// Spec (Luke, 2026-10-20): 0.20 s, ~2 m, small forgiving hitbox, 1.75 s
// cooldown, 0.20 s recovery, no attacker lift (ramps), opposing team only.

/** Play an upper-body SDK predefined emote on lunge start (others see it natively).
 *  'punch' exists in SDK7's scene-feedback emotes ('push' is the alternative). Upper-body
 *  mask so the legs stay on locomotion and the lunge impulse doesn't cancel it. */
export const LUNGE_EMOTE = true
export const LUNGE_EMOTE_NAME = 'punch'

// ─── Slash VFX (client/lungeSlash.ts) — shows the hit area ──────────
/** Flat team-coloured crescent at the front of the hitbox during the lunge. */
export const LUNGE_SLASH = true
/** Crescent width (m). = hitbox diameter (2 × LUNGE_HIT_RADIUS) so players learn the range. */
export const LUNGE_SLASH_WIDTH = 2.2
/** Height above the attacker's feet (m) — chest band. */
export const LUNGE_SLASH_HEIGHT = 1.1
/** Shrink + fade after the active window (s). */
export const LUNGE_SLASH_FADE_S = 0.12
/** Peak opacity. */
export const LUNGE_SLASH_ALPHA = 0.85
/** Intro (visual only; the hitbox is live from frame 0): 'grow' = scale up from the
 *  fist point, 'fade' = alpha 0 → LUNGE_SLASH_ALPHA, 'both' = both together. */
export const LUNGE_SLASH_INTRO: 'grow' | 'fade' | 'both' = 'both'
/** Intro duration (s, ease-out), counted inside the active window. */
export const LUNGE_SLASH_GROW_S = 0.07
/** Starting scale for 'grow' (fraction of full size). */
export const LUNGE_SLASH_START_SCALE = 0.15
/** Fist point the slash grows from, in the attacker's frame (m): x = right, y = up from
 *  the feet, z = forward. Right side because the 'punch' emote is right-handed. */
export const LUNGE_SLASH_FIST_OFFSET = { x: 0.2, y: 1.15, z: 0.3 }
/** Set true if the arc renders pointing backwards in the Explorer (plane UV orientation). */
export const LUNGE_SLASH_FLIP = false

/** Debug overlay (client): hitbox spheres, lunge dir, hit marks, knock dir, state log. */
export const LUNGE_DEBUG = false

// ─── A. Attacker movement ───────────────────────────────────────────
/** Active lunge time (s). Hits only count in this window (+ grace). */
export const LUNGE_ACTIVE_S = 0.20
/** Target travel (m). Informational: drives the impulse below, logged vs measured. */
export const LUNGE_DISTANCE = 8.0 // was 4.0 (2.0 before that); Luke: ~2× further
/** Horizontal impulse at start (Δv, assumed m/s: 8.0 m / 0.20 s = 40, +20% for
 *  ground friction). Added ON TOP of run speed. Cancelled by a brake impulse at
 *  the end that removes only the lunge's extra speed (run speed is kept), so the
 *  lunge stops cleanly instead of sliding/launching. Units unconfirmed: tune with
 *  the logged "[Lunge] travelled" distance (measured from the press, run included). */
export const LUNGE_IMPULSE = 48 // was 24 (12 before that)
/** Vertical part of the attacker's impulse. 0 = surface-following, no ramp launches. */
export const LUNGE_LIFT = 0
/** Brake at the end: fraction of the start impulse removed, scaled by the lunge's
 *  remaining EXTRA speed (forward speed minus the speed at the press) / its peak
 *  extra, so run momentum survives and a lunge into a wall doesn't bounce back. */
export const LUNGE_BRAKE = 1.0
/** After the active window: no new lunge, run/jog/jump disabled (walk only). */
export const LUNGE_RECOVERY_S = 0.20
/** Press → press (s). Covers active + recovery. */
export const LUNGE_COOLDOWN_S = 1.75

// ─── B. Hit detection (attacker client, swept every frame) ──────────
/** Capsule radius around the attacker's per-frame path (m). Small but forgiving. */
export const LUNGE_HIT_RADIUS = 1.1
/** Capsule centre sits this far ahead of the attacker along the lunge (m).
 *  Reach = LUNGE_HIT_FORWARD + LUNGE_HIT_RADIUS ≈ 1.7 m. */
export const LUNGE_HIT_FORWARD = 0.6
/** Targets this close to the attacker always hit, any angle (point-blank). */
export const LUNGE_HIT_OVERLAP = 0.7
/** Max vertical offset (m): no hits through floors / between levels. */
export const LUNGE_HIT_MAX_DY = 1.8
/** Targets more than this behind the start line never count (directional). */
export const LUNGE_HIT_BEHIND = 0.3
/** Extra hit time after the active window (avatar interpolation lag, s). */
export const LUNGE_HIT_GRACE_S = 0.06
/** Slash VFX plane centre ahead of the attacker (m), derived so the arc's outer edge
 *  (centre + width/2) lands exactly on the hitbox's leading edge (FORWARD + RADIUS = 1.7 m). */
export const LUNGE_SLASH_FORWARD = LUNGE_HIT_FORWARD + LUNGE_HIT_RADIUS - LUNGE_SLASH_WIDTH / 2

// ─── Victim knockback (victim's own client) ─────────────────────────
/** Weight of the lunge direction vs attacker→target direction. */
export const LUNGE_KNOCK_FACING_WEIGHT = 0.5
/** Horizontal impulse away from the attacker. Strong: must threaten edges. */
export const LUNGE_KNOCKBACK = 93 // was 62 (×1.5, Luke)
/** Small upward part (breaks floor friction; exaggerates the hit). */
export const LUNGE_KNOCK_LIFT = 10 // was 8
/** Horizontal force held after the impulse (carries the victim further). */
export const LUNGE_KNOCK_FORCE = 38 // was 25
export const LUNGE_KNOCK_FORCE_S = 0.35
/** Victim control lock: walk/jog/run/jump disabled while the knockback carries them,
 *  so they can't steer against the push. A second hit extends it (no stacking). */
export const LUNGE_KNOCKBACK_LOCK = true
export const LUNGE_KNOCKBACK_LOCK_S = 0.3
/** Victim drops an impact older than this vs when it saw that lunge start (ms). */
export const LUNGE_IMPACT_MAX_AGE_MS = 400

// ─── Ghost bot (server-shoved; it walks a graph and can't fall) ─────
export const LUNGE_BOT_SHOVE = 6
export const LUNGE_BOT_STUN_S = 1.2

// ─── Test dummy (client-local box, client/lungeDummy.ts) ────────────
/** Spawn a local opponent box near our base to practise on (+ "Respawn dummy" chip, key 2). */
export const LUNGE_TEST_DUMMY = true
/** How many dummies (each on the centre of a distinct random tile). */
export const LUNGE_DUMMY_COUNT = 4
/** m/s per Physics impulse unit (unknown in SDK7; guess). The dummy gets the same
 *  LUNGE_KNOCK* numbers × this: 93 → 23.3 m/s horizontal, lift 10 → 2.5 m/s, force
 *  38 → 9.5 m/s² for 0.35 s (≈31 m flat travel before friction stops it; was ≈14 m).
 *  Tune until the dummy flies like a real victim. */
export const LUNGE_DUMMY_UNIT = 0.25
/** Dummy gravity (m/s²) and ground friction (m/s² of horizontal deceleration). */
export const LUNGE_DUMMY_GRAVITY = 20
export const LUNGE_DUMMY_FRICTION = 14

// ─── Server validation ──────────────────────────────────────────────
/** Next lunge start accepted no sooner than this (s). */
export const SERVER_MIN_LUNGE_GAP_S = LUNGE_COOLDOWN_S - 0.25
/** Hits accepted within this long after the accepted start (s): active + grace + jitter. */
export const SERVER_LUNGE_HIT_WINDOW_S = 0.6
/** Slack on the ghost range check (lag, float height). */
export const SERVER_LUNGE_BOT_SLACK = 3

export const LUNGE_MODE: AbilityMode = 'on'
export function lungeEnabledForRound(roundIndex: number): boolean {
  return modeEnabledForRound(LUNGE_MODE, roundIndex)
}
