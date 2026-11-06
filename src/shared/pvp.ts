/**
 * pvp.ts — PvP prototype config: Lunge (E) + Paint Burst (F). Dash and Paint Bomb parked (mode 'off').
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

// ═══ Playtest round format (temporary) ══════════════════════════════
// One switch. FORMAT_ALTERNATE false → every round is PvP (normal Pixelwars).
// true → startNextRound flips pvp/pvb after each round that continues from
// the summary. A cold start or an idle start is always PvP.
// PvB: every human on one colour (Red, then Blue, … across PvB rounds);
// bots fill the other colour. Count = min(PVB_BOT_MAX, ceil(humans * PVB_RATIO)),
// taken at round start. Mid-round the count may grow as humans join; it does
// not shrink until the next round, unless no humans are left.
export const FORMAT_ALTERNATE = true
/** Bots per active human in a PvB round. 1 = one bot each. */
export const PVB_RATIO = 1.0
/** Hard cap on PvB bots (playtest: up to 15). */
export const PVB_BOT_MAX = 15

export type RoundFormat = 'pvp' | 'pvb'

export function pvbBotCount(activeHumans: number): number {
  if (!(activeHumans > 0) || !(PVB_RATIO > 0)) return 0
  return Math.min(PVB_BOT_MAX, Math.ceil(activeHumans * PVB_RATIO))
}

/** Next round's format. `continuing` is false for a cold start and an idle start. */
export function nextRoundFormat(current: RoundFormat, continuing: boolean): RoundFormat {
  if (!FORMAT_ALTERNATE || !continuing) return 'pvp'
  return current === 'pvb' ? 'pvp' : 'pvb'
}

/** Human colour for PvB round `index` (0-based, PvB rounds only). Red, then Blue, then Red… */
export function pvbHumanTeam(index: number): 1 | 2 {
  return index % 2 === 0 ? 1 : 2
}

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
export const BOMB_MODE: AbilityMode = 'off' // replaced by Paint Burst on F (Luke, 2026-10-20); code kept, not wired
/** Paint Burst (F): cooldown ability, see the ═══ Paint Burst block below. */
export const BURST_MODE: AbilityMode = 'on'

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

// ═══ Paint Burst (F) ═════════════════════════════════════════════════
// Luke's spec 2026-10-20. Code: shared/burst.ts (pure), client/paintBurst.ts,
// server.ts (burst* handlers). Simple timer cooldown (no paint quota, Luke);
// the server enforces it.

/** Seconds between bursts. Keeps running through respawn. */
export const BURST_COOLDOWN_S = 8
/** Server cooldown slack: accept the next burst this long after the previous one (s). */
export const SERVER_MIN_BURST_GAP_S = BURST_COOLDOWN_S - 0.5
/** Line of sight check OFF for V1 lag pass 2026-10-23 (was: raycast attacker chest → target chest, physics colliders). */
export const BURST_LOS = false
/** Chest height for the LOS ray (m above feet). */
export const BURST_LOS_HEIGHT = 1.0
/** No raycast answer within this time → treat as clear (s). */
export const BURST_LOS_TIMEOUT_S = 0.3
/** Victim knockback: outward impulse (Lunge 93), lift (Lunge 10), sustained force (Lunge 38). */
export const BURST_KNOCKBACK = 70
export const BURST_KNOCK_LIFT = 12
export const BURST_KNOCK_FORCE = 26
export const BURST_KNOCK_FORCE_S = 0.3
/** Local player plays this scene emote when Paint Burst fires (others see it natively): a ground punch
 *  authored on the DCL avatar rig (Blender, 30 fps, 15 frames = 0.467 s: wind-up → fist hits the floor
 *  at 0.3 s → settle). Plays once as a short flash: movement is held for BURST_EMOTE_FREEZE_S so running
 *  doesn't cancel it, and stopEmote at BURST_EMOTE_S guarantees it releases (no held pose). */
export const BURST_EMOTE_ENABLED = true
export const BURST_EMOTE_SRC = 'assets/emotes/burst_groundpunch_emote.glb'
export const BURST_EMOTE_S = 0.467
export const BURST_EMOTE_FREEZE_S = 0.3
/** Victim drops an impact this long after it saw the burst fire (ms). Was 600; widened for high-RTT. */
export const BURST_IMPACT_MAX_AGE_MS = 900
/** One-time paint on activation (server, immediate): footprint shape and size (cells, 1 cell = 2 m).
 *  'circle' = cells whose centre is within R cells of the centre cell's centre (R=3.5 → 37 cells,
 *  ≈ the 7×7 square's size, Luke). 'square' = |dx|,|dz| ≤ R (R=3 or 3.5 → 7×7). 'cross' = |dx|+|dz| ≤ R. */
