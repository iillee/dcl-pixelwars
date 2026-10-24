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
- **Lunge feel pass (2026-10-23, Oct 21 playtest):** still a short shoulder charge. Hit box unchanged (reach 1.7 m). `VICTIM_SPECULATIVE_KNOCK` unchanged.
  - Telegraph: slash width 2.2 → 3.0 and the plane is square (`LUNGE_SLASH_DEPTH_FRAC` 1, was a squashed width/2) so the tip meets the hitbox far face; hold 0.18 s then fade 0.18 s (first feel pass was hold 0.30 / fade 0.24; the old blink was fade 0.12 s with no hold, straight after the 0.20 s charge). Crescent tips (`lunge_slash.png`) pinch to a point: arm width and alpha fall to 0; the crown is unchanged. No hit-volume mesh: `LUNGE_HITBOX_VISIBLE` stays false, press flash removed.
  - Tile bump: up 0.07 → 0.12 s, down 0.14 → 0.30 s. `DASH_TILE_AHEAD` 2 (was the 3×3 only) so the wave includes the cell in front of the paint row; that row leads (`DASH_TILE_AHEAD_DELAY_S` 0.02) and the extra cell follows 0.08 s later.
  - Hit vs miss: team pop end scale 5.0 + white core 2.2 + louder boom at chest. Miss is three grey puffs ~0.85 m ahead, no boom.
  - Power: impulse 48 → 56 (target travel 8 → 9.2 m), knock 93 → 108, lift 10 → 12, force 38 → 44, ghost shove 6 → 7. Active time, cooldown, and hit reach unchanged.
  - Recovery: walk-only lock stays 0.20 s. Readable from the slot only — desktop amber `LOCK` text, mobile slot tinted amber — plus a click. No feet disc, sphere, ring, or hitbox mesh. Paint is not newly gated.
- **Aerial Burst (2026-10-23, same F charge):** grounded Burst is unchanged (radial paint + outward knock). Airborne F is a downward spike only. Cylinder `AIR_SPIKE_RADIUS` 2 m, `AIR_SPIKE_DEPTH` 5.5 m, `AIR_SPIKE_MIN_ABOVE` 1.0 m. Player in the cylinder: downward impulse `AIR_SPIKE_DOWN` 110, outward `AIR_SPIKE_OUT` 18, brief lunge-style control lock. A miss that lands paints the ground-Burst footprint once (see landing note). A miss over the void does not paint. Shared `BURST_COOLDOWN_S` 8. No hitbox cube, disc, or brace sphere. Speculative knock uses the spike direction; ImpactGate still blocks the second shove.
  - Feedback: airborne press dives (`AIR_SPIKE_DIVE_IMPULSE` 48 down, forward 8, force 70 for 0.22 s). The dive reads as team motes falling the commit (`AIR_SPIKE_TRAIL_*`, same sphere family as the ground Burst puff) — not a Lunge crescent. The press does not play `air_spike_dive.wav` (that plus the landing `burst_impact` was a second burst). `air_spike_hit.wav` still plays on a player connect. Ground Burst does not dive and still uses `burst_impact.wav`.
  - Landing (2026-10-24): on a **miss**, when the feet meet the floor inside `AIR_SPIKE_STAMP_WINDOW_S`, every client plays the grounded shockwave once (`showShockwave`: tile ripple, outward motes, `burst_impact.wav`). The diver hears the camera-parented copy only; everyone else hears one positional copy. An own echo does not play it again. The attacker sends `burstLand`; the server paints that spot once with the same `burstCentre` → `burstFootprint` → `applyPaint` path as a ground Burst (`SERVER_BURST_LAND_WINDOW_S`, `BurstLedger.claimPaint` rejects a second call). No second knock, no 5-tile cross. A miss that never meets the floor does not paint, and the full dive (impulse + downward force) keeps going.
  - Connect (2026-10-24): no ground-burst VFX or paint. Recovery is `AIR_SPIKE_KEEP_FRACTION` 0.22 of (measured fall + dive impulse): the dive impulse is applied and a smaller upward cancel leaves a net downward speed, no hop (`AIR_SPIKE_HANG_S` 0). Glide stays shut `AIR_SPIKE_RECOVER_GLIDE_S` 0.35 s unless `AIR_SPIKE_RECOVER_GLIDE`. Victim spike is unchanged (`applyAirKnock` once, glider shut for `AIR_SPIKE_GLIDE_LOCK_S`).
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
- **Load-in fix (2026-10-20):** the maze seed reached clients only via the client-written SeedHolder CRDT (or the next roundReset); if a server was alive but that CRDT never arrived (e.g. fresh server after a deploy), late joiners waited forever with no maze and fell/respawned endlessly. The server `snapshot` now carries `seed` (round index) and the client builds from it (`ensureMazeSeed`), and retries `requestSnapshot` every 6 s until one arrives. Sky: invisible static pads under both base spawns until `isMazeReady()`; fall-respawn suppressed until then.
- **Anvil prediction rollback fix (2026-10-20):** the first server snapshot of our hit trails the local sim by ~RTT of travel (≈2 m at knock speed for 100 ms), so blending to it rolled the anvil back. Now, if that snapshot is on our path and behind us (≥ −0.1 m along, ≤ 0.5 m sideways), the anvil stays on the local sim ("confirmed") until the server anvil stops (then a tiny blend), another slide id arrives, or `ANVIL_PREDICT_CONFIRMED_MAX_S` 4 s. Off-path/ahead/rejected → old fast blend. verify-lunge checks the lagged-server trajectory.
- **Anvil hit prediction (2026-10-20):** our own lunge/burst hit on an anvil also knocks a local AnvilWorld copy at once (same normalised dir + burst multiplier as the server); the anvil renders from that copy until a server snapshot with a new `slide` arrives (or `ANVIL_PREDICT_TIMEOUT_S` 0.5 s, e.g. rejected hit), then blends from the predicted spot to the server state over `ANVIL_BLEND_S` 0.2 s (error ≤ `ANVIL_PREDICT_CLOSE_M` 1 m) or `ANVIL_BLEND_FAR_S` 0.12 s; respawn snaps. Other clients: unchanged snapshot rendering. Launch uses the predicted pos/vel and keeps per-slide dedupe across reconcile.
- **Shared anvils (2026-10-20):** server-owned. `shared/anvilSim.ts` AnvilWorld (spawn picker w/o bases + Sky teleporter squares, per-anvil yaw, slide sim w/ ramp floor, fall, 1 s auto-respawn) runs in `server/anvils.ts` (re-rolled after each `rebuildBotGraph`). Clients send `anvilHit {kind 0 lunge / 1 burst, id, i, dx, dz}` → server dedupes via the existing LungeLedger / BurstLedger (`anvil:i` target, same window/stale rules) → knock (burst × BURST_KNOCKBACK/LUNGE_KNOCKBACK). Key 2 → `anvilRespawn` (1/s per player). Server broadcasts `anvilState` (all anvils: pos, vel, yaw, alive, moving, slide) at 10 Hz while any moves (+1 final frame), on spawn changes, and every 2 s keep-alive. `client/lungeDummy.ts` only renders (exp. smoothing toward snapshot + ≤150 ms velocity extrapolation, snap > 3 m / on respawn; collider follows) and does the victim-side launch (dedupe per `slide`). LUNGE_DUMMY_COUNT 4 → 2.
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

