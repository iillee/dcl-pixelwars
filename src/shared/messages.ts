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
 * See assets/docs/PHASE_4_PLAN.md for the reasoning (fixes flagtag saturation issue).
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
  }),

  // Server → Client (broadcast): UTC round boundary crossed. Carries the
  // authoritative final score of the just-ended round (all clients show
  // the same banner — no more "one player sees red won, another sees
  // tie") plus the seed for the new round. Server has already cleared its
  // paint state before sending, so the next paintDelta — if any — shows
  // the new round's counts.
  // finalTotal is server-side painted-cell count; client re-derives the
  // banner denominator from its own walkable-cell count (same math as HUD).
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

  // Client → Server: request an immediate fresh copy of the leaderboard.
  // Fires when the player opens the popup mid-round so they see current
  // standings without waiting for the next round boundary broadcast.
  requestLeaderboard: Schemas.Map({}),
}

export const room = registerMessages(Messages)
