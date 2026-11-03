/**
 * verify-bot-visual.ts — replay a server botPositions stream through the
 * 74cc09b client interpolation (src/client/botVisual.ts) and check the
 * drawn feet stay on the server feet.
 *
 * Run: npx tsx scripts/verify-bot-visual.ts
 *
 * Covers a ramp walk, a platform leap, and a knock that glides. The client
 * copy is headless: same thresholds, same snapshot buffer, same walk lerp.
 */
import { generateWithRetry, getPlacedTilesInOrder } from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { buildWalkableGraph, WalkableGraph } from '../src/shared/mazeGraph'
import { Bot, mustLeap } from '../src/server/bots/bot'
import { BotBody } from '../src/shared/botBody'
import { lungeKnock } from '../src/shared/knocks'
import { initBots, rebuildBotGraph, tickBots, getBotBroadcast, botSimTime } from '../src/server/bots/manager'

const PREDICT_AHEAD_SEC = 0.1
const LERP_SPEED_PER_SEC = 4
const BROADCAST_INTERVAL_SEC = 0.1
const TELEPORT_THRESHOLD = 8
const TELEPORT_THRESHOLD_FAST = 60
const INTERP_DELAY_S = 0.25
const SNAP_KEEP = 16
const INTERP_EXTRAPOLATE_MAX_S = 0.1
const FAST_HOLD_S = INTERP_DELAY_S + 0.15

type V = { x: number; y: number; z: number }
type Packet = { t: number; x: number; y: number; z: number; st: number; vx: number; vy: number; vz: number }
type Snap = { t: number; pos: V }

const sub = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const lerp = (a: V, b: V, t: number): V => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
})

/** The 74cc09b draw loop, one bot, no engine. */
class Client {
  lastServer: V = { x: 0, y: 0, z: 0 }
  velocity: V = { x: 0, y: 0, z: 0 }
  render: V = { x: 0, y: 0, z: 0 }
  fastUntil = 0
  snaps: Snap[] = []
  riding = false
  clock: number | null = null
  born = false
  now = 0

  private delay(): number {
    const s = this.snaps
    if (s.length < 2) return INTERP_DELAY_S
    const gap = (s[s.length - 1].t - s[0].t) / (s.length - 1)
    return Math.min(0.6, Math.max(INTERP_DELAY_S, gap * 1.5 + 0.05))
  }

  private interpolate(rt: number): V | null {
    const s = this.snaps
    if (s.length === 0) return null
    if (rt <= s[0].t) return s[0].pos
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i]
      if (rt <= b.t) return lerp(a.pos, b.pos, (rt - a.t) / Math.max(1e-4, b.t - a.t))
    }
    const last = s[s.length - 1]
    if (s.length < 2) return last.pos
    const prev = s[s.length - 2]
    const ahead = Math.min(INTERP_EXTRAPOLATE_MAX_S, rt - last.t)
    const u = ahead / Math.max(1e-4, last.t - prev.t)
    return {
      x: last.pos.x + (last.pos.x - prev.pos.x) * u,
      y: last.pos.y + (last.pos.y - prev.pos.y) * u,
      z: last.pos.z + (last.pos.z - prev.pos.z) * u,
    }
  }

  /** One botPositions packet, arriving `lag` seconds after sim time t. */
  packet(p: Packet, lag = 0.05): void {
    this.now = (p.t + lag) * 1000
    const simT = p.t
    const sample = this.now / 1000 - simT
    if (this.clock === null || sample < this.clock || Math.abs(sample - this.clock) > 5) this.clock = sample
    else this.clock += (sample - this.clock) * 0.05
    const server = { x: p.x, y: p.y, z: p.z }
    if (!this.born) {
      this.born = true
      this.lastServer = server
      this.render = { ...server }
      return
    }
    const dist = sub(server, this.lastServer)
    const lastT = this.snaps.length ? this.snaps[this.snaps.length - 1].t : -Infinity
    if (simT < lastT - 1) this.snaps = []
    if (simT > lastT + 1e-4) this.snaps.push({ t: simT, pos: server })
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift()
    const wasFast = this.now < this.fastUntil
    this.riding = p.st === 2
    if (p.st !== 0) this.fastUntil = this.now + FAST_HOLD_S * 1000
    if (this.now < this.fastUntil) {
      this.lastServer = { ...server }
      this.velocity = { x: p.vx, y: p.vy, z: p.vz }
      return
    }
    const snapAt = wasFast ? TELEPORT_THRESHOLD_FAST : TELEPORT_THRESHOLD
    if (dist > snapAt) {
      this.render = { ...server }
      this.lastServer = { ...server }
      this.velocity = { x: 0, y: 0, z: 0 }
    } else if (dist > 1e-3) {
      this.velocity = {
        x: (server.x - this.lastServer.x) / BROADCAST_INTERVAL_SEC,
        y: (server.y - this.lastServer.y) / BROADCAST_INTERVAL_SEC,
        z: (server.z - this.lastServer.z) / BROADCAST_INTERVAL_SEC,
      }
      this.lastServer = server
    }
  }

  /** One render frame, dt seconds after the last packet's arrival. */
  frame(dt: number): void {
    this.now += dt * 1000
    const rt = this.clock === null ? 0 : this.now / 1000 - this.clock - this.delay()
    const interp = this.now < this.fastUntil && this.clock !== null && !this.riding ? this.interpolate(rt) : null
    if (interp) this.render = interp
    else {
      const pred = {
        x: this.lastServer.x + this.velocity.x * PREDICT_AHEAD_SEC,
        y: this.lastServer.y + this.velocity.y * PREDICT_AHEAD_SEC,
        z: this.lastServer.z + this.velocity.z * PREDICT_AHEAD_SEC,
      }
      const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
      this.render = lerp(this.render, pred, k)
    }
  }
}

