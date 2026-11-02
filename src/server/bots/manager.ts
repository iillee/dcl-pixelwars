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

import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, baseTeamOfCellId, Placed } from '../../maze/generator'
import { TILES } from '../../maze/tiles'
import { buildWalkableGraph, WalkableGraph } from '../../shared/mazeGraph'
import { BotBody } from '../../shared/botBody'
import { KnockSpec } from '../../shared/knocks'
import { Bot, makeSmartTarget, PaintReader } from './bot'

type V3 = { x: number; y: number; z: number }
type LiveBot = Bot & { botId: number; body: BotBody }

// Solo-mode: exactly one bot appears when there is exactly one human,
// always on the OPPOSITE team so the solo player has an opponent. Two+
// humans = no bots; zero humans = no bots.
const SOLO_HUMAN_COUNT = 1

export interface ManagerDeps {
  /** Attribute paint to a team. Returns true if the cell actually flipped. */
  applyPaint: (cellId: string, team: number, painter: string) => boolean
  /** Read paint state to power smart-target heuristics. */
  paint: PaintReader
  /** Currently-connected (or ever-connected) human count. */
  humanCount: () => number
  /** Team (1 or 2) of the sole human when humanCount===1, else null. */
  soloHumanTeam: () => number | null
  /** Bot crossed the fall line at `at`; the cloud carries it to `base` (broadcast rescueStart, count the death). */
  onFell?: (id: number, at: V3, base: V3) => void
  /** Bot's cloud trip is over (landed, retired, or a round reset cut it short). */
  onRescueEnd?: (id: number) => void
}

let deps: ManagerDeps | null = null
let graph: WalkableGraph | null = null
let rampTiles: Placed[] = []
let bots: LiveBot[] = []
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
  const tiles = getPlacedTilesInOrder()
  graph = buildWalkableGraph(tiles)
  rampTiles = tiles.filter(t => TILES[t.type].isRamp)
  const dt = Date.now() - t0
  console.log(`[Bots] graph rebuilt: ${graph.nodes.size} cells, ${dt}ms (seed ${seed} → winning ${winning})`)

  // New round: send any surviving ghost back to its own base (the old
  // cellIds are stale). tickBots() then re-checks its team next tick.
  for (const b of bots) placeAtBase(b)
}

/** Stand a bot on its base: legs and body both, ending any cloud trip. */
function placeAtBase(b: LiveBot): void {
  if (b.body.inRescue()) deps?.onRescueEnd?.(b.botId)
  b.currentCell = baseStartCell(b.team)
  b.clearPath()
  b.body.reset(cellPos(b.currentCell) ?? baseSpawn(b.team).pos)
}

function cellPos(id: string): V3 | null {
  const p = graph?.worldPos.get(id)
  return p ? { x: p[0], y: p[1], z: p[2] } : null
}

/** Graph cell under a body that just stopped: deep cells first, within ~one cell and a step of height. */
function cellNear(p: V3): string | null {
  const g = graph!
  for (const pool of [g.deepNodes, g.nodes]) {
    let best: string | null = null, bestD = 2.5
    for (const id of pool) {
      const q = g.worldPos.get(id)
      if (!q || Math.abs(q[1] - p.y) > 1.5) continue
      const d = Math.hypot(q[0] - p.x, q[2] - p.z)
      if (d < bestD) { bestD = d; best = id }
    }
    if (best) return best
  }
  return null
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
  }) as LiveBot
  botIdCounter++
  bot.botId = botIdCounter
  bot.body = new BotBody(cellPos(startCell) ?? baseSpawn(team).pos)
  bots.push(bot)
  console.log(`[Bots] spawn #${botIdCounter}: team ${team === 1 ? 'RED' : 'BLUE'} at ${startCell} (pop ${bots.length})`)
}

