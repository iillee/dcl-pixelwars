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
