# Physical lobby — plan

Status: planning only. Branch `physical-lobby` is `bots-water` @ `7460a8c` (20×20, sea off) plus this note. No gameplay code yet.

Replace automatic PvP/PvB alternation with a lobby that replaces the arena in place. The between-round regen builds it from the existing tiles: a center cross, a straight arm off each side, and a voting end on each arm. Standing on an end is the vote. The cross and the straights abstain. Phase A is the only thing to build first: two ends can win (PvP, PvB), a 15 s vote, idle when nobody votes, and mid-match joins unchanged. The other two ends are visible and cannot start a match until Phase B. No team-select screen and no P2E.

## 1. What exists today

Round lifecycle and mode flip live in `src/server/server.ts`, with the clock in `src/shared/roundTiming.ts` and the flip rule in `src/shared/pvp.ts`.

- A round is active for `ROUND_INTERVAL_MS` (3 min). `setRoundState` / `isRoundActive` are the switch everyone reads.
- When the clock hits zero and someone is present (`presentCount`, fed by `presencePing`), the server sends `roundEnded`, freezes the clock, and sets `intermission = 'summaryWait'` for `SUMMARY_MS` (~10.8 s). The maze stays up.
- When the summary ends, `startNextRound()` runs. `nextRoundFormat` flips `pvp` ↔ `pvb` because `FORMAT_ALTERNATE` is true. A cold start or an idle start does not flip: it forces PvP.
- `startNextRound` then reshuffles teams (PvP) or stacks humans on one colour (PvB), sets the bot population, broadcasts `roundReset` with the format string, clears paint, rebuilds the bot graph, and starts the clock.
- If the summary ends with nobody present, or a round ends with nobody present, `intermission = 'idle'` and nothing starts.
- Idle does not wait. `presencePing` and `joinRoster` call `ensureRoundStarted`, which starts PvP immediately. That is the behavior the lobby replaces.
- The summary UI in `src/ui.tsx` shows `nextRoundBlurb()` from `src/round.ts`, which is hard-coded to “Next round: PvP/PvB”.

Arena generation and replacement:

- The play grid is always 5×5 tiles (160 m), centered in the scene. On this branch the scene is 320 m (20×20 parcels, base `0,0`), so the empty margin is 80 m. See `SKY_EDGE_INSET` in `src/maze/level.ts`.
- `roundReset` → client `round:reset` → `SeedHolder` → `rebuildMaze` in `src/maze/rebuild.ts`. Tiles grow in staggered (0.03 s). Teardown is 25 entities a frame. Team-base tiles are persistent: they are not torn down, so someone standing on a base keeps a floor.
- The server builds the same maze in `rebuildBotGraph` (`src/server/bots/manager.ts`) for the walkable graph. Anvils re-seat from that graph via `anvilsMazeChanged`.

Spawn and positioning:

- Sky mode teleports the local player to their team base on team assign, on `round:reset`, and when a fall rescue finishes (`src/client/player.ts`, `movePlayerTo`). Scene.json’s default spawn is the red base.
- The server does not have a general view of player positions. `messages.ts` says so on `dashHit`. Feet are reported only as `botAim`, and only while a bot exists (`src/client/botVisual.ts`). Combat messages carry an attacker position, which is not a standing sample.

Sync:

- One room schema in `src/shared/messages.ts`, registered on both sides. Round sync is `roundClock` (`idx`, `remainingMs`, `active`, `format`), resent every 5 s while a round is active, plus addressed copies on join and snapshot.
- `roundEnded` opens the summary. `roundReset` carries the seed and the format for the splash.

Paint and combat gates:

- `paintTick` is dropped when `!isRoundActive`.
- Lunge, Burst, anvil hit/push, dash, and bomb do **not** check `isRoundActive`. They check ability mode and team. During today’s summary the maze is still there and those messages still apply.
- Anvil simulation ticks every server frame (`src/server/anvils.ts`), independent of the round clock.
- Bots tick only while `isRoundActive()` (`tickBots`). Clients reap a bot when it disappears from `botPositions`.
- `markActive` (paint, lunge, burst, bomb) is the 60 s “this human is playing” window. Bots fill from that. A lobby sample must not call it.

