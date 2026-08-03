/**
 * messages.ts — shared WS message schema for Squareoff auth server.
 *
 * Registered from both client and server (identical schema). Follows the
 * flagtag pattern of a single `room` handle returned by registerMessages().
 *
 * PHASE 4 STEP 1: only ping/pong exist — smoke-test that the client-server
 * pipeline is up. Real gameplay messages (positionTick, paintDelta, snapshot,
 * roundReset, joinRoster, teamAssigned) land in later steps.
 *
 * SATURATION DISCIPLINE (write ONCE, enforce forever):
 *   - Server broadcast tick:   5 Hz     (never send outside the tick loop)
 *   - Client position ingest: 10 Hz max (rate-limit at server ingress)
 *   - Delta batch cap:        200 cell changes per broadcast (split if larger)
 * See docs/PHASE_4_PLAN.md for the reasoning (fixes flagtag saturation issue).
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // Client → Server
  // NB: Schemas.Number (float64) not Schemas.Int (int32) for timestamps —
  // Date.now() overflows int32 (Step 1 shipped with a negative t value).
  ping: Schemas.Map({ t: Schemas.Number }),
  // Sent once on client boot after PlayerIdentityData is populated.
  // Server appends to roster if new, replies with teamAssigned to the sender.
  joinRoster: Schemas.Map({ userId: Schemas.String }),

  // Server → Client
  pong: Schemas.Map({ t: Schemas.Number, serverT: Schemas.Number }),
  // team values match the Team enum in src/paint.ts: 1 = Red, 2 = Blue.
  // Assignment is `roster.indexOf(userId) % 2` — stable across rejoin,
  // and guaranteed to alternate (fixes the "two blue players in a row"
  // issue the Phase 3 client hash could produce).
  teamAssigned: Schemas.Map({ team: Schemas.Int }),
}

export const room = registerMessages(Messages)
