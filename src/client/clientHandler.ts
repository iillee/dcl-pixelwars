/**
 * clientHandler.ts — the network boundary.
 *
 * SOLE owner of `room.onMessage(...)` on the client. Each incoming server
 * message is validated / logged here and then re-emitted as a typed event
 * on `shared/events`. Gameplay modules subscribe to those events and
 * never touch the wire schema — the day the wire changes, only this file
 * does.
 *
 * Outbound: once-only `joinRoster` and the 10 Hz paint-outbox flusher.
 * Local paint is provisional-Red immediately so walking always shows color
 * even when the auth server is down or teamAssigned is delayed; the server
 * assignment overwrites via setLocalTeam + CRDT.
 *
 * Paint *state* arrives via CRDT (PaintCell / PaletteEntry / PaintCoverage),
 * not room messages — this file only forwards teamAssigned and roundReset.
 *
 * Pattern borrowed from stom66/dcl-sky-chaser (clientHandler.ts + eventBus).
 */

import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { events } from 'src/shared/events'
import { room } from 'src/shared/messages'
import { PAINT_TICK_HZ } from 'src/shared/settings'
import { Team } from 'src/shared/team'

import { drainPaintOutbox, setLocalTeam } from 'src/paint'

// Wire team once teamAssigned arrives. Until then we still paint locally
// with provisional Red (see initClientHandler).
let myTeam: Team = Team.None

/** Give up waiting for CRDT sync and send joinRoster anyway. */
const SYNC_WAIT_MAX_MS = 5000


// MARK: sendDisplayName

/**
 * Send our display name to the server once for the leaderboard directory.
 * Uses AvatarBase.name when available, falls back to a short form of the
 * address (or guest id) so guests still show a readable label.
 */
function sendDisplayName(address: string): void {
	const av   = AvatarBase.getOrNull(engine.PlayerEntity)
	const name = av?.name || `Guest ${address.slice(-4)}`
	console.log(`[Client] → updateName "${name}"`)
	room.send('updateName', { name })
}


// MARK: resolveJoinUserId

/**
 * Prefer PlayerIdentityData.address; otherwise a synthetic guest id.
 * Server team assignment uses context.from — this payload is diagnostic
 * only. Do NOT stall waiting for identity in local preview.
 */
function resolveJoinUserId(): string {
	const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
	if (pid?.address) return pid.address
	return 'guest-' + Math.floor(Math.random() * 1e9).toString(16)
}


// MARK: initClientHandler

export function initClientHandler(): void {
	// Provisional team so optimistic local paint works immediately. First
	// roster slot is Red anyway; if we are Blue, teamAssigned + CRDT correct
	// the color within a network hop.
	setLocalTeam(Team.Red)
	wireInbound()
	wireTeamAssigned()
	wireOutbound()
}


// MARK: wireInbound

function wireInbound(): void {
	room.onMessage('teamAssigned', ({ team }) => {
		events.emit('team:assigned', { team: team as Team })
	})

	room.onMessage('roundReset', ({ seed, finalRed, finalBlue, finalTotal }) => {
		events.emit('round:reset', { seed, finalRed, finalBlue, finalTotal })
	})
}


// MARK: wireTeamAssigned

function wireTeamAssigned(): void {
	events.on('team:assigned', ({ team }) => {
		myTeam = team
		setLocalTeam(myTeam)
		console.log(`[Client] teamAssigned → ${myTeam === Team.Red ? 'RED' : 'BLUE'}`)
	})
}


// MARK: wireOutbound

function wireOutbound(): void {
	let joinSent        = false
	let paintFlushClock = 0
	const paintInterval = 1 / PAINT_TICK_HZ
	let lastSyncLog     = 0
	let syncWaitMs      = 0

	engine.addSystem((dt: number) => {
		const synced = isStateSyncronized()
		if (!synced && syncWaitMs < SYNC_WAIT_MAX_MS) {
			syncWaitMs += dt * 1000
			if (syncWaitMs - lastSyncLog > 1000) {
				lastSyncLog = syncWaitMs
				console.log(`[Client] waiting for isStateSyncronized… (${(syncWaitMs / 1000).toFixed(1)}s)`)
			}
			return
		}
		if (!synced && !joinSent) {
			console.log(`[Client] isStateSyncronized still false after ${SYNC_WAIT_MAX_MS}ms — joining anyway`)
		}

		if (!joinSent) {
			joinSent = true
			const userId = resolveJoinUserId()
			const pid    = PlayerIdentityData.getOrNull(engine.PlayerEntity)
			console.log(
				`[Client] → joinRoster ${userId}` +
				` (pid=${pid ? 'present' : 'null'}, address="${pid?.address ?? ''}", isGuest=${pid?.isGuest})`
			)
			room.send('joinRoster', { userId })
			sendDisplayName(userId)
		}

		// Hold the outbox until the server has rostered us. Local paint still
		// runs via provisional/assigned team; this only gates the wire flush.
		if (myTeam === Team.None) return

		paintFlushClock += dt
		if (paintFlushClock < paintInterval) return
		paintFlushClock = 0
		const ids = drainPaintOutbox()
		if (ids.length === 0) return
		room.send('paintTick', { ids })
	})
}
