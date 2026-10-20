# Pixelwars — PvP prototype handoff (2026-10-20)

For the next agent (e.g. Grokbot) picking up the Dash + Paint Bomb experiment. Facts only. Full design write-up: [`design/pvp-prototype.md`](../design/pvp-prototype.md). Sky-level context: [`docs/HANDOFF.md`](HANDOFF.md).

## 0. Pivot (2026-10-20): Punch replaces Dash + Paint Bomb

Luke: one simple, clear PvP mechanic — **Punch (E)**, goal is knocking opponents off the edge of the sky map (Mario Party style; falling below ~y 66.5 respawns at base).

- **Parked, not deleted:** `DASH_MODE` / `BOMB_MODE` = `'off'` in `src/shared/pvp.ts` (server drops `dashHit` / `bombDrop`). `initDash` / `initPaintBomb` unwired from `src/client/index.ts`, slots removed from the hotbar, native F no longer hidden on mobile. Files `client/dash.ts`, `client/paintBomb.ts`, `server/paintBomb.ts` and their messages stay. To restore: mode `'on'`, re-add init + hotbar slot (+ hide IA_SECONDARY in touchControls).
- **Lunge (Luke spec, final for now):** shoulder-charge on E / LUNGE slot. Client `src/client/lunge.ts`, pure logic `src/shared/lunge.ts`, tuning `LUNGE_*` in `src/shared/pvp.ts` (`client/punch.ts` removed).
  - Movement: one horizontal impulse (48, lift 0, on top of run speed) along facing, brake impulse at the end of the 0.20 s active window (scaled by measured speed / peak speed), target ≈8 m (was 4 m / impulse 24, 2 m / 12 before); the brake removes only the lunge's extra speed above the run speed at the press. No held forces, no lift → follows ramps under gravity, walls still collide. Jump/run/jog off during active + 0.20 s recovery (InputModifier). Cooldown 1.75 s. Logs `[Lunge] #id travelled X m` for tuning.
  - Hits: attacker client sweeps a 1.1 m capsule centred `LUNGE_HIT_FORWARD` 0.6 m ahead (reach ≈1.7 m; anything within 0.7 m of the attacker hits at any angle) from last frame to this frame (+0.06 s grace), ±1.8 m height, nothing >0.3 m behind the start line; each opponent once per lunge; attacker stops dead on first hit.
  - MP: `lungeStart` → server (cooldown, team) → `lungeStarted` broadcast (remote streak/glow). `lungeHit {id,target}` → server `LungeLedger` (once per attacker+id+target, ≤0.6 s after start, opposing team only) → `lungeImpact` → victim's own client applies impulse 93 + lift 10 + force 38/0.35 s (×1.5 on 2026-10-20) and locks its movement input for 0.3 s (`LUNGE_KNOCKBACK_LOCK`, extended not stacked by a second hit, cleared on respawn/round reset; small yellow dizzy sparks) via `ImpactGate` (drops dup, or >400 ms after it saw that start). Ghost: server shove 6 m + 1.2 s stun.
  - Slash VFX (`LUNGE_SLASH_*`, `src/client/lungeSlash.ts`, texture `assets/images/lunge_slash.png`): flat team-coloured crescent, 2.2 m wide (= hitbox diameter), at chest height (1.1 m), outer edge on the hitbox's leading edge (1.7 m; `LUNGE_SLASH_FORWARD` derived from `LUNGE_HIT_FORWARD`); grows + fades in from the right fist point (0.2 right, 1.15 up, 0.3 forward) over 0.07 s (`LUNGE_SLASH_INTRO`, visual only), follows the attacker for 0.20 s then shrinks/fades in 0.12 s; flashes white on hit; shown for remote lunges too. Pool of 4 planes. `LUNGE_SLASH_FLIP` if it points backwards.
  - Debug: `LUNGE_DEBUG = true` draws hitbox/direction/hit/knockback markers + state log.
  - Feedback: team glow + random lunge take (`assets/sounds/lunge_01..06.wav`: ~3 ms lead-in, WAV to avoid mp3 priming delay, preloaded via AssetLoad, one AudioSource per take, played on the input frame before any network send; never the same twice in a row; also on remote lunges) + upper-body `punch` emote (`LUNGE_EMOTE`) on press (no input delay), streak during the lunge (also on remote avatars), hit = pop + bomb boom + big burst, miss = grey dust puff, nothing on presses during cooldown. No camera shake / emote.
  - Offline tests: `npx tsx scripts/verify-lunge.ts`.
