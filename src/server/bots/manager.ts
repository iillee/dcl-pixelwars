/**
 * manager.ts — bot population control + tick loop.
 *
 * Owns the pool of active Bot instances. On each server tick:
 *   1. Adjust population to hit `targetActive` humans + bots
 *   2. Tick every bot; apply resulting paint via the injected callback
 *
 * On round boundary: rebuild the walkable graph from the new maze,
 * clear all bot paths, and reseat bots at random walkable cells so
 * they don't remain stranded on tiles that no longer exist.
 *
 * Bots do NOT flow through the paintTick / leaderboard code paths — they
 * call applyPaint directly. That's intentional:
 *   - No wire message (they're already server-side)
 *   - No leaderboard credit (bot names must never appear in top-painters)
 *
 * Team assignment: whichever team currently has fewer bots. Ties go to
 * Red. Keeps team distribution balanced without needing to poll the
 * human roster split.
 */

import { generateWithRetry, getPlacedTilesInOrder } from '../../maze/generator'
import { buildWalkableGraph, WalkableGraph } from '../../shared/mazeGraph'
import { Bot, makeSmartTarget, PaintReader } from './bot'

// Tuning knobs — Foundation may want to tweak once we ship telemetry.
const TARGET_ACTIVE = 4          // desired total painters (humans + bots)
const MAX_BOTS      = 3          // hard cap regardless of humanCount
const MIN_HUMANS    = 1          // bots only exist when at least one human present

export interface ManagerDeps {
  /** Attribute paint to a team. Returns true if the cell actually flipped. */
  applyPaint: (cellId: string, team: number) => boolean
  /** Read paint state to power smart-target heuristics. */
  paint: PaintReader
  /** Currently-connected (or ever-connected) human count. */
  humanCount: () => number
}

let deps: ManagerDeps | null = null
let graph: WalkableGraph | null = null
let bots: Array<Bot & { botId: number }> = []
let botIdCounter = 0

export function initBots(d: ManagerDeps): void {
  deps = d
  console.log('[Bots] initialised (targetActive=' + TARGET_ACTIVE + ', maxBots=' + MAX_BOTS + ')')
}

/**
 * Rebuild the walkable graph from the current maze seed. Called from
 * server startup and every round boundary. Any bots currently alive are
 * reseated to random walkable cells (their previous cellIds are stale).
 */
export function rebuildBotGraph(seed: number): void {
  const winning = generateWithRetry(seed)
  if (winning === null) {
    console.log('[Bots] graph rebuild failed: no valid maze from seed ' + seed)
    graph = null
    return
  }
  const t0 = Date.now()
  graph = buildWalkableGraph(getPlacedTilesInOrder())
  const dt = Date.now() - t0
  console.log(`[Bots] graph rebuilt: ${graph.nodes.size} cells, ${dt}ms (seed ${seed} → winning ${winning})`)

  // Reseat any surviving bots. Cheaper than tearing them down and
  // respawning (preserves team balance state).
  const nodesArr = [...graph.nodes]
  for (const b of bots) {
    b.currentCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
    b.clearPath()
  }
}

/** Team with fewer bots (ties → Red). Balances the bot population. */
function pickTeamForNewBot(): number {
  const red = bots.filter(b => b.team === 1).length
  const blue = bots.length - red
  return red <= blue ? 1 : 2
}

function spawnBot(): void {
  if (!graph || !deps) return
  const nodesArr = [...graph.nodes]
  const startCell = nodesArr[Math.floor(Math.random() * nodesArr.length)]
  const team = pickTeamForNewBot()
  const bot = new Bot({
    team,
    startCell,
    pickTarget: makeSmartTarget(deps.paint, team),
  }) as Bot & { botId: number }
  botIdCounter++
  bot.botId = botIdCounter
  bots.push(bot)
  console.log(`[Bots] spawn #${botIdCounter}: team ${team === 1 ? 'RED' : 'BLUE'} at ${startCell} (pop ${bots.length})`)
}

function retireBot(): void {
  // Retire the bot on the currently-larger bot team to maintain balance.
  const red = bots.filter(b => b.team === 1).length
  const blue = bots.length - red
  const targetTeam = red >= blue ? 1 : 2
  const idx = bots.findIndex(b => b.team === targetTeam)
  if (idx === -1) return
  const removed = bots.splice(idx, 1)[0]
  console.log(`[Bots] retire: team ${removed.team === 1 ? 'RED' : 'BLUE'} (pop ${bots.length})`)
}

/**
 * Main tick — call from the server's engine.addSystem loop. Handles
 * population adjustment AND bot movement/paint in one pass so callers
 * only wire one system.
 */
export function tickBots(dtSec: number): void {
  if (!graph || !deps) return

  // ── 1. Population control ──────────────────────────────────────────
  const humans = deps.humanCount()
  const desired = humans >= MIN_HUMANS
    ? Math.min(MAX_BOTS, Math.max(0, TARGET_ACTIVE - humans))
    : 0
  while (bots.length < desired) spawnBot()
  while (bots.length > desired) retireBot()

  // ── 2. Tick each bot ───────────────────────────────────────────────
  // Each step paints the stepped cell AND its walkable neighbors, matching
  // the ~3x3 footprint human players apply via paintTick. Without this, a
  // bot painted 1 cell vs the human's 9 per stride — ~9x weaker, and it
  // felt like the bots weren't really contesting territory.
  const dtMs = dtSec * 1000
  for (const b of bots) {
    for (const cellId of b.tick(dtMs, graph)) {
      deps.applyPaint(cellId, b.team)
      // 1-hop neighbors ≈ 3x3 stamp (center + up-to-4 orthogonal). Diagonals
      // would need a 2-hop query — not worth the cost; the visual difference
      // from missing diagonals is minor and it stays cheap.
      for (const nb of graph.adj.get(cellId) ?? []) {
        deps.applyPaint(nb, b.team)
      }
    }
  }
}

/** Diagnostics for the coverage log. */
export function botCount(): number { return bots.length }

/**
 * Snapshot of every bot's current world position. Called by the server's
 * 2 Hz botPositions broadcast tick. Empty array = no bots (broadcast
 * skipped by the caller so we don't fan out zero-payloads).
 */
export function getBotPositions(): Array<{ id: number; team: number; x: number; y: number; z: number }> {
  if (!graph) return []
  const out: Array<{ id: number; team: number; x: number; y: number; z: number }> = []
  for (const b of bots) {
    const pos = graph.worldPos.get(b.currentCell)
    if (!pos) continue // shouldn't happen — currentCell always comes from graph
    out.push({ id: b.botId, team: b.team, x: pos[0], y: pos[1], z: pos[2] })
  }
  return out
}