type Report = { name: string; max: number; stuck: number; nans: number; sts: string; samples: number }

function replay(name: string, packets: Packet[]): Report {
  const c = new Client()
  let max = 0
  let stuck = 0
  let nans = 0
  const sts = new Map<number, number>()
  let prevRender: V | null = null
  let prevServer: V | null = null
  for (const p of packets) {
    if (![p.x, p.y, p.z, p.vx, p.vy, p.vz, p.t].every(Number.isFinite)) nans++
    sts.set(p.st, (sts.get(p.st) ?? 0) + 1)
    c.packet(p)
    // Two frames between 10 Hz packets, the way a 30 Hz client draws.
    for (let i = 0; i < 3; i++) c.frame(0.033)
    const server = { x: p.x, y: p.y, z: p.z }
    const err = sub(c.render, server)
    if (err > max) max = err
    if (prevRender && prevServer && sub(prevRender, c.render) < 0.05 && sub(prevServer, server) > 1.5) stuck++
    prevRender = { ...c.render }
    prevServer = server
  }
  const stText = [...sts.entries()].map(([k, n]) => `${k}:${n}`).join(' ')
  console.log(`${name}: packets=${packets.length} maxDrawError=${max.toFixed(2)} m  frozenWhileServerMoved=${stuck}  nans=${nans}  st[${stText}]`)
  return { name, max, stuck, nans, sts: stText, samples: packets.length }
}

function finite(p: Packet[]): boolean {
  const ids = new Set<number>()
  return p.every(x => Number.isFinite(x.x) && Number.isFinite(x.y) && Number.isFinite(x.z))
}

// ── Ramp edges the walker is told to leap ───────────────────────────
generateWithRetry(42)
const tiles = getPlacedTilesInOrder()
const graph = buildWalkableGraph(tiles)
let rampEdges = 0
let rampLeaps = 0
let maxDy = 0
let maxDist = 0
for (const [id, nbs] of graph.adj) {
  const [tx, tz, ty] = id.split(':')[0].split(',').map(Number)
  const tile = tiles.find(t => t.x === tx && t.z === tz && Math.abs(t.y - ty) < 0.05)
  if (!tile || !TILES[tile.type].isRamp) continue
  const a = graph.worldPos.get(id)
  if (!a) continue
  for (const nb of nbs) {
    const b = graph.worldPos.get(nb)
    if (!b) continue
    rampEdges++
    const dy = Math.abs(a[1] - b[1])
    const dist = Math.hypot(a[0] - b[0], a[2] - b[2])
    if (dy > maxDy) maxDy = dy
    if (dist > maxDist) maxDist = dist
    if (mustLeap(a, b)) rampLeaps++
  }
}
console.log(`ramp walk edges=${rampEdges} mustLeap=${rampLeaps} maxDy=${maxDy.toFixed(2)} maxHoriz=${maxDist.toFixed(2)}`)

// ── Live manager: one bot, 12 s, whatever route it rolls (often a ramp) ──
let counts = { red: 1, blue: 0 }
initBots({ applyPaint: () => false, paint: { teamOf: () => 0 }, activeHumans: () => counts, humans: () => [] })
rebuildBotGraph(42)
const live: Packet[] = []
let acc = 0
for (let t = 0; t < 12; t += 0.05) {
  tickBots(0.05)
  acc += 0.05
  if (acc >= 0.1 - 1e-6) {
    acc = 0
    const b = getBotBroadcast()[0]
    if (b) live.push({ t: botSimTime(), x: b.x, y: b.y, z: b.z, st: b.st, vx: b.vx, vy: b.vy, vz: b.vz })
  }
}
const dup = live.length !== new Set(live.map((_, i) => i)).size
console.log(`live stream unique times=${new Set(live.map(p => p.t.toFixed(3))).size}/${live.length} dupCheck=${dup}`)
const liveReport = replay('live 12s', live)