- **Test dummies (`LUNGE_TEST_DUMMY = true`, `LUNGE_DUMMY_COUNT = 4`, `src/client/lungeDummy.ts`):** client-local opponent-coloured 0.8×1.8×0.8 boxes, each on the exact centre of a distinct random non-base tile (flat tiles first, ramps only if not enough flat ones; any level), floor y from the walkable graph. Re-rolled on maze rebuild, team change and RESPAWN DUMMY (chip top-centre under the coverage pill, `client/dummyUi.tsx`, or key 2) → all 4 to NEW random tiles. Lunge hits each once per lunge; each gets the same `LUNGE_KNOCK*` values via a kinematic sim (× `LUNGE_DUMMY_UNIT` = 0.25, gravity 20, friction 14). Falls → hidden. Set the flag false before any real release.
- **Paint Bomb back on F (2026-10-20):** `BOMB_MODE = 'on'`, `initPaintBomb()` re-added in `client/index.ts`, hotbar is LUNGE (E) left + PAINT BOMB (F) right with tooltips on the outer sides, native F hidden on mobile again. Bomb code unchanged since 9bd8b2b (no fuse ring). Dash stays parked.
- **Box hitbox + visible box (2026-10-20):** hit volume is now a box in front of the attacker oriented along the lunge: `LUNGE_HITBOX_W` 2.2 × `LUNGE_HITBOX_D` 1.4 × `LUNGE_HITBOX_H` 1.8, near face `LUNGE_HITBOX_FORWARD` 0.3 m ahead (reach 1.7 m). `shared/lunge.ts` `hitboxAt()` is the single geometry source; `boxHit()` tests the box placed at last frame's and this frame's PlayerEntity position (swept, slab test) + the 0.7 m point-blank rule + behind-start cut. `client/lungeHitbox.ts` draws a translucent team box (alpha 0.25, emissive, no collider) for active + grace, placed by lunge.ts with the exact position it just tested; flashes on hit; remote lunges get one too (from their avatar Transform). `LUNGE_HITBOX_VISIBLE` on; `LUNGE_HITBOX_PARENT` (default false) switches the local box to a PlayerEntity child if the world box trails in the Explorer. Slash `LUNGE_SLASH_FORWARD` derived from the box far face. Capsule (`LUNGE_HIT_RADIUS/FORWARD`) removed. Untested in Explorer.
- **Slash/glow tracking (2026-10-20):** `lungeSlash.ts` no longer runs its own system; lunge.ts calls `tickSlash(dt, pos)` right after the hit test + hitbox placement, so the local slash uses the same PlayerEntity position that frame (grow-in, active, fade); `lastPos` is now a copy, not the live Transform object. Start glow (local + remote) follows its avatar each frame via `spawnFx(..., follow)`. Speed streaks are intentionally left behind in the world (trail). Remote slash/glow read that avatar's Transform per frame.
- **Paint Burst replaces Paint Bomb on F (2026-10-20):** `BOMB_MODE='off'` (code kept, not initialised), `BURST_MODE='on'`. Params `BURST_*` in `shared/pvp.ts`; pure logic `shared/burst.ts` (BurstCharge, inBurst, burstDir, burstFootprint, BurstLedger); client `client/paintBurst.ts`; server `burst*` handlers in `server.ts`; tests `scripts/verify-burst.ts`.
  - Charge: server counts the sender's paintTick cells that `applyPaint` flipped (neutral/enemy → own), never while that player's burst is active; 10 → 1 charge (no reserve). `burstState` → client HUD. Kept through falls/respawns, cleared on round reset / leave.
  - Use (F or slot tap): burstUse → server consumes, opens a 3 s (+0.5 slack) paint window, broadcasts burstFired, shoves opponent ghost bots in range. Attacker client finds opponent players within 4 m (3D), LOS raycast (CL_PHYSICS, fails open after 0.3 s), sends burstHit → server ledger (once per target, 1 s window) → burstImpact → victim applies impulse 70 / lift 12 / force 26 for 0.3 s via ImpactGate (dup + 600 ms stale) unless respawn-immune. Dummies knocked locally.
  - Paint: while active the client sends its current cell (on change + every 0.25 s); server paints `burstFootprint` (BFS on walkable adjacency inside a 3×3 square or 5-cell cross, |dy| ≤ 1.5) through applyPaint → normal paintDelta. Fall → burstEnd, no refund. F during active = nothing.
  - HUD: F slot shows `n/10` + fill while charging, full + tooltip BURST when ready, `Ns` + draining fill while active; icon `assets/images/burst.png`. Lunge untouched.