export const BURST_PAINT_SHAPE: 'circle' | 'square' | 'cross' = 'circle'
export const BURST_PAINT_RADIUS_CELLS = 5
/** Footprint cells must be within this height of the centre cell (ramps ok, no other levels). */
export const BURST_PAINT_MAX_DY = 1.5
/** Shockwave (knockback) radius = the paint footprint's outer edge: cell centres within
 *  BURST_PAINT_RADIUS_CELLS × 2 m, plus half a cell (R=5 → 11 m). Horizontal feet-to-feet. Same
 *  full-strength knock across the radius (as before). Was 4 m (3D). */
export const BURST_RADIUS = BURST_PAINT_RADIUS_CELLS * 2 + 1
/** …and within this height (a full R-cell ramp run climbs ~3.5 m; a level is ~5.4 m). */
export const BURST_HIT_MAX_DY = 3.5
/** Aerial Burst (same F charge). Only when the press is airborne — grounded Burst stays the radial
 *  blast. Cylinder straight down: a player in it is a combat spike. An air miss that meets the
 *  floor paints the same footprint as a ground Burst (server, once). A miss over the void does
 *  not paint and the dive keeps going. Sideways air at the same height does not connect
 *  (AIR_SPIKE_MIN_ABOVE). */
export const AIR_SPIKE_RADIUS = 2 // m, horizontal feet-to-feet
export const AIR_SPIKE_DEPTH = 5.5 // m, how far below the attacker the spike reaches
export const AIR_SPIKE_MIN_ABOVE = 1.0 // m, attacker feet must be at least this far above the victim
/** Victim spike: strong downward impulse, small outward impulse, short downward carry.
 *  The glider clamps locomotion fall to ~1 m/s and eats force-Y while it is open.
 *  AIR_SPIKE_GLIDE_LOCK_S shuts it (disableGliding) before the impulse and holds it
 *  shut so the victim cannot reopen and float out of the external downward velocity. */
export const AIR_SPIKE_DOWN = 110
export const AIR_SPIKE_OUT = 36 // was 18 (Luke: launch the target more)
export const AIR_SPIKE_FORCE = 40
export const AIR_SPIKE_FORCE_S = 0.28
/** Victim standing on a floor: a downward impulse just meets the ground, so the spike launches
 *  them instead — outward plus lift, harder than a ground Burst (70 / 12) since the dive is the
 *  riskier commit. The outward hold reuses the Burst knock force. */
export const AIR_SPIKE_GROUND_OUT = 85
export const AIR_SPIKE_GROUND_LIFT = 16
export const AIR_SPIKE_GLIDE_LOCK_S = 1.0
/** Attacker aerial Burst: same glider shut as a spiked victim, held for the dive.
 *  Long enough to fall from the top of the sky maze if the landing clear is missed.
 *  The client clears it when the feet land. Ground Burst does not use this. */
export const AIR_SPIKE_DIVE_GLIDE_LOCK_S = 4
/**
 * Attacker recovery after a connect. One block so a playtest can tune the risk.
 * A miss does not use these: the full dive (impulse + downward force) keeps going,
 * and over the void that is a fall.
 *
 * The explorer has no velocity read. Any upward impulse zeros a negative locomotion
 * fall and adds that impulse to external velocity. On a connect we still apply the
 * dive impulse, then a smaller upward cancel, so the NET vertical impulse stays
 * downward: most of the fall is removed, nothing is added upward, gravity resumes.
 * Kept speed = AIR_SPIKE_KEEP_FRACTION × (measured fall + the dive impulse).
 * Near an arena edge that leaves a short drop plus the dive's forward speed —
 * survivable if you recover, a fall if you don't.
 */
/** Share of the downward speed kept on a connect. 0 = full cancel, 1 = no cancel. */
export const AIR_SPIKE_KEEP_FRACTION = 0.22
/** How long to offset gravity after the cancel. 0 = gravity resumes immediately.
 *  This is not a hop: the force only counters gravity, it does not add rise. */
