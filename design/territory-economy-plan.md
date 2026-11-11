# Territory economy — Prototype mode

Plan only. Bot Fight and Team Fight stay as they are. The paint tank, depots, territory respawn, and territory elimination are a new lobby mode, `prototype`, turned on by a flag on that mode. No deploys. `BOT_RECOVERY_ENABLED` stays false. No Decentraland surround.

Base is `main` @ `67db80a`.

Step 1 is the lobby arm, the vote, and the paint tank (capacity 80) with a vertical bar on the right. Depots, territory respawn, and elimination are later. Until those exist, a respawn refills the tank so a round stays playable. The bar is client-predicted and corrected by a per-player `{ tank, denied }` echo.

## Recommendation

Prototype uses **Team Fight's population**. Humans are shuffled across both teams. Bots only fill the short side, same rule as `pvp` today (`setPopulation({ kind: 'pvp' })`, the 1v1 rejoin flip included). It is not humans-together, and it does not use the Bot Fight bot count. Subtitle `Paint Economy`.

Depot awareness, when it is built, still runs only while this mode's `economy` flag is on. Bot Fight bots and Team Fight filler bots stay on today's brain. A balancer bot inside a Prototype round is on the economy, because that round's flag is on.

## Where the rules live today

Paint ownership is a cell, 2 m, not a maze tile and not a parcel. `applyPaint` in `src/server/paintState.ts` flips a cell and returns true only when the team changes. Friendly repaints return false and do not score. The server broadcasts `paintDelta` at 5 Hz with coverage (`src/server/server.ts`, `BROADCAST_HZ`). The client colors from that delta. Walking also paints optimistically in `noteLocalPaintCandidate` (`src/paint.ts`).

Autopaint is the grounded 3×3 in `initPaintingSystem` (`src/paint.ts`). The client flushes ids at 10 Hz (`drainPaintOutbox` → `paintTick` in `src/client/clientHandler.ts`). The server applies them in `room.onMessage('paintTick')` and ignores the message unless `matchLive()`. Cap is `MAX_IDS_PER_TICK` (100).

Dash is off (`DASH_MODE` in `src/shared/pvp.ts`). E is the lunge (`client/lunge.ts`, `LUNGE_DISTANCE` 9.2 m, `LUNGE_LIFT` 0). It does not have its own paint call. While it stays on the floor, the same 3×3 autopaint runs. A straight lunge across fresh cells is about 10–14 new cells. F is Paint Burst (`client/paintBurst.ts`, `burstFootprint` in `src/shared/burst.ts`). Shape is a circle of radius 5 cells. On an open floor that is 81 cells. On twelve real 5×5 mazes the footprint is min 26, p25 55, median 68, p90 80, max 84. The server paints that list in `burstUse` / `burstLand`. Knockback does not read the paint result. Cooldown is `BURST_COOLDOWN_S` (8 s).

There is no paint tank. An empty “wallet” does not exist, so abilities cannot be separated from painting.

The lobby registry is `LOBBY_MODES` in `src/shared/lobby.ts`. Live placed modes are Team Fight (`pvp`, west, cell 1,2) and Bot Fight (`pvb`, east, cell 3,2). Color Garden (2,3) and Pot Hunt (2,1) stay in the list with `live: false, placed: false`. `placeLobbyLayout` (`src/maze/generator.ts`) builds a straight center at `LOBBY_CROSS` {2,2}, rotation 1 (opens east and west), plus one `end` per placed mode. `voteModeAt` counts a vote only inside the end-tile walkable rectangle (`voteZoneLocal`). The center abstains. `pickWinner` (`src/shared/lobby.ts`) gives a tie to the previous mode, otherwise `pvp`. `startNextRound` (`src/server/server.ts`) sets the format with `mode === 'pvb' ? 'pvb' : 'pvp'`, so any other id becomes Team Fight.

