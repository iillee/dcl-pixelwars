/**
 * messages.ts — shared WS message schema for Pixelwars auth server.
 *
 * Registered from both client and server (identical schema). Follows the
 * flagtag pattern of a single `room` handle returned by registerMessages().
 *
 * Message set: joinRoster/teamAssigned, paintTick, paintDelta,
 * requestSnapshot/snapshot, roundReset. The Phase 4 ping/pong diagnostic
 * was retired once real gameplay traffic became the health signal.
 *
 * SATURATION DISCIPLINE (write ONCE, enforce forever):
 *   - Server broadcast tick:   5 Hz     (never send outside the tick loop)
 *   - Client position ingest: 10 Hz max (rate-limit at server ingress)
 *   - Delta batch cap:        200 cell changes per broadcast (split if larger)
 * See archive/docs/PHASE_4_PLAN.md for the reasoning (fixes flagtag saturation issue).
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // Client → Server
  // Sent once on client boot after PlayerIdentityData is populated.
  // Server appends to roster if new, replies with teamAssigned to the sender.
  joinRoster: Schemas.Map({ userId: Schemas.String }),

  // Server → Client
  // team values match the Team enum in src/paint.ts: 1 = Red, 2 = Blue.
  // Assignment is `roster.indexOf(userId) % 2` — stable across rejoin,
  // and guaranteed to alternate (fixes the "two blue players in a row"
  // issue the Phase 3 client hash could produce).
  teamAssigned: Schemas.Map({ team: Schemas.Int }),

  // Client → Server: cells painted by the sender since the last flush.
  // Sent at 10 Hz. Server looks up sender's team from roster, applies to
  // the authoritative paint map, logs coverage.
  // WHY ids and not positions: server doesn't have the maze generator (it's
  // client-only for now), so it can't resolve position -> cell. Client
  // authors ids via worldToCellId locally; server trusts them for Phase 4.
  // Anti-cheat (position validation) is deferred to Phase 5 per the plan.
  // Rate limit: server caps at 100 ids per message (3x3 footprint @ 10Hz
  // is 90 max; anything larger is dropped as suspicious).
  paintTick: Schemas.Map({ ids: Schemas.Array(Schemas.String) }),

  // Server → Client: broadcast of paint state changes accumulated since
  // the last server tick (5Hz). Every delta carries the current coverage
  // counters so no separate poll message is needed — HUD stays in sync
  // for free. Sent to ALL clients on every non-empty tick.
  // last-write-wins per cellId within a tick (server dedupes in a Map).
  paintDelta: Schemas.Map({
    changes: Schemas.Array(Schemas.Map({ id: Schemas.String, team: Schemas.Int })),
    red: Schemas.Int,
    blue: Schemas.Int,
    total: Schemas.Int,
  }),

  // Client → Server: request the current authoritative paint state.
  // Sent once after teamAssigned so a reloaded/late-joining client sees
  // the round's existing paint instead of a blank maze. Server rate-limits
  // (1 per 5s per sender) to prevent snapshot floods.
  requestSnapshot: Schemas.Map({}),

  // Server → Client (addressed): full paint map at the moment of send.
  // At ~1500 walkable cells max per maze, worst case ~30KB — fits in one
  // WS frame with room to spare, no chunking. If mazes grow or we go
  // Uint8Array-backed in Step 5+, add a sequence tag and split.
  snapshot: Schemas.Map({
    entries: Schemas.Array(Schemas.Map({ id: Schemas.String, team: Schemas.Int })),
    red: Schemas.Int,
    blue: Schemas.Int,
    total: Schemas.Int,
    // Current round's maze seed (= server round index): late joiners build the maze from this
    // even if the SeedHolder CRDT never reaches them.
    seed: Schemas.Int,
  }),

  // Server → Client (broadcast): UTC round boundary crossed. Carries the
  // authoritative final score of the just-ended round (all clients show
  // the same banner — no more "one player sees red won, another sees
  // tie") plus the seed for the new round. Server has already cleared its
  // paint state before sending, so the next paintDelta — if any — shows
  // the new round's counts.
  // finalTotal is server-side painted-cell count; client re-derives the
  // banner denominator from its own walkable-cell count (same math as HUD).
  // Server → Client: the server-owned round (round-on-join). Broadcast on start / boundary / idle, and sent to
  // each joiner (joinRoster, requestSnapshot). remainingMs is relative so client clock skew doesn't matter.
  roundClock: Schemas.Map({ idx: Schemas.Int, remainingMs: Schemas.Int, active: Schemas.Boolean }),

  roundReset: Schemas.Map({
    seed: Schemas.Int,
    finalRed: Schemas.Int,
    finalBlue: Schemas.Int,
    finalTotal: Schemas.Int,
  }),

  // Client → Server: send this player's display name once on join so
  // the leaderboard shows human-readable names instead of wallet hashes.
  // Server captures into its player-name directory and patches existing
  // leaderboard entries in place.
  updateName: Schemas.Map({ name: Schemas.String }),

  // Server → one client (addressed), sent just before roundReset: this
  // player's contribution in the round that ended. cells = cells they
  // flipped to their team; teamCells = sum over their teammates.
  // Server → Clients (broadcast), sent just before roundReset: cells each painter OWNS at round end
  // (last painter of each cell). id = player address or `bot:<id>`. Largest first.
  roundOwners: Schemas.Map({
    owners: Schemas.Array(Schemas.Map({ id: Schemas.String, name: Schemas.String, team: Schemas.Int, cells: Schemas.Int, kos: Schemas.Int, deaths: Schemas.Int, painted: Schemas.Int })),
  }),
  // Client → Server: score-bar popup wants live standings; Server → that client: same rows as roundOwners.
  requestStandings: Schemas.Map({}),
  // Client → Server every PRESENCE_PING_S: "I'm still here". Server presence for round-on-join
  // (rounds chain only while someone pinged recently; a ping while idle starts a round).
  presencePing: Schemas.Map({}),
  standings: Schemas.Map({
    owners: Schemas.Array(Schemas.Map({ id: Schemas.String, name: Schemas.String, team: Schemas.Int, cells: Schemas.Int, kos: Schemas.Int, deaths: Schemas.Int, painted: Schemas.Int })),
  }),

  roundResult: Schemas.Map({ cells: Schemas.Int, teamCells: Schemas.Int, team: Schemas.Int }),

  // Server → Clients (broadcast): every active player's team. Sent on
  // join, leave and round reset. Clients use it to paint red/blue
  // AvatarNametag plates on each avatar (client/nametags.ts).
  teamRoster: Schemas.Map({
    entries: Schemas.Array(Schemas.Map({ userId: Schemas.String, team: Schemas.Int })),
  }),

  // Client → Server: request an immediate fresh copy of the leaderboard.
  // Fires when the player opens the popup mid-round so they see current
  // standings without waiting for the next round boundary broadcast.
  requestLeaderboard: Schemas.Map({}),

  // Server → Clients: broadcast bot positions at 2 Hz so clients can
  // render one box per bot. Cheap: 3 bots × ≈20 bytes each. Bots are
  // server-owned virtual painters (see server/bots/manager.ts); this is
  // purely visual — all authoritative paint still flows via paintDelta.
  botPositions: Schemas.Map({
    bots: Schemas.Array(Schemas.Map({
      id: Schemas.Int,       // stable per-bot id (survives round reset if bot survives)
      team: Schemas.Int,     // 1 = Red, 2 = Blue
      x: Schemas.Number,
      y: Schemas.Number,
      z: Schemas.Number,
    })),
  }),

  // Dash PvP prototype (shared/pvp.ts, design/pvp-prototype.md).
  // Client → Server: the sender's dash touched `target` (PlayerIdentityData
  // address) on the sender's screen. dx/dz = horizontal push direction.
  // The server can't see positions, so distance is the attacker's call;
  // it validates teams, round mode and per-attacker rate only.
  dashHit: Schemas.Map({ target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number }),

  // Server → Clients (broadcast): an accepted dashHit. The target's own
  // client applies the knockback (a scene can only push its local player);
  // everyone else shows the impact effect. dx/dz normalised by the server.
  dashImpact: Schemas.Map({ attacker: Schemas.String, target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number }),

  // Lunge (shared/pvp.ts LUNGE_*, client/lunge.ts). Client → Server: we
  // started lunge `id` (per-client counter) at (x, y, z) along (dx, dz).
  // Server checks cooldown and rebroadcasts lungeStarted so every client
  // can show the lunge on that avatar.
  lungeStart: Schemas.Map({ id: Schemas.Int, dx: Schemas.Number, dz: Schemas.Number, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),
  lungeStarted: Schemas.Map({ attacker: Schemas.String, id: Schemas.Int, dx: Schemas.Number, dz: Schemas.Number, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),
  // Client → Server: lunge `id` touched `target` (player address, or
  // "bot:<id>"); (dx, dz) = knockback direction, (x, y, z) = attacker pos.
  lungeHit: Schemas.Map({ id: Schemas.Int, target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),
  // Server → Clients: accepted hit (once per lunge id + target). A player
  // target knocks itself back; everyone shows the impact.
  lungeImpact: Schemas.Map({ attacker: Schemas.String, id: Schemas.Int, target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number }),

  // Paint Burst (shared/pvp.ts BURST_*, client/paintBurst.ts, shared/burst.ts).
  // Client → Server: burst at (x, y, z) on `cell`, facing (fx, fz). Server checks the cooldown, paints the
  // footprint once and rebroadcasts burstFired.
  burstUse: Schemas.Map({ id: Schemas.Int, cell: Schemas.String, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, fx: Schemas.Number, fz: Schemas.Number }),
  burstFired: Schemas.Map({ attacker: Schemas.String, id: Schemas.Int, team: Schemas.Int, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),
  // Client → Server: burst `id` reached `target` (player address); (dx, dz) outward.
  burstHit: Schemas.Map({ id: Schemas.Int, target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number }),
  // Server → Clients: accepted hit (player or "bot:<id>"). The player target knocks itself back.
  burstImpact: Schemas.Map({ attacker: Schemas.String, id: Schemas.Int, target: Schemas.String, dx: Schemas.Number, dz: Schemas.Number }),

  // Shared anvil dummies (server/anvils.ts owns them; shared/anvilSim.ts).
  // Client → Server: lunge (kind 0) or burst (kind 1) `id` hit anvil `i`, knock direction (dx, dz).
  anvilHit: Schemas.Map({ kind: Schemas.Int, id: Schemas.Int, i: Schemas.Int, dx: Schemas.Number, dz: Schemas.Number }),
  // Client → Server: key 2, re-roll all anvils.
  anvilRespawn: Schemas.Map({ n: Schemas.Int }),
  // Client → Server (round stats): anvil i launched me / I fell off and respawned.
  anvilLaunched: Schemas.Map({ i: Schemas.Int }),
  playerFell: Schemas.Map({}),
  // Client → Server: walking/running into anvil i (direction dx,dz; our position x,z). Server moves it slowly.
  anvilPush: Schemas.Map({ i: Schemas.Int, dx: Schemas.Number, dz: Schemas.Number, x: Schemas.Number, z: Schemas.Number, run: Schemas.Int }),
  // Server → Clients: all anvils (feet pos, velocity, yaw, alive, moving, slide = hit/respawn counter).
  anvilState: Schemas.Map({ a: Schemas.Array(Schemas.Map({
    x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, vx: Schemas.Number, vy: Schemas.Number, vz: Schemas.Number,
    yaw: Schemas.Int, alive: Schemas.Int, moving: Schemas.Int, slide: Schemas.Int,
  })) }),

  // Paint Bomb (shared/pvp.ts). Client → Server: drop a bomb at the
  // sender's position. Server checks round mode, team and cooldown, snaps
  // it to the floor, broadcasts bombArmed, and after BOMB_FUSE_S paints
  // the circle itself from its walkable graph (no client cell ids, so the
  // paintTick cap doesn't apply) and broadcasts bombBlast.
  bombDrop: Schemas.Map({ x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),

  // Server → Clients (broadcast): telegraph. Everyone shows the blinking
  // bomb + fuse + blast-area ring at (x, y, z).
  bombArmed: Schemas.Map({ attacker: Schemas.String, team: Schemas.Int, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number }),

  // Server → Clients (broadcast): detonation. Everyone shows the explosion;
  // opponents of `team` within BOMB_KNOCKBACK_RADIUS push themselves.
  // Painted cells arrive through the normal paintDelta tick.
  bombBlast: Schemas.Map({ attacker: Schemas.String, team: Schemas.Int, x: Schemas.Number, y: Schemas.Number, z: Schemas.Number, cells: Schemas.Int }),
}

export const room = registerMessages(Messages)
