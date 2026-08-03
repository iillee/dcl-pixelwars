# Phase 4 — Authoritative Server & Synced Paint

Status: **Step 1 shipped** (scaffolding + hello-world roundtrip). Steps 2–7 pending.

## Why an authoritative server (not pure CRDT)

Options considered:

- **A. Pure CRDT sync** — one synced entity holding the paint bitfield, MessageBus
  for deltas. No hosting. Ships fastest. Cheatable (no validator), and every
  paint event fans out N-times per client, which is exactly the traffic pattern
  that caused flagtag's message-drop bugs.
- **B. Authoritative headless server** (chosen) — server owns the paint bitfield,
  team roster, round state. Clients send positions; server computes paint,
  validates, batches, broadcasts. ~10× less message volume than pure CRDT at
  the same gameplay density, because the server deduplicates and batches at a
  fixed tick. Also unlocks Phase 5 (combat + damage-in-enemy-paint) without a
  rewrite.

## Saturation budget (hard limits — write once, enforce forever)

Documented at the top of `src/shared/messages.ts`. These are the rules that
prevent us from repeating flagtag's saturation problems.

- **Server broadcast tick:** 5 Hz. Never send outside the tick loop.
- **Client position ingest:** 10 Hz max per client. Drop excess at ingress.
- **Delta batch cap:** 200 cell changes per broadcast. Split across ticks if larger.
- **Snapshot on join only.** Not on demand. Rate-limit re-request to 1 per 5s.
- **No `syncEntity` for hot state.** CRDT is for infrequent low-volume data only
  (roundIndex, seed). Everything hot goes over `registerMessages` (WS).
- **Coverage counters live on the server** and travel inside the delta message.
  Clients read them; they don't recompute. Zero extra traffic, guaranteed
  consistency across clients.

Every server send routes through a single `enqueueDelta()` → drained by the
tick loop. Nothing can accidentally fire per-event.

## Architecture

```
src/
├── index.ts             # thin router — isServer() branch, dynamic import
├── client.ts            # existing scene code (client-only runtime)
├── shared/
│   └── messages.ts      # registerMessages() — schema shared client+server
└── server/
    ├── server.ts        # entry: setupServer(), registers handlers
    ├── roster.ts        # (Step 2) userId → team, index % 2 alternation
    ├── paintState.ts    # (Step 3) bitfield ops, coverage counters
    └── roundLoop.ts     # (Step 6) UTC boundary, broadcast roundReset
```

Shared helpers (needed on both sides — extract from `paint.ts` when Step 3 lands):
- `worldToCellId(x, y, z)` — canonical position → cell index
- Cell index compaction for bitfield storage

## Local dev workflow

```
npm run start:server    # terminal A — headless hammurabi-server
npm run start           # terminal B — preview client
```

Server logs: `npm run server-logs` (production deploys).

## Step ledger

Each step is independently testable and shippable. Do not combine.

### ✅ Step 1 — Scaffolding + hello-world roundtrip

- Pin `@dcl/sdk` to auth-server build (`7.24.6-...commit-d270434`).
- `authoritativeMultiplayer: true` in scene.json.
- `src/index.ts` router; `src/client.ts` hosts the existing scene code.
- `src/shared/messages.ts` with ping/pong.
- `src/server/server.ts` with `setupServer()` + ping handler.
- Client sends one ping on boot; logs pong RTT.

**Exit criteria:** browser console shows `pong received — rtt Xms`; server
terminal shows the matching ping log line.

### Step 2 — Roster + team assignment

- Server owns `roster: string[]` (userIds in join order).
- Client → server: `joinRoster { userId }` on client boot.
- Server appends if new, computes `team = index % 2`, sends
  `teamAssigned { team }` back to that player only.
- Client's `teamFromUserId` hash replaced with the server-assigned value.
- Server tracks player-leave (via SDK player presence) and does NOT compact
  the roster — leaves gaps, keeps team assignments stable across rejoin.

