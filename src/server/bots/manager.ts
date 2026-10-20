/**
 * manager.ts — bot population control + tick loop.
 *
 * Owns the pool of active Bot instances. On each server tick:
 *   1. Adjust population to hit `targetActive` humans + bots
 *   2. Tick every bot; apply resulting paint via the injected callback
 *
 * Spawning: the ghost always starts on its OWN base tile centre (the base
 * opposite the solo human). On a round boundary the graph is rebuilt and
 * the ghost is sent back to its base; if the solo human changes team the
 * ghost is respawned for the other side on the other base.
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

import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, baseTeamOfCellId } from '../../maze/generator'
import { buildWalkableGraph, WalkableGraph } from '../../shared/mazeGraph'
import { Bot, makeSmartTarget, PaintReader } from './bot'

// Solo-mode: exactly one bot appears when there is exactly one human,
// always on the OPPOSITE team so the solo player has an opponent. Two+
// humans = no bots; zero humans = no bots.
const SOLO_HUMAN_COUNT = 1

export interface ManagerDeps {
  /** Attribute paint to a team. Returns true if the cell actually flipped. */
  applyPaint: (cellId: string, team: number) => boolean
  /** Read paint state to power smart-target heuristics. */
  paint: PaintReader
  /** Currently-connected (or ever-connected) human count. */
  humanCount: () => number
  /** Team (1 or 2) of the sole human when humanCount===1, else null. */
  soloHumanTeam: () => number | null
}

let deps: ManagerDeps | null = null
let graph: WalkableGraph | null = null
let bots: Array<Bot & { botId: number }> = []
let botIdCounter = 0

export function initBots(d: ManagerDeps): void {
  deps = d
  console.log('[Bots] initialised (solo-mode: 1 bot when 1 human, opposite team)')
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

  // New round: send any surviving ghost back to its own base (the old
  // cellIds are stale). tickBots() then re-checks its team next tick.
  for (const b of bots) {
    b.currentCell = baseStartCell(b.team)
    b.clearPath()
  }
}

/**
 * Walkable cell at the centre of a team's base tile — the graph node
 * nearest baseSpawn(team) (same spot human players spawn on, at base
 * altitude). Prefers deep (off-wall) cells; falls back to any walkable
 * cell, then any node, so a bot always gets a start.
 */
function baseStartCell(team: number): string {
  const g = graph!
  const target = baseSpawn(team).pos
  for (const pool of [g.deepNodes, g.nodes]) {
    let best: string | null = null, bestD = Infinity
    for (const id of pool) {
      if (baseTeamOfCellId(id) !== team) continue
      const p = g.worldPos.get(id)
      if (!p) continue
      const d = (p[0] - target.x) ** 2 + (p[1] - target.y) ** 2 + (p[2] - target.z) ** 2
      if (d < bestD) { bestD = d; best = id }
    }
    if (best) return best
  }
  return [...g.nodes][0]
}

/** Solo-mode: bot team is opposite of the sole human. Defaults to Blue
 *  if soloHumanTeam is somehow unavailable at spawn time. */
function pickTeamForNewBot(): number {
  const humanTeam = deps?.soloHumanTeam() ?? 1
  return humanTeam === 1 ? 2 : 1
}

function spawnBot(): void {
  if (!graph || !deps) return
  // Spawn on the deep (eroded) subgraph so the bot's very first path
  // stays off walls. Fall back to full nodes only in the pathological
  // case where the deep set is empty (shouldn't happen with ARM=10).
  // Spawn on the ghost's OWN base — the opposite base from the solo human.
  const team = pickTeamForNewBot()
  const startCell = baseStartCell(team)
  const bot = new Bot({
    team,
    startCell,
    pickTarget: makeSmartTarget(deps.paint, team),
    paint: deps.paint,   // enables own-paint-avoidance in pathfinding
  }) as Bot & { botId: number }
  botIdCounter++
  bot.botId = botIdCounter
  bots.push(bot)
  console.log(`[Bots] spawn #${botIdCounter}: team ${team === 1 ? 'RED' : 'BLUE'} at ${startCell} (pop ${bots.length})`)
}

