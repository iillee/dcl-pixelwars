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

export async function setupServer(): Promise<void> {
  console.log('[Server] Starting Squareoff server...')

  // Ping handler — echo a pong to the sender. Broadcast (not addressed)
  // is fine for smoke-test; per-recipient targeting arrives with real
  // messages that need it (teamAssigned, snapshot).
  room.onMessage('ping', ({ t }, context) => {
    const from = context?.from ?? '<unknown>'
    const serverT = Date.now()
    console.log(`[Server] ping from ${from} (client t=${t}) → pong ${serverT}`)
    // Address the pong back to the sender only — no broadcast noise from smoke-test.
    if (context?.from) {
      room.send('pong', { t, serverT }, { to: [context.from] })
    }
  })

  console.log('[Server] ✅ Ready — listening for ping.')
}
