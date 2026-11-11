/**
 * manager.ts — bot population control + tick loop.
 *
 * Owns the pool of active Bot instances. On each server tick:
 *   1. Population. PvP (default): fill the short team — bot count = how
 *      many fewer ACTIVE humans that team has. All bots sit on that team
 *      only (bots never fight bots). 1 red human → 1 blue bot; 3 red vs
 *      1 blue → 2 blue bots; even or zero humans → no bots. No cap.
 *      Wrong-side and excess bots retire immediately.
 *      PvB (setPopulation): every bot on the colour opposite the human
 *      team. Count = pvbBotCount(active humans). At a round boundary the
 *      pool is trimmed to that count. Mid-round it may grow when humans
 *      join, and it retires only when no humans are left.
 *   2. Tick every bot; apply resulting paint via the injected callback.
 *
 * Spawning: each bot starts on its own team's base, spread across the
 * base cells so a crowd does not stack on one cell. A round rebuild
 * reseats survivors the same way. If the short team flips (PvP), bots on
 * the old side retire immediately and new ones spawn on the new base.
 *
 * Paint is applied here (no paintTick wire message) and attributed to
 * `bot:<id>`. The server credits that id on the live / round scoreboard
 * only — never the persisted top-painters board.
 *
 * Active humans come from the roster (60s window). Bots are not part of
 * that count; they fill the gap after humans are assigned.
 */

import { generateWithRetry, getPlacedTilesInOrder, baseSpawn, baseTeamOfCellId, Placed } from '../../maze/generator'
import { TILES } from '../../maze/tiles'
import { buildWalkableGraph, WalkableGraph } from '../../shared/mazeGraph'
import { BotBody } from '../../shared/botBody'
import { graphFloorAt } from '../../shared/anvilSim'
import { KnockSpec } from '../../shared/knocks'
import { inBurst, inAirSpike, burstFootprint } from '../../shared/burst'
import {
  BOT_THINK_S, BOT_ENGAGE_RANGE, BOT_SAME_LEVEL_DY, BOT_LUNGE_RANGE, BOT_LUNGE_CHANCE, BOT_BURST_RANGE_FRAC,
  BOT_BURST_CHANCE, BOT_AIM_ERROR_DEG, BOT_LUNGE_BRAKE, LUNGE_DISTANCE, LUNGE_ACTIVE_S, LUNGE_COOLDOWN_S,
  BURST_COOLDOWN_S, BURST_RADIUS, BOT_BURST_PAINT_FRAC, BOT_BURST_PAINT_MIN_CELLS, BOT_BURST_PAINT_CHANCE,
  BOT_LUNGE_WINDUP_S, BOT_SPIKE_CHANCE, BOT_SPIKE_HOP_RANGE, pvbBotCount, BOT_LEAP_ROUTES,
  BOT_SEPARATE_M, BOT_SEPARATE_MAX_M,
} from '../../shared/pvp'
import { Bot, makeWeightedTarget, mulberry32, rollPersonality, PaintReader } from './bot'
import { orderNearest } from '../../shared/territory'
import { BOT_ANIM_LOCO } from '../../shared/botAnim'

type V3 = { x: number; y: number; z: number }
type Combat = {
  think: number
  lungeCd: number
  burstCd: number
  chaseLeft: number
  ids: number
  /** Own lunge in flight: who it is aimed at, for the round-stats hit (reported positions). */
  sweep: { target: string; left: number } | null
  /** Crouch before the dash. lungeStarted waits until this hits zero. */
  windup: { left: number; dx: number; dz: number; target: string; at: V3 } | null
  /** Human we jumped to spike. Cleared when the dive fires or we land. */
  spikeFor: string | null
  /** Human this bot is chasing or swinging at, so a teammate can pick someone else. */
  chaseHuman: string | null
  /** Air spike in the air. A miss paints when the body settles; a hit does not. */
  dive: { id: number; hit: boolean; fx: number; fz: number } | null
}
type Gait = { heading: number; walking: boolean; sepX: number; sepZ: number; aim: string | null }
type LiveBot = Bot & { botId: number; body: BotBody; combat: Combat; gait: Gait }
const newGait = (): Gait => ({ heading: 0, walking: false, sepX: 0, sepZ: 0, aim: null })
const newCombat = (): Combat => ({
  think: BOT_THINK_S, lungeCd: 1, burstCd: 2, chaseLeft: 0, ids: 0, sweep: null, windup: null, spikeFor: null, dive: null, chaseHuman: null,
})