## 8. Rounds, summary, HUD restyle, mobile (2026-10-20 evening → 10-21)

Handoff for this block: [`docs/HANDOFF-UI-2026-10-21.md`](HANDOFF-UI-2026-10-21.md). Reference (what exists, where, tunables):

### Robustness
- `src/shared/safeSystems.ts` (imported first in `src/index.ts`) wraps every `engine.addSystem` in try/catch + throttled log, so one throwing system no longer aborts the frame and comms (the "frozen frame" / server-silence symptom). `shared/anvilSim.ts` substeps capped at 40 and non-finite dt dropped; `shared/mazeGraph.ts` `findPath` loops capped. Server logs dropped paintTick / burstUse / anvilHit (`logDrop`).

### Rounds and sky
- `ROUND_LENGTH_MINUTES = 3` (`src/shared/roundTiming.ts`, UTC-aligned). Day/night per round (`shared/dayNight.ts`, `client/skybox.ts`): even round = day, odd = night.

### Anvils
- Slow push: walking/running into an anvil creeps it. Client (`client/lungeDummy.ts` `checkPush`) sends `anvilPush` intent; server moves it through `AnvilWorld.push` (wall-aware, falls off edges). `ANVIL_PUSH_SPEED` 0.6 m/s, `ANVIL_PUSH_RUN_MULT` 1.5, `ANVIL_PUSH_REACH` 1.35 m, `ANVIL_PUSH_FACING` 0.5, `ANVIL_PUSH_SEND_HZ` 10, `ANVIL_PUSH_HOLD_S` 0.25 (`shared/pvp.ts`).

### Overview (overhead) camera — `client/overviewCamera.ts`, `client/overviewUi.tsx`
- `OV_YAW_DEG = 45` (axonometric; was briefly 0 in 1f32cb3, restored a30c35c). Rotate steps 90°.
- Zoom scale: desktop 15..90 step 10, default 55. Mobile exactly 3 levels 5 / 15 / 25, starts at 5 on every toggle-on. Limits are read live (`scaleMin/Max/Default()`) because `isMobile()` resolves async.
- Mobile auto-start: once `isMobile()` resolves, overview turns on. `exitOverview()` (respawn / round reset / teleport orbs) keeps the player's intent and mobile re-enters after `MOBILE_RESUME_S` 1.0 s unless the player turned it off with the eye.

