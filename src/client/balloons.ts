/**
 * Balloon Battle visuals. Counts come from the server. Each living
 * player and bot gets up to three deep-red balloons, strings tied to
 * one point on the back, floating in a cluster above the name tag.
 *
 * Follow style is BALLOON_STYLE in the shared config:
 *  - 'attached' parents the rig to the avatar (AvatarAttach on the
 *    upper spine for humans, the bot entity for bots) so the knot
 *    tracks with zero lag. Each balloon then jiggles in local space
 *    from the avatar's velocity and turn rate.
 *  - 'trail' is the original world-space spring follow, with lag.
 */
import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  Transform,
  PlayerIdentityData,
  AvatarAttach,
  removeEntityWithChildren,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { events } from '../shared/events'
import { BALLOON_STYLE } from '../shared/balloon'
import { inLobby } from './phase'
import { isBalloonRound } from '../round'
import { getBotRenderPositions } from './botVisual'
import { playBalloonPopSfx } from './audio'
import { setMoveLock, getMoveLock } from './moveLock'
import { isFallRescueActive } from './fallRescue'
import { enterOverview } from './overviewCamera'

type Rgb = { r: number; g: number; b: number }
type Vec = { x: number; y: number; z: number }
type Pose = { feet: Vec; yawDeg: number; entity?: Entity }

/** Deep red #B3121E, matte with a little gloss. */
const COLOR: Rgb = { r: 0xB3 / 255, g: 0x12 / 255, b: 0x1E / 255 }
/** ~1.8x the original 0.28 x 0.34 x 0.28 spheres. */
const BALL_SCALE: Vec = { x: 0.5, y: 0.62, z: 0.5 }
/**
 * Shoulder-blade knot on a feet-anchored body (trail style, and bots):
 * 1.38 m up, 0.20 m behind along the facing. Avatar yaw 0 faces +Z,
 * so back is -local Z: world offset is -sin(yaw) on X, -cos(yaw) on Z.
 */
const BACK_Y = 1.38
const BACK_Z = 0.2
/**
 * Extra offset from AAPT_SPINE2 (upper spine, value 8) onto the back
 * of the torso. Spine bones face roughly +Z forward, so -Z is out
 * between the shoulder blades.
 */
const SPINE_BACK_Y = 0.05
const SPINE_BACK_Z = 0.2
/** AAPT_SPINE2 — between the shoulder blades. */
const ANCHOR_SPINE2 = 8
/** Height of the balloon centers above the back knot. ~1.35 m above a 1.8 m head when the knot sits at 1.38 m. */
const REST_Y = 1.85
/** Idle bob and a light breeze, applied to the rest pose. */
const BOB_S = 2.3
const BOB = 0.12
const SWAY = 0.08
const TRAIL_SWAY = 0.16
/** World-space follow rate for 'trail' (higher = less lag). */
const FOLLOW = 7
/** Attached jiggle: underdamped spring, overshoots then settles. */
const STIFF = 40
const DAMP = 6
const MAX_JIGGLE = 0.55
const POP_S = 0.28
const STRING_R = 0.028

/** Rest slots in knot-local space, fanned up and slightly back so the larger spheres do not overlap. */
const SLOTS: Vec[] = [
  { x: -0.58, y: REST_Y, z: -0.16 },
  { x: 0, y: REST_Y, z: -0.5 },
  { x: 0.58, y: REST_Y, z: -0.16 },
]

type Balloon = {
  i: number
  root: Entity
  ball: Entity
  string: Entity
  pos: Vec
  vel: Vec
}

type Cluster = {
  id: string
  n: number
  style: 'attached' | 'trail'
  attach: Entity | null
  knot: Entity | null
  balloons: Balloon[]
  lastFeet: Vec | null
  lastVel: Vec
  lastYaw: number
  lastYawRate: number
  primed: boolean
}

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

function v(x: number, y: number, z: number): Vec {
  return { x, y, z }
}

function yawRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function wrapDeg(d: number): number {
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/** Forward on the XZ plane; DCL yaw 0 faces +Z. */
function forward(deg: number): Vec {
  const a = yawRad(deg)
  return v(Math.sin(a), 0, Math.cos(a))
}

function rotateYaw(local: Vec, deg: number): Vec {
  const a = yawRad(deg)
  const s = Math.sin(a)
  const c = Math.cos(a)
  return v(local.x * c + local.z * s, local.y, -local.x * s + local.z * c)
}

function backAnchor(pose: Pose): Vec {
  const f = forward(pose.yawDeg)
  return v(pose.feet.x - f.x * BACK_Z, pose.feet.y + BACK_Y, pose.feet.z - f.z * BACK_Z)
}

function restLocal(i: number, t: number, sway: number): Vec {
  const s = SLOTS[i % SLOTS.length]
  return v(
    s.x + Math.sin(t * 1.15 + i * 1.9) * sway,
    s.y + Math.sin(t * BOB_S + i * 1.7) * BOB,
    s.z + Math.cos(t * 0.9 + i * 1.3) * sway,
  )
}

function balloonMat(a = 1) {
  return {
    albedoColor: Color4.create(COLOR.r, COLOR.g, COLOR.b, a),
    emissiveColor: Color4.create(COLOR.r, COLOR.g, COLOR.b, 1),
    emissiveIntensity: 0.12,
    roughness: 0.42,
    metallic: 0.05,
    specularIntensity: 0.35,
  }
}

function stringMat() {
  return {
    albedoColor: Color4.create(0.85, 0.85, 0.82, 1),
    roughness: 1,
    metallic: 0,
  }
}

function aimString(ent: Entity, from: Vec, to: Vec): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const tf = Transform.getMutable(ent)
  if (len < 0.04) {
    tf.position = Vector3.create(from.x, from.y, from.z)
    tf.scale = Vector3.create(STRING_R, 0.04, STRING_R)
    tf.rotation = Quaternion.Identity()
    return
  }
  tf.position = Vector3.create(from.x + dx * 0.5, from.y + dy * 0.5, from.z + dz * 0.5)
  tf.scale = Vector3.create(STRING_R, len, STRING_R)
  tf.rotation = Quaternion.fromToRotation(Vector3.Up(), Vector3.create(dx / len, dy / len, dz / len))
}

function makeSphere(parent: Entity | null, pos: Vec, scale: Vec): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, {
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.create(scale.x, scale.y, scale.z),
    ...(parent ? { parent } : {}),
  })
  MeshRenderer.setSphere(ent)
  Material.setPbrMaterial(ent, balloonMat())
  return ent
}

function makeString(parent: Entity | null): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, {
    position: Vector3.Zero(),
    scale: Vector3.create(STRING_R, 0.4, STRING_R),
    ...(parent ? { parent } : {}),
  })
  MeshRenderer.setCylinder(ent)
  Material.setPbrMaterial(ent, stringMat())
  return ent
}

function spawnBalloon(i: number, at: Vec, parent: Entity | null): Balloon {
  const root = makeSphere(parent, at, BALL_SCALE)
  const ball = root
  const string = makeString(parent)
  return { i, root, ball, string, pos: { ...at }, vel: v(0, 0, 0) }
}

function yawOf(tf: ReturnType<typeof Transform.getOrNull>): number {
  if (!tf) return 0
  return Quaternion.toEulerAngles(tf.rotation).y
}

