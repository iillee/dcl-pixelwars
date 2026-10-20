# PvP prototype: Dash + Paint Bomb (experiment)

> **Status: experiment, not approved V1 scope.** Built on branch `cursor/pvp-dash-b679` (from `level`, sky arena) to answer one playtest question: does a light shove (Dash) and a paint burst with a push (Paint Bomb) make the sky arena more fun than paint-only? `design/gdd.md` is unchanged. Do not deploy or merge without the PO's approval.

Out of scope on purpose: health, damage, elimination, weapons, progression, and any territory bonus for the abilities (no faster recharge on own paint, no knockback resistance, no energy). The existing 1.3× own-paint speed (`src/client/speed.ts`) is untouched.

## What it does

**Dash (E)**
- A burst along your current movement direction, or along the way the avatar faces if you're standing still. Duration 0.4 s, cooldown 5 s.
- An enemy you touch during the dash gets a strong push, mostly along your dash, and can be sent off the arena. There are no guard rails, so a missed dash can carry you off too.
- Feedback: wind whoosh on dash (`swoosh.mp3` from flagtag) plus a white/cyan wind trail at the feet during the burst. On a hit there's a pop (`pop.mp3`) and a team-coloured flash at the victim.

**Paint Bomb (F)**
- No aiming. The bomb drops at your feet, blinks red with a fuse hiss and a growing team-coloured ring for 0.4 s, then explodes.
- It paints every walkable cell within 11 m in your team colour. Enemy bases stay locked, and bomb cells count for the leaderboard and the end-of-round breakdown like normal paint.
- Opponents within 12 m are pushed away from the blast (LINEAR falloff, strongest at the centre) and can fall off. You and your teammates are never pushed.
- Feedback for everyone: fireball, team-coloured shockwave ring out to the paint radius, six debris bits and `bomb_exploding.mp3` at the blast point.

**Both**
- Knocked-off players respawn at their base through the existing fall respawn. Players get 1.5 s of knockback immunity after any respawn.
- Cooldowns keep running through respawn and are never reset.
- Everyone has both abilities. Bots can't use them, and the ghost bot can't be pushed.

## Controls and HUD

| Platform | Dash | Paint Bomb |
|---|---|---|
| Desktop | **E** (`IA_PRIMARY`) or click the left hotbar slot / DASH tooltip | **F** (`IA_SECONDARY`) or click the right slot / PAINT BOMB tooltip |
| Mobile | Tap the left slot or the DASH tooltip | Tap the right slot or the PAINT BOMB tooltip |

Nothing else in pixelwars binds E or F. Overview uses keys 1 and 4, and teleporters are proximity-based.

The hotbar is bottom centre (`src/client/abilityHotbar.tsx`). Its look comes from **dcl-snowdrift's** inventory hotbar (`layer.inventoryHotbar`, `layer.brushSize` Torch/Logs slots and `KeyHintBadge`, `layer.relightPrompt` / `layer.feedPrompt` tooltips, `layer.hotbarBridge`), rebuilt in plain React-ECS because pixelwars doesn't use the UI component kit:

