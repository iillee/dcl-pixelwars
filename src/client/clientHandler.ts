import { setRoundState } from '../shared/roundTiming'
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

import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { events } from '../shared/events'
import { Team } from '../shared/team'
import { drainPaintOutbox, setLocalTeam } from '../paint'
import { SeedHolder, seedHolder } from '../shared/components'
import { ensureMazeSeed } from '../maze/rebuild'

// Locally-tracked team for this session. Written on team:assigned; used
// only to log the human-readable team name. paint.ts owns the "does this
// client's paint go anywhere" logic via setLocalTeam.
let myTeam: Team = Team.None

/**
 * Send our display name to the server once for the leaderboard directory.
 * Uses PlayerIdentityData.name when available, falls back to a short form
 * of the address (or guest id) so guests still show a readable label.
 */
function sendDisplayName(address: string): void {
  const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  // AvatarBase.name is the primary avatar name (works for both wallet users
  // and named guests). PlayerIdentityData doesn't carry the name field.
  const av = AvatarBase.getOrNull(engine.PlayerEntity)
  const name = av?.name || `Guest ${address.slice(-4)}`
  console.log(`[Client] → updateName "${name}"`)
  room.send('updateName', { name })
  void pid  // eslint: keep the reference explicit for future name sources
}

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

  room.onMessage('snapshot', ({ entries, red, blue, total, seed }) => {
    console.log(`[Client] snapshot received: ${entries.length} cells, seed ${seed}`)
    gotSnapshot = true
    // Authoritative seed: build now (before the paint lands) if the SeedHolder CRDT hasn't given us it.
    if (seed && SeedHolder.get(seedHolder).seed !== seed) SeedHolder.createOrReplace(seedHolder, { seed })
    ensureMazeSeed(seed)
    events.emit('paint:snapshot', {
      entries: entries.map(e => ({ id: e.id, team: e.team as Team })),
      red, blue, total,
    })
  })

  room.onMessage('roundResult', ({ cells, teamCells, team }) => {
    events.emit('round:result', { cells, teamCells, team: team as Team })
  })

  room.onMessage('roundOwners', ({ owners }) => {
    events.emit('round:owners', { owners })
  })

  room.onMessage('teamRoster', ({ entries }) => {
    events.emit('team:roster', { entries: entries.map(e => ({ userId: e.userId, team: e.team as Team })) })
  })

  room.onMessage('botPositions', ({ bots }) => {
    events.emit('bots:positions', { bots })
  })

  room.onMessage('roundClock', ({ idx, remainingMs, active }) => {
    setRoundState(idx, Date.now() + remainingMs, active)
  })

  room.onMessage('roundReset', ({ seed, finalRed, finalBlue, finalTotal }) => {
    events.emit('round:reset', { seed, finalRed, finalBlue, finalTotal })
  })

  room.onMessage('dashImpact', ({ attacker, target, dx, dz }) => {
    events.emit('dash:impact', { attacker, target, dx, dz })
  })

  room.onMessage('lungeStarted', (m) => {
    events.emit('lunge:started', { attacker: m.attacker, id: m.id, dx: m.dx, dz: m.dz, x: m.x, y: m.y, z: m.z })
  })
  room.onMessage('lungeImpact', ({ attacker, id, target, dx, dz }) => {
    events.emit('lunge:impact', { attacker, id, target, dx, dz })
  })

  room.onMessage('burstFired', ({ attacker, id, team, x, y, z }) => {
    events.emit('burst:fired', { attacker, id, team: team as Team, x, y, z })
  })
  room.onMessage('burstImpact', ({ attacker, id, target, dx, dz }) => {
    events.emit('burst:impact', { attacker, id, target, dx, dz })
  })

  room.onMessage('bombArmed', ({ attacker, team, x, y, z }) => {
    events.emit('bomb:armed', { attacker, team: team as Team, x, y, z })
  })

  room.onMessage('bombBlast', ({ attacker, team, x, y, z, cells }) => {
    events.emit('bomb:blast', { attacker, team: team as Team, x, y, z, cells })
  })
}

/** Paint Bomb prototype: drop a bomb at our position (see client/paintBomb.ts). */
export function sendBombDrop(x: number, y: number, z: number): void {
  console.log(`[Client] → bombDrop ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`)
  room.send('bombDrop', { x, y, z })
}

