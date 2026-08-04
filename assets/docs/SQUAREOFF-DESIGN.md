# Squareoff — Design Document

**Status:** Phases 1–4 shipped. Live at `labyrinthia.dcl.eth`. Server-authoritative multiplayer working: team assignment, cross-player paint sync, snapshot-on-join, UTC-boundary round reset. Repo: `github.com/iillee/squareoff` (branch `squareoff`).

**Latest refactor (Aug 2026):** event-driven modular architecture (sky-chaser style). `client.ts` went from 1,191 → 121 lines split across `client/`, `maze/`, `shared/` module trees connected by a typed event bus. See [`../../README.md`](../../README.md) and §12 below.

**Session handoff:** Read §1–2 for context, jump to §11 (Phase 4 recap) and §12 (architecture) for the current state, then §13 (Next Steps) for what's live.

---

## 1. Vision

**Squareoff** is a team-based tile-coverage game built on top of the procedural maze scene at `labyrinthia.dcl.eth`. Inspired by Splatoon's *Turf War* mode.

**Core fantasy:** Teams compete to claim the maze's walkable surface — subdivided into 2m grid squares — in their team's color. Walking over a square flips it to your color, overwriting the enemy's if present. At round end (every 5 minutes on the UTC boundary), the team with the highest coverage percentage wins.

**Name:** *Squareoff* = a face-off + literal squares.

**Why on the maze?** The procedurally-generated multi-level labyrinth gives every round a fresh battleground — no static map memorization, verticality via ramps, natural chokepoints. The UTC-boundary round system regenerates the seed every 5 minutes, so no two rounds share terrain.

---

## 2. Game arc (roadmap)

| Phase | Feature | Status |
|---|---|---|
| **1** | Grid-based tile-flip mechanic: player walks over walkable cells, cells adopt their team color. | ✅ Shipped |
| **2** | Round timer, coverage % counter per team, win banner, reset. | ✅ Shipped |
| **3** | Two teams. Team assignment (button or auto). Player color identifier. | ✅ Shipped |
| **4** | Multiplayer sync of paint state (authoritative server). Late joiners get snapshot. | ✅ Shipped |
| **5** | Combat: ink projectile weapon that paints a small radius on impact and damages enemies. | ⏳ Planned |
| **6** | Damage in enemy paint (Splatoon mechanic). Respawn at team base. | ⏳ Planned |
| **7** | Squid-swim mobility on own team's paint (fast travel through own color). Special weapons. | ⏳ Planned |

---

## 3. Technical approach — the grid decision

### Approaches evaluated

Two approaches prototyped on a scratch `drip` branch (kept locally for reference):

**A. Trail approach** (built + rejected — see commit `b591d48` on `drip`)
- Drop small circular decals behind player as they walk.
- Pool of 3000 pre-allocated plane entities recycled ring-buffer style.
- **Rejected because:**
  - Coverage % is fuzzy (overlapping discs); requires random-sampling approximation.
  - Ring buffer means old paint disappears mid-round (bad for a coverage game).
  - Ramps required flat discs on sloped surfaces → visible clipping.
  - Required a "grounded latch" system to suppress paint while jumping/falling (fragile).
  - Foot disc + drops caused z-fighting requiring hacks.
  - Every new gameplay feature added new edge cases.

