/**
 * bot.ts - single-bot state machine.
 *
 * One instance = one virtual player. Owns:
 *   - team (fixed for the round; set by manager on spawn)
 *   - currentCell (cellId - where the bot "is" this frame)
 *   - path (queued cellIds walking toward target)
 *   - step accumulator + jitter + pause state
 *
 * The bot does NOT know about the server tick, WS, or paintState.
 * It's driven by tick(dtMs, graph) and returns the cellIds it stepped
 * onto so the manager can attribute paint. This keeps the state
 * machine unit-testable without a running server.
 *
 * Target selection is a callback (PickTarget) injected by the manager
 * so the same Bot works for random-neutral, enemy-hunter, or future
 * strategies without a rewrite.
 */

import { findPath, WalkableGraph } from 'src/shared/maze/graph'


// MARK: tuning constants

/**
 * Steps per second the bot walks. Cells are 2m at CELL=32m / SIZE=16,
 * so this maps to (STEPS_PER_SEC * 2) m/s. Playtested on main:
 *   4.0 = DCL walk pace, sluggish; player outruns easily
 *   4.8 = a hair faster than walk. Player has to sprint to catch it.
 *   6.0 = matches sprint. Felt too aggressive for solo-mode presence.
 * Per-step time is jittered +/- JITTER_FRAC to break the metronome.
 */
export const DEFAULT_STEPS_PER_SEC = 4.8

/** Randomise each step by +/- this fraction of the base interval. */
const JITTER_FRAC = 0.15

/** After reaching a target, chance of a "looking around" pause before
 *  picking the next one. */
const PAUSE_CHANCE = 0.20
const PAUSE_MIN_MS = 800
const PAUSE_MAX_MS = 1800

/** Enemy-hunter target-tier probability per target roll. Set for main's
 *  ghost after tuning: high enough to feel visibly aggressive without
 *  the ghost ignoring blank areas entirely. */
const ENEMY_BIAS = 0.70

/** How many enemy cells to sample per target roll. Small enough to be
 *  cheap on a mostly-enemy map, large enough that a well-covered region
 *  is very unlikely to be missed. */
const ENEMY_SAMPLE_K = 24

/** How many random graph cells to try per target roll for tiers 1-2. */
const SAMPLE_K = 48


// MARK: PaintReader

export interface PaintReader {
	/** Return the team painted on this cell, or 0 if unpainted. */
	teamOf(cellId: string): number
	/** Optional: sample up to `k` random cellIds held by the opposing
	 *  team. Enables the enemy-hunter target tier. */
	sampleEnemy?(myTeam: number, k: number): string[]
}


// MARK: PickTarget

export type PickTarget = (self: Bot, graph: WalkableGraph) => string | null


// MARK: randomTarget

/** Fallback strategy: uniformly random walkable cell (not self). */
export const randomTarget: PickTarget = (self, graph) => {
	if (graph.nodes.size <= 1) return null
	const arr = [...graph.nodes]
	for (let i = 0; i < 8; i++) {
		const pick = arr[Math.floor(Math.random() * arr.length)]
		if (pick !== self.currentCell) return pick
	}
	return arr[0]
}


// MARK: sampleNodes

/** Sample K nodes from the deep (eroded) subgraph if non-empty,
 *  otherwise fall back to the full node set. */
function sampleNodes(graph: WalkableGraph, k: number): string[] {
	const src = graph.deepNodes.size > 0 ? graph.deepNodes : graph.nodes
	const arr = [...src]
	const out: string[] = []
	for (let i = 0; i < k; i++) out.push(arr[Math.floor(Math.random() * arr.length)])
	return out
}


// MARK: isDeepCentre

/** Deep = far enough from any wall that the 3x3 paint stamp fits fully
 *  inside the corridor. Membership comes from graph.deepNodes (computed
 *  once in graph.ts) so this is O(1). */
function isDeepCentre(cellId: string, graph: WalkableGraph): boolean {
	return graph.deepNodes.has(cellId)
}


// MARK: makeSmartTarget

/**
 * Priority-tiered target picker. Rolled per target selection:
 *   Tier 0 (ENEMY_BIAS %): random deep enemy-held cell (aggressive).
 *   Tier 1: any deep-centre non-own cell (neutral or enemy).
 *   Tier 2: any deep-centre non-self cell (may include own paint).
 *   Fallback: uniformly random walkable cell.
 */
export function makeSmartTarget(paint: PaintReader, myTeam: number): PickTarget {
	return (self, graph) => {
		if (paint.sampleEnemy && Math.random() < ENEMY_BIAS) {
			const enemies = paint.sampleEnemy(myTeam, ENEMY_SAMPLE_K)
			for (const c of enemies) {
				if (c === self.currentCell) continue
				if (isDeepCentre(c, graph)) return c
			}
			// No deep enemy cells - fall through to neutral tier.
		}

		const candidates = sampleNodes(graph, SAMPLE_K)

		for (const c of candidates) {
			if (c === self.currentCell) continue
			if (!isDeepCentre(c, graph)) continue
			const t = paint.teamOf(c)
			if (t !== myTeam) return c
		}
		for (const c of candidates) {
			if (c !== self.currentCell && isDeepCentre(c, graph)) return c
		}
		return randomTarget(self, graph)
	}
}


// MARK: BotOpts