The floor swap is `rebuildMaze` (`src/maze/rebuild.ts`). It skips when `gridSize() === 3`. It spawns the non-end tile at full scale, emits `lobby:floor`, then queues every tile whose type is not `cross`. The center straight is not a cross, so it is queued again after the full-size spawn. Signs are `laySigns` (`src/client/lobby.ts`), one per `placedModes()`, plate `SIGN_W_M` 48 × `SIGN_H_M` 8.6, `fontSize` 45, outline 0, text on local −Z, overview scale `signZoomScale`. `SIGN_COPY` is only `pvp` and `pvb`. `modeTitle` / `modeSubtitle` know only those two ids. `setMyVote` (`src/client/phase.ts`) drops anything else. `roundReset` and `roundClock` (`src/client/clientHandler.ts`) coerce format with `format === 'pvb' ? 'pvb' : 'pvp'`. The splash is `getFormatSplash` (`src/round.ts`).

Round length is `ROUND_LENGTH_MINUTES` (3) in `src/shared/roundTiming.ts`. The timer path in `src/server/server.ts` sends `roundEnded`, clears paint, then `openLobby(false)`. The win screen is client-only (`SUMMARY_MS` 10.8 s) and does not hold the floor. Voting works immediately. The center spawn abstains, so the 15 s clock starts only on an end tile.

Fall rescue is not death. `rescueHome` (`src/client/fallRescue.ts`) returns `baseSpawn` for the player’s team. The cloud timings are `RESCUE_PATH` in `src/shared/rescuePath.ts` (grab 0.4 s, rise 2.1 s, cruise 1.7 s, descend 0.8 s). Movement is locked for the ride (`moveLock.ts`). Bots fly to the same base (`placeAtBase` / `pickSpawn` in `src/server/bots/manager.ts`).

The friendly speed bonus is **off**. `OWN_PAINT_SPEED_MULT` in `src/client/speed.ts` is `1`. The comment and `design/gdd.md` still say 1.3×. Players do not have it. Leave it at 1. Do not turn it on for Prototype. No new combat bonus.

The paintable arena is the 5×5 maze, not the 80×80 parcel box. Twelve seeds: 22–25 tiles, 3690–4360 walkable cells (average about 3900). Jog is 8 m/s, so a fresh corridor spends about 12 new cells per second (a 3-wide swath, one new row every 2 m).

## Lobby

Add `prototype` to `ModeId` and `LOBBY_MODES`:

- cell `{ x: 2, z: 3 }` (north of the cross)
- `teamRule: 'balance'`
- `live: true`, `placed: true`
- `economy: true`
- label `PROTOTYPE`

`pvp` and `pvb` get `economy: false`. Garden and pots stay `live: false`, `placed: false`, `economy: false`. Garden’s reserved cell moves off (2,3) to `{ x: 0, z: 2 }`, which is not built and not a vote. Pot Hunt stays at (2,1), on the closed side of the new center.

`placeLobbyLayout` places a **fork** at the cross, rotation 1. Canonical fork openings are N, S, W. One quarter-turn clockwise makes them N, E, W, which is the west end, the east end, and the north end. The north end uses the rotation the placer already computes for `z > cross` (`r = 2`), so it opens south into the fork. Do not place a south tile.

`rebuildMaze` skips when `gridSize() === 4`. The full-size first tile is the fork (`type !== 'end'`), then `lobby:floor`, then the queue is **only** `type === 'end'`. Leaving the old `type !== 'cross'` filter would spawn the fork twice.

Signs: one more root from the same `laySigns` loop. Title `PROTOTYPE`, subtitle `Paint Economy`, same plate, lip, tail, matte material, `fontSize` 45, outline 0, text on −Z. `billboardAnchor` already steps north by `SIGN_CLEAR_M` (10 m) at `baseY + 22`. Overview scale stays `signZoomScale`. Add a plate color that is not team red or team blue. `hudYourVote` already prints `modeTitle`, so the pill reads `Your vote: PROTOTYPE` once `setMyVote` accepts the id.

