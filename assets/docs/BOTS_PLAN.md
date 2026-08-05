# Bots — Work Plan (Phase 5a)

Status: **MVP + behavioural polish shipped on branch `bots`, deployed to
`pixelwars.dcl.eth`.** All steps 1–7 complete; step 8 (tuning pass) is
an ongoing iterative loop and is currently in a good state (see "Second
polish pass" below). Not yet merged — next session: bot jump/glide
mobility (see "Deferred / next-session ideas" below) + optional codebase
cleanup.

---

## Progress log (chronological)

| Step | Status | Notes |
|---|---|---|
| 1. Walkable adjacency graph | ✅ | `shared/mazeGraph.ts` — seed 1 -> 11780 cells, fully connected, 45ms build |
| 2. BFS pathfinding | ✅ | avg 1.6ms/path over 100 random pairs; 260-step full-map traversal in 7ms |
| 3. Bot state machine | ✅ | `server/bots/bot.ts` — accumulator model, MAX_STEPS_PER_TICK=3 safety cap |
| 4. Smart target heuristics | ✅ | Rewritten twice — see "Second polish pass" below. Current: strict priority (enemy 70% → neutral → own) with erosion-based deep-only movement. |
| 5. Population manager | ✅ | `server/bots/manager.ts` — wired into 5Hz broadcast tick |
| 6. Round-loop wiring | ✅ | Absorbed into step 5; `rebuildBotGraph(seed)` fires on `round:reset` |
| 7A. Invisible bots (paint-only) | ✅ | Shipped first; feel-check confirmed we needed visible form |
| 7B. Visible box entities | ✅ | `client/botVisual.ts` — team-coloured emissive box, 2Hz position broadcast |
| 7C. Ghost model + light | ✅ | Shipped `assets/models/bots/ghost.glb` + `assets/sounds/ghost.mp3` + coloured `LightSource` + ambient bob/drift/pulse + dead-reckoning lerp (not Tween). See `src/client/botVisual.ts` header for why per-frame lerp beats Tween and why a ghost reads better than AvatarShape. AvatarShape deferred — ~1/50th the entity cost. |
| 8. Tuning pass | ✅ (ongoing) | Speed, jitter, pauses shipped. Wall-hugging fixed via erosion. Backtracking fixed via own-paint Dijkstra cost. Roomba-look fixed via shuffle + zig-zag bias. Enemy-hunter tier added for offensive play. |

### Fixes shipped after initial MVP

- **Ramp cellId convention** — paint.ts stores ramp cellIds in canonical
  (pre-rotation) frame; graph originally used world-axis. Rotated ramps
  painted perpendicular to bot movement. Fixed by emitting canonical
  ramp cellIds + world-position matching for cross-tile ramp edges.
  Also picked up the missing top-landing row (17 rows, not 16).
- **3x3 paint footprint** — was 5-cell plus-shape; now matches the human
  9-cell stamp via cellId arithmetic + graph.nodes lookup.
- **Wall-hugging avoidance** — target picker prefers cells at least
  DEEP_MARGIN=2 from either corridor edge, keeping the full 3x3 stamp
  inside the walkable band.
- **Color-swap on server restart** — client no longer rebuilds bot entity
  on `botId` team-mismatch; recolours material in place. Handles the
  bot-id-reuse case cleanly.

### Simplifications made after playtest

- **Solo-mode only** — dropped the 4-active target + 3-max-bot design in
  favour of "exactly 1 bot iff exactly 1 active human, always on the
  opposite team". Simpler mental model + matches Foundation D7 story
  (the point is to *not* land in an empty scene, not to fill the maze).
- **Active-painter filter for humanCount** — scraper accounts that
  connect but never paint no longer suppress bot spawning. Tracked via
  `roster.markActive()` on paintTick + joinRoster with a 60s window.

### Second polish pass — movement quality + offensive play

After merging the MVP the ghost felt "botty" in three specific ways.
Each was fixed in a distinct commit; the code paths are documented
inline in `mazeGraph.ts` / `bot.ts` / `paintState.ts`.

1. **Wall-hugging → eroded deep-graph pathfinding.** Attempts to bias
   BFS via neighbour sorting or post-hoc target filtering all failed:
   the pathfinder could still *traverse* wall cells to reach a deep
   target. Fix: `buildWalkableGraph` now emits a second graph
   (`deepNodes` / `deepAdj`) containing only cells with
   `distToWall >= DEEP_MARGIN`. Bot samples targets from `deepNodes`
   and pathfinds on `deepAdj` (`findPath(..., useDeepOnly=true)`), so
   wall cells are physically absent from its world. Connectivity
   fallback logs a WARN if erosion would fragment the graph.
   `DEEP_MARGIN` currently = 1 (2 was too conservative for the
   ARM=10 corridor width).

2. **Backtracking over own trail → weighted Dijkstra with own-paint cost.**
   `findPath` now accepts an optional `costOf(cellId)` and switches to
   a binary-heap Dijkstra when supplied. Bot sets own-team cells to
   cost 3, everything else to 1: the pathfinder detours through
   un-owned tiles when the detour is ≤2 steps longer but still crosses
   its own paint when there's no alternative — never strands the bot.

3. **Roomba-look (L-shaped paths on open ground) → shuffle + zig-zag bias.**
   Neighbour expansion order is shuffled in both BFS and Dijkstra
   branches (organic feel on ties). Additionally, a `STRAIGHT_PENALTY`
   of 0.15 is added when the next step continues in the same direction
   as the previous one, so on Manhattan-equivalent open stretches the
   pathfinder prefers a staircase over a straight-then-turn. The bump
   is small enough that a genuinely shorter straight path still wins.

4. **Passive floor-filler → enemy-hunter target tier.** The old smart
   picker treated neutral and enemy cells equally, so early round
   (mostly-neutral map) the ghost never contested territory. New
   `paintState.sampleEnemyCells(team, k)` uses reservoir sampling to
   expose enemy paint to the picker. `makeSmartTarget` now has a
   Tier 0 that rolls at `ENEMY_BIAS = 0.70` and targets a random deep
   enemy cell. Falls through cleanly when there's no enemy paint
   (round start) or when sampled enemy cells are all wall-adjacent.

5. **Randomised starting team.** `roster.ts` picks a one-shot
   `teamParityFlip` at server startup so the first joiner is Red or
   Blue 50/50, without breaking alternation or rejoin-stability (all
   three team lookups route through `teamFromIndex`).

**Current tuning knobs** (all easy to find in the code):

| Constant | File | Value | Meaning |
|---|---|---|---|
| `DEFAULT_STEPS_PER_SEC` | `bot.ts` | 4.8 | Slightly faster than DCL walk; catchable by jog/sprint. |
| `DEEP_MARGIN` | `mazeGraph.ts` | 1 | Erosion depth (cells from wall). |
| `STRAIGHT_PENALTY` | `mazeGraph.ts` | 0.15 | Zig-zag bias in Dijkstra. |
| `ENEMY_BIAS` | `bot.ts` | 0.70 | Probability of enemy-hunter tier per target roll. |
| Own-paint cost multiplier | `bot.ts` (inline) | 3 | Detour weight in Dijkstra. |

### Deferred / next-session ideas

- **Jump/glide feature.** A pass over the graph that adds one-way
  "aerial" edges (deep-cell → deep-cell within XZ radius, equal-or-lower
  Y) so the bot can shortcut across gaps humans use jumping/gliding for.
  Would need edge tagging + parabolic Y arc in `Bot.visualPosition` +
  distance-scaled step timing. Rough scope: ~80 lines across mazeGraph.ts
  and bot.ts. Do this *after* offensive play is dialled in — no point
  giving the ghost mobility if it's still painting blank floor.
- **Anti-follow: distance-from-player weight** in target selection.
  Server already knows player position via paintTick sender. Bias
  targets toward the opposite side of the map from the current human.
- **Trail memory:** skip targets within radius R of the last N cells
  the bot painted, so it doesn't wander back into fresh contested space.
- **Codebase cleanup** (see review notes): mask defs duplicated between
  `paint.ts` and `shared/mazeGraph.ts`; split the 759-line `mazeGraph.ts`
  into masks + graph + pathfind modules; prune obsolete `isNearCenter`
  and `PAUSE_*` code paths in `bot.ts` now that motion is organic.

---

## Original plan below (preserved for reference)

Original estimate: 4–6 focused days (MVP ~2 days, polish ~2–4 days).
Actual: MVP in ~1 focused session, all 7B done + fixes in a second.
Ratio 3:1 to estimate, which the plan calls out as expected once the
graph module was in place.

## Why bots are the highest-leverage D7 lever

Squareoff's biggest churn risk mirrors flagtag's: a solo arrival lands in an
empty scene, sees no opponent, and leaves in <30s. Foundation currently
measures success by day-7 retention, so **making the game playable-and-fun
with 1 human is the single largest retention move we can make in one grant
cycle**.

Bots solve this without requiring concurrent-user growth. They gracefully
step aside as humans join, so the game feels alive at 1 player and doesn't
feel diluted at 4.

## What we already have (no new work required)

- Stable cell IDs across the entire play surface (`tx,tz,ty:col,row`).
- Per-tile walkability masks in `paint.ts` — walkable cells are enumerable.
- Tile connectivity — the maze generator already knows which tiles connect
  and on which edges (that's how it builds the maze in the first place).
- Multi-level ramps modeled and painted.
- Server-authoritative paint pipeline (`server/paintState.ts`) — bots call
  the same `applyPaint()` humans do; no duplication.
- 5 Hz server tick loop with a delta batch cap (200 cells/tick) already
  saturating-safe.

## Architecture

Bots run **server-side, in `hammurabi-server`**. Clients see nothing but the
paint deltas they were already going to see — no new client subsystem, no
new WS messages for MVP. Visual presence (optional, see §7) can be added
later without touching the bot logic.

```
server.ts
├── bots/
│   ├── graph.ts       walkable adjacency graph builder (per round rebuild)
│   ├── pathfind.ts    BFS/A* (pure, no server deps)
│   ├── bot.ts         single bot state machine (target, path, step)
│   └── manager.ts     population control + tick loop + team balance
```

Modules never import from other feature modules — same rule as the rest of
the codebase. `graph.ts` and `pathfind.ts` are pure. `bot.ts` and
`manager.ts` are the only stateful pieces.

## Step-by-step plan

### Step 1 — Walkable adjacency graph  (½ day)

**Deliverable:** `buildWalkableGraph(placedTiles) → Map<cellId, cellId[]>`

- For each placed tile, enumerate walkable cells from its walkability mask.
- For each cell, find 4 orthogonal neighbors:
  - **Same-tile** neighbor: check the mask.
  - **Cross-tile** neighbor: check the generator's tile connectivity for
    the edge in question; if connected, look up the adjacent tile's cell.
  - **Ramp** neighbor: bottom-of-ramp connects to lower-level cells, top
    connects to upper-level cells. Generator already places ramps with
    the correct y-offsets; the graph just needs to walk the y axis.
- Emit as a plain `Map`; consumed by pathfinding.
- **Test:** BFS from center tile should reach every walkable cell (i.e. the
  graph is fully connected — matches the generator's own connectivity
  guarantee). If not, the graph builder is dropping edges.

Rebuild this graph once per `round:reset`, cache it, and hand it to the bot
manager. Zero per-tick allocation.

### Step 2 — Pathfinding  (¼ day)

**Deliverable:** `findPath(graph, from, to) → cellId[] | null`

- Start with BFS (uniform cost — every step is one cell). A* adds nothing
  until we care about heuristics.
- Textbook implementation. Cap search to N nodes to avoid pathological
  degenerate cases (e.g. bot targeting an unreachable cell during a
  mid-rebuild race).
- Pure function; no engine imports.

### Step 3 — Bot state machine  (½ day)

**Deliverable:** `class Bot` with `tick(dtMs)`

State per bot:
- `team: Team` (Red or Blue, assigned by manager)
- `currentCell: cellId`
- `targetCell: cellId | null`
- `path: cellId[]`
- `stepCooldownMs: number` (walking speed → cell/sec)

Behavior:
1. If `path` is empty → pick a new target (see §4) → `findPath()` → set path.
2. If `stepCooldownMs > 0` → decrement, done.
3. Otherwise → advance one cell along path, call `applyPaint(cell, team)`,
   reset cooldown to `1000 / STEPS_PER_SEC`.
4. If target reached → clear path, next tick will pick a new target.

Default cadence: **4 cells/sec** (matches a human walking-and-painting
speed roughly). Tunable per difficulty.

### Step 4 — Target selection (behavioral MVP)  (¼ day)

Simple heuristics, tunable knobs:

- **Neutral bias:** 60% of the time, pick a random unpainted cell within N
  tiles of `currentCell`.
- **Enemy bias:** 30% of the time, pick an enemy-owned cell within N tiles
  (painting over them = territorial pressure).
- **Center bias:** 10% of the time, pick a cell near the center tile (keeps
  bots visible and not off in a corner).

This is already a compelling opponent. Tuning is Step 8, not now.

### Step 5 — Population manager + team balance  (½ day)

**Deliverable:** `botManager.tick()` running on the server's main tick.

```
TARGET_ACTIVE = 4
minHumans     = 1  // one human present → bots may exist
maxBots       = 3  // never more than 3 bots even at 0 humans

botsNeeded = clamp(TARGET_ACTIVE - humanCount, 0, maxBots) if humans >= minHumans else 0
```

- **Spawn** bots to reach `botsNeeded`. Assign teams to balance current
  team distribution (bots go to the smaller team first).
- **Retire** bots when human count rises. Retire on the losing team first
  so team balance stays fair.
- Bots retire *between* target selections, not mid-path — no jarring
  disappearance mid-paint-stroke.
- On `round:reset`, clear all bots, rebuild graph, respawn to
  `botsNeeded`.

### Step 6 — Wire into round loop + hammurabi tick  (¼ day)

- `server.ts` calls `botManager.onRoundReset(placedTiles)` after every
  rebuild. Manager rebuilds the graph and reseats bots at the center tile.
- `server.ts` calls `botManager.tick(dtMs)` from its existing 5 Hz loop
  (bots step off the same clock; no new timer).
- Bot paint calls flow through `applyPaint()` exactly like human paint —
  the existing 200-cell/tick delta cap already protects broadcast.

### Step 7 — Visual presence  (optional, ¼–½ day)

Three ladders; ship A now, upgrade later based on feel:

- **A. Invisible bots** (default). Paint appears organically along a path.
  Turf War with no visible opponent still feels alive because the map is
  changing. Zero client work.
- **B. Glowing orb per bot.** Server broadcasts bot positions in a new
  low-frequency message (2 Hz is plenty). Client renders 1 entity + 1
  `LightSource` per bot, team-colored. Cheap (<10 entities total).
- **C. Full `AvatarShape`.** Feels most real but 10× the cost of B, plus
  animation state machine. Defer to a later grant.

Recommendation: ship A on day 2, evaluate, decide B/C on day 3–4.

### Step 8 — Tuning pass  (1–2 days, iterative)

The difference between "bots are cool" and "bots feel botty":

- **Jitter:** small random delays between steps so bots don't move in
  perfect lockstep.
- **Pause behaviors:** occasional 1–2s pauses (mimics a human looking
  around).
- **Difficulty knobs:** `easy` (2 cells/sec, no enemy bias), `medium`
  (4 cells/sec, 30% enemy bias), `hard` (6 cells/sec, 50% enemy bias +
  intercept nearest human).
- **Balancing:** in playtests, tune so a solo human vs 3 medium bots
  wins roughly 55% of the time. Bots should feel beatable but present.

Instrument bot-vs-human paint ratios into the round-end banner if we
want to expose difficulty to players ("You painted 3× more than the
Blue bot!").

## Non-goals (for this grant)

- No bot combat, damage, or respawn logic — Phase 6 concerns.
- No bot "personalities" or named identities — future flavor pass.
- No bot leaderboard entries — bots must NOT pollute the human leaderboard
  in `server/leaderboard.ts`. Explicit skip on bot userIds.
- No path re-planning mid-stroke when the world changes (an enemy paints
  a cell the bot is walking to). MVP just finishes its path — the wasted
  steps read as "bot got outmaneuvered", which is fine.

## Risks

1. **Server CPU.** Hammurabi is single-threaded JS. 3 bots doing BFS a few
   times per second on a ~5k-cell graph is trivial. If we ever scale to
   20+ bots (unlikely), profile and cache paths.
2. **Graph bugs from generator changes.** If tile connectivity ever changes
   shape, the graph builder must follow. Mitigation: the fully-connected
   BFS test in Step 1 catches regressions the moment a tile type is added
   with a broken mask.
3. **Feels fake.** The tuning pass (Step 8) exists specifically to prevent
   this. Budget the time; don't skip it.

## Grant milestone mapping

Aligns to **Week 1** of the 4-week grant plan (solo viability). Deliverable
by end of Week 1: solo player joins an empty realm, sees 3 bots painting
against them within 5s, plays a full round with meaningful competition.

That single flow, measurable via session-length telemetry (Week 4), is the
D7 lever this grant is built around.
