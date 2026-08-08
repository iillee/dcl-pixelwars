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

import { engine, Entity, NetworkEntity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { myProfile, syncEntity } from '@dcl/sdk/network'

import { BotState } from 'src/shared/components'
import {
	generateWithRetry,
	getPlacedTilesInOrder,
} from 'src/shared/maze/generator'
import {
	buildWalkableGraph,
	WalkableGraph,
} from 'src/shared/maze/graph'
import {
	BOT_NETWORK_BASE,
	BOT_NETWORK_MAX,
} from 'src/shared/paintGrid'

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


interface ManagedBot {
	bot:     Bot
	botId:   number
	/** Network id slot in [BOT_NETWORK_BASE, BOT_NETWORK_BASE+BOT_NETWORK_MAX). */
	netSlot: number
	entity:  Entity
}

let deps:  ManagerDeps  | null = null
let graph: WalkableGraph | null = null
let bots:  ManagedBot[] = []
let botIdCounter = 0
// Track which BOT_NETWORK_BASE slots are in use so we can reuse ids on
// respawn (main hit this - stale client ghost when a new bot took the
// same slot).
const usedNetSlots = new Set<number>()


// MARK: allocNetSlot

/** Pick the lowest free slot in [0, BOT_NETWORK_MAX). Returns -1 if
 *  saturated (would only happen far outside solo-mode). */
function allocNetSlot(): number {
	for (let i = 0; i < BOT_NETWORK_MAX; i++) {
		if (!usedNetSlots.has(i)) {
			usedNetSlots.add(i)
			return i
		}
	}
	return -1
}


// MARK: trySyncBot

/** Attach NetworkEntity when profile is ready. No-ops if already linked. */
function trySyncBot(entity: Entity, netSlot: number): void {
	if (NetworkEntity.getOrNull(entity) !== null) return
	if (!myProfile?.networkId) return
	try {
		syncEntity(entity, [BotState.componentId, Transform.componentId], BOT_NETWORK_BASE + netSlot)
	} catch (err) {
		console.error(`[Bots] trySyncBot: syncEntity@${BOT_NETWORK_BASE + netSlot} failed:`, err)
	}
}


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
	for (const mb of bots) {
		mb.bot.currentCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
		mb.bot.clearPath()
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
	const netSlot = allocNetSlot()
	if (netSlot === -1) {
		console.error('[Bots] spawnBot: no free network slot (BOT_NETWORK_MAX exhausted)')
		return
	}
	const spawnSet  = graph.deepNodes.size > 0 ? graph.deepNodes : graph.nodes
	const nodesArr  = [...spawnSet]
	const startCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
	const team      = pickTeamForNewBot()
	const bot       = new Bot({
		team,
		startCell,
		pickTarget: makeSmartTarget(deps.paint, team),
		paint:      deps.paint,
	})
	botIdCounter++

	// Synced entity: Transform position + BotState (botId, team). Position
	// initialised to current cell centre so the client visual spawns in
	// the right place instead of jumping from world origin.
	const entity  = engine.addEntity()
	const startPos = graph.worldPos.get(startCell)
	Transform.create(entity, {
		position: startPos
			? Vector3.create(startPos[0], startPos[1], startPos[2])
			: Vector3.create(0, 0, 0),
	})
	BotState.create(entity, { botId: botIdCounter, team })
	trySyncBot(entity, netSlot)

	bots.push({ bot, botId: botIdCounter, netSlot, entity })
	console.log(`[Bots] spawnBot #${botIdCounter}: team ${team === 1 ? 'RED' : 'BLUE'} netSlot=${netSlot} at ${startCell} (pop ${bots.length})`)
}


// MARK: retireBot

function retireBot(): void {
	const removed = bots.pop()
	if (!removed) return
	engine.removeEntity(removed.entity)
	usedNetSlots.delete(removed.netSlot)
	console.log(`[Bots] retireBot #${removed.botId}: team ${removed.bot.team === 1 ? 'RED' : 'BLUE'} netSlot=${removed.netSlot} (pop ${bots.length})`)
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

	// 2. Tick each bot + apply 3x3 paint stamp per step + push interpolated
	//    position to the synced Transform for the client visual.
	const dtMs = dtSec * 1000
	for (const mb of bots) {
		const { bot, entity, netSlot } = mb
		for (const stepId of bot.tick(dtMs, graph)) {
			const colonIdx = stepId.indexOf(':')
			if (colonIdx < 0) continue
			const prefix = stepId.slice(0, colonIdx + 1)
			const [colStr, rowStr] = stepId.slice(colonIdx + 1).split(',')
			const col = parseInt(colStr, 10)
			const row = parseInt(rowStr, 10)
			for (let dc = -1; dc <= 1; dc++) {
				for (let dr = -1; dr <= 1; dr++) {
					const nid = `${prefix}${col + dc},${row + dr}`
					if (graph.nodes.has(nid)) deps.applyPaint(nid, bot.team)
				}
			}
		}

		// Push interpolated world position for the client visual. The bot's
		// visualPosition lerps currentCell -> path[0] using the step
		// accumulator, giving continuous motion for the client to smooth.
		const pos = bot.visualPosition(graph)
		if (pos) {
			const t = Transform.getMutableOrNull(entity)
			if (t) t.position = Vector3.create(pos[0], pos[1], pos[2])
		}
		// Retry sync in case profile wasn't ready at spawn.
		trySyncBot(entity, netSlot)
	}
}


// MARK: botCount

/** Diagnostics. */
export function botCount(): number {
	return bots.length
}