`startNextRound` must not collapse this id to `pvp` on the wire. Format string is `'prototype'`. Population is the Team Fight branch: `setForcedTeam(null)`, `shuffleTeams`, `setPopulation({ kind: 'pvp' })`, bots fill the short side. Do not set `kind: 'pvb'`. Splash copy comes from `modeTitle` / `modeSubtitle`, not the pvp/pvb ternary in `getFormatSplash` and `nextRoundBlurb`.

Stop coercing the wire format. These sites turn every non-`pvb` string into Team Fight:

- `clientHandler.ts` `roundClock` and `roundReset`
- `phase.ts` `setMyVote`
- `round.ts` `RoundFormat` and the splash
- `shared/events.ts` format union
- `shared/pvp.ts` `RoundFormat`
- `server.ts` `roundFormat` and the `roundClock` vote id list (it is hardcoded `pvp`, `pvb`, `garden`, `pots`)
- `emptyCounts` / `VoteCounts`

`pickWinner` stays: unique leader wins, a tie keeps the previous mode, otherwise `pvp`. Prototype wins when it is the unique leader. Garden still cannot win.

## Gating

One boolean on the mode, `economy`. Tunables live in `src/shared/territory.ts` and are read only when `modeById(roundFormat)?.economy` is true. Bot Fight and Team Fight never call them.

When the flag is off, these stay byte-for-byte in behavior:

- `paintTick` credits every real flip, no wallet
- burst and lunge paint as today; knockback unchanged
- `rescueHome` / bot `pickSpawn` go to the team base
- the round ends only on the 3 minute timer
- bot targeting stays `makeWeightedTarget`

When the flag is on, the sections below apply. The client learns the flag from the format on `roundClock` / `roundReset`, which joiners already receive.

## Rules, smallest change

**Tank.** Server map `userId → remaining`, bots included (`bot:<id>`). Full at round start and on a completed respawn landing. Capacity `PAINT_CAPACITY`. Spending happens inside the existing `applyPaint` callers, not in a second paint system: if the flag is on and the flip would return true, refuse it when remaining is 0; otherwise decrement by 1 and flip. A false return (already ours, or a locked cell) costs nothing. Autopaint, the lunge’s 3×3, and burst all go through that. Burst and lunge knockback run even when the paint list is refused. Area paints that cost more than the tank convert nearest-first until empty: burst already has a centre (`burstFootprint` / `burstCentre`); sort by distance from it. The 3×3 sorts by chebyshev distance of the `col,row` in the cell id from the centre cell. Same inputs, same order. No client-chosen subset.

**Depots.** Four anchors, computed, not placed by hand. Two are the walkable cells nearest `baseSpawn(1)` and `baseSpawn(2)`. They start owned. At round start the server paints those two anchor cells with `applyPaint` and does **not** add score or spend a tank (painter id `depot`). `DEPOT_NEUTRAL_COUNT` more (default 2, allowed 3 or 4) come from `graph.deepNodes`, off base tiles, at least `DEPOT_MIN_SEPARATION_M` from each other and from the starts. Score is `-|dist(red base) - dist(blue base)|`, then farther from both starts. Tie-break is the cell id. Same seed, same maze, same list on server and client, so positions need no message. Ownership is the anchor cell’s team. Neutral anchors start unpainted. A flip of that cell is the capture. Standing on a friendly anchor refills at `PAINT_REFILL_PER_SEC`. Neutral and enemy anchors do not. Do not scale refill by nearby paint.

The server does not have a match position stream. `paintTick` gains an optional `at` cell (the cell under the feet). The 10 Hz flush already exists. With paint left, `ids` are the 3×3 and `at` is the centre. With an empty tank, send `ids: []` and `at` so a player standing on a depot still refills. The server refills only when `at` is a friendly anchor. This trusts the client the same way `paintTick` already does.

**Respawn.** Keep the cloud. `rescueHome` stops hardcoding `baseSpawn` when the flag is on. The rider rises in place (grab + rise is 2.5 s). The server answers with a cell before the cruise: a friendly cell in `deepNodes`, not on the outer edge, no enemy within one graph step of a known position (bots are server-side; humans use the latest `at` from `paintTick`). Prefer the closest such cell to the catch. Tie-break the cell id. Full tank when the descend finishes, not when the cloud picks them up. Bots use the same picker instead of `pickSpawn`’s base list, and only in this mode.