export interface ManagerDeps {
  /** Attribute paint to a team. Returns true if the cell actually flipped. */
  applyPaint: (cellId: string, team: number, painter: string) => boolean
  /** Read paint state to power smart-target heuristics. */
  paint: PaintReader
  /** Active humans per team (roster idle rule). Humans only — never bots. */
  activeHumans: () => { red: number; blue: number }
  /** Bot crossed the fall line at `at`; the cloud carries it to `base` (broadcast rescueStart, count the death). */
  onFell?: (id: number, at: V3, base: V3) => void
  /** Bot's cloud trip is over (landed, retired, or a round reset cut it short). */
  onRescueEnd?: (id: number) => void
  /** Combat. Humans with a fresh reported position (feet); omit to keep bots passive. */
  humans?: () => Array<{ id: string; team: number; x: number; y: number; z: number }>
  /** Which abilities this round allows (players get the same). */
  abilities?: () => { lunge: boolean; burst: boolean }
  /** Bot started lunge `lungeId` at `at` along (dx, dz): broadcast it like a player's. */
  onLunge?: (id: number, lungeId: number, dx: number, dz: number, at: V3) => void
  /** Bot fired burst `burstId` at `at`. air 1 is a spike (no paint yet); air 0 paints now. */
  onBurst?: (id: number, burstId: number, team: number, at: V3, air?: number, fx?: number, fz?: number) => void
  /** Air spike missed and the body met a floor: one ground footprint, like a player's burstLand. */
  onBurstLand?: (id: number, burstId: number, team: number, at: V3, fx: number, fz: number) => void
  /** Bot's lunge reached `human` by reported positions (round stats only; the victim's client knocks itself). */
  onBotHit?: (id: number, human: string) => void
  /** A bot just entered the round (live scoreboard row). */
  onSpawn?: (id: number, team: number) => void
}

let deps: ManagerDeps | null = null
let graph: WalkableGraph | null = null
let rampTiles: Placed[] = []
let placedTiles: Placed[] = []
let bots: LiveBot[] = []
let botIdCounter = 0

/** PvP fills the short team. PvB locks bots to the other colour (humanTeam is 1 or 2). */
export type BotPopulation = { kind: 'pvp' } | { kind: 'pvb'; humanTeam: number }
let population: BotPopulation = { kind: 'pvp' }
let populationGen = 0
let appliedGen = -1
/** Base cells per team, deep cells first, refreshed with the graph. */
const baseCellCache: { 1: string[]; 2: string[] } = { 1: [], 2: [] }

export function initBots(d: ManagerDeps): void {
  deps = d
  population = { kind: 'pvp' }
  populationGen++
  console.log('[Bots] initialised (PvP short-team fill; PvB via setPopulation)')
}

/** Called from startNextRound. The next tick fits the pool (PvP immediately, PvB at the boundary). */
export function setPopulation(mode: BotPopulation): void {
  population = mode.kind === 'pvb' && (mode.humanTeam === 1 || mode.humanTeam === 2)
    ? { kind: 'pvb', humanTeam: mode.humanTeam }
    : { kind: 'pvp' }
  populationGen++
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
    rampTiles = []
    placedTiles = []
    baseCellCache[1] = []
    baseCellCache[2] = []
    return
  }
  const t0 = Date.now()
  const tiles = getPlacedTilesInOrder()
  graph = buildWalkableGraph(tiles)
  rampTiles = tiles.filter(t => TILES[t.type].isRamp)
  placedTiles = tiles
  cacheBaseCells()
  const dt = Date.now() - t0
  console.log(`[Bots] graph rebuilt: ${graph.nodes.size} cells, ${dt}ms (seed ${seed} → winning ${winning})`)

  // New round: spread any surviving ghost across its own base (the old
  // cellIds are stale). tickBots() then re-checks its team next tick.
  for (const b of bots) placeAtBase(b)
}

