/**
 * bot.ts — single-bot state machine (Pixelwars Phase 5a step 3).
 *
 * One instance = one virtual player. Owns:
 *   - team (fixed for the round; set by the manager on spawn)
 *   - currentCell (cellId — where the bot "is" this frame)
 *   - path (queued cellIds walking toward target)
 *   - stepCooldownMs (walking speed governor)
 *
 * The bot does NOT know about the server tick, WS, or paintState. It's
 * driven by tick(dtMs) and exposes advance() → cellId | null so the
 * manager can decide whether to apply paint. This lets us unit-test the
 * whole state machine offline without a running server.
 *
 * Target selection is a callback (pickTarget) injected by the manager,
 * so the same Bot works for random-neutral, enemy-hunter, or "attack the
 * leading team" strategies without a rewrite. Default = random walkable
 * cell.
 */

import { WalkableGraph, findPath } from '../../shared/mazeGraph'
import { GRID_W, GRID_H } from '../../maze/generator'

/** Steps per second the bot walks. 4 ≈ human paint pace. */
export const DEFAULT_STEPS_PER_SEC = 4

export type PickTarget = (self: Bot, graph: WalkableGraph) => string | null

/** Fallback strategy: uniformly random walkable cell (not self). */
export const randomTarget: PickTarget = (self, graph) => {
  if (graph.nodes.size <= 1) return null
  const arr = [...graph.nodes]
  // Bounded retry to avoid picking self in tiny mazes; ~O(1) expected.
  for (let i = 0; i < 8; i++) {
    const pick = arr[Math.floor(Math.random() * arr.length)]
    if (pick !== self.currentCell) return pick
  }
  return arr[0]
}

// ─── smartTarget ──────────────────────────────────────────────────────────────────
// Behavioral mix from BOTS_PLAN.md §5.4:
//   60% neutral bias  (paint an unpainted cell)
//   30% enemy bias    (overpaint an enemy-owned cell — territorial pressure)
//   10% center bias   (stay visible near the middle tile)
//
// Implementation: roll a strategy per target, then sample K random graph
// cells and pick the first that matches. Sampling (not full-scan) keeps
// this O(K) regardless of maze size — at K=48 the miss probability for a
// well-populated category is <1%. If sampling fails, fall back to random.

export interface PaintReader {
  /** Return the team painted on this cell, or 0 if unpainted. */
  teamOf(cellId: string): number
}

const SAMPLE_K = 48

function sampleNodes(graph: WalkableGraph, k: number): string[] {
  // Reservoir-free: cheap random-index sampling. Duplicates possible but
  // harmless — we're just looking for any matching candidate.
  const arr = [...graph.nodes]
  const out: string[] = []
  for (let i = 0; i < k; i++) out.push(arr[Math.floor(Math.random() * arr.length)])
  return out
}

/** Return true if the cellId's tile coord is within `dist` of maze center. */
function isNearCenter(cellId: string, dist: number): boolean {
  // cellId format: "tx,tz,ty:col,row". Only tx,tz matter for center check.
  const comma1 = cellId.indexOf(',')
  const comma2 = cellId.indexOf(',', comma1 + 1)
  const tx = parseInt(cellId.slice(0, comma1), 10)
  const tz = parseInt(cellId.slice(comma1 + 1, comma2), 10)
  const cx = Math.floor(GRID_W / 2)
  const cz = Math.floor(GRID_H / 2)
  return Math.abs(tx - cx) <= dist && Math.abs(tz - cz) <= dist
}

export function makeSmartTarget(paint: PaintReader, myTeam: number): PickTarget {
  const enemyTeam = myTeam === 1 ? 2 : 1
  return (self, graph) => {
    const roll = Math.random()
    const mode: 'neutral' | 'enemy' | 'center' =
      roll < 0.60 ? 'neutral' :
      roll < 0.90 ? 'enemy'   :
                    'center'

    const candidates = sampleNodes(graph, SAMPLE_K)
    for (const c of candidates) {
      if (c === self.currentCell) continue
      const t = paint.teamOf(c)
      if (mode === 'neutral' && t === 0) return c
      if (mode === 'enemy'   && t === enemyTeam) return c
      if (mode === 'center'  && isNearCenter(c, 1)) return c
    }
    // Fallback: no match in sample — return any non-self random cell.
    // Happens when the mode's category is scarce (e.g. no enemy paint yet
    // in round 1) or the sample happens to miss it.
    for (const c of candidates) if (c !== self.currentCell) return c
    return randomTarget(self, graph)
  }
}

export interface BotOpts {
  team: number                  // 1 = Red, 2 = Blue (matches Team enum)
  startCell: string
  stepsPerSec?: number
  pickTarget?: PickTarget
}

export class Bot {
  readonly team: number
  currentCell: string
  private path: string[] = []      // future cells not yet stepped onto
  private stepIntervalMs: number
  private stepAccumMs = 0          // grows with dt, drained by stepIntervalMs per step
  private pick: PickTarget

  /** Safety cap: never step more than this many cells in a single tick,
   *  even if the server stalled and dt is huge. Prevents "teleport paint"
   *  after a hitch. 3 = up to 750ms of catch-up at 4 steps/sec. */
  static readonly MAX_STEPS_PER_TICK = 3

  constructor(opts: BotOpts) {
    this.team = opts.team
    this.currentCell = opts.startCell
    this.stepIntervalMs = 1000 / (opts.stepsPerSec ?? DEFAULT_STEPS_PER_SEC)
    this.pick = opts.pickTarget ?? randomTarget
  }

  /**
   * Advance the bot's clock by dtMs. Returns the array of cellIds the bot
   * stepped onto during this tick (0..MAX_STEPS_PER_TICK). Empty when the
   * step accumulator hasn't yet reached one interval, or when the bot is
   * idle (no reachable target).
   *
   * Accumulator model: at 200ms server tick + 250ms step interval, the
   * bot steps every-other-tick on average (correct 4/sec long-run rate).
   * We cap at MAX_STEPS_PER_TICK so a stalled server (dt=5s) can't cause
   * a bot to teleport-paint 20 cells in one frame.
   */
  tick(dtMs: number, graph: WalkableGraph): string[] {
    this.stepAccumMs += dtMs
    const stepped: string[] = []

    while (this.stepAccumMs >= this.stepIntervalMs && stepped.length < Bot.MAX_STEPS_PER_TICK) {
      this.stepAccumMs -= this.stepIntervalMs

      // Refill path if exhausted (reached target, or first step).
      if (this.path.length === 0) {
        const target = this.pick(this, graph)
        if (target === null || target === this.currentCell) break
        const p = findPath(graph, this.currentCell, target)
        if (!p || p.length < 2) break
        this.path = p.slice(1) // drop index 0 (currentCell)
      }

      const next = this.path.shift()!
      this.currentCell = next
      stepped.push(next)
    }

    // Drain overflow if we hit the safety cap — prevents accum from growing
    // unbounded on prolonged stalls (would cause a burst on the next tick).
    if (this.stepAccumMs > this.stepIntervalMs) {
      this.stepAccumMs = this.stepIntervalMs
    }

    return stepped
  }

  /** Manager can call this to force target re-selection (e.g. round reset). */
  clearPath(): void {
    this.path = []
  }
}
