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

import { WalkableGraph, findPath, DEEP_MARGIN } from '../../shared/mazeGraph'
import { GRID_W, GRID_H } from '../../maze/generator'

/**
 * Steps per second the bot walks. Cells are 1m at paint SIZE=16 per 16m
 * tile, so this maps 1:1 to m/s. Tuning:
 *   4.0 = DCL walk pace, feels sluggish; player outruns easily
 *   4.5 = a hair faster than walk. Player has to sprint to catch it but
 *         it doesn't feel frantic. Current setting.
 *   6.0 = matches sprint. Felt too aggressive for solo-mode presence.
 * Actual per-step time is jittered ±JITTER_FRAC to break the metronome.
 */
export const DEFAULT_STEPS_PER_SEC = 4.8

/** Randomise each step by ±this fraction of the base interval. 0.15 =
 *  ±15%. Too high and the bot looks laggy; too low and it looks robotic. */
const JITTER_FRAC = 0.15

/** After reaching a target, this fraction of the time the bot pauses
 *  before picking the next one. Reads as "looking around". */
const PAUSE_CHANCE = 0.20
const PAUSE_MIN_MS = 800
const PAUSE_MAX_MS = 1800

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
  /** Optional: return up to `k` random cellIds currently held by the
   *  opposing team. Used to make the bot play offensively (contest
   *  enemy paint instead of only chasing blank floor). If undefined,
   *  the bot falls back to the neutral-cell strategy — keeps unit
   *  tests trivial. */
  sampleEnemy?(myTeam: number, k: number): string[]
}

const SAMPLE_K = 48