## 2. Smallest Phase A

### Where it sits

The lobby is not a second place beside the arena, and it is not a pile of boxes. It is the layout the existing between-round regen builds, in the same 5×5 grid the arena uses. Then a second regen builds the arena.

`idle | summaryWait` becomes `idle | summaryWait | lobby`.

1. Round ends → `roundEnded` and the existing summary. The arena stays up for `SUMMARY_MS`, so the result is not playing over a floor that is being deleted. Combat is gated for this window too.
2. Summary ends and someone is present → the regen that today calls `startNextRound` runs instead as a **lobby layout**. Same message path as `roundReset` (`SeedHolder` → `rebuildMaze`), with a layout flag. Teleport to the center cross, not the team base. Do not reshuffle teams, start the clock, rebuild the bot graph, or seat anvils.
3. The 15 s countdown starts once the center cross is walkable, not on the regen message. At 0 the server counts votes.
4. A winner → a second regen, today’s `startNextRound`: arena seed, team shuffle or PvB stack, bots, anvils, `roundReset`, clock. One arena build per match, which is what the game already pays, just after the vote instead of at the summary.
5. Zero votes → stay `idle` **on the lobby tiles**. Do not regen again. The first human vote starts a **5 s** countdown. If every vote disappears, cancel back to `idle` without a rebuild.
6. Cold start is the same lobby regen, not `ensureRoundStarted`. `presencePing` and `joinRoster` must stop starting a match. A ping only proves presence.

`isRoundActive()` stays false for summary, lobby, and idle. `FORMAT_ALTERNATE` stops choosing the mode. Tie: keep the previous mode if it is one of the tied ids, else the lowest registry order (PvP). Zero players: clear votes and stay idle. `onLeaveScene` drops that player’s sample.

### Geometry

Nine existing tiles, placed by a fixed `placeLobbyLayout()` in `src/maze/generator.ts`, then drawn by the current `rebuildMaze` queue (same GLBs, colliders, stagger, teardown). No BFS, no `generateWithRetry`, no new meshes.

On the 5×5 grid (cells 0–4, 32 m each, centered in the 320 m scene):

| Cell | Tile | Role |
|---|---|---|
| (2,2) | `cross` | Plus-shaped center. Abstain. |
| (2,3) (1,2) (2,1) (3,2) | `straight` | One arm off each side of the cross. Abstain. |
| (2,4) (0,2) (2,0) (4,2) | `end` | End of that arm. The voting zone. Opening faces back toward the cross. |

That is the whole play grid’s middle row and middle column. Corners stay empty, including today’s bases at (0,0) and (4,4). Phase A builds all four arms so the layout does not change later. Only two ends can win: west PvP, east PvB. North and south are in the registry as not startable, labeled, and showing a count. Phase B flips those two ids on. It does not add tiles.

Labels and the live count sit on the end tiles (`TextShape`) and on the HUD. The HUD is what mobile can read. The end tile is 32×32 m, so the zone does not need precision.

`spawnCellsForTile` is skipped for a lobby layout. The tiles are floors only. A paint mask on them would be a second paintable arena.

Falling off an end: do not run the match rescue (it flies to a team base that is not in this layout). Teleport back to the cross.

### Votes

New client → server message `lobbyPos { x, y, z }`, sent at 2 Hz only while the phase is `lobby` or `idle`. The server rate-limits to 2 Hz and ignores it during a match. It does not call `markActive`.

The server stores one sample per connected human: position, time, and the zone it computed. The zone test is server-side XZ against the four end-tile footprints from the same `placeLobbyLayout()` the client built. The cross, the straights, and anywhere else abstain. Bots never send `lobbyPos`. A sample older than 1.5 s does not count. `onLeaveScene` deletes it.

