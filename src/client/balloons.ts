/**
 * Balloon Battle visuals. Counts come from the server. Each living
 * player and bot gets up to three balloons on short springs, with a
 * little wind sway, so they lag behind when the avatar moves.
 */
import { engine, Entity, Material, MeshRenderer, Transform, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { events } from '../shared/events'
import { inLobby } from './phase'
import { isBalloonRound } from '../round'
import { getBotRenderPositions } from './botVisual'
import { playBalloonPopSfx } from './audio'
import { setMoveLock, getMoveLock } from './moveLock'
import { isFallRescueActive } from './fallRescue'
import { enterOverview } from './overviewCamera'

type Rgb = { r: number; g: number; b: number }
type Vec = { x: number; y: number; z: number }

const FOLLOW = 7
const BOB_S = 2.3
const COLORS: Rgb[] = [
  { r: 1, g: 0.45, b: 0.55 },
  { r: 1, g: 0.82, b: 0.28 },
  { r: 0.4, g: 0.85, b: 1 },
]
const POP_S = 0.28

type Balloon = {
  i: number
  root: Entity
  ball: Entity
  string: Entity
  pos: Vec
  popT: number
}

type Cluster = { id: string; n: number; balloons: Balloon[] }

const counts = new Map<string, number>()
const clusters = new Map<string, Cluster>()
const pops: Array<{ ent: Entity; t: number; x: number; y: number; z: number }> = []
let clock = 0
let localOut = false

export function balloonCount(id: string): number {
  return counts.get(id.toLowerCase()) ?? 0
}

export function isEliminated(): boolean {
  return localOut
}

function localId(): string {
  return (getPlayer()?.userId ?? '').toLowerCase()
}

function clearCluster(c: Cluster): void {
  for (const b of c.balloons) {
    engine.removeEntity(b.root)
  }
  c.balloons.length = 0
}

function clearAll(): void {
  for (const c of clusters.values()) clearCluster(c)
  clusters.clear()
  for (const p of pops) engine.removeEntity(p.ent)
  pops.length = 0
}

function balloonMat(c: Rgb, a = 1) {
  return {
    albedoColor: Color4.create(c.r, c.g, c.b, a),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 0.7,
    roughness: 0.35,
    metallic: 0,
    specularIntensity: 0.2,
  }
}

function spawnBalloon(i: number, at: Vec): Balloon {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(at.x, at.y, at.z) })
  const ball = engine.addEntity()
  Transform.create(ball, { parent: root, position: Vector3.Zero(), scale: Vector3.create(0.28, 0.34, 0.28) })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, balloonMat(COLORS[i % COLORS.length]))
  const string = engine.addEntity()
  Transform.create(string, { parent: root, position: Vector3.create(0, -0.45, 0), scale: Vector3.create(0.025, 0.9, 0.025) })
  MeshRenderer.setCylinder(string)
  Material.setPbrMaterial(string, {
    albedoColor: Color4.create(0.85, 0.85, 0.82, 1),
    roughness: 1,
    metallic: 0,
  })
  return { i, root, ball, string, pos: { ...at }, popT: -1 }
}

function targetFor(feet: Vec, i: number, t: number): Vec {
  const ang = (i / 3) * Math.PI * 2 + 0.4
  return {
    x: feet.x + Math.cos(ang) * 0.32 + Math.sin(t * 1.15 + i * 1.9) * 0.14,
    y: feet.y + 2.15 + Math.sin(t * BOB_S + i * 1.7) * 0.1,
    z: feet.z + Math.sin(ang) * 0.32 + Math.cos(t * 0.9 + i * 1.3) * 0.14,
  }
}

function follow(cur: Vec, dest: Vec, dt: number): Vec {
  const k = 1 - Math.exp(-FOLLOW * dt)
  return {
    x: cur.x + (dest.x - cur.x) * k,
    y: cur.y + (dest.y - cur.y) * k,
    z: cur.z + (dest.z - cur.z) * k,
  }
}

