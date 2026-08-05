/**
 * server.ts — Squareoff authoritative server entry point.
 *
 * Thin orchestrator, flagtag-pattern. Runs in the headless SDK server
 * process (hammurabi-server). No 3D, no ~system/RestrictedActions —
 * pure state + WS message handling.
 *
 * Responsibilities: roster/team assignment, authoritative paint state
 * (CRDT chunks + palette), coverage CRDT publish, and UTC-boundary
 * roundReset. Paint *state* syncs via CRDT; paintTick remains the
 * client→server command channel.
 */

import { engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { LeaderboardState, leaderboardStateEntity } from 'src/shared/components'
import { room } from 'src/shared/messages'
import { paintGridCapacity } from 'src/shared/paintGrid'
import { initPaintSync } from 'src/shared/paintSync'
import { getRoundIndex as currentRoundIndex } from 'src/shared/roundTiming'
import { PAINT_BRUSH_SIZE_CELLS } from 'src/shared/settings'

import { initDiscord, bindNameResolver, schedulePlayerJoin, flushPendingJoins } from 'src/server/discord'
import {
	loadFromStorage as loadLeaderboard,
	saveToStorage as saveLeaderboard,
	incrementPaint as leaderboardIncrement,
	updateName as leaderboardUpdateName,
	publish as publishLeaderboard,
	getName as leaderboardGetName,
} from 'src/server/leaderboard'
import {
	applyPaint,
	coverage,
	clearAll as clearPaintState,
	seedTeamPalette,
	isCoverageDirty,
	publishCoverage,
} from 'src/server/paintState'
import { assignTeam, rosterSize, getTeam } from 'src/server/roster'

// Ingest rate limit: one brush footprint per paintTick, plus headroom.
// Anything beyond is either a bug or a cheater — drop the whole message.
const MAX_IDS_PER_TICK = PAINT_BRUSH_SIZE_CELLS * PAINT_BRUSH_SIZE_CELLS + 16

export async function setupServer(): Promise<void> {
	console.log('[Server] Starting Squareoff server...')

	// Load leaderboard from Storage before any paintTicks land, so we don't
	// clobber persisted state with a fresh empty board. loadFromStorage()
	// also publishes to the CRDT-synced LeaderboardState so late-joining
	// clients see it immediately without waiting for a round boundary.
	await loadLeaderboard()

	// Register the LeaderboardState entity on the CRDT sync mesh with a
	// fixed networkId (3001) matching the client. Server mutations to this
	// component now propagate to every connected client.
	try {
		syncEntity(leaderboardStateEntity, [LeaderboardState.componentId], 3001)
	} catch (err) {
		console.error('[Server] syncEntity LeaderboardState@3001 failed:', err)
	}

	// Paint CRDT: sparse PaintCell + palette + coverage. Seed team colors
	// so indexes 0/1/2 are deterministic before any paintTick arrives.
	const paintCap = paintGridCapacity()
	console.log(
		`[Server] paint grid: ${paintCap.cellCapacity} cell slots ` +
		`(${paintCap.paintCellsPerTileAxis}×${paintCap.paintCellsPerTileAxis}/tile × ` +
		`${paintCap.tiles} tiles × ${paintCap.levels} levels); ` +
		`PaintCell networkIds ${paintCap.cellNetBase}+`
	)
	initPaintSync()
	seedTeamPalette()

	// Discord webhook + realm/preview detection. Wire the name resolver so
	// the notifier can pull display names captured via updateName. Silent
	// no-op if DISCORD_PLAYER_JOIN_WEBHOOK isn't set or we're in preview.
	bindNameResolver(leaderboardGetName)
	await initDiscord()

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
		// Queue a Discord join notification (debounced 5s to let updateName
		// arrive so we send the real display name, not the wallet hash).
		schedulePlayerJoin(from)
	})

	// Paint ingest — client-authored cell ids, attributed to sender's team.
	// Server writes palette indexes into per-cell PaintCell CRDT; clients
	// observe via sync. If sender hasn't joined the roster yet, drop silently.
	room.onMessage('paintTick', ({ ids }, context) => {
		const from = context?.from
		if (!from) return
		const team = getTeam(from)
		if (team === null) return  // pre-roster paint, retry on next tick
		if (ids.length > MAX_IDS_PER_TICK) {
			console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${MAX_IDS_PER_TICK}`)
			return
		}
		// Count only cells that actually changed — a player standing still
		// on their own paint re-sends the same 9 cellIds every 100ms;
		// crediting all of them would inflate the leaderboard by ~90/sec.
		let gained = 0
		for (const id of ids) {
			if (applyPaint(id, team)) gained++
		}
		if (gained > 0) leaderboardIncrement(from, gained)
	})

	// Name capture — client sends once on join with PlayerIdentityData.name.
	// Server keeps the map in memory and patches existing leaderboard rows.
	room.onMessage('updateName', ({ name }, context) => {
		const from = context?.from
		if (!from) return
		leaderboardUpdateName(from, name)
	})

	// On-demand leaderboard refresh — client asks when opening the popup.
	// We simply republish the CRDT-synced component; the requesting client
	// (and everyone else, harmlessly) picks up the new snapshot on next
	// engine tick. No addressed reply needed — CRDT delivers to all.
	room.onMessage('requestLeaderboard', (_data, context) => {
		if (!context?.from) return
		publishLeaderboard()
	})

	// Coverage publish tick (5 Hz). Coalesces cell mutations into a single
	// PaintCoverage CRDT write — not a room broadcast.
	const COVERAGE_HZ = 5
	const COVERAGE_INTERVAL = 1 / COVERAGE_HZ
	let coverageClock = 0
	engine.addSystem((dt: number) => {
		coverageClock += dt
		if (coverageClock < COVERAGE_INTERVAL) return
		coverageClock = 0
		if (!isCoverageDirty()) return
		publishCoverage()
	})

	// Coverage log tick (5s). Kept as a low-frequency health signal.
	let coverageLogClock = 0
	engine.addSystem((dt: number) => {
		coverageLogClock += dt
		if (coverageLogClock < 5) return
		coverageLogClock = 0
		const c = coverage()
		if (c.total > 0) {
			console.log(`[Server] coverage: red=${c.red} blue=${c.blue} total=${c.total}`)
		}
	})

	// Round loop. Server owns the boundary. On crossing:
	// 1) snapshot final coverage BEFORE clearing (banner needs it),
	// 2) broadcast roundReset with authoritative counts + new seed,
	// 3) clear paint CRDT chunks so the new round starts clean.
	let lastRoundIndex = 0
	engine.addSystem(() => {
		const idx = currentRoundIndex()
		if (lastRoundIndex === 0) { lastRoundIndex = idx; return }
		if (idx === lastRoundIndex) return
		const c = coverage()
		console.log(`[Server] round boundary: ${lastRoundIndex} → ${idx} (final red=${c.red} blue=${c.blue} total=${c.total})`)
		room.send('roundReset', { seed: idx, finalRed: c.red, finalBlue: c.blue, finalTotal: c.total })
		clearPaintState()
		void saveLeaderboard()
		publishLeaderboard()
		lastRoundIndex = idx
	})

	// Discord flush tick — low frequency; the delay is 5s so 1Hz polling
	// gives us more-than-fast-enough drain. Cheap when nothing's pending.
	let discordFlushClock = 0
	engine.addSystem((dt: number) => {
		discordFlushClock += dt
		if (discordFlushClock < 1) return
		discordFlushClock = 0
		flushPendingJoins()
	})

	console.log('[Server] ✅ Ready — listening for joinRoster, paintTick; paint state via sparse PaintCell CRDT; roundReset on UTC boundaries.')
}