function cacheBaseCells(): void {
  baseCellCache[1] = []
  baseCellCache[2] = []
  if (!graph) return
  const buckets: { 1: string[]; 2: string[] } = { 1: [], 2: [] }
  for (const id of graph.nodes) {
    const t = baseTeamOfCellId(id)
    if (t === 1 || t === 2) buckets[t].push(id)
  }
  for (const team of [1, 2] as const) {
    buckets[team].sort((a, b) => {
      const da = graph!.deepNodes.has(a) ? 0 : 1
      const db = graph!.deepNodes.has(b) ? 0 : 1
      if (da !== db) return da - db
      const pa = graph!.worldPos.get(a)
      const pb = graph!.worldPos.get(b)
      if (pa && pb && pa[0] !== pb[0]) return pa[0] - pb[0]
      if (pa && pb && pa[2] !== pb[2]) return pa[2] - pb[2]
      return a < b ? -1 : a > b ? 1 : 0
    })
    baseCellCache[team] = buckets[team]
  }
}

/** Stand a bot on its base: legs and body both, ending any cloud trip. */
function placeAtBase(b: LiveBot): void {
  if (b.body.inRescue()) deps?.onRescueEnd?.(b.botId)
  const spot = pickSpawn(b.team, b)
  b.currentCell = spot.cell
  b.clearPath()
  b.body.reset(spot.pos)
}

/**
 * A free cell on this team's base. The first bot takes the same cell humans
 * spawn on; the rest walk the base so they don't stack. `self` is excluded
 * so a reseat can keep its own cell when nobody else is on it.
 */
function pickSpawn(team: number, self?: LiveBot): { cell: string; pos: V3 } {
  const cells = team === 1 || team === 2 ? baseCellCache[team] : []
  const taken = new Set<string>()
  for (const o of bots) if (o !== self && o.team === team) taken.add(o.currentCell)
  const primary = baseStartCell(team)
  const ordered = primary && !cells.includes(primary) ? [primary, ...cells] : [primary, ...cells.filter(id => id !== primary)]
  for (const id of ordered) {
    if (!id || taken.has(id)) continue
    const p = cellPos(id)
    if (p) return { cell: id, pos: p }
  }
  const cell = cells[0] ?? primary
  const base = cellPos(cell) ?? baseSpawn(team).pos
  const n = bots.filter(o => o !== self && o.team === team).length
  const ang = n * 2.399963229728653
  const rad = 0.45 * (1 + (n % 5))
  return { cell, pos: { x: base.x + Math.cos(ang) * rad, y: base.y, z: base.z + Math.sin(ang) * rad } }
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

function teamName(team: number): string {
  return team === 1 ? 'RED' : team === 2 ? 'BLUE' : 'NONE'
}

function countLabel(c: { red: number; blue: number }): string {
  return `red=${c.red} blue=${c.blue} bots=${bots.length}`
}

/** Short team and how many bots it needs. Even or empty lobbies need none. */
function desiredFill(c: { red: number; blue: number }): { team: number; count: number } {
  if (c.red + c.blue === 0 || c.red === c.blue) return { team: 0, count: 0 }
  if (c.red < c.blue) return { team: 1, count: c.blue - c.red }
  return { team: 2, count: c.red - c.blue }
}

/** Bot whose nearest human is farthest. No reported positions → newest id. */
function pickFarthest(pool: LiveBot[]): LiveBot {
  const humans = deps?.humans?.() ?? []
  let best = pool[0]
  let bestD = -1
  for (const b of pool) {
    const p = b.body.pos
    let d = 0
    if (humans.length > 0) {
      d = Infinity
      for (const h of humans) {
        const dd = Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z)
        if (dd < d) d = dd
      }
    }
    if (d > bestD + 1e-3 || (Math.abs(d - bestD) <= 1e-3 && b.botId > best.botId)) {
      best = b
      bestD = d
    }
  }
  return best
}