**Win.** Extract the timer’s end block (personal `roundResult`, `roundOwners`, `roundEnded`, `clearPaintState`, `openLobby(false)`) into one `endRound`. The timer still calls it at 3 minutes. The flag also calls it immediately when a team has zero painted cells and zero living players. Living means not in the cloud and not held waiting. Most tiles at the timer still wins. Equal cells, including both teams at zero, is the same tie the banner already shows.

**HUD.** Tank number on the existing score bar in `src/ui.tsx` (the territory pill under the clock), team-coloured, hidden in the lobby and in non-economy rounds. A short “refilling” state while `at` is a friendly depot and the tank is not full. Depot marker: a small post at the anchor, colored by the cell team (neutral stays light). Capture reuses `playClaimSfx` plus a one-shot scale pulse when a depot anchor arrives in `paintDelta`. A waiting rider sees “No territory” instead of a silent hover. Desktop and mobile both read the same React HUD. No new buttons. Lunge and burst inputs unchanged.

## Sync

The server is the only spender. The HUD does not wait for the round trip.

The client keeps a predicted integer. A flip it believes it can pay for still optimistic-paints and decrements. At 0 it does not enqueue and does not paint locally, but it still sends `at`. The 5 Hz tick, only to that player, and only when the integer changed or a requested cell was refused, sends `{ tank, denied }`. Denied cells revert to the team the client had before the optimistic paint. Accepted cells are the ones already in `paintDelta`. Burst color is already server-driven (the ripple is separate), so a short tank just shrinks the painted set. Refill predicts locally while the client thinks it is on a friendly anchor, and snaps to the server integer. That is the same 200 ms echo paint already has. No new broadcast rate. Other clients do not receive wallets.

## Edge cases

All of these are economy-only. The round lifecycle stays the one from `8f39b33`: end, clear paint, lobby floor immediately, win screen on the client, vote clock idle until someone stands on an end.

**Last friendly cell flips while a rider is waiting or cruising.** The server sends a new cell if another friendly deep cell exists. If none does, the cloud holds at cruise height, movement stays locked, and paint stays off. They are not dropped on the base, which may now be enemy. If every player on that team is in that hold and the team owns nothing, `endRound` runs. A player who already landed is alive on whatever they stand on; only the hold is blocked.

**Unsafe tiles.** The picker never returns a non-deep cell, a cell next to a known enemy, or a cell whose graph neighbours are missing. If the only friendly cells are edges or adjacent to an enemy, it returns none and the rider holds. That is stricter than dropping them on the base.

**Both teams eliminated together.** One flip cannot zero both teams, because the painter gains the cell. It can happen if the last living players of both teams are already in the cloud and the map has no paint. `endRound` with equal coverage. No winner. Lobby opens the same way.

**Late joiner, team owns nothing.** `teamAssigned` still assigns them with Team Fight's balancer (short side, including the 1v1 flip). Do not `teleportHome` onto `baseSpawn`. Hold them on the cloud until the picker has a cell, then deliver them with a full tank. If the round ends first, they get the lobby and the win screen like any other joiner, and they do not get a missed banner from before they connected (`round:ended` is not replayed). A late joiner whose team still owns a safe cell is delivered there, not to the base.

**Joiner during the win screen.** The floor is already the lobby (`openLobby(false)`). They vote. They do not enter a Prototype match until the vote resolves.

## Bots

No new personality and no change to `makeWeightedTarget` for Bot Fight or Team Fight.