- Two slots: 72 px on desktop, 112 px on mobile, opaque dark background, 18 px radius, constant 4 px border.
- **Ready:** the slot is filled gold with a gold border, and a gold tooltip with black text sits beside it: **DASH** to the left of the E slot, **PAINT BOMB** to the right of the F slot. On mobile a gold bridge strip joins slot and tooltip.
- **Cooling down:** the gold fill rises from empty as the ability recharges, with the seconds left on top. The border is white and there's no tooltip.
- **Unavailable** (no team yet, or a paint-only round): dimmed.
- Desktop shows a small **E** / **F** hint in the slot's top-left corner. Mobile hides it.
- Mobile: `src/client/touchControls.ts` hides the native E/F on-screen buttons so the hotbar is the only touch surface (pattern from snowdrift's `touchControls.ts`). Native 1 (overview) and 4 (rotate) stay.
- The hotbar sits clear of the overview column (right edge, vertical centre) and the native joystick and jump buttons (bottom corners).

## Config (`src/shared/pvp.ts`)

Pure constants with no engine imports, so the client and the server read the same values. `DASH_MODE` and `BOMB_MODE` are independent switches: `'on'` every round, `'off'` disabled (slot hidden, server drops requests), `'alternate'` = only on even UTC round indices.

**Dash** (magnitudes are untested guesses; the SDK doesn't document Physics units):

| Constant | Value | Meaning |
|---|---|---|
| `DASH_MODE` | `'on'` | Switch |
| `DASH_DURATION_S` / `DASH_COOLDOWN_S` | 0.4 / 5 | Burst length, seconds between dashes |
| `DASH_IMPULSE` / `DASH_LIFT` / `DASH_FORCE` | 40 / 4 / 55 | Start impulse, its upward part, sustain force over the burst |
| `DASH_STOP_ON_HIT` / `DASH_MIN_MOVE_SPEED` | true / 1 m/s | Stop the sustain on the first hit; movement vs facing threshold |
| `HIT_RADIUS` / `HIT_MAX_DY` / `HIT_WINDOW_S` | 1.6 m / 2 m / 0.5 s | Contact test on the attacker's screen |
| `KNOCKBACK_DASH_DIR_WEIGHT` | 0.5 | Push direction = 50% dash direction + 50% attacker→victim |
| `KNOCKBACK_IMPULSE` / `KNOCKBACK_LIFT` | 40 / 12 | Victim impulse |
| `KNOCKBACK_FORCE` / `KNOCKBACK_FORCE_S` | 20 / 0.3 s | Extra carry after the impulse |
| `SERVER_HIT_WINDOW_S` / `SERVER_MIN_DASH_GAP_S` / `SERVER_MAX_HITS_PER_DASH` | 0.6 / 4.5 / 3 | Server rate limit |

**Paint Bomb** (starting point: flagtag's bomb; see below):

| Constant | Value | flagtag | Meaning |
|---|---|---|---|
| `BOMB_MODE` | `'on'` | – | Switch |
| `BOMB_FUSE_S` | 0.4 | 5 | Telegraph time from press to blast |
| `BOMB_COOLDOWN_S` | 8 | 10 | Seconds between bombs |
| `BOMB_PAINT_RADIUS` | 11 m | – | Walkable cells whose centre is within this horizontal distance get painted (~2× first pass) |
| `BOMB_PAINT_MAX_DY` | 4 m | – | No painting through levels (they're 10.8 m apart) |
| `BOMB_KNOCKBACK_RADIUS` | 12 m | 6 | 3D distance for knockback (~2× flagtag) |
| `BOMB_KNOCKBACK` | 48, LINEAR | 40, LINEAR | `Physics.applyKnockbackToPlayer(blast, 48, 12, LINEAR)` |
| `BOMB_KNOCKBACK_LIFT` | 10 | – | Extra upward impulse with the same falloff, so floor friction doesn't eat the push |
| `BOMB_SNAP_MAX_DROP` | 4 m | – | Server snaps the bomb down onto a floor cell this close below |
| `SERVER_MIN_BOMB_GAP_S` | 7.5 | – | Server cooldown with 0.5 s slack |
| `RESPAWN_IMMUNITY_S` | 1.5 | – | Shared by both abilities |

Tuning hints: knockback too weak to threaten at an edge → raise `BOMB_KNOCKBACK` / `KNOCKBACK_IMPULSE`; victims fly too high → lower the lifts; bomb too strong for painting → lower `BOMB_PAINT_RADIUS` or raise `BOMB_COOLDOWN_S`.

## What was taken from flagtag

[iillee/flagtag](https://github.com/iillee/flagtag), `src/systems/bombSystem.ts` and `src/server/combat.ts`:

- **Assets** (copied): `assets/models/bomb/Bomb_01.glb` and `Bomb_red.glb` (from flagtag's `asset-packs/iron_grenade`), `assets/sounds/fuse.mp3`, `assets/sounds/bomb_exploding.mp3`, `assets/sounds/swoosh.mp3` (Dash whoosh; used by flagtag's updraft), `assets/images/bomb.png` (hotbar icon).
- **Telegraph:** the blink is done by swapping the normal and red child models' scale (no GLB reload), from a small pre-created pool at a tiny scale so the models are loaded before the first bomb. The blink interval is 80 ms; flagtag goes from 800 to 100 ms over its 5 s fuse, and our whole fuse is the "about to blow" end. The fuse sound plays at the bomb.
- **Explosion VFX:** the same three parts with flagtag's sizes and timing (0.6 s): a fireball sphere growing 0.3 → 4 m then shrinking, a flat shockwave ring, and six debris spheres flying outward. Changes: the ring and half the debris are in the team colour, and the ring grows to the paint diameter. It's animated per frame instead of with `Tween` (flagtag needed a separate `vfxLifetime` registry to stop tweened VFX getting stuck).
- **Dash wind trail:** orb trail at the feet during the burst, same pool/tween pattern as flagtag's `boostTrailSystem.ts`, tinted white/cyan.
- **Knockback:** the victim's client calls `Physics.applyKnockbackToPlayer(blastPos, 48, 12, KnockbackFalloff.LINEAR)`, plus our small lift.
- **Not taken:** flagtag's 3 s stun, `getHit` emote, `InputModifier` movement lock and hit flash (closer to damage than we want), dropping from height / ground raycast / contact detonation, ghost killing, the server-side victim list (our server has no avatar positions), and flagtag's self-knock (its server pushes everyone in range, owner included). Here the bomber and teammates are never pushed, as the brief asks.

## Code map

| File | Role |
|---|---|
| `src/shared/pvp.ts` | All knobs, `dashEnabledForRound` / `bombEnabledForRound` |
| `src/shared/messages.ts` | `dashHit`, `dashImpact`, `bombDrop`, `bombArmed`, `bombBlast` |
| `src/shared/events.ts` | `dash:impact`, `bomb:armed`, `bomb:blast`, `player:respawned` |
| `src/server/server.ts` | Dash hit validation; bomb cooldown, fuse timer, paint, broadcasts |
| `src/server/paintBomb.ts` | Blast circle + floor snap from the bot walkable graph |
| `src/server/bots/manager.ts` | `getWalkableGraph()` export |
| `src/client/clientHandler.ts` | Inbound → events; `sendDashHit()`, `sendBombDrop()` |
| `src/client/knockback.ts` | Local team, roster map, respawn immunity, guarded Physics calls |
| `src/client/dash.ts` | Dash input, Physics, hit detection, knockback, flash, wind trail |
| `src/client/paintBomb.ts` | Bomb input, telegraph, explosion FX/sound, knockback |
| `src/client/abilityHotbar.tsx` | E/F hotbar + tooltips (rendered in `src/ui.tsx`) |
| `src/client/touchControls.ts` | Hides native E/F buttons on mobile |
| `src/client/player.ts` | `teleportHome()` emits `player:respawned` |

## Multiplayer flow

**Dash**
1. The attacker applies the impulse and sustain force to itself.
2. The attacker's client checks visible enemy avatars each frame of the hit window and sends `dashHit { target, dx, dz }` for the first contact per target.
3. The server checks the round mode, both teams and the per-attacker hit window, then broadcasts `dashImpact`.
4. The victim's client pushes itself (unless immune). Everyone else sees the flash.

**Paint Bomb**
1. The bomber's client sends `bombDrop { x, y, z }` with its own position and shows the telegraph immediately (predicted), so the 0.4 s fuse reads without waiting for a round trip.
2. The server checks the round mode, the bomber's team and cooldown, and that the position is inside the scene. It snaps the bomb down to the nearest floor cell, queues it for `BOMB_FUSE_S`, and broadcasts `bombArmed`. Other clients show the telegraph; the bomber's telegraph moves to the snapped spot.
3. When the fuse runs out, the server paints every walkable cell in the circle from its own walkable graph: the same graph the ghost bot uses, built from the round seed. `applyPaint` keeps bases locked. The server credits the leaderboard and round contribution, then broadcasts `bombBlast`. The paint reaches everyone through the normal 5 Hz `paintDelta`, so it shows up a frame or two after the blast.
4. Every client shows the explosion. A client whose local player is on the other team, inside `BOMB_KNOCKBACK_RADIUS` (12 m) and not immune, pushes itself.

**Why the server computes the cells:** it already has the walkable graph with every cell's world position, so it doesn't have to trust client cell ids. That also means a bomb needs no chunking against the 100-id `paintTick` cap. An 11 m circle covers a much wider swath of the woven maze than the first 5.5 m pass.

## Technical limitations and decisions

- **Only the local player can be pushed.** The SDK's `Physics` helpers only affect `engine.PlayerEntity`. Knockback therefore runs on the victim's own client after a server relay, one round trip later (typically 100–300 ms).
- **Dash hits are judged on the attacker's screen.** Remote avatars lag about 100–300 ms, so a victim can feel hit "from nowhere". The hit window is 0.1 s longer than the dash to compensate. This favours the attacker.
- **Bomb victims are judged on their own screen.** Each victim checks its own, current position against the server's blast point. That's fairer than Dash, but it means an attacker can't see in advance exactly who will fly.
- **The server can't see positions.** It trusts the attacker for Dash contact and the bomber's reported drop position (same trust model as `paintTick`). It does check that the drop is inside the scene, the cooldown, the team and the round mode. A modified client could drop bombs anywhere on the map once per cooldown. Anti-cheat is deferred.
- **Predicted feedback can be wrong.** If the server rejects a dash hit or a bomb (rate limit, round boundary), the attacker still saw a flash, or a telegraph that fades after 1.9 s with no blast.
- **The server fuse adds latency.** The blast fires 0.4 s after the server receives the drop. The bomber sees about 0.4 s plus half a round trip; others see about 0.4 s from when the telegraph arrives.
- **Painted cells arrive on the next 5 Hz `paintDelta`.** Up to 0.2 s after the explosion.
- **Ramps:** bomb paint on ramps uses the graph's interpolated cell height, so the circle's edge on a slope is approximate. The `BOMB_PAINT_MAX_DY` (4 m) height window keeps it from painting the level above or below.
- **Mid-air bombs:** with no floor within 4 m below, the bomb explodes where it was dropped and paints nothing it can't reach.
- **Round boundary:** bombs still fusing at a boundary are dropped by the server (their cell ids would be stale), and clients clear their telegraphs.
- **Physics support:** clients without Physics support do nothing on knockback. Calls are wrapped and logged as `[PvP] … failed (Physics unsupported?)`.
- **The ghost bot** is a server-side painter with no avatar, so it can't be pushed. Bombs do repaint its cells.
- **Air dash is allowed**, so a knocked player with Dash ready can dash back toward the arena.
- **Mobile positional audio:** flagtag notes that `global: false` audio doesn't attenuate on mobile, so blasts may sound equally loud everywhere there. We didn't port its manual attenuation helper.
- **Hotbar with one ability:** if only one ability is on, its slot centres and the tooltip leaves a small gap. That's cosmetic.

## Paint-only vs abilities comparison

Set `DASH_MODE` and/or `BOMB_MODE` to `'alternate'` in `src/shared/pvp.ts` and rebuild. Even UTC round indices have the ability; odd rounds are paint-only (5-minute rounds, so it flips every round). A small chip above the hotbar says **DASH + BOMB ROUND** or **PAINT ONLY**. In paint-only rounds the slots are dimmed, E/F do nothing and the server drops requests. Play at least two of each back to back with the same group. To compare abilities separately, set one to `'on'` and the other to `'off'`.

## What to test with two real players first

1. Both join on different teams. Desktop: E and F work, the slots show the E/F hints and gold tooltips. Mobile: tapping a slot or tooltip works, there are no native E/F buttons, and the hotbar doesn't collide with the joystick or jump.
2. **Dash** on flat L0: distance (about 2–3× a step burst?), direction (movement, or facing when standing), whoosh.
3. **Dash** into the other player mid-tile, then near an edge. Does the victim move? Do they fall and respawn at base with immunity?
4. **Bomb** alone: the telegraph is visible and audible within the 0.4 s, the explosion shows, a circle of your colour appears, and your own base and the enemy base are unchanged.
5. **Bomb** next to the other player: are they pushed and you not? A teammate standing next to you is not pushed. Does it threaten them near an edge?
6. Cooldowns: Dash 5…1 and Bomb 8…1 with the rising fill; both keep counting through a respawn.
7. Leaderboard / end-of-round breakdown: bomb cells count for the bomber.
8. Server log: `[Server] dashImpact …`, `[Server] bombBlast … → N cells`, and no `rejected` lines in normal play.

## Playtest questions

- Did Dash and/or Paint Bomb make rounds more fun, more stressful, or both? Which one mattered more?
- Did you still focus on painting, or did rounds turn into shoving matches?
- Did the bomb feel like a paint tool or a weapon?
- Did getting knocked off feel fair? Could you tell who did it and why?
- Was the bomb's 0.4 s warning enough to react?
- Did a missed dash that sent you off feel like your fault (good) or like a bug (bad)?
- Were the cooldowns (Dash 5 s, Bomb 8 s) too short, too long, or about right?
- Did respawn feel fast enough, and was the immunity noticeable?
- On mobile, was the hotbar easy to use mid-run?
- **Which version would you rather play another round of, and why?**
