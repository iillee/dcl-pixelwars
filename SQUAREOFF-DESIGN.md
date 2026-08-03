# Squareoff — Design Document

**Status:** Phase 1 complete and deployed live at `labyrinthia.dcl.eth`. Painting is per-client (no cross-player sync yet). Own private repo at `github.com/iillee/squareoff` (branch `squareoff`).

**Session handoff:** This document is the starting point for a fresh session. Read it, then continue from **Next Steps** at the bottom.

---

## 1. Vision

**Squareoff** is a team-based tile-coverage game built on top of the existing procedural maze scene (`labyrinthia.dcl.eth`). Inspired by Splatoon's *Turf War* mode.

**Core fantasy:** Teams compete to claim the maze's walkable surface — subdivided into 1m grid squares — in their team's color. Walking over a square flips it to your color, overwriting the enemy's if present. At round end, the team with the highest coverage percentage wins.

**Name:** *Squareoff* = a face-off + literal squares.

**Why on the maze?** The procedurally-generated multi-level labyrinth gives every round a fresh battleground — no static map memorization, verticality via ramps, natural chokepoints. The existing lever-regenerated seed system provides a natural round-reset mechanic.

---

## 2. Game arc (roadmap)

| Phase | Feature | Complexity |
|---|---|---|
| **1 (current)** | Grid-based tile-flip mechanic: player walks over walkable cells, cells adopt their team color. Single player, one color, no scoring yet. | Medium |
| **2** | Round timer, coverage % counter per team, win banner, reset. | Low |
| **3** | Two teams. Team assignment (button or auto). Player color identifier. | Low |
| **4** | Multiplayer sync of grid state (compact bitfield via CRDT). Late joiners get current picture. | Medium |
| **5** | Combat: ink projectile weapon that paints a small radius on impact and damages enemies. | Medium |
| **6** | Damage in enemy paint (Splatoon mechanic). Respawn at team base. | Medium |
| **7** | Squid-swim mobility on own team's paint (fast travel through own color). Special weapons. | High |

**Focus for the next session:** Phase 3 (two teams) recommended — makes multiplayer meaningful before adding sync in Phase 4. See Next Steps at bottom for details.

---

## 3. Technical approach — the grid decision

### Approaches evaluated

We prototyped two approaches on a scratch `drip` branch (kept locally for reference):

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

### Grid parameters (decided)

| Setting | Value | Rationale |
|---|---|---|
| Cell size | **1m × 1m** | Fine-grained "Splatoon-y" look. |
| Grid resolution per tile | Varies by tile shape (masks are sparse) | Only walkable cells get a spawned entity. |
| Cell entity | `MeshRenderer.setPlane` at Y = tile-base + small offset | 2 tris each. Cheap. |
| Cell material | `MTM_ALPHA_TEST` optional (probably solid color), single shared per team color | Engine dedupes identical materials. |
| Ramp cell rotation | Match ramp slope (single shared quaternion per ramp) | Avoids clipping. |

### Entity budget (100-parcel scene)

- Total budget: **51,200 entities**
- Maze tiles worst case: ~150
- Paint cells: ~200 avg walkable per tile × 150 tiles = **~30,000**
- Overhead (UI, audio, lever, beacon, players, projectiles): ~500
- **Projected use: ~30,700 (~60% budget)**
- Comfortable headroom for combat, effects, 10-20 players.

### Real perf risk: draw calls

30k plane entities may produce up to 30k draw calls if the engine doesn't batch same-material planes. **This is untested.** Mitigation plan: if FPS tanks on stress test, drop to 2m cells (~7,500 entities, 4× reduction).

---

## 4. Tile geometry — planned changes

The tile GLBs are being **re-exported** by the designer to align cleanly with a 1m grid, based on the mockup in `assets/images/subdivisions.jpg`:
- Walkable footprints will be integer-meter dimensions (no fractional cells).
- **Tile origin, cell size (32m maze cell), and rotation conventions all preserved** — existing maze placement code (`ROT_OFFSET`, rotation, ramp stacking) does NOT change.
- Only geometry inside each tile is adjusted.

### Tile types

Six existing tile types, from `TILES` in `src/index.ts`:

| Type | Openings | Notes |
|---|---|---|
| `end` | N | Dead-end room |
| `straight` | N–S | Straight corridor |
| `turn` | N–E | 90° L bend |
| `fork` | N–S–W | T-junction |
| `cross` | N–E–S–W | 4-way intersection |
| `ramp` | N–S | Slope, rises `STEP` (10m) from S to N in canonical orientation |

---

## 5. Masks — data format

Each tile type gets a **canonical (unrotated) mask** — a 2D array of chars, one char per 1m cell. When a tile spawns at rotation `r`, we rotate the mask 90°×r before spawning cells.

**Draft format:**