function spawnBot(team: number, reason: string, counts: { red: number; blue: number }): void {
  if (!graph || !deps) return
  // Own base, spread across the base cells. Each bot is its own instance:
  // path, combat cooldowns, and `bot:<id>` paint / hit credit.
  const spot = pickSpawn(team)
  botIdCounter++
  const botId = botIdCounter
  const personality = rollPersonality(mulberry32(botId * 0x9e3779b9), botId)
  const bot = new Bot({
    team,
    startCell: spot.cell,
    pickTarget: makeWeightedTarget(deps.paint, team),
    paint: deps.paint,   // enables own-paint-avoidance in pathfinding
    personality,
    rng: mulberry32(botId * 0x85ebca6b),
    useAir: BOT_LEAP_ROUTES,
  }) as LiveBot
  bot.botId = botId
  bot.body = new BotBody(spot.pos, mulberry32(botId * 0xc2b2ae35))
  bot.combat = newCombat()
  bot.gait = newGait()
  bots.push(bot)
  deps.onSpawn?.(bot.botId, team)
  const w = personality.weights
  const focus = (['paint', 'enemy', 'chase', 'roam'] as const).reduce((a, k) => w[k] > w[a] ? k : a, 'paint' as const)
  console.log(`[Bots] spawn #${bot.botId} team ${teamName(team)} at ${spot.cell} (${reason}, ${countLabel(counts)}) pace ${personality.speedMul.toFixed(2)} engage ${personality.engageM.toFixed(1)}m retarget ${personality.retargetS.toFixed(1)}s ${focus}`)
}

function retireBot(b: LiveBot, reason: string, counts: { red: number; blue: number }): void {
  const i = bots.indexOf(b)
  if (i < 0) return
  bots.splice(i, 1)
  if (b.body.inRescue()) deps?.onRescueEnd?.(b.botId)
  console.log(`[Bots] retire #${b.botId} team ${teamName(b.team)} (${reason}, ${countLabel(counts)})`)
}

/** Match the pool to the short team now. Excess and wrong-side bots leave immediately. */
function balanceBots(): void {
  if (!graph || !deps) return
  const fresh = appliedGen !== populationGen
  appliedGen = populationGen
  if (population.kind === 'pvb') {
    balancePvb(fresh)
    return
  }
  const counts = deps.activeHumans()
  const want = desiredFill(counts)
  if (want.count === 0) {
    const why = counts.red + counts.blue === 0 ? 'zero humans' : 'teams even'
    while (bots.length > 0) retireBot(pickFarthest(bots), why, counts)
    return
  }
  for (const b of bots.filter(x => x.team !== want.team)) {
    retireBot(b, `wrong team, short side is ${teamName(want.team)}`, counts)
  }
  while (bots.length > want.count) retireBot(pickFarthest(bots), 'excess, farthest from a human', counts)
  while (bots.length < want.count) {
    const before = bots.length
    spawnBot(want.team, 'fill short team', counts)
    if (bots.length === before) break
  }
}

/**
 * PvB pool. Wrong-team leftovers (the previous format) retire. On the tick
 * that applies a new population, trim down to the round-start count. After
 * that, only add bots — a human leaving does not retire anyone, unless the
 * human count hits zero.
 */
function balancePvb(fresh: boolean): void {
  if (!deps) return
  const counts = deps.activeHumans()
  const humans = counts.red + counts.blue
  const wantN = pvbBotCount(humans)
  const team = population.kind === 'pvb' && population.humanTeam === 1 ? 2 : 1
  for (const b of bots.filter(x => x.team !== team)) {
    retireBot(b, `wrong team, PvB bots are ${teamName(team)}`, counts)
  }
  if (wantN === 0) {
    while (bots.length > 0) retireBot(pickFarthest(bots), 'zero humans', counts)
    return
  }
  if (fresh) {
    while (bots.length > wantN) retireBot(pickFarthest(bots), 'round start, fit PvB count', counts)
  }
  while (bots.length < wantN) {
    const before = bots.length
    spawnBot(team, 'PvB fill', counts)
    if (bots.length === before) break
  }
}

/**
 * Main tick — call from the server's engine.addSystem loop. Handles
 * population adjustment AND bot movement/paint in one pass so callers
 * only wire one system.
 */
/** Seconds of bot simulation so far. Stamped on every broadcast so clients can
 *  interpolate by simulation time instead of packet arrival time. */
let simClock = 0
export function botSimTime(): number { return simClock }

/** Drop every bot. The lobby does not run the match, so ghosts must leave before the next broadcast. */
export function sleepBots(): void {
  const counts = deps ? deps.activeHumans() : { red: 0, blue: 0 }
  while (bots.length > 0) retireBot(bots[0], 'lobby', counts)
}