function retireBot(): void {
  const removed = bots.pop()
  if (!removed) return
  if (removed.body.inRescue()) deps?.onRescueEnd?.(removed.botId)
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

  // Walking ghost whose cell no longer exists (e.g. the tile under it went
  // away): back to its own base.
  for (const b of bots) {
    if (b.body.mode === 'walk' && !graph.nodes.has(b.currentCell)) {
      console.log(`[Bots] ghost ${b.team === 1 ? 'RED' : 'BLUE'} lost its cell - back to its base`)
      placeAtBase(b)
    }
  }

  // ── 2. Tick each bot ───────────────────────────────────────────────
  // Body first (knock flight, cloud ride, landing), then the legs if the
  // body lets them walk. Each step paints the stepped cell AND its walkable
  // neighbors, matching the ~3x3 footprint human players apply via
  // paintTick. Knocked, falling or riding bots don't paint.
  const dtMs = dtSec * 1000
  for (const b of bots) {
    const world = { graph, rampTiles, base: cellPos(baseStartCell(b.team)) ?? baseSpawn(b.team).pos }
    for (const ev of b.body.tick(dtSec, world)) {
      if (ev.type === 'trace') console.log(ev.line)
      else if (ev.type === 'settled') {
        const c = cellNear(b.body.pos)
        if (c) { b.currentCell = c; b.clearPath(); b.body.follow(cellPos(c)!) }
        else placeAtBase(b)
      } else if (ev.type === 'fell') {
        console.log(`[Bots] ghost ${b.botId} fell at ${ev.catch.x.toFixed(1)},${ev.catch.y.toFixed(1)},${ev.catch.z.toFixed(1)} - cloud home`)
        deps.onFell?.(b.botId, ev.catch, world.base)
      } else if (ev.type === 'landed') {
        b.currentCell = baseStartCell(b.team)
        b.clearPath()
        deps.onRescueEnd?.(b.botId)
        console.log(`[Bots] ghost ${b.botId} home`)
      }
    }
    if (!b.body.canWalk()) continue
    const stepped = b.tick(dtMs, graph)
    const vp = b.visualPosition(graph)
    if (vp) b.body.follow({ x: vp[0], y: vp[1], z: vp[2] })
    for (const stepId of stepped) {
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
          if (graph.nodes.has(nid)) deps.applyPaint(nid, b.team, `bot:${b.botId}`)
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
/** Body state on the wire: 0 walking, 1 knocked/airborne, 2 riding or dropping from the cloud. */
export type BotWireState = 0 | 1 | 2

export function getBotPositions(): Array<{ id: number; team: number; x: number; y: number; z: number; st: BotWireState }> {
  if (!graph) return []
  const out: Array<{ id: number; team: number; x: number; y: number; z: number; st: BotWireState }> = []
  for (const b of bots) {
    // Walking: the body follows Bot.visualPosition() (sub-step lerp between
    // cells). Knocked / rescued: the body's own simulated position.
    const p = b.body.pos
    const st: BotWireState = b.body.mode === 'walk' ? 0 : b.body.mode === 'knock' ? 1 : 2
    out.push({ id: b.botId, team: b.team, x: p.x, y: p.y, z: p.z, st })
  }
  return out
}

const lastSent = new Map<number, { x: number; y: number; z: number; t: number }>()

/** The botPositions broadcast: positions plus velocity over the real time since
 *  the previous broadcast, so clients can extrapolate fast motion between
 *  uneven packets. Only the broadcast tick may call this (it owns lastSent). */
export function getBotBroadcast(): Array<ReturnType<typeof getBotPositions>[number] & { vx: number; vy: number; vz: number }> {
  const now = Date.now()
  const out = getBotPositions().map(b => {
    const prev = lastSent.get(b.id)
    const dt = prev ? (now - prev.t) / 1000 : 0
    lastSent.set(b.id, { x: b.x, y: b.y, z: b.z, t: now })
    if (!prev || dt < 0.02 || dt > 0.5) return { ...b, vx: 0, vy: 0, vz: 0 }
    return { ...b, vx: (b.x - prev.x) / dt, vy: (b.y - prev.y) / dt, vz: (b.z - prev.z) / dt }
  })
  for (const id of [...lastSent.keys()]) if (!out.some(b => b.id === id)) lastSent.delete(id)
  return out
}

/**
 * A hit on a ghost bot. Range-checks the attacker's reported position against
 * the bot's body, then applies the same KnockSpec a human victim would get
 * (`specFor` gets whether the bot is on a floor, for the spike). The body
 * flies, can be knocked off the map and is rescued like a player.
 * Returns false if rejected (no such bot, out of range, immune / riding).
 */
export function hitBot(id: number, ax: number, ay: number, az: number,
  maxRange: number, maxDy: number, specFor: (grounded: boolean) => KnockSpec): boolean {
  if (!graph) return false
  const b = bots.find(x => x.botId === id)
  if (!b) return false
  const p = b.body.pos
  if (Math.hypot(p.x - ax, p.z - az) > maxRange || Math.abs(p.y - ay) > maxDy) {
    console.log(`[Bots] hit on ghost ${id} rejected: range`)
    return false
  }
  if (!b.body.canBeHit()) return false
  const spec = specFor(b.body.isGrounded())
  if (!b.body.knock(spec)) return false
  b.clearPath()
  console.log(`[Bots] ghost ${id} hit: ${spec.kind}`)
  return true
}
