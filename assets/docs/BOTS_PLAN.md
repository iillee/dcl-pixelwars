# Bots — Work Plan (Phase 5a)

Status: **Not started.** Estimate: 4–6 focused days (MVP ~2 days, polish ~2–4 days).

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