export function tickBots(dtSec: number): void {
  if (Number.isFinite(dtSec) && dtSec > 0) simClock += dtSec
  if (!graph || !deps) return

  // ── 1. Population control ──────────────────────────────────────────
  // Immediate: a human joining or waking drops the excess this tick, not at
  // the round boundary. Bot.team is fixed per instance (target is bound to it),
  // so a side flip retires the old bots and spawns on the new base.
  balanceBots()

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
    const world = { graph, rampTiles, tiles: placedTiles, base: cellPos(baseStartCell(b.team)) ?? baseSpawn(b.team).pos }
    for (const ev of b.body.tick(dtSec, world)) {
      if (ev.type === 'trace') console.log(ev.line)
      else if (ev.type === 'recover') console.log(`[Bots] ghost ${b.botId} recovery ${ev.how}`)
      else if (ev.type === 'settled') {
        const dive = b.combat.dive
        b.combat.dive = null
        b.combat.spikeFor = null
        b.combat.windup = null
        b.combat.chaseHuman = null
        if (dive && !dive.hit) deps?.onBurstLand?.(b.botId, dive.id, b.team, { ...b.body.pos }, dive.fx, dive.fz)
        const c = cellNear(b.body.pos)
        if (c) { b.currentCell = c; b.clearPath(); b.body.follow(cellPos(c)!) }
        else placeAtBase(b)
      } else if (ev.type === 'fell') {
        b.combat.dive = null
        b.combat.spikeFor = null
        b.combat.windup = null
        b.combat.chaseHuman = null
        console.log(`[Bots] ghost ${b.botId} fell at ${ev.catch.x.toFixed(1)},${ev.catch.y.toFixed(1)},${ev.catch.z.toFixed(1)} - cloud home`)
        deps.onFell?.(b.botId, ev.catch, world.base)
      } else if (ev.type === 'landed') {
        b.currentCell = baseStartCell(b.team)
        b.clearPath()
        deps.onRescueEnd?.(b.botId)
        console.log(`[Bots] ghost ${b.botId} home`)
      }
    }
    fillSense(b)
    fight(b, dtSec)
    if (!b.body.canWalk()) { b.gait.walking = false; continue }
    const stepped = b.tick(dtMs, graph)
    const leap = b.takeLeap()
    let holdLip = false
    if (leap) {
      const pos = cellPos(leap.to)
      if (pos && b.body.leap(pos)) {
        b.commitLeap()
        console.log(`[Bots] ghost ${b.botId} ${leap.kind}s toward ${leap.to}`)
      } else {
        const lip = cellPos(b.currentCell)
        const far = !!lip && Math.hypot(b.body.pos.x - lip.x, b.body.pos.z - lip.z) > 1.4
        if (far && lip) { b.body.follow(lip); holdLip = true }
        else b.clearPath()
      }
    }
    if (b.body.canWalk() && !holdLip) {
      const vp = b.visualPosition(graph)
      // The cell lerp, plus a small separation nudge. smoothWalk's corner cut
      // left this segment: the explorer avatar capsule stopped on the ramp
      // mesh while the transform kept going. e3c774d followed this point and
      // the mesh stayed on the entity.
      if (vp) {
        const at = { x: vp[0], y: vp[1], z: vp[2] }
        b.body.follow(b.path.length > 0 ? separate(b, at) : at)
      }
    } else b.gait.walking = false
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
      const stamp: string[] = []
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const nid = `${prefix}${col + dc},${row + dr}`
          if (graph.nodes.has(nid)) stamp.push(nid)
        }
      }
      for (const nid of orderNearest(stamp, stepId)) deps.applyPaint(nid, b.team, `bot:${b.botId}`)
    }
  }
}

/**
 * Combat brain, every BOT_THINK_S while the bot is on its feet: nearest enemy
 * human on its level within BOT_ENGAGE_RANGE → lunge if close, burst if inside
 * the radius, otherwise chase. Players' cooldowns; one roll per ability per think.
 */
