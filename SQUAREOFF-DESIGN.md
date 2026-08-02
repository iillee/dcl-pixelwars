# Squareoff — Design Document

**Status:** Design phase, pre-implementation. Living on local `squareoff` branch off the `labyrinthia` maze project (not pushed to GitHub).

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

**Focus for the next session:** Phase 1 only.

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

**Branch:** `squareoff` (local only, not pushed)
**Base:** `main` branch of `labyrinthia` repo (deployed to `labyrinthia.dcl.eth`)
**Reference branch:** `drip` (local only) — contains the rejected trail-approach prototype. Look here if you want to see what was tried and why it was abandoned.

**Files of interest on `squareoff`:**
- `src/index.ts` — clean maze code, no paint experiments. Squareoff grid system to be added.
- `src/ui.tsx` — mute button, lever-cooldown label. Needs a coverage % display for squareoff.
- `assets/models/tile-*.glb` — the 6 tile GLBs; being re-exported by designer.
- `assets/images/subdivisions.jpg` — designer's mockup of the 1m grid overlay on each tile type.
- `SQUAREOFF-DESIGN.md` — this file.

---

## 10. Next Steps (in order)

For the fresh session picking this up:

1. **Wait for re-exported tile GLBs + confirmed dimensions from the designer.** Don't code masks against the old GLBs — they're changing.
2. **Author 6 tile masks** based on new GLB dimensions. Start with rough guesses if the designer isn't ready; iterate live.
3. **Implement grid spawn on tile placement.** Hook into the existing tile spawn system in `spawnTileWithGrow` — after the tile appears, spawn its child paint cells with the mask.
4. **Implement painting.** Per-frame: read player pos → tile lookup → local cell math → color change.
5. **Add coverage % pill to UI** next to the existing lever-hint pill.
6. **Stress test:** Force-generate a full maze, walk everywhere, check FPS. If it tanks → drop to 2m cells.
7. **Only then** move to Phase 2 (round timer + win state).

**Do NOT** attempt Phases 3+ until Phase 1 feels tight in single-player.

---

## Appendix — key constants from `src/index.ts` (as of session end)

```ts
const TILE_SCALE = 2                                  // tiles are scaled 2x on spawn
const CELL = 16 * TILE_SCALE                          // = 32m per maze grid cell
const GRID_W = Math.floor(160 / CELL)                 // = 5 cells across
const GRID_H = Math.floor(160 / CELL)                 // = 5 cells across
const STEP = 5 * TILE_SCALE                           // = 10m ramp Y rise
const MAX_Y = 120                                     // max stack height
```

Do not change these — the paint grid is a subdivision within each `CELL`-sized tile.
