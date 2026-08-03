/**
 * server.ts — Squareoff authoritative server entry point.
 *
 * Thin orchestrator, flagtag-pattern. Runs in the headless SDK server
 * process (hammurabi-server). No 3D, no ~system/RestrictedActions —
 * pure state + WS message handling.
 *
 * PHASE 4 STEP 1: hello-world only. Handles ping → broadcasts pong.
 * Domain modules (roster, paintState, roundLoop) arrive in later steps.
 */

import { room } from '../shared/messages'
import { assignTeam, rosterSize } from './roster'

export async function setupServer(): Promise<void> {
  console.log('[Server] Starting Squareoff server...')

  // Ping handler — echo a pong to the sender. Kept for Phase 4 diagnostics;
  // will retire once real gameplay messages are the health signal.
  room.onMessage('ping', ({ t }, context) => {
    const from = context?.from ?? '<unknown>'
    const serverT = Date.now()
    console.log(`[Server] ping from ${from} (client t=${t}) → pong ${serverT}`)
    if (context?.from) {
      room.send('pong', { t, serverT }, { to: [context.from] })
    }
  })

  // Roster handler — assign or look up a player's team.
  // Client sends joinRoster once on boot; we reply teamAssigned to that sender only.
  // Idempotent: repeated calls for the same userId return the same team.
  // Trust model: userId comes from context.from (authenticated by hammurabi),
  // NOT from the payload's userId field — payload is redundant but useful
  // for logging early-connect diagnostics.
  room.onMessage('joinRoster', ({ userId }, context) => {
    const from = context?.from
    if (!from) {
      console.log(`[Server] joinRoster rejected: no context.from (payload userId=${userId})`)
      return
    }
    if (from !== userId) {
      // Not an error — client may not have context.from's exact address casing.
      // We ignore the payload and use context.from as authoritative.
      console.log(`[Server] joinRoster payload/from mismatch (payload=${userId}, from=${from}) — using from`)
    }
    const team = assignTeam(from)
    console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()})`)
    room.send('teamAssigned', { team }, { to: [from] })
  })

  console.log('[Server] ✅ Ready — listening for ping, joinRoster.')
}