export interface BotOpts {
	team:         number    // 1 = Red, 2 = Blue (matches Team enum)
	startCell:    string
	stepsPerSec?: number
	pickTarget?:  PickTarget
	/** Optional paint reader. When supplied, pathfinding penalises
	 *  own-team painted cells so the bot avoids re-walking its trail. */
	paint?:       PaintReader
}


// MARK: Bot

export class Bot {
	readonly team: number
	currentCell:   string
	path:          string[] = []          // future cells; public for visual interp

	private baseStepIntervalMs: number
	private stepIntervalMs:     number
	private stepAccumMs        = 0
	private pauseRemainingMs   = 0
	private pick:              PickTarget
	private paint?:            PaintReader

	/** Safety cap: never step more than this many cells in one tick,
	 *  even if the server stalled and dt is huge. Prevents teleport-paint
	 *  after a hitch. 3 = up to ~625ms of catch-up at 4.8 steps/sec. */
	static readonly MAX_STEPS_PER_TICK = 3


	// MARK: constructor

	constructor(opts: BotOpts) {
		this.team                = opts.team
		this.currentCell         = opts.startCell
		this.baseStepIntervalMs  = 1000 / (opts.stepsPerSec ?? DEFAULT_STEPS_PER_SEC)
		this.stepIntervalMs      = this.jitteredInterval()
		this.pick                = opts.pickTarget ?? randomTarget
		this.paint               = opts.paint
	}


	// MARK: jitteredInterval

	/** Base +/- JITTER_FRAC. Recomputed per step so consecutive steps
	 *  don't share timing. */
	private jitteredInterval(): number {
		const j = 1 + (Math.random() * 2 - 1) * JITTER_FRAC
		return this.baseStepIntervalMs * j
	}


	// MARK: tick

	/**
	 * Advance the bot's clock by dtMs. Returns the array of cellIds the
	 * bot stepped onto during this tick (0..MAX_STEPS_PER_TICK). Empty
	 * during a pause, when the accumulator hasn't reached the next step,
	 * or when the bot has no reachable target.
	 */
	tick(dtMs: number, graph: WalkableGraph): string[] {
		if (this.pauseRemainingMs > 0) {
			this.pauseRemainingMs -= dtMs
			this.stepAccumMs = 0
			if (this.pauseRemainingMs > 0) return []
			this.pauseRemainingMs = 0
		}

		this.stepAccumMs += dtMs
		const stepped: string[] = []

		while (this.stepAccumMs >= this.stepIntervalMs && stepped.length < Bot.MAX_STEPS_PER_TICK) {
			this.stepAccumMs   -= this.stepIntervalMs
			this.stepIntervalMs = this.jitteredInterval()

			// Refill path if exhausted (reached target, or first step).
			if (this.path.length === 0) {
				if (Math.random() < PAUSE_CHANCE) {
					this.pauseRemainingMs = PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS)
					this.stepAccumMs = 0
					break
				}
				const target = this.pick(this, graph)
				if (target === null || target === this.currentCell) break

				// Restrict to deep subgraph when possible so wall cells
				// are physically absent from the bot's world. Fall back
				// to the full graph only if either endpoint drifted off
				// (shouldn't happen post-spawn but stays safe).
				const onDeep = graph.deepNodes.has(this.currentCell) && graph.deepNodes.has(target)

				// Own-paint cost 3x: detour through un-owned tiles when
				// the alt is <=2 extra steps; still crosses own paint
				// when there's no alternative (never strands the bot).
				const paint  = this.paint
				const myTeam = this.team
				const costOf = paint
					? (id: string) => (paint.teamOf(id) === myTeam ? 3 : 1)
					: undefined

				const p = findPath(graph, this.currentCell, target, 20000, onDeep, costOf)
				if (!p || p.length < 2) break
				this.path = p.slice(1) // drop index 0 (currentCell)
			}

			const next = this.path.shift()!
			this.currentCell = next
			stepped.push(next)
		}

		// Drain overflow after safety cap so accum can't grow unbounded.
		if (this.stepAccumMs > this.stepIntervalMs) {
			this.stepAccumMs = this.stepIntervalMs
		}

		return stepped
	}


	// MARK: clearPath

	/** Force target re-selection (round reset, reseat). */
	clearPath(): void {
		this.path = []
	}


	// MARK: visualPosition

	/**
	 * Interpolated world position for the visual broadcast. Lerps
	 * currentCell -> path[0] using stepAccumMs / stepIntervalMs. Turns
	 * the discrete step model into continuous motion so the client's
	 * per-frame lerp only has to smooth network jitter, not a
	 * teleport-then-hold cadence.
	 */
	visualPosition(graph: WalkableGraph): [number, number, number] | null {
		const cur = graph.worldPos.get(this.currentCell)
		if (!cur) return null
		const nextId = this.path[0]
		if (!nextId) return [cur[0], cur[1], cur[2]]
		const next = graph.worldPos.get(nextId)
		if (!next) return [cur[0], cur[1], cur[2]]
		const f = Math.max(0, Math.min(1, this.stepAccumMs / this.stepIntervalMs))
		return [
			cur[0] + (next[0] - cur[0]) * f,
			cur[1] + (next[1] - cur[1]) * f,
			cur[2] + (next[2] - cur[2]) * f,
		]
	}
}