**B. Grid approach** (chosen — this doc's plan)
- Pre-spawned grid of small plane entities on each maze tile's walkable surface.
- Player position → figure out which cell they're on → set that cell's material to their team color.
- **Wins because:**
  - Coverage % is trivial: `cellsByTeam / totalCells`.
  - No overlap, no z-fighting, no ring-buffer recycling (paint persists).
  - Ramp cells can be pre-rotated to match slope — no clipping.
  - Late-joiner sync is compact: one byte per cell.
  - Matches the Splatoon mental model exactly.
- **Trade-off:** Requires authoring per-tile "walkability masks" (one per tile type), and can't handle arbitrary geometry — but there are only 6 tile types.

### Grid parameters (as shipped)

| Setting | Value | Rationale |
|---|---|---|
| Cell size | **2m × 2m** | Balances Splatoon-y look vs entity budget. Dropped from initial 1m plan after stress testing. |
| Grid resolution per tile | 16×16 (`SIZE = 16`) — masks sparse | Only walkable cells get a spawned entity. |
| Cell entity | `MeshRenderer.setPlane` at Y = tile-base + `FLAT_OFFSET` (0.55m) | 2 tris each. |
| Cell material | Matte PBR (`roughness=1`, `metallic=0`), one shared per team color | Engine dedupes identical materials. |
| Ramp cell rotation | Match ramp slope (single shared quaternion per ramp) | Avoids clipping. |

### Entity budget (121-parcel scene, as measured)

- Total budget: **~24,200 entities** (121 parcels × 200)
- Maze tiles worst case: ~30 (5×5 grid × up to 4 Y levels; BFS rarely fills every slot)
- Paint cells: ~150 avg walkable per tile × 25 tiles ≈ **~3,800**
- Teleport orbs: 2 bodies + 2 wireframes + 2 lights + 2 sound emitters = **8**
- Overhead (UI, audio, players): ~50
- **Measured use: ~3,900 (~16% budget)** — huge headroom for combat/items (Phases 5+).

**Note:** we experimented with 1m paint cells (`SIZE = 32`, ~15k entities) for higher-res paint but the WebGL client couldn't sustain that many individual PBR-material planes; the paint pipeline lagged 3–4s behind player movement. Reverted to 2m cells.

---

## 4. Tile geometry

The tile GLBs were re-exported for Squareoff to align cleanly with the paint grid, based on the mockup in `../images/subdivisions.jpg`:
- Walkable footprints are integer-meter dimensions.
- **Tile origin, cell size (32m maze cell), and rotation conventions preserved** — `ROT_OFFSET`, rotation math, ramp stacking unchanged.
- Only geometry inside each tile was adjusted.

### Tile types

Six types, from `TILES` in [`src/maze/tiles.ts`](../../src/maze/tiles.ts):

| Type | Openings | Notes |
|---|---|---|
| `end` | N | Dead-end room |
| `straight` | N–S | Straight corridor |
| `turn` | N–E | 90° L bend |
| `fork` | N–S–W | T-junction |
| `cross` | N–E–S–W | 4-way intersection |
| `ramp` | N–S | Slope, rises `STEP` (10.767m) from S to N in canonical orientation |

---

## 5. Masks — data format

Each tile type gets a **canonical (unrotated) mask** — a 2D array of chars, one char per cell. When a tile spawns at rotation `r`, the mask is rotated 90°×r before spawning cells.

**Format** (see `MASKS` in [`src/paint.ts`](../../src/paint.ts)):
```ts
// '.' = wall/void (no paint cell)
// 'F' = floor cell (paint spawnable)
// Row 0 = -Z edge (south); rows grow to +Z (north). Column 0 = -X (west) → +X (east).
```

**Ramp cells** use a dedicated path (`rampGeometry` in paint.ts), not the mask. Flat landings at both ends; incline cells spaced along the slope so 2m squares tile flush across the tilted surface. Cells tilted around the tile's slope axis by `atan(STEP / inclineLen)`.

---

## 6. Coordinate math

Given player world position `(px, py, pz)`:

1. Determine which **maze grid cell** they're in: `mgx = floor(px / CELL)`, `mgz = floor(pz / CELL)`.
2. Look up the tile at that column via `lookupTile(mgx, mgz, py)` in [`src/maze/generator.ts`](../../src/maze/generator.ts) — returns the highest tile whose Y is at or below the player's feet.
3. Compute **local tile coordinates** by subtracting the tile origin and undoing rotation.
4. Compute **cell index within tile**: `cellX = floor(localX / cellSize)`, `cellZ = floor(localZ / cellSize)`.
5. If that cell exists in the tile's mask → paint it via `noteLocalPaintCandidate(cellId)`.

Coverage counters are updated by the server on every 5 Hz `paintDelta` broadcast — no client-side polling required.

---

## 7. Multiplayer (Phase 4 — shipped)

**Architecture:** authoritative headless server (hammurabi-server) owns paint state and round clock. See [`PHASE_4_PLAN.md`](PHASE_4_PLAN.md) for the design rationale and [`src/shared/messages.ts`](../../src/shared/messages.ts) for the wire schema.

**Message set:**
- Client → Server: `joinRoster`, `paintTick` (10 Hz), `requestSnapshot`, `updateName` (once on join), `requestLeaderboard` (on popup open)
- Server → Client: `teamAssigned`, `paintDelta` (5 Hz), `snapshot` (on request), `roundReset` (UTC boundary)

**Synced (CRDT) components** ([`src/shared/components.ts`](../../src/shared/components.ts)):
- `SeedHolder` (networkId 3000) — current maze seed. Written by first-joiner init and by the round-reset handler.
- `LeaderboardState` (networkId 3001) — JSON string of top-N painters. Written by server on boot (after Storage load) and on each round boundary; also republished on `requestLeaderboard`.

Any new synced component **must** be registered on both server and client via `syncEntity(entity, [Component.componentId], <networkId>)` with matching IDs. Without the server-side call, mutations never leave the server process — root cause of the leaderboard-popup-was-empty bug fixed Aug 2026.

**Saturation discipline (see §2 of PHASE_4_PLAN):**
- Server broadcast: 5 Hz max
- Client position ingest: 10 Hz max
- Delta batch cap: 200 cell changes per broadcast (dropped in the ingest layer if a client exceeds ~100 ids/tick)

**Trust model:** all `userId` values come from `context.from` (server-authenticated), never from payload fields. Team assignment is `roster.indexOf(userId) % 2` — stable across rejoin, guaranteed alternation by join order.

**Round timing:** UTC-aligned 5-minute boundaries. Single source of truth in [`src/shared/roundTiming.ts`](../../src/shared/roundTiming.ts); both client and server compute the same `getRoundIndex()`.

---

## 8. Known unknowns / open questions

1. **Draw call batching** — SDK7 does batch same-material planes; verified in the field with ~30k plane entities running at 30+ FPS.
2. **Ramp cell rotation** — solved; see `rampGeometry` in paint.ts.
3. **Cell material updates cost** — cheap enough for 20-50 cells/frame (3×3 footprint + walk).
4. **Team assignment UX** — solved server-side (auto-alternate by roster order).
5. **Player-attached "foot color indicator"** — briefly enabled, removed for feeling intrusive. Team is still tracked internally; a subtler indicator can return later.
6. **Composite tree-shaking bug (see §10 Deploy)** — worked around, not properly fixed.

---

## 9. Repo state

**Branch:** `squareoff` (tracks `squareoff` remote at `github.com/iillee/squareoff`, private).
**Base:** `main` branch of `labyrinthia` repo (public, not modified by squareoff work).
**Reference branch:** `drip` (local only) — contains the rejected trail-approach prototype.

**History note:** The squareoff remote had its history rewritten with `git filter-branch` to purge `HomeAgain_Loop.wav` (52MB) from all reachable commits. Clone size is ~3MB.

**Files of interest** (post-refactor — see §12 for the full module tree):
- [`src/paint.ts`](../../src/paint.ts) — masks, `rampGeometry`, `spawnCellsForTile`, `worldToCellId`, coverage, painting system with grounded gating + 3×3 footprint, event subscribers (`initPaintNet`).
- [`src/maze/generator.ts`](../../src/maze/generator.ts) — pure maze generator (grid, placement rules, BFS growth, `lookupTile`).
- [`src/maze/rebuild.ts`](../../src/maze/rebuild.ts) — visual spawn/teardown pipeline, `round:reset` subscriber.
- [`src/client/clientHandler.ts`](../../src/client/clientHandler.ts) — network boundary; sole owner of `room.onMessage`.
- [`src/server/server.ts`](../../src/server/server.ts) — server orchestrator, round loop.
- [`src/ui.tsx`](../../src/ui.tsx) — HUD (mute pill, coverage pill, round countdown, end-of-round banner).
- `assets/models/tile-*.glb` — 2m-grid-aligned walkable footprints, floor slab 0.5m above origin.
- `../images/pallet.jpeg` — team color source: red `#FF7577`, blue `#6A99FC`.

---

## 10. Deploy workflow

**IMPORTANT — don't use `/deploy` alone.** Use the two-step:

```bash
npx sdk-commands build
npx sdk-commands deploy --skip-build --target-content https://worlds-content-server.decentraland.org
```

The built-in `/deploy` (and plain `sdk-commands deploy`) internally runs a `--production` build. In production mode the bundler treats `assets/scene/main.composite` (Creator Hub visual editor artifact + `@dcl/asset-packs` runtime) as the primary scene source and tree-shakes our TypeScript entry, producing a broken 585KB bundle. The two-step workflow uses the non-production ~6.5MB bundle. See open question §8.6.

**Note:** the `scene.json` `creator` field must be a valid wallet address (or empty), NOT a display name. The worlds content server rejects otherwise. Human-readable names go in `contact.name` and `owner`.

---

## 11. Phase 4 — what actually shipped

**Authoritative server** (`src/server/`):
- `server.ts` — 5 Hz broadcast loop, message dispatch, round-boundary detection.
- `roster.ts` — team assignment by join order (idempotent per userId, alternating parity).
- `paintState.ts` — the authoritative paint map. Rate limits ingest (100 ids/tick max), tracks coverage counters.

**Client-side networking:**
- `joinRoster` sent once when `PlayerIdentityData.address` populates.
- On `teamAssigned` → `setLocalTeam` + request snapshot.
- `paintTick` batched at 10 Hz from the local outbox.
- `paintDelta` (5 Hz) applied via `applyRemotePaint` — same path our own paint takes when echoed back.
- `snapshot` on join (up to 1500 cells, one WS frame, ~30KB).
- `roundReset` at UTC boundaries — banner + clear paint + new seed + teleport.

**Fixes shipped during Phase 4:**
- Winner-mismatch across clients (all clients now read the same authoritative counts).
- Stale HUD % after rebuild (server clears its state; client zeroes on `roundReset`).
- Ghost paint from cellId collisions between old/new mazes (server state cleared before new round's first paint).
- Reload during a round now restores the paint view via snapshot.
- Two-blue-players-in-a-row bug (server guarantees alternation).

---

## 12. Architecture (post-refactor, Aug 2026)

Event-driven modular structure inspired by [stom66/dcl-sky-chaser](https://github.com/stom66/dcl-sky-chaser) — adapted with a typed event bus and lighter file split.

**Data flow:**
```
Server WS message ──► client/clientHandler.ts (room.onMessage)
                          │
                          ▼
                    events.emit('paint:delta', {…})
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    paint.ts        maze/rebuild.ts    round.ts / player.ts
```

**File tree:**
```
src/
├── index.ts                    entry router (isServer branch)
├── paint.ts                    paint mechanic + initPaintNet subscriber
├── round.ts                    timer + banner + initRoundNet subscriber
├── stress.ts                   load-test harness
├── teleportOrbs.ts             paired teleport portals (deterministic per seed)
├── ui.tsx                      HUD + leaderboard popup (React-ECS)
├── client/
│   ├── index.ts                orchestrator, setupClient()
│   ├── clientHandler.ts        SOLE owner of room.on/send — WS boundary
│   ├── audio.ts                music + mute + click SFX + tile-claim SFX (local, per-flip)
│   ├── player.ts               initial spawn + round-reset teleport to center
│   └── waitForLoad.ts          startup gate (available, not yet wired)
├── maze/
│   ├── tiles.ts                pure — Dir + TILES catalog
│   ├── rng.ts                  pure — mulberry32
│   ├── generator.ts            grid + placement + BFS growth (no engine)
│   └── rebuild.ts              spawn/teardown + initMazeNet subscriber
├── shared/
│   ├── events.ts               typed event bus + Events map
│   ├── team.ts                 Team enum (client + server)
│   ├── roundTiming.ts          single source of round cadence
│   ├── messages.ts             WS schema (registerMessages)
│   └── components.ts           ECS components (SeedHolder, LeaderboardState)
└── server/                     headless authoritative server
    ├── server.ts               orchestrator + round loop
    ├── roster.ts               team assignment
    ├── paintState.ts           authoritative paint map (applyPaint → bool)
    ├── leaderboard.ts          top-painters accumulator + Storage persistence
    └── discord.ts              join-notification webhook (env-var loaded)
```

**Event map** ([`src/shared/events.ts`](../../src/shared/events.ts)):
```ts
type Events = {
  'team:assigned':   { team: Team }
  'paint:delta':     { changes: […], red, blue, total }
  'paint:snapshot':  { entries: […], red, blue, total }
  'round:reset':     { seed, finalRed, finalBlue, finalTotal }
}
```

**Rules of the road:**
- `client/clientHandler.ts` is the only file that touches `room`. Wire schema changes = one-file diff.
- Publishers emit; they don't call subscribers. Adding a "fanfare on round end" is a one-liner in `client/audio.ts`.
- Modules never import from other feature modules — only from `shared/` and (for subscribers) `shared/events.ts`.
- `maze/tiles.ts` and `maze/rng.ts` are pure. `maze/generator.ts` uses no engine imports — the visual side lives in `maze/rebuild.ts`.

---

## 12b. Server-side subsystems (added Aug 2026)

### Leaderboard (`src/server/leaderboard.ts`)

**Metric:** cells **captured** (unpainted → yours, or enemy → yours). Standing on your own paint credits 0 — otherwise the 9-cell footprint × 10 Hz outbox would inflate a stationary player's count by ~90/sec, which was the actual observed bug (leaderboard started at ~58K, incremented on every popup open). Fix: `applyPaint()` now returns `bool` (true = state changed), and the paintTick handler only credits gained cells.

**Persistence:** `Storage.set('leaderboard-v1', json)` on every round boundary (5 min). Load on boot before any paintTicks land. Safe parsing (`?? []`) — malformed data logs + resets rather than losing all future writes to a stuck strict-parse.

**Publish cadence:** CRDT-synced `LeaderboardState` written on:
1. Boot (after Storage load) — so late joiners see standings immediately.
2. Round boundary — refresh for all connected clients.
3. `requestLeaderboard` message — on-demand refresh when a player opens the popup.

Steady-state bandwidth: ~2 KB every 5 min per client. Negligible.

**Not (yet) implemented** — daily vs all-time split, serialized mutation queue, strict-recovery path (all present in flagtag/leaderboard.ts). Deliberately trimmed — add if the game grows to need them.

### Discord webhook (`src/server/discord.ts`)

**Setup:** webhook URL is loaded via `EnvVar.get('DISCORD_PLAYER_JOIN_WEBHOOK')` — **never hardcoded**, since scene bundles are publicly downloadable.
- **Local dev:** `.env` file (gitignored) with `DISCORD_PLAYER_JOIN_WEBHOOK=https://...`.
- **Production:** `npx sdk-commands storage env set DISCORD_PLAYER_JOIN_WEBHOOK --value "https://..."`.

**Preview suppression:** `getRealm({}).realmInfo.isPreview` — skip sends during local testing to avoid spamming the channel.

**Debounced send:** join is queued for 5s before firing; server checks `leaderboard.getName(userId)` at flush time so real display names appear in Discord instead of wallet hashes. Falls back to short address (`0x1e93…a52b`) after 15s if the name never resolves (likely a bot / weird client).

**Anti-abuse:** `allowed_mentions.parse: []` in the POST body — a player named literally `@everyone` cannot ping the Discord server.

### Star popup UI

Toggled by a star button in the timer panel (mirror position to the mute button). Backdrop is click-to-close; anywhere inside the modal card also closes. Rows show rank (top-3 in yellow), player name, cell count. Reads from the CRDT-synced `LeaderboardState` component — no per-frame render cost beyond JSON.parse.

---

## 13. Next Steps

Recommended path for the next session:

1. **Playtest with multiple accounts.** Now that authoritative sync is live, get 3+ concurrent players to catch remaining desync / edge-case bugs. Watch for: snapshot arriving before local tiles finish spawning; roster.indexOf race on simultaneous joins; paintDelta bursts saturating the WS on a full lobby.
2. **Wire `client/waitForLoad.ts`.** The gate is available but not called; useful once we add a loading screen or anything that hard-requires PlayerEntity to have a Transform.
3. **Phase 5 — combat.** Ink projectile weapon. Painting on impact (small radius). Damage to enemies. Design decisions ahead: recharge model? ammo? weapon variants? Splatoon's "roller/blaster/charger" archetypes are worth studying.
4. **Phase 6 — respawn + damage-in-enemy-paint.** Requires a per-player HP component (synced) and a "team base" concept (spawn point per team). Once shipped, the game becomes properly zone-controlled.
5. **Phase 7 — squid-swim mobility.** High complexity — requires per-frame player-to-paint proximity checks and locomotion modification. Only after Phases 5–6 are solid.

**Also worth doing when convenient:**
- Investigate the composite / production-build issue properly (see §10).
- Consider a subtler foot color indicator (retired in Phase 3 for feeling intrusive).
- Split `paint.ts` (636 lines) into `paint/masks.ts`, `paint/spawn.ts`, `paint/system.ts` if it grows further.
- Add a `client/hud/` subfolder if `ui.tsx` grows past ~300 lines.

**Do NOT** attempt Phases 6–7 until Phase 5 combat is solid.

---

## Appendix A — local dev setup

**scene.json requirements** for the authoritative server to work in Creator Hub / CLI preview:
- `"authoritativeMultiplayer": true`
- `"worldConfiguration": { "name": "labyrinthia.dcl.eth" }`
- `"logsPermissions": ["0x1e93e534c5e26b01ed242410b43ae23dd0faa52b"]` — without this, server `console.log()` output is hidden and the server *appears* broken when it's just silent.

**Local preview issues** and their causes:

| Symptom | Cause | Fix |
|---|---|---|
| Preview shows old code even after edit | Creator Hub watcher not rebuilding the bundle | `npx sdk-commands build` manually; check `stat bin/index.js` vs `stat src/ui.tsx` timestamps |
| Paint doesn't propagate in single-player preview | Guest player has no wallet → no `joinRoster` → server drops paintTicks | 3-second fallback in `clientHandler.ts` sends `joinRoster` with a synthetic guest id if PlayerIdentityData.address never populates |
| Discord webhook silent locally | Preview realm auto-detected | Expected — `[Discord] preview realm detected — join notifications disabled` in server logs |
| Stale CRDT after schema change | `main.crdt` / `main1.crdt` cached | `rm main.crdt main1.crdt` and restart preview |

---

## Appendix B — key constants (as of Aug 2026)

**Scene layout:** 11×11 parcels (176m × 176m). Deployed to `labyrinthia.dcl.eth`.

**Persistent center cross:** the generator always seeds a single `cross` tile at the exact grid center (cell (2,2), world (88, 88, 0)). It's the mandatory rally point — same world position every round, four symmetric arms fanning N/S/E/W. `rebuildMaze()` preserves the center tile entity across round rebuilds (no tear-down / grow-in on the tile players are standing on); its paint resets in place via `resetPaintForTile()`.

**[`src/maze/generator.ts`](../../src/maze/generator.ts):**
```ts
export const TILE_SCALE = 2                            // tiles scaled 2x on spawn
export const CELL = 16 * TILE_SCALE                    // = 32m per maze grid cell
export const SCENE_SIZE = 176                          // 11×11 parcels
export const GRID_W = Math.floor(SCENE_SIZE / CELL)    // = 5 cells across
export const GRID_H = Math.floor(SCENE_SIZE / CELL)    // = 5 cells across
export const MAZE_ORIGIN = (SCENE_SIZE - GRID_W*CELL)/2 // = 8m border (5×5 grid centered in scene)
export const STEP = 5.3835 * TILE_SCALE                // = 10.767m ramp Y rise
export const MAX_Y = 40                                // 4 levels max (Y = 0, 10.77,
                                                       // 21.53, 32.30) — lowered from 60
                                                       // to push players closer together
```

**Center-cross seeding:** `generate()` places a `cross` tile at `(Math.floor(GRID_W/2), Math.floor(GRID_H/2), 0)` before BFS growth. Frontier expansion fans out from its 4 openings, so every maze has radial symmetry around the rally point.

**[`src/teleportOrbs.ts`](../../src/teleportOrbs.ts):**
One pair of gold d20 teleport orbs spawns each round, deterministic on the current seed. Rules:
- Both tiles must be non-ramp (flat landing).
- Both tiles must be outside the 3×3 block around the center cross (no orb on spawn or any adjacent tile).
- The two tiles must sit on different Y levels (guaranteed vertical shortcut).
- Fallback (rare, single-level maze): warn + place on same level.

Orbs use the flagtag gold-orb visual: d20 body + wireframe overlay (both scaled 0.8), orange-gold point light (`Color3(1, 0.45, 0)`, intensity 150, range 12), spin + bob animation, positional teleport SFX. Trigger radius 1.2m, 1s cooldown, lands 2.5m from destination orb to avoid re-trigger.

**[`src/paint.ts`](../../src/paint.ts):**
```ts
const SIZE = 16                                        // cells across a tile → 2m cells
const ARM = SIZE * 20 / 32                             // = 10 — corridor width
const LO = (SIZE - ARM) / 2                            // = 3 — corridor band low bound
const RAMP_FLAT_END = 1                                // cells of flat landing at each ramp end
export const FLAT_OFFSET = 0.275 * 2                   // = 0.55m world above tile origin
const WALKABLE_TOP = 0.5                               // top of floor slab in world meters
const SPAWN_DELAY_MS = 500                             // paint cells wait for tile grow-in tween
const GROUND_TOLERANCE = 0.4                           // grounded threshold for painting
```

**[`src/shared/roundTiming.ts`](../../src/shared/roundTiming.ts):**
```ts
export const ROUND_LENGTH_MINUTES = 5
export const ROUND_INTERVAL_MS = ROUND_LENGTH_MINUTES * 60 * 1000
```

**Server ingest limits ([`src/server/server.ts`](../../src/server/server.ts)):**
```ts
const MAX_IDS_PER_TICK = 100                           // 3x3 footprint at 10Hz = 90 ids max
```

The maze grid `Map` key rounds Y to 3 decimals — `STEP` is a float now and raw arithmetic drifts, which previously silently broke the "no tile above ramp" rule.
