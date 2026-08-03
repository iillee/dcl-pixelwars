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

import { engine } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { assignTeam, rosterSize, getTeam } from './roster'
import { applyPaint, coverage, drainDelta, getFullState } from './paintState'

// Ingest rate limit: 3x3 footprint at 10Hz = 90 ids max per tick. 100 is
// the generous cap; anything beyond is either a bug or a cheater and we drop
// the whole message rather than half-apply.
const MAX_IDS_PER_TICK = 100

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

  // Paint ingest — client-authored cell ids, attributed to sender's team.
  // If sender hasn't joined the roster yet (race: paint fires before
  // teamAssigned round-trips), drop silently — client will resend on the
  // next tick as new cells accumulate in its outbox.
  room.onMessage('paintTick', ({ ids }, context) => {
    const from = context?.from
    if (!from) return
    const team = getTeam(from)
    if (team === null) return  // pre-roster paint, retry on next tick
    if (ids.length > MAX_IDS_PER_TICK) {
      console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${MAX_IDS_PER_TICK}`)
      return
    }
    for (const id of ids) applyPaint(id, team)
  })

  // Broadcast tick (Phase 4 Step 4). 5Hz — the SATURATION_BUDGET rate
  // from src/shared/messages.ts. Drains accumulated paint changes and
  // sends paintDelta to ALL clients (no `to:`). Coverage rides in every
  // message so HUDs stay in sync without a separate poll. Silent tick
  // (drainDelta returns []) skips the send entirely.
  const BROADCAST_HZ = 5
  const BROADCAST_INTERVAL = 1 / BROADCAST_HZ
  let broadcastClock = 0
  engine.addSystem((dt: number) => {
    broadcastClock += dt
    if (broadcastClock < BROADCAST_INTERVAL) return
    broadcastClock = 0
    const changes = drainDelta()
    if (changes.length === 0) return
    const c = coverage()
    room.send('paintDelta', { changes, red: c.red, blue: c.blue, total: c.total })
  })

  // Coverage log tick (5s). Kept as a low-frequency health signal;
  // paintDelta is the real-time path.
  let coverageClock = 0
  engine.addSystem((dt: number) => {
    coverageClock += dt
    if (coverageClock < 5) return
    coverageClock = 0
    const c = coverage()
    if (c.total > 0) {
      console.log(`[Server] coverage: red=${c.red} blue=${c.blue} total=${c.total}`)
    }
  })

  // Snapshot handler (Phase 4 Step 5). Late/reloading clients ask once
  // after teamAssigned; we reply with the full paint map addressed to
  // just them. Rate limit: 1 per 5s per sender — a rapid reconnect loop
  // (or a bad actor) can't flood us with big payloads.
  const SNAPSHOT_COOLDOWN_MS = 5000
  const lastSnapshotAt = new Map<string, number>()
  room.onMessage('requestSnapshot', (_data, context) => {
    const from = context?.from
    if (!from) return
    const now = Date.now()
    const last = lastSnapshotAt.get(from) ?? 0
    if (now - last < SNAPSHOT_COOLDOWN_MS) {
      console.log(`[Server] requestSnapshot from ${from} rate-limited (${now - last}ms since last)`)
      return
    }
    lastSnapshotAt.set(from, now)
    const entries = getFullState()
    const c = coverage()
    console.log(`[Server] snapshot → ${from} (${entries.length} cells, red=${c.red} blue=${c.blue})`)
    room.send('snapshot', { entries, red: c.red, blue: c.blue, total: c.total }, { to: [from] })
  })

  console.log('[Server] ✅ Ready — listening for ping, joinRoster, paintTick, requestSnapshot; broadcasting paintDelta at 5Hz.')
}