function feetOf(id: string): Vec | null {
  const me = localId()
  if (id === me) {
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    return p ? { x: p.x, y: p.y, z: p.z } : null
  }
  if (id.startsWith('bot:')) {
    const num = Number(id.slice(4))
    const bot = getBotRenderPositions().find(b => b.id === num)
    return bot ? { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z } : null
  }
  for (const [entity, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (pid.address.toLowerCase() !== id) continue
    const p = Transform.getOrNull(entity)?.position
    if (p) return { x: p.x, y: p.y, z: p.z }
  }
  return null
}

function setCounts(entries: Array<{ id: string; n: number }>): void {
  counts.clear()
  for (const e of entries) counts.set(e.id.toLowerCase(), e.n)
  const me = localId()
  localOut = !!me && counts.has(me) && (counts.get(me) ?? 0) <= 0 && isBalloonRound()
}

function popAt(pos: Vec, color: Rgb): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(pos.x, pos.y, pos.z), scale: Vector3.create(0.28, 0.34, 0.28) })
  MeshRenderer.setSphere(ent)
  Material.setPbrMaterial(ent, balloonMat(color, 1))
  pops.push({ ent, t: 0, x: pos.x, y: pos.y, z: pos.z })
  playBalloonPopSfx()
}

function applyPop(id: string, n: number): void {
  const key = id.toLowerCase()
  const was = counts.get(key) ?? 0
  counts.set(key, n)
  const c = clusters.get(key)
  if (c && c.balloons.length > n) {
    const gone = c.balloons.pop()
    if (gone) {
      const tf = Transform.getOrNull(gone.root)
      const p = tf?.position
      popAt(p ? { x: p.x, y: p.y, z: p.z } : gone.pos, COLORS[gone.i % COLORS.length])
      engine.removeEntity(gone.root)
    }
  }
  if (key === localId() && n <= 0 && was > 0) localOut = true
}

function syncClusters(dt: number): void {
  const live = isBalloonRound() && !inLobby()
  if (!live) {
    if (clusters.size) clearAll()
    if (localOut) {
      localOut = false
      if (getMoveLock() === 'frozen') setMoveLock('open')
    }
    return
  }
  const want = new Set<string>()
  for (const [id, n] of counts) {
    if (n <= 0) continue
    want.add(id)
    const feet = feetOf(id)
    if (!feet) continue
    let c = clusters.get(id)
    if (!c) { c = { id, n, balloons: [] }; clusters.set(id, c) }
    while (c.balloons.length < n) {
      const i = c.balloons.length
      const at = targetFor(feet, i, clock)
      c.balloons.push(spawnBalloon(i, at))
    }
    while (c.balloons.length > n) {
      const gone = c.balloons.pop()
      if (gone) engine.removeEntity(gone.root)
    }
    c.n = n
    for (const b of c.balloons) {
      const dest = targetFor(feet, b.i, clock)
      b.pos = follow(b.pos, dest, dt)
      const tf = Transform.getMutable(b.root)
      tf.position = Vector3.create(b.pos.x, b.pos.y, b.pos.z)
      const len = Math.max(0.25, b.pos.y - (feet.y + 1.5))
      const st = Transform.getMutable(b.string)
      st.position = Vector3.create(0, -len / 2, 0)
      st.scale = Vector3.create(0.025, len, 0.025)
    }
  }
  for (const [id, c] of Array.from(clusters.entries())) {
    if (want.has(id)) continue
    clearCluster(c)
    clusters.delete(id)
  }
  if (localOut && !isFallRescueActive()) {
    if (getMoveLock() !== 'frozen') setMoveLock('frozen')
    enterOverview()
  }
}

function tickPops(dt: number): void {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]
    p.t += dt
    const u = Math.min(1, p.t / POP_S)
    const s = 0.28 + u * 0.45
    const tf = Transform.getMutableOrNull(p.ent)
    if (tf) tf.scale = Vector3.create(s, s * 1.15, s)
    Material.setPbrMaterial(p.ent, balloonMat(COLORS[0], 1 - u))
    if (p.t >= POP_S) {
      engine.removeEntity(p.ent)
      pops.splice(i, 1)
    }
  }
}

export function initBalloons(): void {
  events.on('balloon:state', ({ entries }) => setCounts(entries))
  events.on('balloon:pop', ({ id, n }) => applyPop(id, n))
  events.on('round:reset', () => {
    counts.clear()
    localOut = false
    clearAll()
    if (getMoveLock() === 'frozen') setMoveLock('open')
  })
  engine.addSystem((dt: number) => {
    clock += dt
    syncClusters(dt)
    tickPops(dt)
  })
}