export const AIR_SPIKE_HANG_S = 0
/** Upward force during AIR_SPIKE_HANG_S. About explorer gravity (10). Ignored when the hang is 0. */
export const AIR_SPIKE_HANG_FORCE = 10
/** Glider available the moment the spike connects. false holds it shut for LOCK_S. */
export const AIR_SPIKE_RECOVER_GLIDE = false
/** How long the attacker's glider stays shut when RECOVER_GLIDE is false. */
export const AIR_SPIKE_RECOVER_GLIDE_S = 0.35
/** Attacker dive on an airborne press only (Yoshi Down-B style commit, not a freefall mode).
 *  Downward impulse plus a short downward force. A small forward component sells the body commit
 *  without leaving the 2 m cylinder. Ground Burst does not use these. */
export const AIR_SPIKE_DIVE_IMPULSE = 48
export const AIR_SPIKE_DIVE_FORWARD = 8
export const AIR_SPIKE_DIVE_FORCE = 70
export const AIR_SPIKE_DIVE_FORCE_S = 0.22
/** Dive trail: team spheres (same family as the ground Burst motes) falling down the commit.
 *  Not the Lunge crescent. */
export const AIR_SPIKE_TRAIL_N = 6
export const AIR_SPIKE_TRAIL_DROP = 4.2 // m
export const AIR_SPIKE_TRAIL_S = 0.4
export const AIR_SPIKE_TRAIL_SIZE = 0.32 // m, starting diameter
/** Air-only sounds (assets/sounds/air_spike_*.wav). Ground Burst keeps burst_impact.wav.
 *  A miss that lands inside AIR_SPIKE_STAMP_WINDOW_S plays that same burst_impact once
 *  (not the press dive clip as well — the two together read as a double burst).
 *  The server paints that footprint once, and the shockwave knocks with the same
 *  radius, force, and hit validation as a ground Burst. A connect does not play
 *  the landing; its sound is air_spike_hit, and the landing stays disarmed so
 *  there is no second shockwave. The cue is dropped if the feet meet the floor
 *  later than the window. */
export const AIR_SPIKE_DIVE_VOL = 0.95
export const AIR_SPIKE_HIT_VOL = 1
/** Heavy boom layered under the connect (the Lunge hit's bomb_exploding layer) so a spike lands with weight. */
export const AIR_SPIKE_BOOM_VOL = 0.9
export const AIR_SPIKE_STAMP_VOL = 0.92
export const AIR_SPIKE_STAMP_WINDOW_S = 1.4
/** Server: accept burstHit this long after the shockwave opens (s).
 *  A ground press opens it on burstUse. A landing opens it when that air miss
 *  is accepted, so a dive longer than this can still knock. */
export const SERVER_BURST_HIT_WINDOW_S = 1.0
/** Metres above the walkable surface that still count as standing for Burst.
 *  Movement paint stays at 0.4 m. A mobile bob, or a hotbar press that samples
 *  the previous frame, can sit above that and still be on the floor. 1.15 m is
 *  inside the server paint height band and below a real jump, so the press
 *  stays a ground Burst and the landing still resolves a centre. */
export const BURST_STANCE_SLACK = 1.15
/** Client keeps resending a shockwave's paint until the server confirms a footprint. */
export const BURST_PAINT_RETRY_S = 2.5
export const BURST_PAINT_RETRY_GAP_S = 0.25
/** Client resends an airborne burstUse until the server echoes burstFired. */
export const BURST_USE_RETRY_S = 1.5
/** Server: accept one landing paint this long after an airborne burstUse (s).
 *  The stamp window, plus the client's paint retries, plus RTT. An empty
 *  footprint does not consume the claim, so a later grounded sample still paints. */
export const SERVER_BURST_LAND_WINDOW_S = 4.5
/** Expanding ring, particles, aura. */
export const BURST_RING_S = 0.35
export const BURST_PARTICLES = 8
/** Tile ripple (adapted from dcl-canvas paint.ts brush-lift overlays): cell-sized team
 *  slabs (floor paint material) over the whole paint footprint pop up and settle, rippling outward.
 *  Visual only; the flat ring stays alongside. */
export const BURST_TILE_RIPPLE = true
/** Time for the wave front to travel centre → footprint corner (s). */
export const BURST_TILE_RIPPLE_S = 0.45
/** Peak height above the floor (m) (dcl-canvas BRUSH_LIFT_METERS 0.25). */
export const BURST_TILE_LIFT = 0.35
/** Per-slab rise / settle times (s) (dcl-canvas 140 / 220 ms). */
export const BURST_TILE_UP_S = 0.1
export const BURST_TILE_DOWN_S = 0.2
/** Slab footprint (m, cell = 2 m) and thickness (m). */
export const BURST_TILE_SIZE = 1.9
export const BURST_TILE_THICK = 0.3
/** Pooled slab entities shared by all bursts (cap; extra cells are skipped). */
export const BURST_TILE_POOL = 180
/** Dash (lunge) trail: the 3×3 paint swath around the dashing avatar pops (edges first), plus cells
 *  straight ahead (DASH_TILE_AHEAD) so the bump reaches the front paint. Smaller than Burst, but the
 *  rise/settle is long enough that the forward tiles are still in the wave (client/burstRipple.ts dashPop). */