AFK rule, so a frozen body cannot chain matches: a lobby session anchors everyone on the cross (the teleport). A sample counts only if that player has moved at least 1.5 m from their anchor during **this** session and is currently on an end tile. The next session resets the anchor to the cross. An idle player who never walks never votes again. A teleport that fails and leaves them on an end also does not count until they move.

### Sync

Extend `roundClock` rather than adding a second clock. New fields:

- `phase`: `match | summary | lobby | idle`
- `voteMs`: remaining countdown, 0 when idle
- `votes`: array of `{ id, n }`, ids from the registry (`pvp`, `pvb` in Phase A)
- `winner`: `''` until the server has picked

Broadcast on every phase change and every 1 s while `lobby` or `idle`. Addressed copy on join and snapshot, same as today’s clock. Clients render counts from this message only. They never send a zone id.

### Gates

One helper, `combatOpen()`, true only in `match`. Use it at the top of `paintTick`, `lungeStart`, `lungeHit`, `burstUse`, `burstLand`, `burstHit`, `anvilHit`, `anvilPush`, `anvilLaunched`, `bombDrop`, `dashHit`, and `playerFell`. On leaving `match`, clear lunge/burst ledgers, pending bombs, and rescue riders, and send `rescueEnd` for anyone still riding.

Client: `isLungeEnabledNow` / `isBurstEnabledNow` also require `phase === 'match'`. Anvil push and the paint outbox already stop being useful if the server drops them; still stop sending.

Anvils: skip `world.tick` outside `match`, and send one empty `anvilState` so dummies disappear. Bots: keep `tickBots` behind `isRoundActive()`, and send one empty `botPositions` when the lobby opens so ghosts are reaped. Do not call `rebuildBotGraph` until the match actually starts.

### Joins

- `match` active: today’s path. PvP keeps the short-team flip. PvB keeps `setForcedTeam` so the joiner lands on the human colour. No lobby teleport.
- `summary`: send the clock, do not start a round, do not open the lobby early. They see the result, then move with everyone else.
- `lobby` or `idle`: do not assign a new match team and do not call `ensureRoundStarted`. Send `roundClock`. Client teleports to the center. Team shuffle still happens once, inside `startNextRound`, when a mode wins.

## 3. Concerns

**World size.** Burst lag tracked parcel count, not the sea. `7460a8c` (20×20, 400 parcels) is the fast build; 100×100 and 300×300 were slow with the sea off. This branch must not change `WORLD_SIZE` or `scene.json`. The nine lobby tiles sit in the existing 5×5 grid.

**Two regens per cycle, and the floor gap.** Today the summary holds the arena, then one `rebuildMaze` tears it down and grows the next one. The lobby inserts a regen at that same moment and a second regen after the vote. The arena grow still happens once per match. The new work is tearing the arena down early and building nine lobby tiles, then tearing those nine down when the arena grows.

`rebuildMaze` deletes first (25 tiles a frame, and each tile’s paint cells with it) and then grows replacements from scale 0.001 over 500 ms, staggered 0.03 s apart. A 5×5 maze is a few dozen tiles, so the outgoing arena is gone in a frame or two. Nine lobby tiles are about 0.24 s of stagger plus the 500 ms scale-up. That is the hole: colliders disappear before the new floor exists. Today nobody falls through it because sky bases are persistent and the round-reset teleport lands on them. The lobby does not include (0,0) or (4,4), so those bases must be torn down too, and the teleport target (the cross) is one of the tiles being created. Reuse the spawn and teardown functions, but for a layout change spawn the center cross at full scale and teleport onto it before the rest of the teardown. Start the 15 s when that cross is walkable (`isRebuilding()` false is not enough, because the last tile is still scaling). Do not run `generateWithRetry` for the lobby. That search tries up to 500 full sky mazes; `placeLobbyLayout()` is nine `placeTile` calls.

