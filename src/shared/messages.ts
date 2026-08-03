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
  ping: Schemas.Map({ t: Schemas.Int }),

  // Server → Client
  pong: Schemas.Map({ t: Schemas.Int, serverT: Schemas.Int }),
}

export const room = registerMessages(Messages)
