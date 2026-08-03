/**
 * clientHandler.ts — the network boundary.
 *
 * SOLE owner of `room.onMessage(...)` on the client. Each incoming server
 * message is validated / logged here and then re-emitted as a typed event
 * on `shared/events`. Gameplay modules subscribe to those events and
 * never touch the wire schema — the day the wire changes, only this file
 * does.
 *
 * Outbound: also owns the once-only `joinRoster` send (fires as soon as
 * PlayerIdentityData is populated) and the 10 Hz paint-outbox flusher.
 *
 * The one non-emit subscriber that stays here is `team:assigned` — its
 * "reply" is another WS send (requestSnapshot), which is network-shaped
 * work that belongs on the network boundary.
 *
 * Pattern borrowed from stom66/dcl-sky-chaser (clientHandler.ts + eventBus).
 */

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { events } from '../shared/events'
import { Team } from '../shared/team'
import { drainPaintOutbox, setLocalTeam } from '../paint'

// Locally-tracked team for this session. Written on team:assigned; used
// only to log the human-readable team name. paint.ts owns the "does this
// client's paint go anywhere" logic via setLocalTeam.
let myTeam: Team = Team.None

export function initClientHandler(): void {
  wireInbound()
  wireTeamAssigned()
  wireOutbound()
}

// ─── Inbound: room.onMessage → events.emit ────────────────────────────
// Handlers do the minimum needed to translate wire types to event payloads.
// `team as Team` casts are safe: server enforces wire values 0/1/2 (see
// shared/team.ts and server/roster.ts).
function wireInbound(): void {
  room.onMessage('teamAssigned', ({ team }) => {
    events.emit('team:assigned', { team: team as Team })
  })

  room.onMessage('paintDelta', ({ changes, red, blue, total }) => {
    events.emit('paint:delta', {
      changes: changes.map(c => ({ id: c.id, team: c.team as Team })),
      red, blue, total,
    })
  })

  room.onMessage('snapshot', ({ entries, red, blue, total }) => {
    console.log(`[Client] snapshot received: ${entries.length} cells`)
    events.emit('paint:snapshot', {
      entries: entries.map(e => ({ id: e.id, team: e.team as Team })),
      red, blue, total,
    })
  })

  room.onMessage('roundReset', ({ seed, finalRed, finalBlue, finalTotal }) => {
    events.emit('round:reset', { seed, finalRed, finalBlue, finalTotal })
  })
}

// ─── Team assignment reply ────────────────────────────────────────────
// team:assigned is a server→client message whose "handler" ends with
// another WS send (requestSnapshot). Kept here because the reply is
// network-shaped work; paint side effects flow via setLocalTeam.
function wireTeamAssigned(): void {
  events.on('team:assigned', ({ team }) => {
    myTeam = team
    setLocalTeam(myTeam)
    console.log(`[Client] teamAssigned → ${myTeam === Team.Red ? 'RED' : 'BLUE'}`)
    // Ask for the current authoritative paint state. Fires exactly once
    // per teamAssigned; server has a 5s cooldown against abuse. Fixes:
    // reloading during a round used to wipe our view of already-painted
    // cells — snapshot restores them.
    console.log('[Client] → requestSnapshot')
    room.send('requestSnapshot', {})
  })
}

// ─── Outbound: room.send from local systems ───────────────────────────
function wireOutbound(): void {
  // joinRoster one-shot. Waits for PlayerIdentityData to populate (avatar
  // wallet address); Team.None guests never fire and painting no-ops for
  // them (see paint.ts). Fires exactly once per session.
  let joinSent = false
  engine.addSystem(() => {
    if (joinSent) return
    const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
    if (!pid || !pid.address) return
    joinSent = true
    console.log(`[Client] → joinRoster ${pid.address}`)
    room.send('joinRoster', { userId: pid.address })
  })

  // Paint outbox flusher: 10 Hz. Drain locally-painted cell ids and send
  // to the server; the server attributes to sender's team, applies to its
  // authoritative map, and broadcasts back via paintDelta so all clients
  // (including us) converge on the same picture.
  let paintFlushClock = 0
  engine.addSystem((dt: number) => {
    paintFlushClock += dt
    if (paintFlushClock < 0.1) return
    paintFlushClock = 0
    const ids = drainPaintOutbox()
    if (ids.length === 0) return
    room.send('paintTick', { ids })
  })
}