function sampleNodes(graph: WalkableGraph, k: number): string[] {
  // Sample ONLY from the eroded (deep) subgraph. Combined with
  // useDeepOnly=true in findPath below, this guarantees the bot can
  // neither target nor traverse a wall-adjacent cell. If deepNodes is
  // empty (extreme edge case), fall back to full nodes so the bot
  // still moves.
  const src = graph.deepNodes.size > 0 ? graph.deepNodes : graph.nodes
  const arr = [...src]
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

// A cell is "deep centre" iff its Manhattan distance from the nearest
// wall is at least DEEP_MARGIN. Uses graph.distToWall which is computed
// once at build time (see mazeGraph.ts). Shape-agnostic — handles L,
// T, corner tiles + ramps + cross-tile openings correctly, unlike the
// old fixed-LO/HI midpoint heuristic which only worked for straight
// corridors and produced the wall-hugging we saw in playtest.
//
// Post-erosion: "deep" is now defined structurally by membership in
// graph.deepNodes (built once in mazeGraph.ts with DEEP_MARGIN). The
// bot samples from that set AND pathfinds on graph.deepAdj, so wall
// cells are physically unreachable — no post-hoc filtering needed.

function isDeepCentre(cellId: string, graph: WalkableGraph): boolean {
  return graph.deepNodes.has(cellId)
}

// ─── smartTarget priority (revised after "ghost too passive" playtest) ─
// Problem: bot treated neutral and enemy cells equally, so early round
// (mostly-neutral map) it almost never contested territory — the human
// could paint uncontested, then camp behind the bot to repaint its trail.
// The ghost never played offense.
//
// New strict priority (first match wins):
//   0. ENEMY_BIAS chance: aim for a random deep enemy-held cell.
//      Turns the ghost into an aggressor instead of a floor-filler.
//      Falls through when there is no enemy paint yet (round start) or
//      when the sampled enemy cells all lie in the wall band.
//   1. Any deep-centre non-own cell (neutral or enemy) — the old
//      tier 1. Handles the common early-round case.
//   2. Any deep-centre non-self cell (last resort — may include own
//      paint if the local area is fully claimed).

/** Probability of rolling the offensive (enemy-hunter) target strategy
 *  on each new target pick. 0.7 was chosen so late-round the bot is
 *  clearly contesting enemy paint (visible "comes back to overpaint
 *  what you just did" behavior) while early round (little enemy paint
 *  yet) the 30% neutral roll + the fall-through keep it moving. Tune
 *  down to 0.5 if it feels too clingy, up to 0.85 for max pressure. */
const ENEMY_BIAS = 0.70
/** How many enemy cells to sample per target roll. 24 is well above the
 *  probability of missing a well-covered region while remaining cheap
 *  when the map is mostly enemy paint (reservoir sampling is O(N) but
 *  N here is bounded by cellTeam size, low thousands worst case). */
const ENEMY_SAMPLE_K = 24

export function makeSmartTarget(paint: PaintReader, myTeam: number): PickTarget {
  return (self, graph) => {
    // Tier 0: enemy hunter. Only rolls if the paint reader supports
    // enemy sampling AND the RNG says so this tick.
    if (paint.sampleEnemy && Math.random() < ENEMY_BIAS) {
      const enemies = paint.sampleEnemy(myTeam, ENEMY_SAMPLE_K)
      for (const c of enemies) {
        if (c === self.currentCell) continue
        if (isDeepCentre(c, graph)) return c
      }
      // No deep enemy cells found — fall through to the neutral tier.
    }

    const candidates = sampleNodes(graph, SAMPLE_K)

    // Tier 1: nearest deep-centre unclaimed cell (neutral or enemy).
    for (const c of candidates) {
      if (c === self.currentCell) continue
      if (!isDeepCentre(c, graph)) continue
      const t = paint.teamOf(c)
      if (t !== myTeam) return c   // unclaimed = anything not our own paint
    }
    // Tier 2: any deep-centre non-self cell (may include own paint).
    for (const c of candidates) {
      if (c !== self.currentCell && isDeepCentre(c, graph)) return c
    }
    // Very small maze / mostly-edge graph — last-resort random walkable.
    return randomTarget(self, graph)
  }
}

export interface BotOpts {
  team: number                  // 1 = Red, 2 = Blue (matches Team enum)
  startCell: string
  stepsPerSec?: number
  pickTarget?: PickTarget
  /** Optional paint reader. When supplied, the bot's pathfinder
   *  penalises own-team painted cells so it avoids re-walking its own
   *  trail (the visible backtracking we saw in playtest). Enemy paint
   *  and neutral cells keep the base cost of 1. */
  paint?: PaintReader
}

export class Bot {
  readonly team: number
  currentCell: string
  path: string[] = []              // future cells not yet stepped onto (public for visual interp)
  private baseStepIntervalMs: number   // mean step interval (from stepsPerSec)
  private stepIntervalMs: number       // current step's actual interval (jittered)
  private stepAccumMs = 0              // grows with dt, drained by stepIntervalMs per step
  private pauseRemainingMs = 0         // if >0, bot is holding for a "look around" pause
  private pick: PickTarget
  private paint?: PaintReader

  /** Safety cap: never step more than this many cells in a single tick,
   *  even if the server stalled and dt is huge. Prevents "teleport paint"
   *  after a hitch. 3 = up to 750ms of catch-up at 4 steps/sec. */
  static readonly MAX_STEPS_PER_TICK = 3

  constructor(opts: BotOpts) {
    this.team = opts.team
    this.currentCell = opts.startCell
    this.baseStepIntervalMs = 1000 / (opts.stepsPerSec ?? DEFAULT_STEPS_PER_SEC)
    this.stepIntervalMs = this.jitteredInterval()
    this.pick = opts.pickTarget ?? randomTarget
    this.paint = opts.paint
  }

  /** Base interval ±JITTER_FRAC. Recomputed per step so consecutive
   *  steps aren't identical — breaks the metronome cadence. */
  private jitteredInterval(): number {
    const j = 1 + (Math.random() * 2 - 1) * JITTER_FRAC
    return this.baseStepIntervalMs * j
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
    // Honour any active "look around" pause before advancing the step
    // accumulator. Zeroing the accum during a pause keeps the bot cleanly
    // stationary; visualPosition() returns raw currentCell (path is
    // empty) so it also reads as still on the client.
    if (this.pauseRemainingMs > 0) {
      this.pauseRemainingMs -= dtMs
      this.stepAccumMs = 0
      if (this.pauseRemainingMs > 0) return []
      this.pauseRemainingMs = 0
    }

    this.stepAccumMs += dtMs
    const stepped: string[] = []

    while (this.stepAccumMs >= this.stepIntervalMs && stepped.length < Bot.MAX_STEPS_PER_TICK) {
      this.stepAccumMs -= this.stepIntervalMs
      // Roll the next interval for the step AFTER this one, so no two
      // consecutive steps share timing.
      this.stepIntervalMs = this.jitteredInterval()

      // Refill path if exhausted (reached target, or first step).
      if (this.path.length === 0) {
        // Chance to pause here — "human looking around at a junction"
        // feel. Skips this whole step; resumes on next tick.
        if (Math.random() < PAUSE_CHANCE) {
          this.pauseRemainingMs = PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS)
          this.stepAccumMs = 0
          break
        }
        const target = this.pick(this, graph)
        if (target === null || target === this.currentCell) break
        // useDeepOnly=true: the pathfinder cannot traverse wall cells
        // even to reach a deep target. If currentCell has drifted off the
        // deep set (shouldn't happen post-spawn, but paranoia), fall back
        // to the full graph for one path so the bot can rejoin the deep
        // interior on the next target roll.
        const onDeep = graph.deepNodes.has(this.currentCell) && graph.deepNodes.has(target)
        // Cost function: own-team paint is 3x more expensive than
        // neutral / enemy cells. Result: the pathfinder takes a detour
        // through un-owned tiles when the detour is <=2 extra steps,
        // but still crosses its own paint when there's no alternative
        // (e.g. the target is behind a fully-owned stretch). This
        // eliminates the "turn around and paint the same tail again"
        // roomba behaviour without ever stranding the bot.
        const paint = this.paint
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

  /**
   * Interpolated world position for visual broadcast. Lerps from
   * currentCell toward path[0] based on how far into the current step
   * interval we are (stepAccumMs / stepIntervalMs). Returns the raw
   * currentCell position if there's no next cell (idle, at target, or
   * mid-repath).
   *
   * Why this exists: currentCell snaps to the destination the instant a
   * step fires, then holds for 250ms until the next step. Broadcasting
   * that raw = teleport-then-hold pattern, which reads as stutter no
   * matter what the client Tween rate is. Sub-step interp turns the
   * broadcast into continuous motion so the Tween only has to smooth
   * out network jitter.
   */
  visualPosition(graph: WalkableGraph): [number, number, number] | null {
    const cur = graph.worldPos.get(this.currentCell)
    if (!cur) return null
    const nextId = this.path[0]
    if (!nextId) return [cur[0], cur[1], cur[2]]
    const next = graph.worldPos.get(nextId)
    if (!next) return [cur[0], cur[1], cur[2]]
    // Fraction of the way to next cell. Clamped [0,1] — accum can briefly
    // exceed intervalMs when the server tick is late.
    const f = Math.max(0, Math.min(1, this.stepAccumMs / this.stepIntervalMs))
    return [
      cur[0] + (next[0] - cur[0]) * f,
      cur[1] + (next[1] - cur[1]) * f,
      cur[2] + (next[2] - cur[2]) * f,
    ]
  }
}