### Per-player stats (server)
- `server/paintState.ts`: `cellPainter` map = last painter per cell (players by address, bots `bot:<id>`); `applyPaint(…, painter)` at all call sites; `ownerCounts()`.
- `server/roundStats.ts`: KO/death rules. A fall is a death; it's a KO for whoever last hit the victim (lunge / burst / dash impact) within `KO_WINDOW_MS` 4000; an anvil launch credits whoever last touched (hit/push) that anvil within `ANVIL_CREDIT_MS` 4000. Cleared each round.
- Messages: `roundOwners` (sent just before `roundReset`, top 60 rows: id, team, name ≤16 chars, cells owned, kos, deaths, painted) and `requestStandings` → `standings` (same rows, mid-round). Client → server: `anvilLaunched`, `playerFell`.

### Round-end summary — `src/ui.tsx` (`RoundSummary`, `TeamCard`), timing `src/round.ts`
- Score bar grows (0.4 s) into: title "TEAM WINS!" / "IT'S A TIE" (team word in team colour, WINS! white, plain labels, 72 px × scale, fit to 90% of screen width on one line, subtitle in flow with a plain-words phone fallback), territory pill (red | unpainted | blue, % labels pinned to the bar ends, integers unless equal → 1 then 2 decimals), two team tables (TERRITORY/AREA, TILES, KOS, DEATHS; MVP chip on top painter; self row outlined). Tables top-aligned, side by side or stacked on phones (`tablesLayout`), pill width = tables width. Hold `SUMMARY_HOLD_S` 10 s, click anywhere to close. No backdrop (removed everywhere: '100%' of the 1920×1080 virtual canvas doesn't reach phone edges).
- Tunables: `SUMMARY_TITLE_FONT` 72, `SUMMARY_PILL_H` 48, `SUMMARY_PILL_FONT` 30, `SUMMARY_CARD_W` 580, `SUMMARY_CARD_GAP` 40, `SUMMARY_ROW_H` 44, `SUMMARY_CARD_ROWS` 10 / `_SMALL` 4, `SUMMARY_FONT_MIN` 12, `SUMMARY_FIT` 0.94, `SUMMARY_K_MAX` 1.6, `SUMMARY_K_READ` 0.75.

### Live team lists
- Click the score bar mid-round: it becomes the big territory pill heading the same team tables (live via `requestStandings` every `STANDINGS_REFRESH_MS` 3 s), placed under the clock; click again to close.

### Light HUD style
- One light colour `PANEL_LIGHT` (white) and key-tile frame constants exported from `client/abilityHotbar.tsx`: `RADIUS` 18, `BORDER_W` 4 (light rim `GOLD_BORDER`), `TILE_RING` 6 (dark ring `SLOT_BG`). Used by the clock, score bar fill, summary tables, top painters, overview/top buttons.
- Desktop clock: single framed panel, star + eye column left, mute right; overview +/−/rotate pop out to the left. Mobile top row: star | mute | timer | eye (separate 68 px `TileButton`s, `MOBILE_TIMER_W` 200), overview rotate | + | − grow right of the eye, score bar spans the row (`MOBILE_TOP_W`).
- Top painters (star): desktop all rows, custom drag scrollbar (`LB_*`, PrimaryPointerInfo drag), backdrop; mobile top 10, no scrollbar, no backdrop, tap board/✕ to close. Gold rank chips 1–3.

### Mobile controls
- Lunge/Burst as circles stacked above the native jump button (`client/abilityHotbar.tsx`): `JUMP_CX_RIGHT` 150, `JUMP_CY_BOTTOM` 90, `JUMP_D` 170, `CIRCLE_D` 140, `CIRCLE_GAP` 12, `CIRCLE_X_OFFSET` 70, `CIRCLE_RING` 6, `CIRCLE_ICON_FRAC` 0.72. Gold ring when ready, dark otherwise, seconds while cooling, no labels. Burst uses `assets/images/burst_solid.png` (hard-alpha copy of burst.png).
- `client/touchControls.ts`: `TouchScreenControls` hides native E, F, pointer and 1–4; only joystick + jump remain.

### Burst emote
- One-shot ground punch (`BURST_EMOTE_SRC`, `BURST_EMOTE_S` 0.467): movement held `BURST_EMOTE_FREEZE_S` 0.3 s (via lunge.ts `holdForEmote`, shares its InputModifier) so running can't cancel it; `stopEmote` at the end. Looping hold pose removed.