- **Paint Burst tuning (2026-10-20):** charge 100 captures (HUD `n/100`); default footprint 7×7 square (`BURST_PAINT_RADIUS_CELLS = 3`, 'cross' still available); own impact sound `assets/sounds/burst_impact.wav` synthesized by `scripts/make-burst-sfx.py` (thump + whoosh + click), preloaded in `client/audio.ts`.
- **Burst tile ripple (2026-10-20):** `client/burstRipple.ts`, flag `BURST_TILE_RIPPLE` (+ `BURST_TILE_*` tuning). Adapted from dcl-canvas paint.ts brush-lift overlays (box per cell, up 140 ms / down 220 ms, then despawn): here a pool of 40 cell-sized team slabs, cells = `burstFootprint` on a client copy of the walkable graph clipped to BURST_RADIUS (same level, no gaps), each delayed by distance so the pop ripples out over 0.4 s. Local + remote bursts. Flat ring kept.
- **Paint Burst one-time (2026-10-20, supersedes the 3 s / burstPaint / aura notes above):** burstUse now carries the player's cell; the server resolves the centre (`burstCentre`: reported cell if near, else nearest walkable cell) and paints the whole 7×7 footprint once, immediately (same score credit, never charge — it doesn't go through paintTick). No active state, no resends (`burstPaint`/`burstEnd` messages removed), no aura, no active countdown: the F slot goes straight back to 0/100. Tile ripple covers the same footprint (all 49 cells), delay by distance / footprint extent over `BURST_TILE_RIPPLE_S` 0.45 s, pool `BURST_TILE_POOL` 100 (two full bursts). Knockback radius `BURST_RADIUS` 4 m and the flat ring (sized to it) unchanged.
- **Paint Burst cooldown + circle (2026-10-20, supersedes the charge/quota notes above):** no paint quota: `BURST_COOLDOWN_S = 12` timer, server-enforced (`SERVER_MIN_BURST_GAP_S` 11.5); F slot uses the Lunge-style fill, no number. Removed BurstCharge, `burstState` message, the paintTick charge hook and the charge-earned pulse (sphere + pop). Paint footprint default `BURST_PAINT_SHAPE = 'circle'`, `BURST_PAINT_RADIUS_CELLS = 3.5` (37 cells on flat floor, up to ~39 over ramps; 'square'/'cross' still available). Ripple slabs use paint.ts `cellMaterial(team)` (same opaque matte floor material, no emissive).
- **Dummies never on teleporters (2026-10-20):** `pickSpots()` (initial spawn, auto-respawn, key 2) skips every grid square holding a teleporter (`teleportOrbs.ts teleporterTiles()`, sky and classic). Pad trigger is 1.2 m at the tile centre, so neighbours are unaffected.
- **Overview eye (2026-10-20):** right-edge overview column removed. A small eye (`assets/images/eye.png`, copied from dcl-snowdrift; 21×14, white / gold when open or overview on) sits under the timer's star; it toggles a row left of the timer: [+ − ⟳ (overview only)] [overview toggle]. `client/overviewUi.tsx` OverviewEye / OverviewRow.
- **Camera vs tiles (2026-10-20):** maze tiles (`maze/rebuild.ts`) now use `visibleMeshesCollisionMask: CL_PHYSICS | CL_POINTER` so the 3rd-person camera collides with floors/walls/ramps (Explorer needs both layers on the same geometry). Raycasts (burst LOS) are CL_PHYSICS-only, unchanged.
- **Anvil launch (2026-10-20):** a sliding anvil dummy (≥ `ANVIL_LAUNCH_MIN_SPEED` 3 m/s) touching the local player (1.25 m horizontal, −0.5…+1.2 m height) launches them: `applyImpulseToPlayer` along the anvil's travel × `ANVIL_LAUNCH_IMPULSE` 220 + `ANVIL_LAUNCH_LIFT` 45, knock control-lock, dash-hit sound. Once per anvil per slide, `ANVIL_LAUNCH_COOLDOWN_S` 1 s, skipped while respawn-immune and for 0.35 s after we hit that anvil. Dummies are client-local and NOT synced: each client launches only itself against its own anvils.
- **Ramp burst by rotation (2026-10-20):** verify-burst simulates a player on every ramp (all 4 rotations, ~24 Sky layouts, 21 points per ramp) through paint.ts worldToCellId → server burst: all pass, no rotation mismatch found. TEMP logs: client `[Burst] #id fired cell=… pos=…`, server `[Server] burst … cell=… centre=… footprint=N rampCells=M` — remove once the in-game ramp case is understood.
- **Burst ramp paint check (2026-10-20):** verify-burst runs the server burstUse path (burstCentre → burstFootprint → applyPaint → drainDelta) on every ramp, with reported cell and fallback: all ramp cells change owner and are broadcast. Same ids as client paint planes (paint.ts rampCellIdxFromCanonical ↔ mazeGraph). If ramps look unpainted in preview after b80abd0, the server process is likely still on the old centre-based footprint: restart the preview and check the `[Server] burst … painted N cells` log.
- **Burst on ramps (2026-10-20):** `burstFootprint` checks BURST_PAINT_MAX_DY per walk edge (cell vs the cell it steps from), not vs the centre, so a whole ramp run inside the circle is painted; unconnected stacked levels stay out. Ripple slabs on ramp cells are pitched/yawed to the slope (`burstRipple.ts cellPose`, rampSurfaceY). verify-burst: ramp case + R-aware disc size (was hard-coded 37 for R 3.5).
- **Anvil yaw per dummy (2026-10-20):** each dummy stores its own `yaw` (rolled only in respawnDummy for each dummy / respawnOne for that one) and `place()` applies it every frame it moves; logs `[Dummy i] … yaw N°`.
- **Anvil random yaw (2026-10-20):** every spawn (initial, auto-respawn, key 2) picks 0/90/180/270° on the dummy root; model + collider are children (x offset −0.105 m in local space) so they rotate together around the tile centre. Hitbox/physics unchanged.
- **Anvil colliders (2026-10-20):** anvil GLB's own invisible collision mesh (`Anvil_01_collider`) is on CL_PHYSICS (`invisibleMeshesCollisionMask`), child of the dummy root so it moves with it. Lunge hits are geometric (unaffected); dummy motion uses the walk graph (no raycasts). Burst LOS to a dummy ignores hits within 1.2 m of it (`DUMMY_LOS_SLACK`) so its own collider doesn't block.
- **Territory bar star (2026-10-20):** white star (`assets/images/star_white.png`, 14 px) centred in the leading team's fill when that fill is ≥ 22 px (14 + 4 px padding each side) of the 194 px inner track; none on a tie or 0–0.
- **Territory bar edges (2026-10-20):** red/blue fills rounded only on their outer ends (per-corner borderRadius), square where they meet the white middle.
- **Territory bar style (2026-10-20):** styled after flagtag's drown bar (`flagtag/src/ui/components/ProgressBar.tsx`): 200×22 pill, dark PANEL_BG_SEMI track (0.08,0.08,0.1,0.87), 3 px border padding, rounded white inner track with rounded red (left) / blue (right) fills, 16 px tall. No assets.
- **Territory bar (2026-10-20):** the `RED x% — BLUE y%` pill under the timer (`src/ui.tsx`) is now a 200×24 bar: red from the left (`red%`), blue from the right (`blue%`), white = unpainted; same `coverage()` data and 1-decimal rounding; TEAM_RGB colours. No numbers on the HUD now (the round-end banner still shows them).
- **Dummy ramp sliding (2026-10-20):** `floorAt` in `client/lungeDummy.ts` now uses `rampSurfaceY` (shared/mazeGraph.ts, continuous slope height) for ramp nodes instead of their stepped cell Y (~0.7 m/cell > STEP_UP 0.6, which made uphill slides miss the floor and fall). A grounded dummy also snaps down up to 0.6 m (down-ramps). Falls only off walkable cells; walls/knockback unchanged. verify-lunge has ramp-surface checks.
- **Dummies = anvils, auto-respawn (2026-10-20, supersedes the box/RESPAWN DUMMY chip notes above):** visual is Luke's Creator Hub anvil `assets/asset-packs/anvil/Anvil_01/Anvil_01.glb` (child of the dummy root, ×1.5, x offset −0.105 m, base on the floor, no collider); hit point and sim unchanged. A fallen dummy respawns alone after `LUNGE_DUMMY_RESPAWN_S` = 1 s at a random tile centre (pickSpots, skipping tiles under the other dummies). The RESPAWN DUMMY chip (`client/dummyUi.tsx`) is removed; key 2 still re-rolls all. The Creator Hub Anvil entity in main.crdt / entity-names.ts is left alone and uncommitted.
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