In Prototype only, before the usual think in `src/server/bots/manager.ts`: if the bot’s tank is under `BOT_REFILL_AT` (a quarter of capacity), path to the nearest friendly anchor and stand there. The same refill tick that serves players fills them. When the tank is above that line, add `DEPOT_TARGET_BONUS` inside the existing `stampValue` score for a neutral or enemy anchor, so capture competes with ordinary paint and chase without a new weight. Burst-for-paint already bails out when the footprint is mostly ours; it also bails out when the tank cannot pay the nearest cell. Knockback and lunges stay. `BOT_RECOVERY_ENABLED` stays false: a bot shoved off an edge rides the cloud and uses the territory picker, it does not glide back.

## Numbers

Do not start at 15–20. One burst into fresh paint spends the cells that actually flip. The median footprint is 68 and a cramped one is still 26, so 15–20 is gone on the first F even when the corridor clips the circle. Walking spends about 12 per second, so that same tank is also about one second of autopaint.

Start at **capacity 80** and **refill 16 per second** (full in 5 s of standing on a friendly depot). 80 is one open burst (81) with a couple of cells spare, or about six seconds of jogging on fresh paint, or several lunges. F still knocks back at 0. The tank is what stops the paint, not the fight.

Elimination on the 80×80 parcel box is the wrong picture. The paintable set is about 3900 cells. One player jogging for the whole 3 minutes covers about 2160 new cells if they never turn around and never repaint. Two living teams painting each other will not hit zero often. After a wipe, the survivors only have to repaint the dead team’s cells. At a median burst of 68 every 8 s plus walking, a few hundred leftover cells are a short job. Keep elimination. Expect the timer to end most Prototype rounds, and elimination to matter once a team is stuck in the cloud.

## Tests

`scripts/verify-lobby.ts` today requires 3 tiles, a straight center, placed ids `pvp,pvb`, and garden/pots present but not voting. Update it, and don’t weaken the Bot Fight / Team Fight checks:

- 4 tiles. Center is a fork at `LOBBY_CROSS`, rotation 1, openings north, east, and west. `validate()` passes. Each end opens toward the fork. No south end.
- Spawn point `lobbyFeet` lands on a walkable fork cell, and `voteModeAt` there is `''`.
- Prototype’s tint centre votes `prototype`. A point on that end outside the inset rectangle does not. Team Fight and Bot Fight tints still vote only themselves.
- Garden and pots are still in the registry, not placed, and their cells do not vote. Garden is no longer (2,3).
- `modeTitle` / `modeSubtitle`: `BOT FIGHT` / `vs Bots`, `TEAM FIGHT` / `vs Humans`, `PROTOTYPE` / `Paint Economy`. `economy` is true only on `prototype`.
- `signZoomScale(29)` is still 0.3. Prototype’s anchor is 10 m past the north edge at `baseY + 22`.
- `pickWinner`: a prototype lead returns `prototype`. A tie with `pvp` still prefers the previous mode, otherwise `pvp`. A garden count cannot win. `emptyCounts` includes `prototype: 0`.
- The rebuild source skips on `gridSize() === 4` and queues `type === 'end'` only.
- `setMyVote('prototype')` sticks. `setMyVote('garden')` does not.
- Vote clock, AFK, frame checks (`eighty` included), and the “no summary wait” needles stay.

New `scripts/verify-territory.ts`, pure, no scene:

- A flip spends 1. An already-friendly cell spends 0. At 0, nothing flips.
- A list longer than the tank converts nearest-first and is stable across two calls.
- Depot picker: two neutrals by default, none on a base tile, separation holds, red/blue graph distances differ by at most a small bound, same seed twice matches.
- Respawn picker skips edge cells and cells beside an enemy, returns null at zero friendly cells, and returns a cell again after one friendly cell is painted.
- `endRound` condition: zero cells and no living player fires; zero cells with someone still walking does not; both teams empty is a tie; a timer with unequal cells still picks the leader.
- With `economy: false`, the spend helper is not consulted (the pvp/pvb mode defs say so, and a dry call with the flag off flips without decrementing).

Run `verify-lobby`, `verify-territory`, and `verify-water` so the lobby floor change did not move the sea. `verify-bot`’s wall-shove failure is pre-existing. Do not “fix” it. Do not enable edge recovery.
