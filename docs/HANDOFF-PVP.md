# Pixelwars — PvP prototype handoff (2026-10-20)

For the next agent (e.g. Grokbot) picking up the Dash + Paint Bomb experiment. Facts only. Full design write-up: [`design/pvp-prototype.md`](../design/pvp-prototype.md). Sky-level context: [`docs/HANDOFF.md`](HANDOFF.md).

## 0. Pivot (2026-10-20): Punch replaces Dash + Paint Bomb

Luke: one simple, clear PvP mechanic — **Punch (E)**, goal is knocking opponents off the edge of the sky map (Mario Party style; falling below ~y 66.5 respawns at base).

- **Parked, not deleted:** `DASH_MODE` / `BOMB_MODE` = `'off'` in `src/shared/pvp.ts` (server drops `dashHit` / `bombDrop`). `initDash` / `initPaintBomb` unwired from `src/client/index.ts`, slots removed from the hotbar, native F no longer hidden on mobile. Files `client/dash.ts`, `client/paintBomb.ts`, `server/paintBomb.ts` and their messages stay. To restore: mode `'on'`, re-add init + hotbar slot (+ hide IA_SECONDARY in touchControls).
- **Lunge (Luke spec, final for now):** shoulder-charge on E / LUNGE slot. Client `src/client/lunge.ts`, pure logic `src/shared/lunge.ts`, tuning `LUNGE_*` in `src/shared/pvp.ts` (`client/punch.ts` removed).
  - Movement: one horizontal impulse (12, lift 0) along facing, brake impulse at the end of the 0.20 s active window (scaled by measured speed / peak speed), target ≈2 m. No held forces, no lift → follows ramps under gravity, walls still collide. Jump/run/jog off during active + 0.20 s recovery (InputModifier). Cooldown 1.75 s. Logs `[Lunge] #id travelled X m` for tuning.
  - Hits: attacker client sweeps a 1.1 m capsule from last frame to this frame (+0.06 s grace), ±1.8 m height, nothing >0.3 m behind the start line; each opponent once per lunge; attacker stops dead on first hit.
  - MP: `lungeStart` → server (cooldown, team) → `lungeStarted` broadcast (remote streak/glow). `lungeHit {id,target}` → server `LungeLedger` (once per attacker+id+target, ≤0.6 s after start, opposing team only) → `lungeImpact` → victim's own client applies impulse 62 + lift 8 + force 25/0.35 s via `ImpactGate` (drops dup, or >400 ms after it saw that start). Ghost: server shove 6 m + 1.2 s stun.
  - Debug: `LUNGE_DEBUG = true` draws hitbox/direction/hit/knockback markers + state log.
  - Feedback: team glow + swoosh on press (no input delay), streak during the lunge (also on remote avatars), hit = pop + bomb boom + big burst, miss = grey dust puff, nothing on presses during cooldown. No camera shake / emote.
  - Offline tests: `npx tsx scripts/verify-lunge.ts`.
- **Test dummy (`LUNGE_TEST_DUMMY = true`, `src/client/lungeDummy.ts`):** client-local opponent-coloured 0.8×1.8×0.8 box on the most exposed L0 cell 5–14 m from your base spawn. Lunge hits it like an enemy; it gets the same `LUNGE_KNOCK*` values via a kinematic sim (× `LUNGE_DUMMY_UNIT` = 0.25 m/s per impulse unit, gravity 20, friction 14, floor from the walkable graph). Falls → hidden. Reset: "RESPAWN DUMMY" chip left of the LUNGE slot, or key 2. Logs `[Dummy] stopped after / fell off after X m`. Set the flag false before any real release.
- Sections below describe the Dash/Bomb era and are kept for when they come back.

---

## 1. Where the work lives

| Item | Value |
|---|---|
| Repo | `github.com/iillee/dcl-pixelwars` |
| Branch | **`cursor/pvp-dash-b679`** (branched from `level`) |
| Tip (at handoff) | `044bbfa` — Tune PvP feel: bigger bomb, faster Dash, flagtag swoosh + wind trail |
| Draft PR | https://github.com/iillee/dcl-pixelwars/pull/3 (base **`level`**, not `main`) |
| Status | Experiment. **Not V1 scope. Do not deploy or merge without Luke's go-ahead.** |
| Luke's local remote name | `dcl-pixelwars` (not `origin`) — Creator Hub path `C:\Users\luke\AppData\Roaming\creator-hub\scenes\dcl-pixelwars` |
| Cloud agents | Push to GitHub only. They cannot write Luke's Windows folder; he must pull. |

`main` = classic maze. `level` = sky arena without PvP. This branch = sky + Dash + Paint Bomb.

---

## 2. What was built (this session)

### Abilities
- **E = Dash:** 0.4 s burst, 5 s cooldown. Impulse **40**, sustain force **55**, lift 4 (`src/shared/pvp.ts`). Movement direction, or avatar facing when nearly still. Hits enemy avatars → knockback (victim self-applies Physics). Missed dash can carry you off. Respawn immunity 1.5 s after any `teleportHome`.
- **F = Paint Bomb:** 0.4 s blink telegraph, 8 s cooldown. Paints walkable cells in an **11 m** circle; knockback radius **12 m**, magnitude 48 LINEAR + lift 10. Server paints from its walkable graph (bases stay locked). Bomber and teammates are never pushed.

### Feedback
- Dash: flagtag **`assets/sounds/swoosh.mp3`**, white/cyan wind trail at feet during burst (`src/client/dash.ts`), hit pop + team flash.
- Bomb: flagtag bomb GLBs, fuse + explode sounds, growing ring, fireball/shockwave/debris (`src/client/paintBomb.ts`).

