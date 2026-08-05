# Labyrinthia · Squareoff

A team tile-coverage game played on a procedurally generated 3D maze, built for Decentraland with SDK7.

**Squareoff** — two teams (Red and Blue) run around a fresh maze every round, painting the walkable surface in their color just by walking on it. Highest coverage at the round timer wins. Inspired by Splatoon's *Turf War*.

**Labyrinthia** — the arena underneath. Every round a new maze is grown from a small set of modular tile pieces (corridors, forks, crossings, multi‑level ramps) that stack into a 10×10 parcel labyrinth (160m × 160m). Seed is derived from a UTC round boundary so every player sees the same maze at the same instant with zero sync overhead.

**Multiplayer:** authoritative headless server (`authoritativeMultiplayer: true`) owns the paint state and round clock; clients render and stream paint ticks at 10 Hz, server broadcasts deltas at 5 Hz.

**Live:** [labyrinthia.dcl.eth](https://play.decentraland.org/?realm=labyrinthia.dcl.eth)

The scene is intended to be **downloaded, remixed, and shared**. All source assets (Blender, SketchUp) are included alongside the exported `.glb` tiles so you can swap in your own geometry and generate entirely new worlds from the same rule set. See [`assets/docs/SQUAREOFF-DESIGN.md`](assets/docs/SQUAREOFF-DESIGN.md) for the game design doc.

---

## Design references

| Plan view | Axonometric |
|---|---|
| ![Plan](assets/images/blocks_plan.png) | ![Axon](assets/images/blocks_axon.png) |

---

## How it works

### The tile catalog

Six modular tiles, each defined by a set of open edges in a canonical orientation (N/E/S/W). The generator considers all 4 rotations of each tile at every cell.

| Tile | Openings | Purpose |
|---|---|---|
| `end` | N | Seed / cap for dead ends |
| `straight` | N, S | Corridor |
| `turn` | N, E | 90° corner |
| `fork` | N, S, W | T‑junction |
| `cross` | N, E, S, W | 4‑way intersection |
| `ramp` | N, S | Two‑level connector (S is low, N is high) |

Source models live in [`assets/models/`](assets/models/) as `.glb` files. Original modeling files:

- [`assets/blender/tiles.blend`](assets/blender/) — Blender source
- [`assets/sketchup/tiles.skp`](assets/sketchup/) — SketchUp source

### Generation algorithm

Maze growth is a frontier‑based flood‑fill with vertical stacking:

1. **Seed** — about 1 seed per 25 parcels are dropped as `end` tiles at random cells on the ground level.
2. **Grow** — the open edges of placed tiles feed a frontier queue. Cells are consumed lowest‑Y first (so each floor fills horizontally before ramps climb).
3. **Pick a tile** — a weighted pool favours branching/ramp tiles (`ramp ×3, cross ×2, fork ×2, turn, straight`), falling back to `end` only when nothing else fits.
4. **Validate placement** — each candidate must pass strict connectivity checks: openings can't face off‑grid or into a wall, ramps can't collide vertically, and multi‑level ramp interactions must "handshake" correctly (see `canPlace()` in [`src/client.ts`](src/client.ts) for the full ruleset).
5. **Validate result** — after growth, every opening on every placed tile must connect to a matching neighbour. If any dangle, discard and retry with a new seed (up to 500 attempts).

Ramps are the tricky part. Because a ramp's high side lands one level up in an adjacent cell, they interact with neighbours on multiple Y levels simultaneously. The generator enforces several rules to keep stairs walkable:

- Cells directly above a ramp must be empty or another ramp of the **same rotation**.
- Parallel same‑axis ramps on different levels must climb in the **same direction** (no fragile "V" configurations).
- When two orthogonally‑adjacent ramps interact, either their rotations match (matched handshake) or they meet edge‑to‑edge at their shared high edges.

Generation is deterministic given a seed: the RNG is a small mulberry32, and the winning seed is logged to the browser console on each generation so any bug can be reproduced exactly.

---

## Remix guide

The maze generator lives in [`src/client.ts`](src/client.ts) (it runs on the client since it's purely visual — the server only tracks paint state). Common tweaks:

| Want to… | Change |
|---|---|
| Use bigger/smaller tiles | `TILE_SCALE` (currently `2`) |
| Change ramp step height | `STEP` (derived from `TILE_SCALE`) |
| Bias the tile mix | `GROWTH_PRIMARY` weighted array |
| More/fewer seed points | `SEED_COUNT` formula in `generate()` |
| Cap tower height | `MAX_Y` |
| Lock a specific maze | Hard‑code a seed instead of deriving from `getRoundIndex()` in `client.ts` |
| Swap the geometry | Replace files in `assets/models/` (keep the same names & pivot at SW corner) |

Tile pivots are at the south‑west corner with geometry extending `+X` / `+Z`. If you author replacements with a centred pivot you'll need to adjust `ROT_OFFSET` in `src/client.ts`.

---

## Run locally

```bash
npm install
npm start
```

Preview opens in your browser via the Decentraland SDK dev server.

## Deploy

Scene is configured as a Decentraland World in [`scene.json`](scene.json) (`worldConfiguration.name: "labyrinthia.dcl.eth"`).

```bash
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

To deploy to your own World, change `worldConfiguration.name` to a DCL NAME or ENS you own.

---

## Project structure

```
maze/
├── assets/
│   ├── blender/            # Blender source (.blend)
│   ├── sketchup/           # SketchUp source (.skp)
│   ├── images/             # Design reference art
│   ├── models/             # Exported .glb tiles used by the scene
│   └── scene/              # Creator Hub composite
├── src/
│   ├── index.ts            # Entry router — branches on isServer()
│   ├── client.ts           # Maze rendering, painting, input, audio (client runtime)
│   ├── paint.ts            # Grid + paint mechanic
│   ├── round.ts            # Client round timer + end-of-round banner
│   ├── ui.tsx              # HUD (React-ECS)
│   ├── stress.ts           # Load-test harness
│   ├── server/             # Headless authoritative server
│   │   ├── server.ts       # Orchestrator, round loop, message handlers
│   │   ├── roster.ts       # Team assignment
│   │   └── paintState.ts   # Authoritative paint map
│   └── shared/             # Imported by both client and server
│       ├── messages.ts     # WS message schema
│       ├── components.ts   # Shared ECS components
│       └── roundTiming.ts  # Round cadence + UTC helpers
├── scene.json              # Parcels, spawn points, world config
└── package.json
```

---

## AI agents and skills

This project is set up for AI coding agents (Cursor, Claude, Codex, and similar tools). When writing or editing code here, agents should follow the project conventions in [`AGENTS.md`](AGENTS.md) — indentation, annotations, imports, logging, file layout, and related style rules.

Task-specific guidance for Decentraland SDK7 work lives under [`.agents/skills/`](.agents/skills/). Those skill files (from [`decentraland/sdk-skills`](https://github.com/decentraland/sdk-skills)) cover topics such as scene authoring, UI, multiplayer, audio, and deployment. Agents should read and follow the relevant skill before making changes in that area.

If skills are missing locally, install them with:

```bash
npx skills add decentraland/sdk-skills
```

Claude-oriented entry context is also noted in [`CLAUDE.md`](CLAUDE.md).

---

## License

MIT — do whatever you like, credit appreciated but not required. Have fun remixing.