export const DASH_TILE_POP = true
/** Thin black outline on raised slabs (Burst + Dash), dcl-canvas style edge strips: 4 top edges per slab,
 *  parented to the slab so they ride its animation for free (pooled with it, no per-frame work). */
export const SLAB_OUTLINE = true
export const SLAB_OUTLINE_M = 0.03 // edge thickness in metres
export const DASH_TILE_LIFT_FRAC = 0.35 // × BURST_TILE_LIFT (0.35 m) ≈ 0.12 m
export const DASH_TILE_UP_S = 0.12 // was 0.07 — the rise stays readable while the lunge runs ahead
export const DASH_TILE_DOWN_S = 0.30 // was 0.14 — settle lasts long enough to still be up at the front paint
export const DASH_TILE_DELAY_S = 0.03 // after the avatar enters the cell (trails just behind)
export const DASH_TILE_MAX = 60 // live dash slabs at once (all dashers; shares Burst's 180-slab pool)
export const DASH_TILE_INNER_LAG_S = 0.06 // centre column pops this long after the swath's edge tiles // ≥ 2 × 49: two overlapping full 7×7 bursts
/** Cells straight ahead of the entered cell that bump. 1 was only the 3×3 front row;
 *  2 covers the paint footprint that sits another cell in front while the lunge outruns that row. */
export const DASH_TILE_AHEAD = 2
/** Front-row delay (s). Shorter than the centre-column lag so the wave reaches the paint ahead. */
export const DASH_TILE_AHEAD_DELAY_S = 0.02
/** Extra delay (s) per cell past the first one ahead, so the bump travels forward instead of stopping short. */
export const DASH_TILE_AHEAD_STEP_S = 0.08