/** Dash prototype: report that our dash touched `target` (see client/dash.ts). */
export function sendDashHit(target: string, dx: number, dz: number): void {
  console.log(`[Client] → dashHit ${target.slice(0, 8)}`)
  room.send('dashHit', { target, dx, dz })
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
  // Retry until a snapshot (paint + maze seed) arrives; server rate-limits to 1 per 5 s.
  let retry = 0
  engine.addSystem((dt: number) => {
    if (gotSnapshot || myTeam === Team.None) return
    retry += dt
    if (retry < SNAPSHOT_RETRY_S) return
    retry = 0
    console.log('[Client] → requestSnapshot (retry, none received yet)')
    room.send('requestSnapshot', {})
  })
}
let gotSnapshot = false
const SNAPSHOT_RETRY_S = 6

// ─── Outbound: room.send from local systems ───────────────────────────
function wireOutbound(): void {
  // joinRoster one-shot. Waits for PlayerIdentityData to populate (avatar
  // wallet address). If the address never appears within FALLBACK_MS (as
  // happens with anonymous local-preview guests) we synthesize a stable
  // guest id so the pipeline still works end-to-end for local dev.
  let joinSent = false
  let joinClock = 0
  const FALLBACK_MS = 3000
  let lastDiagLog = 0
  engine.addSystem((dt: number) => {
    if (joinSent) return
    joinClock += dt * 1000
    const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)

    // Every 1s until we join: dump what we're seeing so local-preview
    // stalls are debuggable without adding print-statements ad-hoc.
    if (joinClock - lastDiagLog > 1000) {
      lastDiagLog = joinClock
      console.log(`[Client] joinRoster wait (${(joinClock/1000).toFixed(1)}s): pid=${pid ? 'present' : 'null'}, address="${pid?.address ?? ''}", isGuest=${pid?.isGuest}`)
    }

    if (pid?.address) {
      joinSent = true
      console.log(`[Client] → joinRoster ${pid.address}`)
      room.send('joinRoster', { userId: pid.address })
      sendDisplayName(pid.address)
      return
    }
    // Fallback: after FALLBACK_MS without a wallet address, use a synthetic
    // guest id so local single-player preview can paint. The server uses
    // context.from (authoritative) for team assignment, so this payload id
    // is really only for our own logging.
    if (joinClock >= FALLBACK_MS) {
      joinSent = true
      const guestId = 'guest-' + Math.floor(Math.random() * 1e9).toString(16)
      console.log(`[Client] → joinRoster (fallback guest ${guestId}) after ${(joinClock/1000).toFixed(1)}s with no PlayerIdentityData.address`)
      room.send('joinRoster', { userId: guestId })
      sendDisplayName(guestId)
    }
  })

  // joinRoster retry. On a cold first join the server's addressed
  // teamAssigned (and the teamRoster broadcast) can be lost while the
  // auth-server transport is still registering this peer, leaving the
  // client with Team.None: no paint, no tag. A rejoin worked because the
  // transport was warm. Resend every JOIN_RETRY_S until teamAssigned
  // lands; the server handler is idempotent (same team returned).
  let joinRetryClock = 0
  let joinAttempts = 1
  const JOIN_RETRY_S = 2
  engine.addSystem((dt: number) => {
    if (!joinSent || myTeam !== Team.None) return
    joinRetryClock += dt
    if (joinRetryClock < JOIN_RETRY_S) return
    joinRetryClock = 0
    joinAttempts++
    const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
    const uid = pid?.address || 'guest-retry'
    console.log(`[Client] no teamAssigned yet (room ready=${room.isReady()}) -> joinRoster retry #${joinAttempts} ${uid}`)
    room.send('joinRoster', { userId: uid })
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

/** Lunge: we started lunge `id` (see client/lunge.ts). */
export function sendLungeStart(id: number, dx: number, dz: number, x: number, y: number, z: number): void {
  room.send('lungeStart', { id, dx, dz, x, y, z })
}

/** Lunge: lunge `id` touched `target`. */
export function sendLungeHit(id: number, target: string, dx: number, dz: number, x: number, y: number, z: number): void {
  console.log(`[Client] → lungeHit #${id} ${target.slice(0, 8)}`)
  room.send('lungeHit', { id, target, dx, dz, x, y, z })
}

/** Paint Burst (client/paintBurst.ts). */
export function sendBurstUse(id: number, cell: string, x: number, y: number, z: number, fx: number, fz: number): void {
  console.log(`[Client] → burstUse #${id}`)
  room.send('burstUse', { id, cell, x, y, z, fx, fz })
}
export function sendBurstHit(id: number, target: string, dx: number, dz: number): void {
  console.log(`[Client] → burstHit #${id} ${target.slice(0, 8)}`)
  room.send('burstHit', { id, target, dx, dz })
}