**Persistent tiles and the seed.** `isPersistentTile` keeps the two sky bases across every rebuild. Leaving them up during the lobby leaves two extra floors in the corners. A layout change has to clear `persistentSet` and queue those entities for teardown, then let the next arena rebuild latch them again. Lobby tiles must not latch as persistent, or the following maze would keep a cross where it wanted something else. `SeedHolder` and snapshot `seed` currently call `ensureMazeSeed`, which would grow an arena on top of the lobby if a late joiner arrived mid-vote. Ignore that seed unless `phase === 'match'`.

**In-place swap, rest of the leak.** Same grid means same cell ids. Skipping `spawnCellsForTile` on the lobby layout is what keeps the lobby from being a paintable maze. `rebuildBotGraph` and `anvilsMazeChanged` must not run on the lobby regen or they will walk and seat combat props on the cross. Fall rescue still aims at the team base; during the lobby its target is the cross.

**`server.ts` is the state machine.** The phase, the join branches, and the combat gates are all in one large file. The change is localized, but a missed gate is a combat leak. The helper has to be the only check, and a verify script should assert every combat handler mentions it.

**No server-side positions today.** Zone votes need `lobbyPos`. Reusing `botAim` would require bots to exist during the lobby and would feed the aim system. Don’t.

**`markActive`.** If a lobby sample or a lobby ping refreshes the 60 s window, the next PvP round will treat AFK lobby standers as active humans and spawn fill bots against them.

**Anvil and bot systems are not fully slaved to the round clock.** Anvils tick anyway. Bot visuals linger until an empty `botPositions` arrives. Both need an explicit “lobby opened” flush.

**Summary still has a live maze for ~11 s.** Gates must cover `summary` too, or the last lunge of the round lands during the banner. The lobby regen waits until that summary ends so the result is not playing over the teardown.

**15 s vs 5 s.** After a finished round the lobby always runs 15 s, then goes idle if nobody voted. Idle (including first connect) does not run 15 s. The first real vote starts 5 s. Cancelling when the last vote leaves has to clear `voteMs` on the next broadcast so clients don’t show a stale timer.

**Mid-lobby team colours.** Nametags still show the previous match’s team until `startNextRound` reshuffles. That is fine for Phase A. Don’t reshuffle on lobby join.

**Mobile.** World text is not enough. The HUD countdown and the four counts have to be readable. Each voting end is a full 32 m tile, so it does not need a precise step.

## 4. Size and commits

Phase A is one feature, not a rewrite. The heavy edit is the intermission in `server.ts` plus teaching `rebuildMaze` to swap layout without dropping the floor. Roughly six commits, each shippable on this branch:

1. `src/shared/modes.ts` — registry of `{ id, label, color, teamRule, live }`. Phase A: `pvp` and `pvb` live, `garden` and `pots` present and not live. `teamRule` is `'balance' | 'humans-together'`.
2. `placeLobbyLayout()` and a layout flag through `roundReset` → `rebuildMaze`. Same spawn queue. No paint cells. Center cross spawned full-size before teardown. Persistent bases cleared on the way in and latched again on the arena regen.
3. Server phase machine: summary → lobby regen → vote → arena regen or idle. 15 s / 5 s. Stop auto-start on ping and join. No bot graph and no anvils on the lobby regen.
4. `roundClock` fields + `lobbyPos`. Summary line no longer promises a fixed next mode. Countdown starts when the cross is walkable.
5. End-tile zone samples, AFK anchor, winner pick, `combatOpen()` on every combat and paint handler, empty bot and anvil flush, fall rescue aims at the cross.
6. `scripts/verify-lobby.ts`: the nine tiles and which cells vote, the tie rule, the idle/5 s rule, and a source check that combat handlers call the gate.

Phase B sets `garden` and `pots` to live on the north and south ends. No new tiles, no team select, no P2E, no new match rules.

Phase C is polish: label size, countdown tick, mobile type, winner announcement beat before the arena regen.