/** Airborne, past the top of the hop: spike the human in the cylinder, or dive the miss. */
function trySpike(b: LiveBot, humans: Array<{ id: string; team: number; x: number; y: number; z: number }>): void {
  const c = b.combat
  if (!b.body.isAirborne() || b.body.verticalSpeed() > 1) return
  const can = deps?.abilities?.() ?? { lunge: false, burst: false }
  if (!can.burst || c.burstCd > 0 || c.dive) return
  const p = b.body.pos
  let aim: (typeof humans)[number] | null = null
  for (const h of humans) {
    if (h.team !== b.team && inAirSpike(p, h)) { aim = h; break }
  }
  if (!aim && c.spikeFor) aim = humans.find(h => h.id === c.spikeFor) ?? null
  if (!aim && !c.spikeFor) return
  const dx = (aim?.x ?? p.x) - p.x, dz = (aim?.z ?? p.z) - p.z
  const fl = Math.hypot(dx, dz) || 1
  b.body.dive(dx, dz)
  c.burstCd = BURST_COOLDOWN_S
  const id = ++c.ids
  const hit = !!aim && inAirSpike(p, aim)
  c.dive = { id, hit, fx: dx / fl, fz: dz / fl }
  c.spikeFor = null
  deps?.onBurst?.(b.botId, id, b.team, { ...p }, 1, c.dive.fx, c.dive.fz)
  console.log(`[Bots] ghost ${b.botId} spikes${hit ? ` ${aim!.id.slice(0, 8)}` : ' (miss)'}`)
}

function fillSense(b: LiveBot): void {
  const avoidCells = new Set<string>()
  const avoidHumans = new Set<string>()
  for (const o of bots) {
    if (o === b || o.team !== b.team) continue
    const g = o.goalOf()
    if (g) avoidCells.add(g)
    if (o.combat.chaseHuman) avoidHumans.add(o.combat.chaseHuman)
  }
  b.sense.humans = deps?.humans?.() ?? []
  b.sense.avoidCells = avoidCells
  b.sense.avoidHumans = avoidHumans
}


/** Nudge a walking bot off a teammate. Stays on a floor, and never more than SEPARATE_MAX off the path. */
function separate(b: LiveBot, pos: V3): V3 {
  if (!graph) return pos
  let x = 0, z = 0
  for (const o of bots) {
    if (o === b) continue
    const dx = pos.x - o.body.pos.x
    const dz = pos.z - o.body.pos.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-3 || d >= BOT_SEPARATE_M) continue
    const deficit = BOT_SEPARATE_M - d
    const same = o.team === b.team ? 1 : 0.65
    x += (dx / d) * deficit * same
    z += (dz / d) * deficit * same
  }
  const mag = Math.hypot(x, z)
  if (mag < 1e-3) return pos
  const scale = Math.min(BOT_SEPARATE_MAX_M, mag) / mag
  const nx = pos.x + x * scale
  const nz = pos.z + z * scale
  const floor = graphFloorAt(graph, rampTiles, nx, nz, pos.y, 1.3, 0.7)
  if (floor === null || Math.abs(floor - pos.y) > 0.8) return pos
  return { x: nx, y: pos.y, z: nz }
}