function poseOf(id: string): Pose | null {
  const me = localId()
  if (id === me) {
    const tf = Transform.getOrNull(engine.PlayerEntity)
    if (!tf) return null
    return { feet: v(tf.position.x, tf.position.y, tf.position.z), yawDeg: yawOf(tf), entity: engine.PlayerEntity }
  }
  if (id.startsWith('bot:')) {
    const num = Number(id.slice(4))
    const bot = getBotRenderPositions().find(b => b.id === num)
    if (!bot) return null
    return { feet: v(bot.pos.x, bot.pos.y, bot.pos.z), yawDeg: bot.yawDeg, entity: bot.entity }
  }
  for (const [entity, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (pid.address.toLowerCase() !== id) continue
    const tf = Transform.getOrNull(entity)
    if (!tf) return null
    return { feet: v(tf.position.x, tf.position.y, tf.position.z), yawDeg: yawOf(tf), entity }
  }
  return null
}

function remoteAvatarId(id: string): string | null {
  for (const [, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (pid.address.toLowerCase() === id) return pid.address
  }
  return null
}

/** Parent the knot to the avatar. Humans use AvatarAttach on spine2; bots use their own entity. */
function attachKnot(id: string, pose: Pose): { attach: Entity | null; knot: Entity } | null {
  const knot = engine.addEntity()
  if (id.startsWith('bot:')) {
    const host = pose.entity
    if (!host) {
      engine.removeEntity(knot)
      return null
    }
    Transform.create(knot, {
      parent: host,
      position: Vector3.create(0, BACK_Y, -BACK_Z),
    })
    return { attach: null, knot }
  }
  const attach = engine.addEntity()
  if (id === localId()) {
    AvatarAttach.create(attach, { anchorPointId: ANCHOR_SPINE2 })
  } else {
    const avatarId = remoteAvatarId(id)
    if (!avatarId) {
      engine.removeEntity(attach)
      engine.removeEntity(knot)
      return null
    }
    AvatarAttach.create(attach, { avatarId, anchorPointId: ANCHOR_SPINE2 })
  }
  Transform.create(knot, {
    parent: attach,
    position: Vector3.create(0, SPINE_BACK_Y, -SPINE_BACK_Z),
  })
  return { attach, knot }
}

function clearCluster(c: Cluster): void {
  if (c.attach) {
    removeEntityWithChildren(engine, c.attach)
  } else if (c.knot) {
    // Knot is a child of a bot body we do not own: drop our children
    // first, then the knot itself, never the bot.
    for (const b of c.balloons) {
      engine.removeEntity(b.root)
      engine.removeEntity(b.string)
    }
    engine.removeEntity(c.knot)
  } else {
    for (const b of c.balloons) {
      engine.removeEntity(b.root)
      engine.removeEntity(b.string)
    }
  }
  c.balloons.length = 0
  c.attach = null
  c.knot = null
}

function clearAll(): void {
  for (const c of clusters.values()) clearCluster(c)
  clusters.clear()
  for (const p of pops) engine.removeEntity(p.ent)
  pops.length = 0
}

function worldBalloonPos(c: Cluster, b: Balloon, pose: Pose): Vec {
  if (c.style === 'trail' || !c.knot) return { ...b.pos }
  const knot = backAnchor(pose)
  const w = rotateYaw(b.pos, pose.yawDeg)
  return v(knot.x + w.x, knot.y + w.y, knot.z + w.z)
}

function stepMotion(c: Cluster, pose: Pose, dt: number): { acc: Vec; yawRate: number; dYaw: number } {
  if (!c.primed || dt <= 0) {
    c.lastFeet = { ...pose.feet }
    c.lastVel = v(0, 0, 0)
    c.lastYaw = pose.yawDeg
    c.lastYawRate = 0
    c.primed = true
    return { acc: v(0, 0, 0), yawRate: 0, dYaw: 0 }
  }
  const prev = c.lastFeet ?? pose.feet
  const vel = v((pose.feet.x - prev.x) / dt, (pose.feet.y - prev.y) / dt, (pose.feet.z - prev.z) / dt)
  const acc = v((vel.x - c.lastVel.x) / dt, (vel.y - c.lastVel.y) / dt, (vel.z - c.lastVel.z) / dt)
  const dYaw = wrapDeg(pose.yawDeg - c.lastYaw)
  const yawRate = dYaw / dt
  c.lastFeet = { ...pose.feet }
  c.lastVel = vel
  c.lastYaw = pose.yawDeg
  c.lastYawRate = yawRate
  return { acc, yawRate, dYaw }
}

function toKnotLocal(world: Vec, yawDeg: number): Vec {
  // Inverse of rotateYaw: world offset in the yaw-aligned knot frame.
  return rotateYaw(world, -yawDeg)
}

function jiggle(b: Balloon, rest: Vec, accWorld: Vec, dYaw: number, yawDeg: number, dt: number): void {
  // Keep the balloon still in world XZ as the body turns, then spring back.
  if (dYaw !== 0) {
    const rot = rotateYaw(b.pos, -dYaw)
    const rotV = rotateYaw(b.vel, -dYaw)
    b.pos = rot
    b.vel = rotV
  }
  const accL = toKnotLocal(accWorld, yawDeg)
  b.vel.x -= accL.x * dt
  b.vel.y -= accL.y * dt
  b.vel.z -= accL.z * dt
  b.vel.x += (rest.x - b.pos.x) * STIFF * dt
  b.vel.y += (rest.y - b.pos.y) * STIFF * dt
  b.vel.z += (rest.z - b.pos.z) * STIFF * dt
  const damp = Math.exp(-DAMP * dt)
  b.vel.x *= damp
  b.vel.y *= damp
  b.vel.z *= damp
  b.pos.x += b.vel.x * dt
  b.pos.y += b.vel.y * dt
  b.pos.z += b.vel.z * dt
  const ox = b.pos.x - rest.x
  const oy = b.pos.y - rest.y
  const oz = b.pos.z - rest.z
  const mag = Math.sqrt(ox * ox + oy * oy + oz * oz)
  if (mag > MAX_JIGGLE) {
    const k = MAX_JIGGLE / mag
    b.pos.x = rest.x + ox * k
    b.pos.y = rest.y + oy * k
    b.pos.z = rest.z + oz * k
    b.vel.x *= k
    b.vel.y *= k
    b.vel.z *= k
  }
}

function follow(cur: Vec, dest: Vec, dt: number): Vec {
  const k = 1 - Math.exp(-FOLLOW * dt)
  return v(cur.x + (dest.x - cur.x) * k, cur.y + (dest.y - cur.y) * k, cur.z + (dest.z - cur.z) * k)
}

function placeTrailBalloon(b: Balloon, dest: Vec, knot: Vec, dt: number): void {
  b.pos = follow(b.pos, dest, dt)
  const tf = Transform.getMutable(b.root)
  tf.position = Vector3.create(b.pos.x, b.pos.y, b.pos.z)
  aimString(b.string, knot, b.pos)
}

function placeAttachedBalloon(b: Balloon): void {
  const tf = Transform.getMutable(b.root)
  tf.position = Vector3.create(b.pos.x, b.pos.y, b.pos.z)
  aimString(b.string, v(0, 0, 0), b.pos)
}

function ensureCluster(id: string, pose: Pose): Cluster | null {
  const existing = clusters.get(id)
  if (existing) return existing
  const c: Cluster = {
    id,
    n: 0,
    style: BALLOON_STYLE,
    attach: null,
    knot: null,
    balloons: [],
    lastFeet: null,
    lastVel: v(0, 0, 0),
    lastYaw: pose.yawDeg,
    lastYawRate: 0,
    primed: false,
  }
  if (BALLOON_STYLE === 'attached') {
    const rig = attachKnot(id, pose)
    if (!rig) return null
    c.attach = rig.attach
    c.knot = rig.knot
  }
  clusters.set(id, c)
  return c
}

function setCounts(entries: Array<{ id: string; n: number }>): void {
  counts.clear()
  for (const e of entries) counts.set(e.id.toLowerCase(), e.n)
  const me = localId()
  localOut = !!me && counts.has(me) && (counts.get(me) ?? 0) <= 0 && isBalloonRound()
}

function popAt(pos: Vec): void {
  const ent = engine.addEntity()
  Transform.create(ent, {
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.create(BALL_SCALE.x, BALL_SCALE.y, BALL_SCALE.z),
  })
  MeshRenderer.setSphere(ent)
  Material.setPbrMaterial(ent, balloonMat(1))
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
      const pose = poseOf(key)
      const p = pose ? worldBalloonPos(c, gone, pose) : gone.pos
      popAt(p)
      engine.removeEntity(gone.root)
      engine.removeEntity(gone.string)
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
  const step = Math.min(Math.max(dt, 0), 0.05)
  const want = new Set<string>()
  for (const [id, n] of counts) {
    if (n <= 0) continue
    want.add(id)
    const pose = poseOf(id)
    if (!pose) continue
    const c = ensureCluster(id, pose)
    if (!c) continue
    while (c.balloons.length < n) {
      const i = c.balloons.length
      const rest = restLocal(i, clock, c.style === 'trail' ? TRAIL_SWAY : SWAY)
      const at = c.style === 'trail' ? (() => {
        const knot = backAnchor(pose)
        const w = rotateYaw(rest, pose.yawDeg)
        return v(knot.x + w.x, knot.y + w.y, knot.z + w.z)
      })() : rest
      c.balloons.push(spawnBalloon(i, at, c.knot))
    }
    while (c.balloons.length > n) {
      const gone = c.balloons.pop()
      if (gone) {
        engine.removeEntity(gone.root)
        engine.removeEntity(gone.string)
      }
    }
    c.n = n
    if (c.style === 'attached') {
      const mot = stepMotion(c, pose, step)
      for (const b of c.balloons) {
        const rest = restLocal(b.i, clock, SWAY)
        jiggle(b, rest, mot.acc, mot.dYaw, pose.yawDeg, step)
        placeAttachedBalloon(b)
      }
    } else {
      const knot = backAnchor(pose)
      for (const b of c.balloons) {
        const rest = restLocal(b.i, clock, TRAIL_SWAY)
        const w = rotateYaw(rest, pose.yawDeg)
        const dest = v(knot.x + w.x, knot.y + w.y, knot.z + w.z)
        placeTrailBalloon(b, dest, knot, step)
      }
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
    const s = BALL_SCALE.x + u * 0.55
    const tf = Transform.getMutableOrNull(p.ent)
    if (tf) tf.scale = Vector3.create(s, s * (BALL_SCALE.y / BALL_SCALE.x), s)
    Material.setPbrMaterial(p.ent, balloonMat(1 - u))
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
