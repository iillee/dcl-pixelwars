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
import { myProfile } from '@dcl/sdk/network'
import { onLeaveScene } from '@dcl/sdk/players'

import { room } from 'src/shared/messages'
import { paintGridCapacity } from 'src/shared/paintGrid'
import { initPaintSync, paintCellEntityCount, relinkPaintSync } from 'src/shared/paintSync'
import { getRoundIndex as currentRoundIndex } from 'src/shared/roundTiming'
import {
	PAINT_COVERAGE_PUBLISH_HZ,
	PAINT_TICK_MAX_IDS,
} from 'src/shared/settings'
import { eventBus, ServerEvents } from 'src/shared/utils/eventBus'

import {
	botCount,
	initBots,
	rebuildBotGraph,
	tickBots,
} from 'src/server/bots/manager'
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
	sampleEnemyCells,
	teamOfCell,
} from 'src/server/paintState'
import {
	activeHumanCount,
	activeSoloHumanTeam,
	assignTeam,
	getTeam,
	markActive,
	markInactive,
	rosterSize,
} from 'src/server/roster'
import { initServerStats, startServerStatsTick } from 'src/server/serverStats'

const HEARTBEAT_INTERVAL_S     = 5
const PAINT_SUMMARY_INTERVAL_S = 5


// MARK: setupServer

/** Boot roster, paint CRDT, stats, and room handlers for the auth server. */
export async function setupServer(): Promise<void> {
	console.log('[Server] Starting Squareoff server...')

	await loadLeaderboard()

	const paintCap = paintGridCapacity()
	console.log(
		`[Server] paint grid: ${paintCap.cellCapacity} cell slots ` +
		`(${paintCap.paintCellsPerTileAxis}×${paintCap.paintCellsPerTileAxis}/tile × ` +
		`${paintCap.tiles} tiles × ${paintCap.levels} levels); ` +
		`PaintCell networkIds ${paintCap.cellNetBase}+`
	)
	initPaintSync()
	seedTeamPalette()

	initServerStats()
	startServerStatsTick(() => coverage().total)

	bindNameResolver(leaderboardGetName)
	await initDiscord()

	// Bots: wire injectable deps + build the graph for the initial seed.
	// Population is 0 until an active human joins.
	initBots({
		applyPaint,
		paint: {
			teamOf:      teamOfCell,
			sampleEnemy: sampleEnemyCells,
		},
		humanCount:    activeHumanCount,
		soloHumanTeam: activeSoloHumanTeam,
	})
	rebuildBotGraph(currentRoundIndex())
	eventBus.on(ServerEvents.RoundReset, ({ seed }: { seed: number }) => {
		rebuildBotGraph(seed)
	})

	// Clear the leaver's activity slot immediately so the bot manager
	// reacts on the next tick (~engine frame) instead of waiting up to
	// 60s for the activity window to expire. Roster slot is preserved
	// for team-stability on rejoin.
	onLeaveScene((userId: string) => {
		markInactive(userId)
		console.log(`[Server] onLeaveScene ${userId} (active humans now ${activeHumanCount()})`)
	})

	// PaintTick summary accumulators (coalesced log every few seconds).
	let paintTicks       = 0
	let paintIdsIn       = 0
	let paintApplied     = 0
	let paintDroppedCap  = 0
	let paintDroppedTeam = 0
	let paintSummaryClock = 0

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
		markActive(from)
		console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()} active ${activeHumanCount()})`)
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
		if (team === null) {
			paintDroppedTeam++
			return
		}
		markActive(from)
		if (ids.length > PAINT_TICK_MAX_IDS) {
			paintDroppedCap++
			console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${PAINT_TICK_MAX_IDS}`)
			return
		}
		// Count only cells that actually changed — a player standing still
		// on their own paint re-sends the same 9 cellIds every 100ms;
		// crediting all of them would inflate the leaderboard by ~90/sec.
		let gained = 0
		for (const id of ids) {
			if (applyPaint(id, team)) gained++
		}
		paintTicks++
		paintIdsIn   += ids.length
		paintApplied += gained
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

	// Coverage publish tick. Coalesces cell mutations into a single
	// PaintCoverage CRDT write — not a room broadcast.
	const COVERAGE_INTERVAL = 1 / PAINT_COVERAGE_PUBLISH_HZ
	let coverageClock = 0
	engine.addSystem((dt: number) => {
		coverageClock += dt
		if (coverageClock < COVERAGE_INTERVAL) return
		coverageClock = 0
		relinkPaintSync()
		if (!isCoverageDirty()) return
		publishCoverage()
	})

	// Heartbeat + paintTick summary. Always logs so a live idle server is
	// obvious; silence means the process died.
	let heartbeatClock = 0
	engine.addSystem((dt: number) => {
		heartbeatClock += dt
		paintSummaryClock += dt

		if (paintSummaryClock >= PAINT_SUMMARY_INTERVAL_S) {
			paintSummaryClock = 0
			if (paintTicks > 0 || paintDroppedCap > 0 || paintDroppedTeam > 0) {
				console.log(
					`[Server] paintTick ${PAINT_SUMMARY_INTERVAL_S}s: ` +
					`ticks=${paintTicks} ids=${paintIdsIn} applied=${paintApplied} ` +
					`droppedCap=${paintDroppedCap} droppedTeam=${paintDroppedTeam} ` +
					`paintCells=${paintCellEntityCount()}`
				)
				paintTicks       = 0
				paintIdsIn       = 0
				paintApplied     = 0
				paintDroppedCap  = 0
				paintDroppedTeam = 0
			}
		}

		if (heartbeatClock < HEARTBEAT_INTERVAL_S) return
		heartbeatClock = 0
		const c = coverage()
		console.log(
			`[Server] alive roster=${rosterSize()} activeHumans=${activeHumanCount()} bots=${botCount()} cells=${paintCellEntityCount()} ` +
			`coverage=red=${c.red}/blue=${c.blue}/total=${c.total} ` +
			`profileReady=${!!myProfile?.networkId}`
		)
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
		eventBus.emit(ServerEvents.RoundReset, { seed: idx })
		lastRoundIndex = idx
	})

	// Bot tick. Manager handles spawn/despawn based on active humans and
	// applies 3x3 paint stamps per stepped cell via the injected
	// applyPaint. Runs on the same engine cadence as other systems; the
	// bot state machine is dt-based so cadence doesn't matter.
	engine.addSystem((dt: number) => {
		tickBots(dt)
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

	console.log(
		'[Server] Ready — listening for joinRoster, paintTick; ' +
		'paint state via sparse PaintCell CRDT; roundReset on UTC boundaries. ' +
		`heartbeat every ${HEARTBEAT_INTERVAL_S}s.`
	)
}