**Why:** guaranteed alternation. Fixes the 2-blue-players-in-a-row issue
permanently. Client still assumes hash for remote-player team indicators
(no visual difference today; will be replaced when we broadcast the roster).

**Exit criteria:** two clients join simultaneously; server logs show them on
opposite teams; the HUD reflects the assignment.

### Step 3 — Paint bitfield (client → server, no broadcast yet)

- Server allocates `Uint8Array` sized to the max possible cell count.
  Byte value: 0 = unpainted, 1 = red, 2 = blue.
- Extract `worldToCellId` to `src/shared/cellId.ts` (needed by both sides).
- Client → server: `positionTick { x, y, z }` at 10 Hz (rate-limited server-side).
- Server computes the 3×3 footprint each tick, updates bitfield, increments
  coverage counters. **Still no broadcast** — this step verifies ingest is
  clean and coverage stays sane.

**Exit criteria:** server logs coverage every 5s; matches what the local
client would compute if it were still painting locally.

### Step 4 — paintDelta broadcast

- Server accumulates `changes: [cellIdx, team][]` between ticks.
- Tick loop (5 Hz): if any changes queued, `send('paintDelta', ...)` to all.
  Include `coverage: { red, blue, total }` in every delta.
- Client stops painting locally. Adds `onMessage('paintDelta')` receiver that
  looks up the local cell entity by cellIdx and calls `Material.setPbrMaterial`.
- Coverage HUD reads from a client-side mirror updated on delta receipt.

**Exit criteria:** two clients see each other paint in real time; coverage
pill stays consistent across both clients.

### Step 5 — Snapshot on join

- Client → server: `requestSnapshot` once, after `teamAssigned`.
- Server sends `snapshot { bitfield: Uint8Array }`. If >200KB, chunk across
  multiple messages with a sequence tag.
- Client applies snapshot on receipt (batched material updates over 2–3 frames
  so we don't hitch).

**Exit criteria:** late joiner sees the current board within 2s of joining;
no gray/unpainted flicker.

### Step 6 — Server-driven round reset

- Server owns the round loop (`round.ts` logic moves to `server/roundLoop.ts`).
- On UTC boundary: clear bitfield, reset coverage, `send('roundReset', { roundIndex, seed })`.
- Client removes its own round-boundary detector. On `roundReset` receipt:
  clear local paint cell materials, show win banner, teleport to center.
- Seed for the new maze is server-generated and included in the message —
  no `SeedHolder` sync needed for round-driven rebuilds (kept only as
  dev-lever override path).

**Exit criteria:** all clients transition to the new round within one
network hop of each other; coverage snaps to 0/0 simultaneously.

### Step 7 — Cleanup + docs

- Remove `syncEntity` from `SeedHolder` (no longer needed).
- Remove client-side coverage computation (server is source of truth).
- Document the final message schema and server module boundaries.
- Add a `docs/PHASE_5_PLAN.md` skeleton for combat.

## What is NOT in Phase 4

- Persistent storage (leaderboards, all-time stats). Zero storage writes this
  phase — rounds live in RAM only. Reserved for Phase 6+.
- Anti-cheat position validation. Server trusts `positionTick` for now; a
  malicious client could paint anywhere they claim to be. Adding a distance/
  speed sanity check is a small follow-up when it matters (Phase 5, when
  combat gives cheating actual game impact).
- Server-authoritative combat / damage-in-enemy-paint. Phase 5.

## Open questions to resolve before Step 2

1. **Production hosting:** Foundation/Decentraland provides hammurabi-server
   hosting for scenes with `authoritativeMultiplayer: true`. Confirm the
   deployment path is the same as flagtag's (deploy scene → server auto-starts
   from `src/server/server.ts` entry).
2. **Server-side player presence:** server needs to detect join/leave to
   maintain the roster. Confirm the SDK API (flagtag uses
   `playerTracking.ts` — check the pattern before Step 2).