function retireBot(): void {
  const removed = bots.pop()
  if (!removed) return
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
  const desired = humans === SOLO_HUMAN_COUNT ? 1 : 0
  while (bots.length < desired) spawnBot()
  while (bots.length > desired) retireBot()

  // Solo human switched team (or was re-assigned at a new round): the ghost
  // must play the other side, so retire it and respawn on the opposite base.
  // Bot.team is fixed per instance (its smart target is bound to it).
  const solo = deps.soloHumanTeam()
  if (solo !== null && bots.length === 1 && bots[0].team === solo) {
    console.log(`[Bots] solo human is now ${solo === 1 ? 'RED' : 'BLUE'} - respawning ghost on the opposite base`)
    retireBot()
    spawnBot()
  }

  // Ghost off the map (its cell no longer exists, e.g. the tile under it
  // went away): respawn on its own base. Server bots walk the graph and
  // can't physically fall, so this is the equivalent of a fall respawn.
  for (const b of bots) {
    if (!graph.nodes.has(b.currentCell)) {
      console.log(`[Bots] ghost ${b.team === 1 ? 'RED' : 'BLUE'} lost its cell - back to its base`)
      b.currentCell = baseStartCell(b.team)
      b.clearPath()
    }
  }

  // ── 2. Tick each bot ───────────────────────────────────────────────
  // Each step paints the stepped cell AND its walkable neighbors, matching
  // the ~3x3 footprint human players apply via paintTick. Without this, a
  // bot painted 1 cell vs the human's 9 per stride — ~9x weaker, and it
  // felt like the bots weren't really contesting territory.
  const dtMs = dtSec * 1000
  for (const b of bots) {
    for (const stepId of b.tick(dtMs, graph)) {
      // Paint the full 3x3 stamp around the stepped cell (matches human
      // 9-cell footprint). Uses cellId arithmetic + graph.nodes lookup so
      // off-corridor positions are filtered.
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

/** Diagnostics for the coverage log. */
export function botCount(): number { return bots.length }

/** Current round's walkable graph (null until the first rebuild succeeds).
 *  Also read by server/paintBomb to resolve the blast circle. */
export function getWalkableGraph(): WalkableGraph | null { return graph }

/**
 * Snapshot of every bot's current world position. Called by the server's
 * 2 Hz botPositions broadcast tick. Empty array = no bots (broadcast
 * skipped by the caller so we don't fan out zero-payloads).
 */
export function getBotPositions(): Array<{ id: number; team: number; x: number; y: number; z: number }> {
  if (!graph) return []
  const out: Array<{ id: number; team: number; x: number; y: number; z: number }> = []
  for (const b of bots) {
    // Sub-step interpolated position — lerps between currentCell and
    // path[0] based on step accumulator. Turns the broadcast into
    // continuous motion instead of teleport-then-hold. See Bot.visualPosition().
    const pos = b.visualPosition(graph)
    if (!pos) continue
    out.push({ id: b.botId, team: b.team, x: pos[0], y: pos[1], z: pos[2] })
  }
  return out
}

/**
 * Punch on a ghost bot. Range-checks the puncher's reported position, then
 * slides the bot up to `shove` m along (dx, dz), stopping where the floor
 * it stands on ends (samples every 0.5 m, nearest walkable node within
 * ~one cell at the same height). Server bots walk the graph and can't fall,
 * so the ghost is pushed to the edge, not off it. Returns false if rejected.
 */
export function punchBot(id: number, ax: number, ay: number, az: number, dx: number, dz: number,
  maxRange: number, maxDy: number, shove: number, stunMs: number): boolean {
  if (!graph) return false
  const b = bots.find(x => x.botId === id)
  if (!b) return false
  const pos = b.visualPosition(graph)
  if (!pos) return false
  if (Math.hypot(pos[0] - ax, pos[2] - az) > maxRange || Math.abs(pos[1] - ay) > maxDy) {
    console.log(`[Bots] punch on ghost ${id} rejected: range`)
    return false
  }
  const NODE_TOL = 2.5
  const nearest = (x: number, y: number, z: number): string | null => {
    let best: string | null = null
    let bestD = NODE_TOL
    for (const nid of graph!.deepNodes) {
      const p = graph!.worldPos.get(nid)
      if (!p || Math.abs(p[1] - y) > 1.5) continue
      const d = Math.hypot(p[0] - x, p[2] - z)
      if (d < bestD) { bestD = d; best = nid }
    }
    return best
  }
  let dest = b.currentCell
  for (let s = 0.5; s <= shove + 1e-6; s += 0.5) {
    const n = nearest(pos[0] + dx * s, pos[1], pos[2] + dz * s)
    if (!n) break
    dest = n
  }
  b.currentCell = dest
  b.clearPath()
  b.stun(stunMs)
  console.log(`[Bots] ghost ${id} punched → ${dest}`)
  return true
}
