# Squareoff — Design Document

**Status:** Phases 1–4 shipped. Live at `labyrinthia.dcl.eth`. Server-authoritative multiplayer working: team assignment, cross-player paint sync, snapshot-on-join, UTC-boundary round reset. Repo: `github.com/iillee/squareoff` (branch `squareoff`).

**Latest refactor (Aug 2026):** event-driven modular architecture (sky-chaser style). `client.ts` went from 1,191 → 121 lines split across `client/`, `maze/`, `shared/` module trees connected by a typed event bus. See [`../../README.md`](../../README.md) and §12 below.

**Session handoff:** Read §1–2 for context, jump to §11 (Phase 4 recap) and §12 (architecture) for the current state, then §13 (Next Steps) for what's live.

---

## 1. Vision

**Squareoff** is a team-based tile-coverage game built on top of the procedural maze scene at `labyrinthia.dcl.eth`. Inspired by Splatoon's *Turf War* mode.

**Core fantasy:** Teams compete to claim the maze's walkable surface — subdivided into 2m grid squares — in their team's color. Walking over a square flips it to your color, overwriting the enemy's if present. At round end (every 4 minutes on the UTC boundary), the team with the highest coverage percentage wins.

**Name:** *Squareoff* = a face-off + literal squares.

**Why on the maze?** The procedurally-generated multi-level labyrinth gives every round a fresh battleground — no static map memorization, verticality via ramps, natural chokepoints. The UTC-boundary round system regenerates the seed every 4 minutes, so no two rounds share terrain.

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

### Entity budget (100-parcel scene, as measured)

- Total budget: **51,200 entities**
- Maze tiles worst case: ~150
- Paint cells: ~200 avg walkable per tile × 150 tiles ≈ **~30,000**
- Overhead (UI, audio, players, effects): ~500
- **Measured use: ~30,700 (~60% budget)**
- Comfortable headroom for combat (Phases 5+).

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
- Client → Server: `joinRoster`, `paintTick` (10 Hz), `requestSnapshot`
- Server → Client: `teamAssigned`, `paintDelta` (5 Hz), `snapshot` (on request), `roundReset` (UTC boundary)

**Saturation discipline (see §2 of PHASE_4_PLAN):**
- Server broadcast: 5 Hz max
- Client position ingest: 10 Hz max
- Delta batch cap: 200 cell changes per broadcast (dropped in the ingest layer if a client exceeds ~100 ids/tick)

**Trust model:** all `userId` values come from `context.from` (server-authenticated), never from payload fields. Team assignment is `roster.indexOf(userId) % 2` — stable across rejoin, guaranteed alternation by join order.

**Round timing:** UTC-aligned 4-minute boundaries. Single source of truth in [`src/shared/roundTiming.ts`](../../src/shared/roundTiming.ts); both client and server compute the same `getRoundIndex()`.

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
├── ui.tsx                      HUD (React-ECS)
├── client/
│   ├── index.ts                orchestrator, setupClient()
│   ├── clientHandler.ts        SOLE owner of room.on/send — WS boundary
│   ├── audio.ts                music + mute + click SFX
│   ├── player.ts               round-reset teleport subscriber
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
│   └── components.ts           ECS components (SeedHolder)
└── server/                     headless authoritative server
    ├── server.ts               orchestrator + round loop
    ├── roster.ts               team assignment
    └── paintState.ts           authoritative paint map
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

## Appendix — key constants (as of Aug 2026)

**[`src/maze/generator.ts`](../../src/maze/generator.ts):**
```ts
export const TILE_SCALE = 2                            // tiles scaled 2x on spawn
export const CELL = 16 * TILE_SCALE                    // = 32m per maze grid cell
export const GRID_W = Math.floor(160 / CELL)           // = 5 cells across
export const GRID_H = Math.floor(160 / CELL)           // = 5 cells across
export const STEP = 5.3835 * TILE_SCALE                // = 10.767m ramp Y rise
export const MAX_Y = 60                                // halved from 120 to
                                                       // keep the maze horizontal
```

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
export const ROUND_LENGTH_MINUTES = 4
export const ROUND_INTERVAL_MS = ROUND_LENGTH_MINUTES * 60 * 1000
```

**Server ingest limits ([`src/server/server.ts`](../../src/server/server.ts)):**
```ts
const MAX_IDS_PER_TICK = 100                           // 3x3 footprint at 10Hz = 90 ids max
```

The maze grid `Map` key rounds Y to 3 decimals — `STEP` is a float now and raw arithmetic drifts, which previously silently broke the "no tile above ramp" rule.