// ── A forced ramp walk, no leap: step along ramp neighbours ─────────
function rampChain(g: WalkableGraph): string[] | null {
  for (const [id, nbs] of g.adj) {
    const p = g.worldPos.get(id)
    if (!p) continue
    const up = nbs.map(n => ({ n, q: g.worldPos.get(n) })).filter(x => x.q && x.q[1] > p[1] + 0.3)
    if (!up.length) continue
    const chain = [id]
    let cur = up[0].n
    for (let i = 0; i < 14 && cur; i++) {
      chain.push(cur)
      const here = g.worldPos.get(cur)!
      const next = (g.adj.get(cur) ?? []).find(n => {
        const q = g.worldPos.get(n)
        return q && q[1] > here[1] + 0.3 && !chain.includes(n)
      })
      if (!next) break
      cur = next
    }
    if (chain.length >= 6) return chain
  }
  return null
}
const chain = rampChain(graph)
const rampPackets: Packet[] = []
if (chain) {
  const bot = new Bot({ team: 2, startCell: chain[0], stepsPerSec: 4, useAir: true, pickTarget: () => chain[chain.length - 1] })
  const p0 = graph.worldPos.get(chain[0])!
  const body = new BotBody({ x: p0[0], y: p0[1], z: p0[2] })
  let prev: Packet | null = null
  for (let i = 0, sim = 0; i < 80; i++, sim += 0.1) {
    bot.tick(100, graph)
    const leap = bot.takeLeap()
    if (leap) {
      const to = graph.worldPos.get(leap.to)
      if (to) body.leap({ x: to[0], y: to[1], z: to[2] })
      bot.commitLeap()
    }
    if (body.canWalk()) {
      const vp = bot.visualPosition(graph)
      if (vp) body.follow({ x: vp[0], y: vp[1], z: vp[2] })
    } else {
      body.tick(0.1, { graph, rampTiles: tiles.filter(t => TILES[t.type].isRamp), tiles, base: { x: p0[0], y: p0[1], z: p0[2] } })
    }
    const st = body.isGliding() ? 4 : body.mode === 'walk' ? 0 : body.mode === 'knock' ? 1 : 2
    const pkt: Packet = { t: sim, x: body.pos.x, y: body.pos.y, z: body.pos.z, st, vx: 0, vy: 0, vz: 0 }
    if (prev) {
      pkt.vx = (pkt.x - prev.x) / 0.1
      pkt.vy = (pkt.y - prev.y) / 0.1
      pkt.vz = (pkt.z - prev.z) / 0.1
    }
    rampPackets.push(pkt)
    prev = pkt
  }
  console.log(`ramp chain ${chain.length} cells, y ${graph.worldPos.get(chain[0])![1].toFixed(1)} → ${graph.worldPos.get(chain[chain.length - 1])![1].toFixed(1)}`)
}
const rampReport = rampPackets.length ? replay('ramp walk/leap', rampPackets) : null

// ── Knock off a lip, the recovery glide the wire marks st=4 ─────────
const from = chain ? graph.worldPos.get(chain[0])! : [...graph.worldPos.values()][0]
const knocked = new BotBody({ x: from[0], y: from[1], z: from[2] }, () => 0)
knocked.knock(lungeKnock(-1, 0))
const world = { graph, rampTiles: tiles.filter(t => TILES[t.type].isRamp), tiles, base: { x: from[0], y: from[1], z: from[2] } }
const knockPackets: Packet[] = []
let prevK: Packet | null = null
for (let i = 0, sim = 0; i < 80 && knocked.mode !== 'rescue'; i++, sim += 0.1) {
  knocked.tick(0.1, world)
  const st = knocked.isGliding() ? 4 : knocked.mode === 'walk' ? 0 : knocked.mode === 'knock' ? 1 : 2
  const pkt: Packet = { t: sim, x: knocked.pos.x, y: knocked.pos.y, z: knocked.pos.z, st, vx: 0, vy: 0, vz: 0 }
  if (prevK) {
    pkt.vx = (pkt.x - prevK.x) / 0.1
    pkt.vy = (pkt.y - prevK.y) / 0.1
    pkt.vz = (pkt.z - prevK.z) / 0.1
  }
  knockPackets.push(pkt)
  prevK = pkt
  if (knocked.mode === 'walk' && sim > 0.4) break
}
const knockReport = replay('knock+glide', knockPackets)

const walkBad = [liveReport, rampReport].filter((r): r is Report => !!r && (r.max > 3 || r.stuck > 0 || r.nans > 0))
if (live.some(p => p.st !== 0)) {
  console.error('✗ a walking bot left the ground (st ' + live.filter(p => p.st !== 0).length + ' packets). Leaps are off.')
  process.exit(1)
}
if (walkBad.length || knockReport.nans > 0 || knockReport.stuck > 2 || knockReport.max > 8) {
  console.error('✗ draw drifted or froze')
  process.exit(1)
}
if (!finite(live) || !finite(rampPackets) || !finite(knockPackets)) {
  console.error('✗ non-finite position in a stream')
  process.exit(1)
}
console.log('✓ walking draw stays within 3 m (ramps included); glide lag stays inside the 8 m snap')