### UI (snowdrift pattern, plain React-ECS)
- Bottom-centre hotbar: `src/client/abilityHotbar.tsx`.
- Gold tooltips (**DASH** / **PAINT BOMB**) + mobile gold bridges; paint order is bridge → tooltips → slots so chips sit **behind** the buttons.
- Cool-down: gold fill + seconds; **hide** Dash `»` / bomb icon while cooling.
- Desktop E/F key hints; mobile hides native E/F via `src/client/touchControls.ts` (keeps overview 1 / 4).

### Multiplayer (critical)
- SDK `Physics` only moves **local** player → knockback always on victim after `dashImpact` / `bombBlast`.
- Server validates teams, round mode, cooldowns; **cannot see positions** (trusts attacker/bomber). Bomb cells computed server-side.
- Wire: `dashHit` / `dashImpact` / `bombDrop` / `bombArmed` / `bombBlast` in `src/shared/messages.ts`. Client inbound only through `src/client/clientHandler.ts` → `src/shared/events.ts`.

### Config
All knobs: **`src/shared/pvp.ts`**. `DASH_MODE` / `BOMB_MODE`: `'on'` | `'off'` | `'alternate'` (even UTC rounds = abilities on for comparison).

### Left alone on purpose
- No territory ability bonuses (Luke: ignore that part of the brief).
- `src/client/speed.ts` 1.3× own-paint speed unchanged.
- `design/gdd.md` unchanged (not approved V1).
- No merge to `main` / `level`, no deploy.

### Verify at tip
- `npm run build` → typecheck clean.
- `npx tsx scripts/verify-graph.ts` and `verify-bot.ts` passed earlier on the branch.
- **Not playtested with two real players** after the radius/speed/swoosh pass. Impulse units are guesses.

---

## 3. Commit map on this branch (`level..HEAD`, oldest → newest)

| Commit | What |
|---|---|
| `73237bb` | Shared dash config + `dashHit` / `dashImpact` + server validation |
| `8b4eb85` | Client Dash, hit detection, knockback, first HUD button |
| `16bf43e` | Early Dash docs |
| `4ed1473` | Flagtag bomb assets |
| `dc31208` | E/F hotbar, Paint Bomb client+server, snowdrift UI |
| `ec7d647` | `design/pvp-prototype.md` + pointers |
| `55232a4` | Stale import comment fix |
| `4b0edf3` | Tooltips behind slots; hide icons on cooldown |
| `044bbfa` | Bomb ~2× radius, faster Dash, swoosh + wind trail |

---

## 4. Key files

| Path | Role |
|---|---|
| `src/shared/pvp.ts` | All tuning + round enable helpers |
| `src/shared/messages.ts` / `events.ts` | Wire + bus |
| `src/server/server.ts` | `dashHit`, bomb fuse/paint/broadcast |
| `src/server/paintBomb.ts` | Circle + floor snap |
| `src/client/dash.ts` | Dash + wind trail |
| `src/client/paintBomb.ts` | Bomb FX / input |
| `src/client/knockback.ts` | Team, roster, immunity, safe Physics |
| `src/client/abilityHotbar.tsx` | Hotbar UI |
| `src/client/touchControls.ts` | Hide native E/F on mobile |
| `src/client/audio.ts` | `DASH_SRC` = swoosh |
| `design/pvp-prototype.md` | Spec, limitations, playtest questions |
| `docs/HANDOFF.md` §5a | Short pointer from sky handoff |

Do not commit: `main.crdt`, `assets/images/autogenerated-thumbnail.png`, `dclcontext/*`, `package.json` line-ending noise from preview. SDK pin stays `@dcl/sdk` + `@dcl/js-runtime` `7.30.2-39321726891.commit-9926e63`.

---

## 5. How Luke pulls (PowerShell / Creator Hub)

```powershell
cd C:\Users\luke\AppData\Roaming\creator-hub\scenes\dcl-pixelwars
git fetch dcl-pixelwars
git checkout cursor/pvp-dash-b679
git pull dcl-pixelwars cursor/pvp-dash-b679
Remove-Item -Force bin\index.js
npm install
npm run build
```

Then preview. Undo preview dirt: `git checkout -- package.json main.crdt`. Needs **two players on different teams** to feel Dash/Bomb.

Cloud agent pull: `git fetch origin && git checkout cursor/pvp-dash-b679 && git reset --hard origin/cursor/pvp-dash-b679`.

---

## 6. Suggested next work (for the next agent)

Priority is playtest readiness, not features:

1. **Two-player pass** — walk the checklist in `design/pvp-prototype.md` § "What to test with two real players first". Retune `DASH_*` / `BOMB_*` in `pvp.ts` from feel.
2. **UI polish** if Luke asks — still match snowdrift; don't invent a new layout language.
3. **Do not** add territory recharge/resistance, health, weapons, or deploy without approval.
4. **Do not** merge into `main`. Prefer updating PR #3 (base `level`). Fast-forward `level` only if Luke asks.
5. Live world `pixelwars.dcl.eth` may still be an old sky bundle with greybox columns; column-free source is on `level` / this branch — redeploy is a separate Luke action (see `docs/HANDOFF.md`).

Playtest closer: **"Which version would you rather play another round of, and why?"** (paint-only vs abilities via `DASH_MODE`/`BOMB_MODE` = `'alternate'`).

---

## 7. Open risks (short)

- Dash/bomb push strength unconfirmed in Explorer with two humans.
- Server trusts client for dash contact and bomb position.
- Predicted FX can show even when server rejects.
- Ghost bot cannot be dashed/knocked.
- Clients without Physics: no knockback (logged).
