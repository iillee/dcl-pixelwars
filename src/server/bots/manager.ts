/**
 * manager.ts - bot population control + per-tick paint pump.
 *
 * Owns the pool of active Bot instances. On each server tick:
 *   1. Adjust population to solo-mode target (1 bot iff 1 active human).
 *   2. Tick every bot; apply resulting paint via injected callback.
 *
 * On round boundary (subscribed via ServerEvents.RoundReset): rebuild
 * the walkable graph from the new maze, clear all bot paths, reseat
 * bots on random deep cells so they don't sit on stale cellIds.
 *
 * Bots call applyPaint directly - they do NOT flow through paintTick,
 * so:
 *   - no wire message (they're already server-side)
 *   - no leaderboard credit (bot userIds never appear in top-painters)
 */

import {
	generateWithRetry,
	getPlacedTilesInOrder,
} from 'src/shared/maze/generator'
import {
	buildWalkableGraph,
	WalkableGraph,
} from 'src/shared/maze/graph'

import {
	Bot,
	makeSmartTarget,
	PaintReader,
} from 'src/server/bots/bot'


// Solo-mode: exactly one bot when there is exactly one human. Two+
// humans = no bots; zero humans = no bots.
const SOLO_HUMAN_COUNT = 1


// MARK: ManagerDeps

export interface ManagerDeps {
	/** Attribute paint to a team. Returns true iff the cell changed team. */
	applyPaint:    (cellId: string, team: number) => boolean
	/** Read paint state to power smart-target heuristics. */
	paint:         PaintReader
	/** Currently-active human count (last-seen within roster's window). */
	humanCount:    () => number
	/** Team (1 or 2) of the sole human when humanCount === 1, else null. */
	soloHumanTeam: () => number | null
}


let deps:  ManagerDeps  | null = null
let graph: WalkableGraph | null = null
let bots:  Array<Bot & { botId: number }> = []
let botIdCounter = 0


// MARK: initBots

/** Wire the manager to the server's paint + roster APIs. Call once at boot. */
export function initBots(d: ManagerDeps): void {
	deps = d
	console.log('[Bots] initBots: solo-mode enabled (1 bot when 1 human, opposite team)')
}


// MARK: rebuildBotGraph

/**
 * Rebuild the walkable graph from the current maze seed. Call at server
 * startup and every round boundary. Surviving bots are reseated to
 * random deep cells (their previous cellIds are stale post-regen).
 */
export function rebuildBotGraph(seed: number): void {
	const winning = generateWithRetry(seed)
	if (winning === null) {
		console.log(`[Bots] rebuildBotGraph: no valid maze from seed ${seed}`)
		graph = null
		return
	}
	const t0 = Date.now()
	graph = buildWalkableGraph(getPlacedTilesInOrder())
	const dt = Date.now() - t0
	console.log(`[Bots] rebuildBotGraph: ${graph.nodes.size} cells, ${dt}ms (seed ${seed} -> winning ${winning})`)

	const seatSet  = graph.deepNodes.size > 0 ? graph.deepNodes : graph.nodes
	const nodesArr = [...seatSet]
	for (const b of bots) {
		b.currentCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
		b.clearPath()
	}
}


// MARK: pickTeamForNewBot

/** Solo-mode: bot is opposite the sole human. Falls back to Blue (2) if
 *  the roster is momentarily empty at spawn time. */
function pickTeamForNewBot(): number {
	const humanTeam = deps?.soloHumanTeam() ?? 1
	return humanTeam === 1 ? 2 : 1
}


// MARK: spawnBot

function spawnBot(): void {
	if (!graph || !deps) return
	const spawnSet = graph.deepNodes.size > 0 ? graph.deepNodes : graph.nodes
	const nodesArr = [...spawnSet]
	const startCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
	const team = pickTeamForNewBot()
	const bot  = new Bot({
		team,
		startCell,
		pickTarget: makeSmartTarget(deps.paint, team),
		paint:      deps.paint,
	}) as Bot & { botId: number }
	botIdCounter++
	bot.botId = botIdCounter
	bots.push(bot)
	console.log(`[Bots] spawnBot #${botIdCounter}: team ${team === 1 ? 'RED' : 'BLUE'} at ${startCell} (pop ${bots.length})`)
}


// MARK: retireBot

function retireBot(): void {
	const removed = bots.pop()
	if (!removed) return
	console.log(`[Bots] retireBot: team ${removed.team === 1 ? 'RED' : 'BLUE'} (pop ${bots.length})`)
}


// MARK: tickBots

/**
 * Main tick. Call from the server's engine.addSystem loop. Handles
 * population adjustment + bot movement/paint in one pass.
 *
 * Paint stamp: each stepped cell becomes the centre of a 3x3 footprint
 * (matches the human paint brush). Off-corridor cells are filtered via
 * graph.nodes membership.
 */
export function tickBots(dtSec: number): void {
	if (!graph || !deps) return

	// 1. Population control.
	const humans  = deps.humanCount()
	const desired = humans === SOLO_HUMAN_COUNT ? 1 : 0
	while (bots.length < desired) spawnBot()
	while (bots.length > desired) retireBot()

	// 2. Tick each bot + apply 3x3 paint stamp per step.
	const dtMs = dtSec * 1000
	for (const b of bots) {
		for (const stepId of b.tick(dtMs, graph)) {
			const colonIdx = stepId.indexOf(':')
			if (colonIdx < 0) continue
			const prefix = stepId.slice(0, colonIdx + 1)
			const [colStr, rowStr] = stepId.slice(colonIdx + 1).split(',')
			const col = parseInt(colStr, 10)
			const row = parseInt(rowStr, 10)
			for (let dc = -1; dc <= 1; dc++) {
				for (let dr = -1; dr <= 1; dr++) {
					const nid = `${prefix}${col + dc},${row + dr}`
					if (graph.nodes.has(nid)) deps.applyPaint(nid, b.team)
				}
			}
		}
	}
}


// MARK: botCount

/** Diagnostics. */
export function botCount(): number {
	return bots.length
}


// MARK: getBotPositions

/**
 * Snapshot of every bot's interpolated world position + id + team. Used
 * by Phase 3 client visual. Empty array when no bots.
 */
export function getBotPositions(): Array<{ id: number; team: number; x: number; y: number; z: number }> {
	if (!graph) return []
	const out: Array<{ id: number; team: number; x: number; y: number; z: number }> = []
	for (const b of bots) {
		const pos = b.visualPosition(graph)
		if (!pos) continue
		out.push({ id: b.botId, team: b.team, x: pos[0], y: pos[1], z: pos[2] })
	}
	return out
}