function fight(b: LiveBot, dt: number): void {
  const c = b.combat
  c.lungeCd -= dt; c.burstCd -= dt; c.chaseLeft -= dt; c.think -= dt
  const humans = deps?.humans?.() ?? []
  if (c.sweep) {
    c.sweep.left -= dt
    const h = humans.find(x => x.id === c.sweep!.target)
    const p = b.body.pos
    if (h && Math.hypot(h.x - p.x, h.z - p.z) < 2 && Math.abs(h.y - p.y) < BOT_SAME_LEVEL_DY) {
      deps?.onBotHit?.(b.botId, h.id)
      c.sweep = null
    } else if (c.sweep.left <= 0) c.sweep = null
  }
  if (c.windup) {
    c.windup.left -= dt
    if (c.windup.left > 0) return
    const w = c.windup
    c.windup = null
    if (b.body.dash(w.dx, w.dz, LUNGE_DISTANCE / LUNGE_ACTIVE_S, LUNGE_ACTIVE_S, BOT_LUNGE_BRAKE)) {
      c.lungeCd = LUNGE_COOLDOWN_S
      c.sweep = { target: w.target, left: LUNGE_ACTIVE_S + 0.4 }
      b.clearPath()
      deps?.onLunge?.(b.botId, ++c.ids, w.dx, w.dz, w.at)
      console.log(`[Bots] ghost ${b.botId} lunges at ${w.target.slice(0, 8)}`)
    }
    return
  }
  if (!b.body.canWalk()) { trySpike(b, humans); return }
  if (c.think > 0 || !graph) return
  c.think = BOT_THINK_S
  const p = b.body.pos
  const engage = b.personality?.engageM ?? BOT_ENGAGE_RANGE
  const nearestHuman = (skipTaken: boolean) => {
    let tgt: (typeof humans)[number] | null = null, best = engage
    for (const h of humans) {
      if (h.team === b.team || Math.abs(h.y - p.y) > BOT_SAME_LEVEL_DY) continue
      if (skipTaken && b.sense.avoidHumans.has(h.id)) continue
      const d = Math.hypot(h.x - p.x, h.z - p.z)
      if (d < best) { best = d; tgt = h }
    }
    return { tgt, best }
  }
  let { tgt, best } = nearestHuman(true)
  if (!tgt) ({ tgt, best } = nearestHuman(false))
  c.chaseHuman = tgt ? tgt.id : null
  const can = deps?.abilities?.() ?? { lunge: false, burst: false }
  if (!tgt) {
    // Nobody to fight: Burst for paint, like a player does, where most of the footprint isn't ours yet.
    if (!can.burst || c.burstCd > 0 || !deps) return
    const fp = burstFootprint(graph, b.currentCell)
    if (fp.length < BOT_BURST_PAINT_MIN_CELLS) return
    const gain = fp.filter(id => deps!.paint.teamOf(id) !== b.team).length
    if (gain / fp.length < BOT_BURST_PAINT_FRAC || Math.random() >= BOT_BURST_PAINT_CHANCE) return
    c.burstCd = BURST_COOLDOWN_S
    deps.onBurst?.(b.botId, ++c.ids, b.team, { ...p })
    console.log(`[Bots] ghost ${b.botId} bursts for paint (${gain}/${fp.length} cells)`)
    return
  }
  if (can.burst && c.burstCd <= 0 && best <= BOT_SPIKE_HOP_RANGE && Math.random() < BOT_SPIKE_CHANCE) {
    const dx = tgt.x - p.x, dz = tgt.z - p.z
    if (b.body.jump(dx, dz)) {
      c.spikeFor = tgt.id
      b.clearPath()
      console.log(`[Bots] ghost ${b.botId} jumps to spike ${tgt.id.slice(0, 8)} (${best.toFixed(1)} m)`)
      return
    }
  }
  if (can.lunge && c.lungeCd <= 0 && best <= BOT_LUNGE_RANGE && Math.random() < BOT_LUNGE_CHANCE) {
    const err = (Math.random() * 2 - 1) * BOT_AIM_ERROR_DEG * Math.PI / 180
    const ax = (tgt.x - p.x) / Math.max(best, 1e-3), az = (tgt.z - p.z) / Math.max(best, 1e-3)
    const dx = ax * Math.cos(err) - az * Math.sin(err), dz = ax * Math.sin(err) + az * Math.cos(err)
    c.lungeCd = LUNGE_COOLDOWN_S
    c.windup = { left: BOT_LUNGE_WINDUP_S, dx, dz, target: tgt.id, at: { ...p } }
    b.stun(BOT_LUNGE_WINDUP_S * 1000)
    b.clearPath()
    console.log(`[Bots] ghost ${b.botId} winds up a lunge at ${tgt.id.slice(0, 8)} (${best.toFixed(1)} m)`)
    return
  }
  if (can.burst && c.burstCd <= 0 && inBurst(p, tgt, BURST_RADIUS * BOT_BURST_RANGE_FRAC) && Math.random() < BOT_BURST_CHANCE) {
    c.burstCd = BURST_COOLDOWN_S
    deps?.onBurst?.(b.botId, ++c.ids, b.team, { ...p })
    console.log(`[Bots] ghost ${b.botId} bursts at ${tgt.id.slice(0, 8)} (${best.toFixed(1)} m)`)
    return
  }
  if (c.chaseLeft <= 0) {
    const cell = cellNear(tgt)
    if (cell && cell !== b.currentCell) { b.chase(cell); c.chaseLeft = 0.5 }
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
/** Body state on the wire: 0 walking, 1 knocked/airborne, 2 riding or dropping from the cloud,
 *  3 lunge wind-up (standing, facing the target), 4 gliding a recovery. */
export type BotWireState = 0 | 1 | 2 | 3 | 4

function wireOf(b: LiveBot): BotWireState {
  if (b.combat.windup) return 3
  if (b.body.isGliding()) return 4
  if (b.body.mode === 'walk') return 0
  return b.body.mode === 'knock' ? 1 : 2
}

/** Feet plus the graph cell the bot last stood on. Hit tests use the feet; the cell is only
 *  a footprint fallback for a ground Burst (a bot standing on a painted cell). */
export function getBotHitPoints(): Array<{ id: number; team: number; x: number; y: number; z: number; cell: string }> {
  if (!graph) return []
  return bots.map(b => ({ id: b.botId, team: b.team, x: b.body.pos.x, y: b.body.pos.y, z: b.body.pos.z, cell: b.currentCell }))
}

/** Pace, focus, and current goal. The separation verify reads this; playtest logs the same numbers at spawn. */
export function getBotProfiles(): Array<{
  id: number
  team: number
  speedMul: number
  engageM: number
  retargetS: number
  weights: { paint: number; enemy: number; chase: number; roam: number }
  goal: string | null
  chaseHuman: string | null
}> {
  return bots.map(b => ({
    id: b.botId,
    team: b.team,
    speedMul: b.personality?.speedMul ?? 1,
    engageM: b.personality?.engageM ?? BOT_ENGAGE_RANGE,
    retargetS: b.personality?.retargetS ?? 0,
    weights: b.personality?.weights ?? { paint: 0, enemy: 0, chase: 0, roam: 0 },
    goal: b.goalOf(),
    chaseHuman: b.combat.chaseHuman,
  }))
}

export function getBotPositions(): Array<{ id: number; team: number; x: number; y: number; z: number; st: BotWireState }> {
  if (!graph) return []
  const out: Array<{ id: number; team: number; x: number; y: number; z: number; st: BotWireState }> = []
  for (const b of bots) {
    // Walking: the body follows Bot.visualPosition() (sub-step lerp between
    // cells). Knocked / rescued: the body's own simulated position.
    const p = b.body.pos
    out.push({ id: b.botId, team: b.team, x: p.x, y: p.y, z: p.z, st: wireOf(b) })
  }
  return out
}

const lastSent = new Map<number, { x: number; y: number; z: number; t: number }>()

/** The botPositions broadcast: positions plus velocity over the real time since
 *  the previous broadcast, so clients can extrapolate fast motion between
 *  uneven packets. Only the broadcast tick may call this (it owns lastSent). */
export function getBotBroadcast(): Array<ReturnType<typeof getBotPositions>[number] & { vx: number; vy: number; vz: number; an: number }> {
  const now = Date.now()
  const animOf = new Map(bots.map(b => [b.botId, b.combat.windup ? BOT_ANIM_LOCO : b.body.animCode()]))
  const out = getBotPositions().map(b => {
    const prev = lastSent.get(b.id)
    const dt = prev ? (now - prev.t) / 1000 : 0
    lastSent.set(b.id, { x: b.x, y: b.y, z: b.z, t: now })
    const an = animOf.get(b.id) ?? BOT_ANIM_LOCO
    // Wind-up: the ghost is still. vx/vz carry the facing so the client yaws before the dash.
    if (b.st === 3) {
      const aim = bots.find(x => x.botId === b.id)?.combat.windup
      if (aim) return { ...b, vx: aim.dx * 3, vy: 0, vz: aim.dz * 3, an }
    }
    if (!prev || dt < 0.02 || dt > 0.5) return { ...b, vx: 0, vy: 0, vz: 0, an }
    return { ...b, vx: (b.x - prev.x) / dt, vy: (b.y - prev.y) / dt, vz: (b.z - prev.z) / dt, an }
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
  b.combat.windup = null
  b.combat.spikeFor = null
  b.combat.dive = null
  console.log(`[Bots] ghost ${id} hit: ${spec.kind}`)
  return true
}