```ts
// '.' = wall/void (no paint cell)
// 'F' = floor cell (paint spawnable)
// '0'-'9' = ramp cell at height (digit/9) * STEP above tile base
// Row 0 = -Z edge (south); rows grow to +Z (north). Column 0 = -X (west) → +X (east).
// (Text-art orientation may be flipped — align to code once implemented.)

const STRAIGHT_MASK = [
  '................................',
  '................................',
  '............FFFFFFFF............',
  '............FFFFFFFF............',
  // ... 32 rows ...
]
```

**Ramp cells** need one shared rotation quaternion (matching the ramp GLB's slope) so their plane meshes sit flush with the ramp surface.

**Author workflow:**
1. Designer confirms walkable footprint dimensions per tile.
2. Code owner (or designer directly) fills in the 6 mask arrays.
3. Preview → walk → observe coverage → iterate.

---

## 6. Coordinate math (implementation notes)

Given player world position `(px, py, pz)`:

1. Determine which **maze grid cell** they're in: `mgx = floor(px / CELL)`, `mgz = floor(pz / CELL)`.
2. Look up which tile (if any) sits at `(mgx, mgz, py-rounded-to-STEP)` in the maze `grid` Map.
3. Compute **local tile coordinates** by subtracting the tile origin and undoing rotation.
4. Compute **cell index within tile**: `cellX = floor(localX / 1m)`, `cellZ = floor(localZ / 1m)`.
5. If that cell exists in the tile's mask → mark it painted with the player's team color.

Coverage counter walks the master painted-cells map periodically (not every frame) and counts by team.

---

## 7. Multiplayer notes (deferred — Phase 4)

- Paint state = one byte per cell in a synced bitfield. Cell IDs are stable (deterministic from tile position + local cell). Late joiners receive the full bitfield on spawn.
- Player positions are already engine-synced — no custom sync for movement.
- Cell updates should be **debounced/batched** to avoid a flood of tiny CRDT updates when a player walks across cells rapidly.
- Round events (start / end / reset) via `MessageBus`.

---

## 8. Known unknowns / open questions

1. **Draw call batching** — DCL SDK7 does it batch same-material planes across entities? Need to test with ~5k+ plane entities in one scene.
2. **Ramp cell rotation** — how the ramp GLB's slope is expressed and how to derive the exact tilt for the child cells. Likely `Quaternion.fromEulerDegrees(-rampAngle, 0, 0)` applied after tile rotation.
3. **Cell material updates cost** — is `Material.setPbrMaterial` on 20-50 cells per frame (player crossing a lot of cells) cheap enough? If not, batch or defer.
4. **Team assignment UX** — button, auto-balance, or player choice? Deferred to Phase 3.
5. **Player-attached "foot color indicator"** — the trail approach's foot disc was nice UX. Consider bringing it back as a purely-visual (non-scoring) attach.

---

## 9. Repo state at handoff

**Branch:** `squareoff` (tracks `squareoff` remote at `github.com/iillee/squareoff`, private).
**Base:** `main` branch of `labyrinthia` repo (still on `origin`, public, not modified by squareoff work).
**Reference branch:** `drip` (local only) — contains the rejected trail-approach prototype.

**History note:** The squareoff remote had its history rewritten with `git filter-branch` to purge `HomeAgain_Loop.wav` (52MB) from all reachable commits. Clone size is ~3MB. Local `main` and `drip` still contain the WAV since they weren't rewritten — harmless.

**Files of interest:**
- `src/index.ts` — maze code + wiring for paint. `spawnCellsForTile` called from `spawnTileWithGrow` (line ~520); `initPaintingSystem` called from `main()` with a `lookupTile` closure over the maze grid.
- `src/paint.ts` — the whole paint system: masks, `rampGeometry`, `spawnCellsForTile`, `worldToCellId`, coverage, painting system with grounded gating + 3x3 footprint.
- `src/ui.tsx` — hint pill + mute button + coverage pill (red% — blue%).
- `src/stress.ts` — dormant plane-spawn stress harness (`STRESS_COUNT = 0`).
- `assets/models/tile-*.glb` — re-exported tiles with 1m-grid-aligned walkable footprints, white surfaces, floor slab 0.25 local (0.5m world) above origin.
- `assets/images/pallet.jpeg` — team color source: red `#FF7577`, blue `#6A99FC`.
- `assets/images/subdivisions.jpg` — designer's mockup that guided mask authoring.
- `SQUAREOFF-DESIGN.md` — this file.

---

## 10. Phase 1 — what actually shipped

All checklist items done, live on `labyrinthia.dcl.eth`.

**Mask conventions (canonical / unrotated):**
- Row 0 = south (–Z), row `SIZE-1` = north (+Z).
- Col 0 = west (–X), col `SIZE-1` = east (+X).
- Mask is rotated 90° CW per tile `r` via `rot90cw` before iteration.
- Chars: `.` = void, `F` = flat cell, `0`–`9` = height digit (unused now that ramps take a dedicated path).

**Ramp handling (dedicated path in `spawnCellsForTile`):**
- Flat landings at both ends (1 cell wide each; controlled by `RAMP_FLAT_END`).
- Incline cells spaced at `cellSize` intervals *along the slope* (not horizontally) so 2m squares tile flush across the tilted surface with no gaps and no size compensation.
- Incline cells tilted around the tile's slope axis by `atan(STEP / inclineLen)`.
- `rampCellIdxFromCanonical` is shared by spawn and `worldToCellId` so painting-under-player uses the exact same cell IDs the spawner assigned.

**Painting behavior:**
- 3×3 cell footprint centered on player.
- Grounded gate: center-cell `groundY` must be within `0.4m` of player Y or the whole footprint is skipped (rejects jumps / glides / falls). Neighbor cells additionally reject if `|player.y – cellGroundY| > 1.5m` (skips cells on other floors).
- Cell materials: matte PBR (`roughness=1`, `metallic=0`, `specularIntensity=0`).
- Paint cells spawn 500ms after the tile's grow-in tween so tiles pop in before their grid appears.

**Deploy workflow (important — don't use `/deploy` alone):**
```
npx sdk-commands build
npx sdk-commands deploy --skip-build --target-content https://worlds-content-server.decentraland.org
```

The built-in `/deploy` (and plain `sdk-commands deploy`) internally runs a `--production` build. In production mode the bundler treats `assets/scene/main.composite` (Creator Hub visual editor artifact + `@dcl/asset-packs` runtime) as the primary scene source and tree-shakes our TypeScript entry, producing a broken 585KB bundle with none of our code. The two-step workflow avoids this by using the non-production 6.5MB bundle. See open question in §8 for a proper long-term fix.

---

## 11. Next Steps (in order)

Recommended path for the next session:

1. **Real-world stress observations.** With the scene deployed live, note any FPS issues, dropped frames during tile grow-in, regen churn from lever spam, etc. If problems appear, tune (drop SIZE further, shrink footprint, etc.) before adding features.
2. **Phase 3 first (before Phase 2).** Add two-team support (Red + Blue, palette colors already in `TEAM_COLORS`). Team assignment via a simple UI button or auto-assign on join. Once two teams exist, painting is competitive and interesting even before round timers or sync.
3. **Phase 2.** Round timer + win banner + reset. Now meaningful because coverage % is a two-sided race.
4. **Phase 4 (sync).** The big one before any competitive multiplayer. Approach per §7: one synced entity holding the whole paint bitfield (NOT one entity per cell), debounced batched writes per player, snapshot-on-join for late joiners.
5. **Phases 5–7.** Combat, damage in enemy paint, squid-swim. Only after Phases 2–4 are solid.

**Also worth doing when convenient:**
- Investigate the composite / production-build issue properly. Options: annotate `main()` to preserve it, mark `src/index.ts` as `sideEffects: true` in `package.json`, or delete `main.composite` (after reproducing the SpawnArea1 + Labyrinthia asset it contains in code).
- Foot color indicator under the player (mentioned as §8.5 open question). Nice UX polish once teams exist.

**Do NOT** attempt Phases 5+ until Phases 2–4 are solid.

---

## Appendix — key constants (as of Phase 1 close)

**`src/index.ts`:**
```ts
const TILE_SCALE = 2                                  // tiles scaled 2x on spawn
const CELL = 16 * TILE_SCALE                          // = 32m per maze grid cell
const GRID_W = Math.floor(160 / CELL)                 // = 5 cells across
const GRID_H = Math.floor(160 / CELL)                 // = 5 cells across
const STEP = 5.3835 * TILE_SCALE                      // = 10.767m ramp Y rise (from new GLB geometry)
const MAX_Y = 120                                     // max stack height
```

**`src/paint.ts`:**
```ts
const SIZE = 16                                       // cells across a tile → 2m cells
const ARM = 10                                        // corridor width in cells (= SIZE * 20/32)
const LO = 3, HI = 13                                 // corridor band bounds
const RAMP_FLAT_END = 1                               // cells of flat landing at each ramp end
export const FLAT_OFFSET = 0.275 * 2                  // = 0.55m world above tile origin
const WALKABLE_TOP = 0.5                              // top of floor slab in world meters
const SPAWN_DELAY_MS = 500                            // paint cells wait for tile grow-in tween
const GROUND_TOLERANCE = 0.4                          // grounded threshold for painting
```

The grid `Map` key in `src/index.ts` rounds Y to 3 decimals — `STEP` is a float now and raw arithmetic drifts, which previously silently broke the "no tile above ramp" rule.