/** Is Paint Burst live for this UTC round index? */
export function burstEnabledForRound(roundIndex: number): boolean {
  return modeEnabledForRound(BURST_MODE, roundIndex)
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
/** Crescent width (m). Wider than LUNGE_HITBOX_W (2.2) so the arc reads at a glance;
 *  the press-time hit-volume flash is the true push box. Was 2.2. */
export const LUNGE_SLASH_WIDTH = 3.0
/** Plane depth as a fraction of width. The mesh used to be width/2 (squashed), so the
 *  crescent stopped short of the hitbox. 1 = square; the forward tip lands on the far face. */
export const LUNGE_SLASH_DEPTH_FRAC = 1
/** Height above the attacker's feet (m) — chest band. */
export const LUNGE_SLASH_HEIGHT = 1.15 // was 1.1
/** Shrink + fade after the active window + hold (s). Was 0.24; 0.12 was too fast to read. */
export const LUNGE_SLASH_FADE_S = 0.18
/** Full-size hold after the active window, before the fade (s). Was 0.30. Still well above a blink. */
export const LUNGE_SLASH_HOLD_S = 0.18
/** Peak opacity. */
export const LUNGE_SLASH_ALPHA = 0.92 // was 0.85
/** Intro (visual only; the hitbox is live from frame 0): 'grow' = scale up from the
 *  fist point, 'fade' = alpha 0 → LUNGE_SLASH_ALPHA, 'both' = both together. */
export const LUNGE_SLASH_INTRO: 'grow' | 'fade' | 'both' = 'both'
/** Intro duration (s, ease-out), counted inside the active window. Was 0.07. */
export const LUNGE_SLASH_GROW_S = 0.10
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
/** Target travel (m). Informational: drives the impulse below, logged vs measured.
 *  Still a short close-range charge (a few tiles), not a long dash. */
export const LUNGE_DISTANCE = 9.2 // was 8.0 (4.0, then 2.0); feel pass +~15%
/** Horizontal impulse at start (Δv, assumed m/s: 9.2 m / 0.20 s = 46, +~20% for
 *  ground friction). Added ON TOP of run speed. Cancelled by a brake impulse at
 *  the end that removes only the lunge's extra speed (run speed is kept), so the
 *  lunge stops cleanly instead of sliding/launching. Units unconfirmed: tune with
 *  the logged "[Lunge] travelled" distance (measured from the press, run included). */
export const LUNGE_IMPULSE = 56 // was 48 (24, 12 before that)
/** Vertical part of the attacker's impulse. 0 = surface-following, no ramp launches. */
export const LUNGE_LIFT = 0
/** Downward force during the lunge window so downhill lunges hug the ramp. */
export const LUNGE_STICK_FORCE = 120
/** Brake at the end: fraction of the start impulse removed, scaled by the lunge's
 *  remaining EXTRA speed (forward speed minus the speed at the press) / its peak
 *  extra, so run momentum survives and a lunge into a wall doesn't bounce back. */
export const LUNGE_BRAKE = 0.7
/** After the active window: no new lunge, run/jog/jump disabled (walk only).
 *  Intentional brace — amber LOCK on the desktop slot, amber tint on mobile, plus a click.
 *  No world mesh. Short on purpose. */
export const LUNGE_RECOVERY_S = 0.20
/** Press → press (s). Covers active + recovery. */
export const LUNGE_COOLDOWN_S = 2

// ─── B. Hit detection (attacker client, swept every frame) ──────────
/** Hitbox: a box in front of the attacker, oriented along the lunge direction,
 *  re-placed every frame from the player's CURRENT Transform and swept from last
 *  frame's box so fast frames can't skip targets (shared/lunge.ts boxHit).
 *  Width across the lunge (m). The slash is wider (LUNGE_SLASH_WIDTH); this box is the real reach. */
export const LUNGE_HITBOX_W = 2.2
/** Depth along the lunge (m), near face → far face. */
export const LUNGE_HITBOX_D = 1.4
/** Height (m) from the attacker's feet; also the max |dy| to a target's feet
 *  (no hits through floors / between levels). */
export const LUNGE_HITBOX_H = 1.8
/** Gap from the avatar centre to the box's near face (m). Reach = FORWARD + D = 1.7 m. */
export const LUNGE_HITBOX_FORWARD = 0.3
/** Debug only: translucent team box for the active window + grace. Off in play.
 *  No press flash — the crescent is the telegraph. */
export const LUNGE_HITBOX_VISIBLE = false
/** Box alpha when LUNGE_HITBOX_VISIBLE is on (flashes brighter on a hit). */
export const LUNGE_HITBOX_ALPHA = 0.25
/** false = world-space box placed from the same per-frame numbers as the hit test
 *  (default). true = child of engine.PlayerEntity with a local offset (try this if
 *  the box visibly trails the avatar at high speed in the Explorer). */
export const LUNGE_HITBOX_PARENT = false
/** Targets this close to the attacker always hit, any angle (point-blank). */
export const LUNGE_HIT_OVERLAP = 0.7
/** Max vertical offset (m), kept for the server's bot check (= LUNGE_HITBOX_H). */
export const LUNGE_HIT_MAX_DY = LUNGE_HITBOX_H
/** Targets more than this behind the start line never count (directional). */
export const LUNGE_HIT_BEHIND = 0.3
/** Extra hit time after the active window (avatar interpolation lag, s). */
export const LUNGE_HIT_GRACE_S = 0.06
/** Slash plane centre ahead of the attacker (m). Forward tip
 *  (centre + width * DEPTH_FRAC / 2) sits on the hitbox far face (FORWARD + D = 1.7 m). */
export const LUNGE_SLASH_FORWARD = LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D - (LUNGE_SLASH_WIDTH * LUNGE_SLASH_DEPTH_FRAC) / 2

// ─── Hit / miss read (client/lunge.ts impactFx / miss dust) ─────────
/** Team-coloured hit burst end scale (m) at chest height. Was 3.2 inline. */
export const LUNGE_HIT_POP_TO = 5.0
/** White hit core end scale (m). Was 1.4. Boom stays on this one; miss has no boom. */
export const LUNGE_HIT_CORE_TO = 2.2
/** Grey miss-dust end scale (m). Foot-level, ahead of the brace, no impact sound. Was 0.9. */
export const LUNGE_MISS_DUST_TO = 1.2

// ─── Victim knockback (victim's own client) ─────────────────────────
/** Weight of the lunge direction vs attacker→target direction. */
export const LUNGE_KNOCK_FACING_WEIGHT = 0.5
/** Horizontal impulse away from the attacker. Strong: must threaten edges.
 *  Feel pass: modest bump. Still a shove, not a map-length launch. */
export const LUNGE_KNOCKBACK = 108 // was 93 (62 before that, ×1.5)
/** Small upward part (breaks floor friction; exaggerates the hit). */
export const LUNGE_KNOCK_LIFT = 12 // was 10 (8 before that)
/** Horizontal force held after the impulse (carries the victim further). */
export const LUNGE_KNOCK_FORCE = 44 // was 38 (25 before that)
export const LUNGE_KNOCK_FORCE_S = 0.35
/** Victim control lock: walk/jog/run/jump disabled while the knockback carries them,
 *  so they can't steer against the push. A second hit extends it (no stacking). */
export const LUNGE_KNOCKBACK_LOCK = true
export const LUNGE_KNOCKBACK_LOCK_S = 0.3
/** Victim drops an impact older than this vs when it saw that lunge start (ms). Was 400; too tight for DCL RTT. */
export const LUNGE_IMPACT_MAX_AGE_MS = 800
/** Victim anticipates knockback when they see lungeStarted/burstFired and are in the hit volume,
 *  before server Impact arrives. Confirmed Impact is deduped via ImpactGate (no double push).
 *  Residual risk: rare false knock if we look in-volume but the attacker never reports us. */
export const VICTIM_SPECULATIVE_KNOCK = true

// ─── Ghost bot body (shared/botBody.ts, run by the server) ──────────
/** Bots take the same knocks as players (shared/knocks.ts) through a server body sim. These convert
 *  Physics-API units to the body's m/s and set its gravity and ground friction. Tune them until the
 *  "[KnockTrace] bot ..." server lines match "[KnockTrace] human ..." victim lines for the same hit.
 *  0.15 guessed a 12 m lunge. A human gets the raw impulse; the anvil stand-in for that impulse
 *  (LUNGE_DUMMY_UNIT) is 0.25 and slides about 40 m. Same number here. Motion stays the body's
 *  normal steps — no extra snap. */
export const BOT_KNOCK_UNIT = 0.25 // m/s per impulse unit; matches LUNGE_DUMMY_UNIT
export const BOT_GRAVITY = 20 // m/s²
export const BOT_FRICTION = 14 // m/s² of horizontal slow-down on a floor
/** A knocked bot walks again once it is on a floor below this speed and its lock has run out (m/s). */
export const BOT_RECOVER_SPEED = 1.5
/**
 * Human locomotion the scene does not override.
 * client/speed.ts writes jog 8 and run 10 (the docs defaults). Jump, double jump, and glide
 * stay at the explorer defaults (docs.decentraland.org locomotion): jump 1 m, run-jump 1.5 m,
 * double jump 2 m, glide 6 m/s, glide fall 1 m/s. Walk is listed so the set stays complete.
 * The body integrates at BOT_GRAVITY (20), not explorer gravity (~10), so a jump's vertical
 * speed is solved to reach the same apex inside this integrator (botJumpSpeed). Glide speed
 * and the fall cap are already m/s and are used as-is.
 */
export const HUMAN_WALK_SPEED = 1.5
export const HUMAN_JOG_SPEED = 8
export const HUMAN_RUN_SPEED = 10
export const HUMAN_JUMP_HEIGHT = 1
export const HUMAN_RUN_JUMP_HEIGHT = 1.5
export const HUMAN_DOUBLE_JUMP_HEIGHT = 2
export const HUMAN_GLIDE_SPEED = 6
export const HUMAN_GLIDE_FALL = 1

/** Upward speed (m/s) whose apex under BOT_GRAVITY equals `heightM`. */
export function botJumpSpeed(heightM: number): number {
  return Math.sqrt(Math.max(0, 2 * BOT_GRAVITY * heightM))
}

/**
 * Edge recovery after a knock. Off: the bot keeps the knock and just falls,
 * then fallTriggerY (the swell, or y 112.47) starts the same cloud rescue a
 * human gets. No jump, double jump, glide, steer-home, or glide dash.
 * The attempt code below stays for when this comes back on.
 */
export const BOT_RECOVERY_ENABLED = false
/**
 * Recovery after a knock, when BOT_RECOVERY_ENABLED. The bot always attempts
 * (CHANCE 1). It is imperfect on purpose: each bot rolls one reaction delay
 * in [REACT_MIN, REACT_MAX] and keeps it, then each knock can skip the double
 * jump or aim wide. Steering accelerates toward the human glide speed instead
 * of clamping the knock velocity away, so a hard hit still carries them past
 * the floor. Tune only these.
 */
/** 0 = never attempts, 1 = always attempts. Execution error is the other knobs. */
export const BOT_RECOVER_CHANCE = 1
/** Per-bot reaction after control returns (the knock lock, or a spike's glide lock). Seconds. */
export const BOT_RECOVER_REACT_MIN_S = 0.15
export const BOT_RECOVER_REACT_MAX_S = 0.45
/** Chance this knock skips the double jump even when the first jump comes up short. */
export const BOT_RECOVER_SKIP_DOUBLE_CHANCE = 0.34
/** Chance this knock aims beside the floor it wanted. */
export const BOT_RECOVER_MISJUDGE_CHANCE = 0.30
/** Sideways miss when they misjudge (m). */
export const BOT_RECOVER_MISJUDGE_M = 3.5
/**
 * Air steering (m/s²) toward a glide of HUMAN_GLIDE_SPEED. The human glider also clamps
 * horizontal speed to that number, which would erase a knock; this accel does not.
 */
export const BOT_RECOVER_STEER_ACCEL = 4.5
/** How fast a glide's heading can swing toward the floor (rad/s). ~180°/s, an arc not a snap. */
export const BOT_GLIDE_TURN = 3.2
/** Below this horizontal speed a grounded bot is not "heading off" (m/s). */
export const BOT_RECOVER_EDGE_SPEED = 2.5
/** At or above this horizontal speed the first jump is the run jump; below it, the standing jump. */
export const BOT_RECOVER_RUN_JUMP_AT = 4
/** Give up once this far below the floor they were aiming at (m). */
export const BOT_RECOVER_GIVE_UP_M = 2.2
/** Stop steering after this long in the glide and just fall (s). */
export const BOT_RECOVER_MAX_S = 3.5
/** Ignore floors farther than this when picking a landing (m). */
export const BOT_RECOVER_MAX_SEEK_M = 36
/** Ground hop: up a low ledge, or the jump that starts a spike (m/s). Apex ≈ 1.6 m at BOT_GRAVITY — a player hop, not a whole level. */
export const BOT_JUMP_V = 8
/** Horizontal cap when the bot leaps off a ledge (player run, m/s). */
/** Planned platform hops. Off: a leap's airborne wire state (st=1) makes the
 *  74cc09b client draw from its snapshot buffer, and the explorer's grounded
 *  avatar stays on the ramp while that transform flies. Routes walk around. */
export const BOT_LEAP_ROUTES = false
export const BOT_LEAP_SPEED = 10
/** Path cost of a drop or jump, in walk-steps. Beats a ramp detour; loses to a short walk. */
export const BOT_LEAP_COST = 5
/** Telegraph before the dash (s). The ghost crouches; lungeStarted fires when the dash actually starts. */
export const BOT_LUNGE_WINDUP_S = 0.32
/** Per think, chance to jump and spike a nearby human instead of lunging. */
export const BOT_SPIKE_CHANCE = 0.28
/** Horizontal range (m) at which the bot bothers jumping for a spike. The hit itself is the AIR_SPIKE cylinder. */
export const BOT_SPIKE_HOP_RANGE = 4.5

// ─── Ghost bot combat (server/bots/manager.ts) ──────────────────────
/** Clients report their position this often while a ghost is in the round (botAim). */
export const BOT_AIM_REPORT_HZ = 5
/** Reported positions older than this are ignored (s). */
export const BOT_AIM_STALE_S = 1.0
/** The bot decides how often (s). Each decision is one roll per ability, so chance × rate = aggression. */
export const BOT_THINK_S = 0.25
/** Chase a human this close (m, horizontal) and within BOT_SAME_LEVEL_DY. Bots roll their own inside the band below. */
export const BOT_ENGAGE_RANGE = 14
export const BOT_SAME_LEVEL_DY = 1.5
/** Seeded pace: each bot's step rate is multiplied by 1 ± this. */
export const BOT_SPEED_SPREAD = 0.10
/** How often a bot drops its path and picks again, before the per-bot jitter. */
export const BOT_RETARGET_S = 5.5
/** Retarget interval is multiplied by 1 ± this. */
export const BOT_RETARGET_SPREAD = 0.35
/** Preferred engagement distance is rolled inside this band (m). */
export const BOT_ENGAGE_MIN_M = 8
export const BOT_ENGAGE_MAX_M = 18
/** Keep walking bots about this far apart (m). 3.5 sits in the 3–4 m band. */
export const BOT_SEPARATE_M = 3.5
/** Hard cap on how far separation may pull a bot off its path point (m). Two bots can sit ~3.6 m apart. */
export const BOT_SEPARATE_MAX_M = 1.8
/** Lunge when the target is this close (m): the dash covers LUNGE_DISTANCE 9.2 m, so well inside it. */
export const BOT_LUNGE_RANGE = 5.5
export const BOT_LUNGE_CHANCE = 0.35
/** Burst when the target is inside this share of BURST_RADIUS. */
export const BOT_BURST_RANGE_FRAC = 0.75
export const BOT_BURST_CHANCE = 0.25
/** No human in range: Burst for paint when at least this share of the footprint isn't the bot's
 *  (and the footprint has at least MIN cells, so not in a corridor stub), with this chance per think. */
export const BOT_BURST_PAINT_FRAC = 0.6
export const BOT_BURST_PAINT_MIN_CELLS = 20
export const BOT_BURST_PAINT_CHANCE = 0.5
/** Aim error on a lunge, ± degrees (uniform). */
export const BOT_AIM_ERROR_DEG = 12
/** Bot dash speed and length for its lunge (m/s, s): LUNGE_DISTANCE over LUNGE_ACTIVE_S, then it brakes. */
export const BOT_LUNGE_BRAKE = 0.15 // fraction of the dash speed kept after the active window

// ─── Test dummy (client-local box, client/lungeDummy.ts) ────────────
/** Spawn a local opponent box near our base to practise on (+ "Respawn dummy" chip, key 2). */
export const LUNGE_TEST_DUMMY = true
/** How many dummies (each on the centre of a distinct random tile). */
export const LUNGE_DUMMY_COUNT = 2
/** A dummy that falls off respawns at a random tile centre after this delay (s). */
export const LUNGE_DUMMY_RESPAWN_S = 1
/** Anvil launch: a SLIDING anvil dummy (horizontal speed ≥ MIN_SPEED m/s) that touches the local
 *  player launches them (impulse along the anvil's travel + big lift) — meant to throw you off the
 *  arena. Client-local like the dummies. Once per anvil per slide; COOLDOWN_S between launches. */
export const ANVIL_LAUNCH_ENABLED = true
export const ANVIL_LAUNCH_MIN_SPEED = 3
export const ANVIL_LAUNCH_IMPULSE = 220 // horizontal (lunge knockback is 108)
export const ANVIL_LAUNCH_LIFT = 45
export const ANVIL_LAUNCH_COOLDOWN_S = 1
/** Attacker-side anvil prediction (client/lungeDummy.ts): our own lunge/burst hit knocks the anvil
 *  locally at once (shared/anvilSim.ts, same knock the server applies) until the server's snapshot
 *  for that hit arrives (or PREDICT_TIMEOUT_S passes: e.g. the hit was rejected); then the render
 *  blends to the server state: error ≤ PREDICT_CLOSE_M over BLEND_S, else over BLEND_FAR_S.
 *  Errors > SNAP_M snap (same as plain snapshot rendering), and respawns always snap. */
export const ANVIL_PREDICT_ENABLED = true
export const ANVIL_PREDICT_TIMEOUT_S = 0.5
export const ANVIL_PREDICT_CLOSE_M = 1.0
export const ANVIL_BLEND_S = 0.2
export const ANVIL_BLEND_FAR_S = 0.12
export const ANVIL_SNAP_M = 3
/** After the server confirms our predicted slide, keep rendering the local sim (it runs ~RTT ahead of the
 *  snapshots on the same path) until the server anvil stops, diverges, or this many seconds pass. */
export const ANVIL_PREDICT_CONFIRMED_MAX_S = 4
/** m/s per Physics impulse unit (unknown in SDK7; guess). The dummy gets the same
 *  LUNGE_KNOCK* numbers × this: 108 → 27 m/s horizontal, lift 12 → 3 m/s, force
 *  44 → 11 m/s² for 0.35 s. Tune until the dummy flies like a real victim. */
export const LUNGE_DUMMY_UNIT = 0.25
/** Dummy gravity (m/s²) and ground friction (m/s² of horizontal deceleration). */
export const LUNGE_DUMMY_GRAVITY = 20
export const LUNGE_DUMMY_FRICTION = 14
/** Slow push: walking/running into an anvil creeps it along the push direction (server-moved;
 *  client sends anvilPush intent at ANVIL_PUSH_SEND_HZ while in contact, server holds each for HOLD_S). */
export const ANVIL_PUSH_SPEED = 0.6 // m/s walking
export const ANVIL_PUSH_RUN_MULT = 1.5 // running → 0.9 m/s
export const ANVIL_PUSH_REACH = 1.35 // m, horizontal player↔anvil centre distance that counts as contact
export const ANVIL_PUSH_FACING = 0.5 // cos of max angle between avatar facing and the direction to the anvil
export const ANVIL_PUSH_SEND_HZ = 10
export const ANVIL_PUSH_HOLD_S = 0.25

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
