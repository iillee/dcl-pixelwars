# Dash PvP prototype (experiment)

> **Status: experiment, not approved V1 scope.** Built on branch `cursor/pvp-dash-b679` (from `level`, sky arena) to answer one playtest question: does a light shove make the sky arena more fun than paint-only? `design/gdd.md` is unchanged. Do not deploy or merge without the PO's approval.

Out of scope on purpose: health, damage, elimination, weapons, progression, Paint Bomb, and any territory bonus for Dash (no faster recharge on own paint, no knockback resistance, no energy). The existing 1.3× own-paint speed (`src/client/speed.ts`) is untouched.

## What it does

- **Dash**: press to burst a short distance in your current movement direction (avatar facing if you're standing still). Duration 0.4 s, cooldown 5 s.
- **Hit**: an enemy you touch during the dash gets a strong push away from you, mostly along your dash. Near an edge, that sends them off the arena. There are no guard rails, so a missed dash can carry you off too.
- **Fall**: the existing fall respawn sends knocked-off players back to their team base. Players get 1.5 s of knockback immunity after any respawn. The dash cooldown keeps running through respawn.
- **Feedback**: whoosh on dash (`teleport.mp3`). On a hit, the attacker and the victim both hear a pop (`pop.mp3`) and see a team-coloured flash sphere at the victim. Other players see the flash and hear a positional pop at the victim's avatar.
- Everyone has Dash. Bots can't use it, and the ghost bot can't be hit (see limitations).

## Controls

| Platform | Dash |
|---|---|
| Desktop | **F** (`IA_SECONDARY`), or click the round **DASH** button |
| Mobile | Tap the round **DASH** button (right edge, below the overview button, above the jump button) |

The button turns gold when Dash is ready. During the cooldown it shows the seconds left, and it greys out when Dash is unavailable (no team yet, or a paint-only round). On desktop it also shows an **F** hint.

## Config (`src/shared/dash.ts`)

Pure constants with no engine imports, so the client and the server read the same values.

| Constant | Value | Meaning |
|---|---|---|
| `DASH_MODE` | `'on'` | `'on'` every round, `'off'` disabled (no button, server drops hits), `'alternate'` = Dash only on even UTC round indices |
| `DASH_DURATION_S` | 0.4 | Sustain-force time |
| `DASH_COOLDOWN_S` | 5 | Seconds between dashes (never reset) |
| `DASH_IMPULSE` | 20 | One-shot horizontal impulse at dash start |
| `DASH_LIFT` | 3 | Upward part of the start impulse (gets the avatar off the floor so friction doesn't eat it) |
| `DASH_FORCE` | 25 | Horizontal force held for the dash duration (0 = impulse only) |
| `DASH_STOP_ON_HIT` | true | The sustain force stops on the first hit |
| `DASH_MIN_MOVE_SPEED` | 1 m/s | Above this, dash follows movement. Below it, dash follows avatar facing |
| `HIT_RADIUS` | 1.6 m | Horizontal contact distance |
| `HIT_MAX_DY` | 2 m | Max height difference for a hit (no hits through floors or ramps) |
| `HIT_WINDOW_S` | 0.5 | Hit window after dash start (dash + 0.1 s for avatar lag) |
| `KNOCKBACK_DASH_DIR_WEIGHT` | 0.5 | Push direction = 50% dash direction + 50% attacker→victim |
| `KNOCKBACK_IMPULSE` | 40 | Victim horizontal impulse |
| `KNOCKBACK_LIFT` | 12 | Victim upward impulse |
| `KNOCKBACK_FORCE` / `_S` | 20 / 0.3 s | Extra force after the impulse that carries the victim further (0 = off) |
| `RESPAWN_IMMUNITY_S` | 1.5 | No knockback this long after a teleport home |
| `SERVER_HIT_WINDOW_S` | 0.6 | Server accepts an attacker's hits only within 0.6 s of that dash's first hit |
| `SERVER_MIN_DASH_GAP_S` | 4.5 | The next window opens no sooner than this (cooldown − 0.5 s slack) |
| `SERVER_MAX_HITS_PER_DASH` | 3 | Distinct targets per window |

**Impulse and force magnitudes are untested guesses.** The SDK doesn't document their units. The docs examples use 50 (launch up) and 40 (knockback). Tune them in the first two-player session: dash too short → raise `DASH_IMPULSE` / `DASH_FORCE`; knockback too weak to threaten at an edge → raise `KNOCKBACK_IMPULSE` / `KNOCKBACK_FORCE`; victims fly too high → lower `KNOCKBACK_LIFT`.

To turn Dash off completely, set `DASH_MODE = 'off'` and rebuild. The client skips `initDash()`, the button is hidden, and the server rejects every `dashHit`.

## Code map

| File | Role |
|---|---|
| `src/shared/dash.ts` | All knobs + `dashEnabledForRound(idx)` |
| `src/shared/messages.ts` | `dashHit` (client → server), `dashImpact` (server → all) |
| `src/shared/events.ts` | `dash:impact`, `player:respawned` |
| `src/server/server.ts` | `dashHit` handler: validate, rate-limit, broadcast |
| `src/client/clientHandler.ts` | `dashImpact` → `dash:impact`; `sendDashHit()` |
| `src/client/dash.ts` | Input, direction, Physics calls, hit detection, knockback, flash |
| `src/client/dashUi.tsx` | DASH button + round-mode label (rendered in `src/ui.tsx`) |
| `src/client/player.ts` | `teleportHome()` emits `player:respawned` (immunity hook) |
| `src/client/audio.ts` | `playDashSfx()`, `playDashHitSfx()` |

## Multiplayer flow

1. **Attacker (local):** F / button → `Physics.applyImpulseToPlayer(dir × DASH_IMPULSE + up × DASH_LIFT)` and `Physics.applyForceToPlayerForDuration(dir, DASH_FORCE, 0.4 s)`. Direction comes from the player's smoothed position change over recent frames, or from the avatar's facing when it's standing still.
2. **Attacker detects the hit.** Every frame in the hit window, this client checks every visible avatar (`PlayerIdentityData` + `Transform`, skipping `engine.PlayerEntity`). A hit is an avatar whose roster team is the other team, within `HIT_RADIUS` horizontally and `HIT_MAX_DY` vertically. The first contact per target per dash sends `dashHit { target, dx, dz }`. The attacker hears the pop and sees the flash immediately (predicted).
3. **Server validates.** It checks that Dash is enabled this round, the attacker is on the roster, the target is a connected player on the other team, the direction is non-zero, and the hit is inside the attacker's hit window (rate limit, max 3 targets, no duplicates). Then it broadcasts `dashImpact { attacker, target, dx, dz }` with a normalised direction.
4. **Victim self-applies.** The client whose address matches `target` applies `dir × KNOCKBACK_IMPULSE + up × KNOCKBACK_LIFT` plus a short `KNOCKBACK_FORCE`, unless it's in respawn immunity or this round is paint-only. Every other client except the attacker shows the flash and a positional pop at the victim's avatar.
5. **Fall and respawn.** The existing sky fall respawn (`MIN_Y − FALL_RESPAWN_DROP`, 12 m below the lowest level) teleports the victim to their team base, which grants 1.5 s of immunity.

Bandwidth: one small message per hit and one broadcast per accepted hit. The dash itself isn't networked; the avatar movement it causes shows up through normal avatar sync.

## Technical limitations and decisions

- **Only the local player can be pushed.** The SDK's `Physics` helpers only affect `engine.PlayerEntity`. Writing `Transform` on players is ignored. So knockback has to run on the victim's own client after a server relay. That adds one round trip (attacker → server → victim, typically 100–300 ms) between contact and push.
- **Hits are judged on the attacker's screen.** Remote avatar positions are interpolated and run about 100–300 ms behind. A hit can land on someone who has already moved on their own screen ("I was nowhere near him"), and a dodge visible to the victim may not count. That's why `HIT_WINDOW_S` is 0.1 s longer than the dash. This is the classic favour-the-shooter trade-off, chosen because it makes hits feel responsive to the attacker.
- **The server can't validate distance.** The authoritative server doesn't see player positions, so it trusts the attacker's client for contact (same trust model as `paintTick` cell ids). It only enforces teams, round mode and rate. A modified client could shove anyone on the enemy team once per dash window. Anti-cheat is deferred.
- **Predicted feedback can be wrong.** If the server rejects a hit (rate limit, team change, round boundary), the attacker has already seen the flash and heard the pop, but the victim doesn't move.
- **Victim's client can drop it.** If the victim's client misses the broadcast, or doesn't support the Physics components (older explorer builds), nothing happens. The calls are wrapped in try/catch and logged as `[Dash] … failed (Physics unsupported?)`.
- **Impulse units are untested.** All magnitudes are first guesses (see Config).
- **The ghost bot can't be hit.** It's a server-side virtual painter with no avatar or physics, and bots never dash.
- **Air dash is allowed.** A knocked-back player who still has Dash off cooldown can dash back toward the arena. That's a possible counterplay; watch whether it feels good or cheap.
- **Remote dashes have no dedicated effect.** Other players just see the avatar move fast. A trail would need an extra broadcast per dash.
- **Round boundary.** The client and server each read the UTC round index, so a hit sent in the last few milliseconds of a round can be judged against different rounds in `'alternate'` mode. That's harmless.
- **Overview camera** stays on during a knockback. A fall respawn turns it off as before.

## Paint-only vs Dash comparison

Set `DASH_MODE = 'alternate'` in `src/shared/dash.ts` and rebuild. Even UTC round indices are Dash rounds and odd ones are paint-only (5-minute rounds, so the mode flips every round). A small **DASH ROUND** / **PAINT ONLY** label sits above the button. In paint-only rounds the button is greyed out, F does nothing, and the server drops hits. Play at least two of each back to back with the same group.

## What to test with two real players first

1. Both join on different teams (red/blue name tags visible). The DASH button is gold and F works on desktop, and the button works on mobile.
2. Dash on flat L0 with nobody near. Is the distance about 2–3× a normal step burst? Does the direction follow movement, and facing when standing still? Do you hear the whoosh?
3. Dash into the other player in the middle of a tile. Does the victim move at all? If not, the client probably doesn't support Physics, or the magnitudes are far too low.
4. Dash into the other player near an edge. Can it knock them off? Does the victim respawn at their base, and are they immune right after (a second hit within 1.5 s does nothing)?
5. Missed dash toward an edge: can it carry the attacker off?
6. Check the cooldown: the button shows 5…1, and it keeps counting through a respawn.
7. Latency feel: how often does a hit land when it looked like a miss to the victim (or the reverse)?
8. Mobile: is the button reachable, does it collide with the joystick or jump, and can you dash while moving?
9. Server log: `[Server] dashImpact …` on hits, and no `rejected` lines during normal play.

## Playtest questions

- Did Dash make rounds more fun, more stressful, or both?
- Did you still focus on painting, or did rounds turn into shoving matches?
- Did getting knocked off feel fair? Could you tell who hit you and why?
- Did a missed dash that sent you off feel like your fault (good) or like a bug (bad)?
- Was the cooldown too short, too long, or about right? Was the knockback strong enough to matter near edges?
- Did respawn feel fast enough, and was the immunity noticeable?
- On mobile, was the button easy to use mid-run?
- **Which version would you rather play another round of, and why?**
