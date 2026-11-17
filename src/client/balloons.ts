/**
 * Balloon Battle visuals. Counts come from the server. Each living
 * player and bot gets up to three deep-red balloons, strings tied to
 * one point on the back, floating in a cluster above the name tag.
 *
 * Follow style is BALLOON_STYLE in the shared config:
 *  - 'attached' parents the knot to the avatar root so it cannot lag.
 *    Humans use AvatarAttach on AAPT_POSITION (no walk-cycle bob);
 *    remotes pass avatarId; bots parent to their visual entity. The
 *    back offset is a child of that attach in avatar-local space
 *    (0, BACK_Y, -BACK_Z). AvatarAttach already carries the avatar's
 *    yaw, so the child is not rotated again. Balloons and strings are
 *    children of the knot: only the balloon end jiggles, from
 *    low-passed planar velocity and turn. Each balloon is a slight egg
 *    with a simple cone taper and a small nub; the nub tilts along the
 *    string's top segment, and the string always meets that nub from
 *    the balloon's live transform.
 *  - 'trail' is the original world-space spring follow, with lag.
 *    Strings still start at the live back knot, not a lagged point.
 *
 * Rigs exist only while a balloon match is live. Leaving the match
 * (summary, lobby, or idle), or a player leaving, tears down every
 * attach, knot, balloon, string, pop, and cached count.
 */
import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  Transform,
  PlayerIdentityData,
  AvatarAttach,
  getWorldPosition,
  removeEntityWithChildren,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { events } from '../shared/events'
import { BALLOON_STYLE, BALLOON_REST_Y, BALLOON_SLOT_EASE_S, balloonRestSlots, balloonsLive } from '../shared/balloon'
import { gamePhase } from './phase'
import { isLobbyLayout } from '../maze/rebuild'
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
/** Slight egg: about 1.15× taller than wide, close to the current size. */
const BODY_XZ = 0.54
const BODY_Y = 0.62
const BODY_Y_OFF = 0.03
/** Short cone tucked into the egg: top diameter is ~28% of the body
 *  width, so it does not flare out as a skirt. setCylinder(1, tip)
 *  is scaled by NECK_XZ, so the visual top radius is NECK_XZ. */
const NECK_H = 0.1
const NECK_XZ = 0.076
const NECK_TUCK = 0.07
const NECK_TIP_RATIO = 0.32
const NUB_XZ = 0.05
const NUB_Y = 0.046
const NUB_OVERLAP = 0.01
const BODY_BOTTOM = BODY_Y_OFF - BODY_Y * 0.5
const NECK_TOP = BODY_BOTTOM + NECK_TUCK
const NECK_TIP = NECK_TOP - NECK_H
const NUB_CENTER = NECK_TIP - NUB_Y * 0.5 + NUB_OVERLAP
const NUB_TIP = NUB_CENTER - NUB_Y * 0.5
/** Local distance from the balloon root to the nub tip. */
const BALL_BOTTOM = -NUB_TIP
/** Aim the nub along the string's top segment, blended toward that
 *  direction, capped, and smoothed so it does not jitter. */
const AIM_BLEND = 0.7
const MAX_AIM_DEG = 28
const AIM_TAU = 0.16
/**
 * Upper-back knot on the avatar root (no bone bob): 1.68 m up, between
 * the shoulder blades, 0.20 m behind along the facing. Avatar yaw 0
 * faces +Z, so back is -local Z: world offset is -sin(yaw) on X,
 * -cos(yaw) on Z.
 */
const BACK_Y = 1.68
const BACK_Z = 0.2
/** AAPT_POSITION - avatar root, not an animated bone. */
const AAPT_POSITION = 0
/** Height of the balloon centers above the back knot. ~1.43 m above a 1.8 m head. */
const REST_Y = BALLOON_REST_Y
/** Slow idle bob: period 3.2 s, small amplitude. */
const BOB_PERIOD = 3.2
const BOB_OMEGA = (Math.PI * 2) / BOB_PERIOD
const BOB = 0.05
const SWAY_PERIOD = 4.5
const SWAY_OMEGA = (Math.PI * 2) / SWAY_PERIOD
const SWAY = 0.05
const TRAIL_SWAY = 0.16
/** World-space follow rate for 'trail' (higher = less lag). */
const FOLLOW = 7
/** Exponential smoothing time constant for the spring's planar velocity and turn rate only. The knot is never smoothed. */
const SMOOTH_TAU = 0.2
/** Floaty spring, close to critically damped (zeta 0.85). omega = sqrt(14) ~ 3.74 rad/s. */
const STIFF = 14
const ZETA = 0.85
const DAMP = 2 * ZETA * Math.sqrt(STIFF)
const MAX_JIGGLE = 0.4
const POP_S = 0.28
const STRING_R = 0.028
/** Four short cylinders with a slight catenary sag. */
const STRING_SEGS = 4
/** Mid-span sag (m). Small enough to read as string, not a rope. */
const STRING_SAG = 0.14
/** Midpoint trails the balloon so the string bends as it moves. */
const STRING_LAG_TAU = 0.16


type Balloon = {
  i: number
  root: Entity
  ball: Entity
  segs: Entity[]
  pos: Vec
  vel: Vec
  /** Eased knot-local rest, before idle bob and sway. */
  home: Vec
  fromHome: Vec
  toHome: Vec
  ease: number
  /** Lagged catenary mid. Reused every frame; no per-tick allocations. */
  lagMid: Vec
  lagReady: boolean
  /** Smoothed direction of the balloon's local -Y (nub axis). */
  aim: Vec
  aimReady: boolean
}

type Cluster = {
  id: string
  n: number
  style: 'attached' | 'trail'
  /** AvatarAttach root for humans. Null for bots, whose knot is parented to the body. */
  attach: Entity | null
  knot: Entity | null
  balloons: Balloon[]
  smoothVel: Vec
  smoothYawRate: number
  prevFeet: Vec
  prevVel: Vec
  prevYaw: number
  primed: boolean
}

const counts = new Map<string, number>()
const clusters = new Map<string, Cluster>()
const pops: Array<{ ent: Entity; t: number; x: number; y: number; z: number }> = []
let clock = 0
let localOut = false
let wasLive = false

export function balloonCount(id: string): number {
  return counts.get(id.toLowerCase()) ?? 0
}

export function isEliminated(): boolean {
  return localOut
}

function balloonMatchLive(): boolean {
  // The lobby floor can land while the clock is still 'match'. Treat
  // that as the end of the round so AvatarAttach rigs do not linger.
  return !isLobbyLayout() && balloonsLive(gamePhase(), isBalloonRound() ? 'balloon' : '')
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

/** Frame-rate independent exponential blend toward a new sample. */
function smoothK(dt: number, tau: number = SMOOTH_TAU): number {
  if (dt <= 0) return 0
  return 1 - Math.exp(-dt / tau)
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

function lerpHome(a: Vec, b: Vec, t: number): Vec {
  return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
}

function slotAt(i: number, n: number): Vec {
  const slots = balloonRestSlots(n)
  return slots[Math.min(i, Math.max(slots.length - 1, 0))] ?? { x: 0, y: REST_Y, z: -0.33 }
}

/** After a count change, aim each leftover balloon at a balanced slot for the new count. */
function rehome(c: Cluster, instant: boolean): void {
  const slots = balloonRestSlots(c.balloons.length)
  for (let i = 0; i < c.balloons.length; i++) {
    const b = c.balloons[i]
    const to = slots[i]
    b.i = i
    if (instant) {
      b.home = { ...to }
      b.fromHome = { ...to }
      b.toHome = { ...to }
      b.ease = 1
    } else {
      b.fromHome = { ...b.home }
      b.toHome = { ...to }
      b.ease = 0
    }
  }
}

function tickHome(b: Balloon, dt: number): void {
  if (b.ease >= 1) return
  b.ease = Math.min(1, b.ease + dt / BALLOON_SLOT_EASE_S)
  const t = b.ease * b.ease * (3 - 2 * b.ease)
  b.home = lerpHome(b.fromHome, b.toHome, t)
}

function restLocal(b: Balloon, t: number, sway: number): Vec {
  const s = b.home
  const i = b.i
  return v(
    s.x + Math.sin(t * SWAY_OMEGA + i * 1.9) * sway,
    s.y + Math.sin(t * BOB_OMEGA + i * 1.7) * BOB,
    s.z + Math.cos(t * SWAY_OMEGA * 0.85 + i * 1.3) * sway,
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

const _from = { x: 0, y: 0, z: 0 }
const _to = { x: 0, y: 0, z: 0 }
const _tip = { x: 0, y: 0, z: 0 }
const _down = Vector3.create(0, -1, 0)
const _dir = Vector3.create(0, 1, 0)

/**
 * World or parent-local point at the nub tip: the root position plus
 * the rotated, scaled (0, -BALL_BOTTOM, 0) offset.
 */
function balloonBottom(tf: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number }; scale: { x: number; y: number; z: number } }, out: Vec): void {
  _down.x = 0
  _down.y = -BALL_BOTTOM * tf.scale.y
  _down.z = 0
  const w = Vector3.rotate(_down, tf.rotation)
  out.x = tf.position.x + w.x
  out.y = tf.position.y + w.y
  out.z = tf.position.z + w.z
}

const _aimWant = { x: 0, y: -1, z: 0 }
const _downAxis = Vector3.create(0, -1, 0)

/** Point on the sagged string at parameter t (0 at the knot, 1 at the nub). */
function stringPoint(from: Vec, mid: Vec, to: Vec, t: number, out: Vec): void {
  const u = 1 - t
  out.x = u * u * from.x + 2 * u * t * mid.x + t * t * to.x
  out.y = u * u * from.y + 2 * u * t * mid.y + t * t * to.y
  out.z = u * u * from.z + 2 * u * t * mid.z + t * t * to.z
}

/**
 * Rotate the balloon so its nub aims along the string's top segment,
 * 70% toward that direction, capped at 28°, and low-passed.
 */
function aimNub(b: Balloon, tip: Vec, toward: Vec, dt: number) {
  let dx = toward.x - tip.x
  let dy = toward.y - tip.y
  let dz = toward.z - tip.z
  let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  _aimWant.x = 0
  _aimWant.y = -1
  _aimWant.z = 0
  if (len > 0.02) {
    dx /= len
    dy /= len
    dz /= len
    _aimWant.x = dx * AIM_BLEND
    _aimWant.y = -1 * (1 - AIM_BLEND) + dy * AIM_BLEND
    _aimWant.z = dz * AIM_BLEND
    len = Math.sqrt(_aimWant.x * _aimWant.x + _aimWant.y * _aimWant.y + _aimWant.z * _aimWant.z) || 1
    _aimWant.x /= len
    _aimWant.y /= len
    _aimWant.z /= len
    const ang = Math.acos(Math.max(-1, Math.min(1, -_aimWant.y)))
    const max = MAX_AIM_DEG * Math.PI / 180
    if (ang > max && ang > 1e-5) {
      const t = max / ang
      _aimWant.x *= t
      _aimWant.y = -1 + (_aimWant.y + 1) * t
      _aimWant.z *= t
      len = Math.sqrt(_aimWant.x * _aimWant.x + _aimWant.y * _aimWant.y + _aimWant.z * _aimWant.z) || 1
      _aimWant.x /= len
      _aimWant.y /= len
      _aimWant.z /= len
    }
  }
  if (!b.aimReady) {
    b.aim.x = _aimWant.x
    b.aim.y = _aimWant.y
    b.aim.z = _aimWant.z
    b.aimReady = true
  } else {
    const k = 1 - Math.exp(-Math.max(0, dt) / AIM_TAU)
    b.aim.x += (_aimWant.x - b.aim.x) * k
    b.aim.y += (_aimWant.y - b.aim.y) * k
    b.aim.z += (_aimWant.z - b.aim.z) * k
    len = Math.sqrt(b.aim.x * b.aim.x + b.aim.y * b.aim.y + b.aim.z * b.aim.z) || 1
    b.aim.x /= len
    b.aim.y /= len
    b.aim.z /= len
  }
  _dir.x = b.aim.x
  _dir.y = b.aim.y
  _dir.z = b.aim.z
  return Quaternion.fromToRotation(_downAxis, _dir)
}

function orientBalloon(b: Balloon, tf: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number }; scale: { x: number; y: number; z: number } }, knot: Vec, dt: number): void {
  balloonBottom(tf, _tip)
  const t = (STRING_SEGS - 1) / STRING_SEGS
  if (b.lagReady) stringPoint(knot, b.lagMid, _tip, t, _from)
  else { _from.x = knot.x; _from.y = knot.y; _from.z = knot.z }
  tf.rotation = aimNub(b, _tip, _from, dt)
}

function aimString(ent: Entity, from: Vec, to: Vec): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const tf = Transform.getMutable(ent)
  if (len < 0.04) {
    tf.position.x = from.x
    tf.position.y = from.y
    tf.position.z = from.z
    tf.scale.x = STRING_R
    tf.scale.y = 0.04
    tf.scale.z = STRING_R
    tf.rotation = Quaternion.Identity()
    return
  }
  tf.position.x = from.x + dx * 0.5
  tf.position.y = from.y + dy * 0.5
  tf.position.z = from.z + dz * 0.5
  tf.scale.x = STRING_R
  tf.scale.y = len
  tf.scale.z = STRING_R
  _dir.x = dx / len
  _dir.y = dy / len
  _dir.z = dz / len
  tf.rotation = Quaternion.fromToRotation(Vector3.Up(), _dir)
}

/** Quadratic bezier from the knot through a lagged, sagged mid to the balloon. */
function placeString(segs: Entity[], lag: Vec, ready: { lagReady: boolean }, from: Vec, to: Vec, dt: number): void {
  const midX = (from.x + to.x) * 0.5
  const midZ = (from.z + to.z) * 0.5
  const midY = (from.y + to.y) * 0.5 - STRING_SAG
  if (!ready.lagReady) {
    lag.x = midX
    lag.y = midY
    lag.z = midZ
    ready.lagReady = true
  } else {
    const k = 1 - Math.exp(-Math.max(0, dt) / STRING_LAG_TAU)
    lag.x += (midX - lag.x) * k
    lag.y += (midY - lag.y) * k
    lag.z += (midZ - lag.z) * k
  }
  _from.x = from.x
  _from.y = from.y
  _from.z = from.z
  for (let i = 1; i <= STRING_SEGS; i++) {
    const t = i / STRING_SEGS
    const u = 1 - t
    _to.x = u * u * from.x + 2 * u * t * lag.x + t * t * to.x
    _to.y = u * u * from.y + 2 * u * t * lag.y + t * t * to.y
    _to.z = u * u * from.z + 2 * u * t * lag.z + t * t * to.z
    aimString(segs[i - 1], _from, _to)
    _from.x = _to.x
    _from.y = _to.y
    _from.z = _to.z
  }
}

function paintBalloon(ent: Entity, a = 1): void {
  Material.setPbrMaterial(ent, balloonMat(a))
}

function addBalloonPart(parent: Entity, pos: Vec, scale: Vec, cone = false): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, {
    parent,
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.create(scale.x, scale.y, scale.z),
  })
  if (cone) MeshRenderer.setCylinder(ent, 1, NECK_TIP_RATIO)
  else MeshRenderer.setSphere(ent)
  paintBalloon(ent)
  return ent
}

/** Slight egg, a simple cone taper, and a small tied nub. Root is unscaled. */
function buildBalloonParts(root: Entity): void {
  addBalloonPart(root, v(0, BODY_Y_OFF, 0), v(BODY_XZ, BODY_Y, BODY_XZ))
  addBalloonPart(root, v(0, NECK_TOP - NECK_H * 0.5, 0), v(NECK_XZ, NECK_H, NECK_XZ), true)
  addBalloonPart(root, v(0, NUB_CENTER, 0), v(NUB_XZ, NUB_Y, NUB_XZ))
}

function makeBalloon(parent: Entity | null, pos: Vec): Entity {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.One(),
    ...(parent ? { parent } : {}),
  })
  buildBalloonParts(root)
  return root
}

function makeSphere(parent: Entity | null, pos: Vec, scale: Vec): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, {
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.create(scale.x, scale.y, scale.z),
    ...(parent ? { parent } : {}),
  })
  MeshRenderer.setSphere(ent)
  paintBalloon(ent)
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

function makeStringSegs(parent: Entity | null): Entity[] {
  const segs: Entity[] = []
  for (let i = 0; i < STRING_SEGS; i++) segs.push(makeString(parent))
  return segs
}

function spawnBalloon(i: number, at: Vec, parent: Entity | null): Balloon {
  const root = makeBalloon(parent, at)
  const segs = makeStringSegs(parent)
  const home = slotAt(i, i + 1)
  return {
    i, root, ball: root, segs, pos: { ...at }, vel: v(0, 0, 0),
    home: { ...home }, fromHome: { ...home }, toHome: { ...home }, ease: 1,
    lagMid: { x: at.x * 0.5, y: at.y * 0.5 - STRING_SAG, z: at.z * 0.5 },
    lagReady: false,
    aim: { x: 0, y: -1, z: 0 },
    aimReady: false,
  }
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

/**
 * Sit the knot on the avatar or bot itself. Humans: AvatarAttach on the
 * root (AAPT_POSITION). Bots: parent to the bot visual entity. The back
 * offset lives on a child so the engine can drive the attach point.
 */
function attachRig(id: string, pose: Pose): { attach: Entity | null; knot: Entity } | null {
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
    AvatarAttach.create(attach, { anchorPointId: AAPT_POSITION })
  } else {
    const avatarId = remoteAvatarId(id)
    if (!avatarId) {
      engine.removeEntity(attach)
      engine.removeEntity(knot)
      return null
    }
    AvatarAttach.create(attach, { avatarId, anchorPointId: AAPT_POSITION })
  }
  // AAPT_POSITION already follows the avatar's yaw. A second yaw on the
  // child (or a world-space back offset in that rotated frame) put the
  // knot on the chest. Same local back offset as the bots.
  Transform.create(knot, {
    parent: attach,
    position: Vector3.create(0, BACK_Y, -BACK_Z),
  })
  return { attach, knot }
}

function clearCluster(c: Cluster): void {
  // The AvatarAttach root often has no Transform, so a tree walk starting
  // there would skip the knot and leak the local player's balloons.
  // Always drop the knot (and its balloons and strings) first, then the
  // attach entity itself. Never remove a bot body we do not own.
  if (c.knot) removeEntityWithChildren(engine, c.knot)
  if (c.attach) engine.removeEntity(c.attach)
  if (!c.knot && !c.attach) {
    for (const b of c.balloons) {
      removeEntityWithChildren(engine, b.root)
      dropSegs(b)
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

/** Drop every rig, pop, and cached count. Next match starts at 3 balloons. */
export function teardownBalloons(): void {
  counts.clear()
  localOut = false
  wasLive = false
  clearAll()
  if (getMoveLock() === 'frozen') setMoveLock('open')
}

function dropCluster(id: string): void {
  const c = clusters.get(id)
  if (!c) return
  clearCluster(c)
  clusters.delete(id)
}

function worldBalloonPos(c: Cluster, b: Balloon, pose: Pose): Vec {
  if (c.style === 'attached') {
    const wp = getWorldPosition(engine, b.root)
    if (wp) return v(wp.x, wp.y, wp.z)
  }
  if (c.style === 'trail' || !c.knot) return { ...b.pos }
  const knot = backAnchor(pose)
  const w = rotateYaw(b.pos, pose.yawDeg)
  return v(knot.x + w.x, knot.y + w.y, knot.z + w.z)
}

/** Planar velocity and turn rate, low-passed, with the vertical step-bob ignored. Drives the balloon spring only — never the knot. */
function stepMotion(c: Cluster, pose: Pose, dt: number): { acc: Vec; dYaw: number } {
  if (!c.primed || dt <= 0) {
    c.prevFeet = { ...pose.feet }
    c.prevVel = v(0, 0, 0)
    c.smoothVel = v(0, 0, 0)
    c.smoothYawRate = 0
    c.prevYaw = pose.yawDeg
    c.primed = true
    return { acc: v(0, 0, 0), dYaw: 0 }
  }
  const k = smoothK(dt)
  const rawVel = v((pose.feet.x - c.prevFeet.x) / dt, 0, (pose.feet.z - c.prevFeet.z) / dt)
  c.smoothVel.x += (rawVel.x - c.smoothVel.x) * k
  c.smoothVel.y = 0
  c.smoothVel.z += (rawVel.z - c.smoothVel.z) * k
  const acc = v((c.smoothVel.x - c.prevVel.x) / dt, 0, (c.smoothVel.z - c.prevVel.z) / dt)
  const rawRate = wrapDeg(pose.yawDeg - c.prevYaw) / dt
  c.smoothYawRate += (rawRate - c.smoothYawRate) * k
  const dYaw = c.smoothYawRate * dt
  c.prevFeet = { ...pose.feet }
  c.prevVel = { ...c.smoothVel }
  c.prevYaw = pose.yawDeg
  return { acc, dYaw }
}

function toKnotLocal(world: Vec, yawDeg: number): Vec {
  return rotateYaw(world, -yawDeg)
}

function jiggle(b: Balloon, rest: Vec, accWorld: Vec, dYaw: number, yawDeg: number, dt: number): void {
  if (dYaw !== 0) {
    b.pos = rotateYaw(b.pos, -dYaw)
    b.vel = rotateYaw(b.vel, -dYaw)
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

function dropSegs(b: Balloon): void {
  for (let i = 0; i < b.segs.length; i++) engine.removeEntity(b.segs[i])
}

const _knot = { x: 0, y: 0, z: 0 }

function placeTrailBalloon(b: Balloon, dest: Vec, knot: Vec, dt: number): void {
  b.pos = follow(b.pos, dest, dt)
  const tf = Transform.getMutable(b.root)
  tf.position.x = b.pos.x
  tf.position.y = b.pos.y
  tf.position.z = b.pos.z
  orientBalloon(b, tf, knot, dt)
  balloonBottom(tf, _tip)
  placeString(b.segs, b.lagMid, b, knot, _tip, dt)
}

function placeAttachedBalloon(b: Balloon, dt: number): void {
  const tf = Transform.getMutable(b.root)
  tf.position.x = b.pos.x
  tf.position.y = b.pos.y
  tf.position.z = b.pos.z
  // String is a child of the knot. Aim it in local space so the bottom
  // end is the knot and the top end is the live nub tip.
  _knot.x = 0
  _knot.y = 0
  _knot.z = 0
  orientBalloon(b, tf, _knot, dt)
  balloonBottom(tf, _tip)
  placeString(b.segs, b.lagMid, b, _knot, _tip, dt)
}

function emptyCluster(id: string, pose: Pose): Cluster {
  return {
    id,
    n: 0,
    style: BALLOON_STYLE,
    attach: null,
    knot: null,
    balloons: [],
    smoothVel: v(0, 0, 0),
    smoothYawRate: 0,
    prevFeet: { ...pose.feet },
    prevVel: v(0, 0, 0),
    prevYaw: pose.yawDeg,
    primed: false,
  }
}

function ensureCluster(id: string, pose: Pose): Cluster | null {
  let c = clusters.get(id)
  if (!c) {
    c = emptyCluster(id, pose)
    clusters.set(id, c)
  }
  if (c.style === 'attached' && !c.knot) {
    const rig = attachRig(id, pose)
    if (!rig) return null
    c.attach = rig.attach
    c.knot = rig.knot
  }
  return c
}

function setCounts(entries: Array<{ id: string; n: number }>): void {
  if (!balloonMatchLive()) {
    teardownBalloons()
    return
  }
  counts.clear()
  for (const e of entries) counts.set(e.id.toLowerCase(), e.n)
  const me = localId()
  localOut = !!me && counts.has(me) && (counts.get(me) ?? 0) <= 0
  for (const [id, c] of Array.from(clusters.entries())) {
    if ((counts.get(id) ?? 0) <= 0) {
      clearCluster(c)
      clusters.delete(id)
    }
  }
}

function dropLeavers(entries: Array<{ userId: string }>): void {
  if (!balloonMatchLive()) return
  const live = new Set(entries.map(e => e.userId.toLowerCase()))
  if (live.size === 0) return
  for (const [id, c] of Array.from(clusters.entries())) {
    if (id.startsWith('bot:')) continue
    if (live.has(id)) continue
    counts.delete(id)
    clearCluster(c)
    clusters.delete(id)
  }
}

function popAt(pos: Vec): void {
  const ent = engine.addEntity()
  Transform.create(ent, {
    position: Vector3.create(pos.x, pos.y, pos.z),
    scale: Vector3.create(BODY_XZ, BODY_XZ, BODY_XZ),
  })
  MeshRenderer.setSphere(ent)
  paintBalloon(ent, 1)
  pops.push({ ent, t: 0, x: pos.x, y: pos.y, z: pos.z })
  playBalloonPopSfx()
}

function applyPop(id: string, n: number): void {
  if (!balloonMatchLive()) {
    teardownBalloons()
    return
  }
  const key = id.toLowerCase()
  const was = counts.get(key) ?? 0
  counts.set(key, n)
  const c = clusters.get(key)
  if (c && c.balloons.length > n) {
    const gone = c.balloons.pop()
    if (gone) {
      const pose = poseOf(key) ?? { feet: c.prevFeet, yawDeg: c.prevYaw }
      popAt(worldBalloonPos(c, gone, pose))
      removeEntityWithChildren(engine, gone.root)
      dropSegs(gone)
    }
    if (c.balloons.length > 0) rehome(c, false)
  }
  if (n <= 0) dropCluster(key)
  if (key === localId() && n <= 0 && was > 0) localOut = true
}

function syncClusters(dt: number): void {
  const live = balloonMatchLive()
  if (!live) {
    if (wasLive || clusters.size || counts.size || pops.length) teardownBalloons()
    return
  }
  wasLive = true
  const step = Math.min(Math.max(dt, 0), 0.05)
  const want = new Set<string>()
  for (const [id, n] of counts) {
    if (n <= 0) continue
    want.add(id)
    const raw = poseOf(id)
    if (!raw) continue
    const c = ensureCluster(id, raw)
    if (!c) continue
    if (c.style === 'attached' && !c.knot) continue
    const before = c.balloons.length
    while (c.balloons.length < n) {
      const i = c.balloons.length
      const home = slotAt(i, n)
      const rest = v(home.x, home.y, home.z)
      const at = c.style === 'trail' ? (() => {
        const knot = backAnchor(raw)
        const w = rotateYaw(rest, raw.yawDeg)
        return v(knot.x + w.x, knot.y + w.y, knot.z + w.z)
      })() : rest
      c.balloons.push(spawnBalloon(i, at, c.knot))
    }
    while (c.balloons.length > n) {
      const gone = c.balloons.pop()
      if (gone) {
        removeEntityWithChildren(engine, gone.root)
        dropSegs(gone)
      }
    }
    c.n = n
    if (c.balloons.length !== before) rehome(c, c.balloons.length > before)
    if (c.style === 'attached') {
      // The attach/parent drives the knot. Do not rewrite its offset.
      const mot = stepMotion(c, raw, step)
      for (const b of c.balloons) {
        tickHome(b, step)
        jiggle(b, restLocal(b, clock, SWAY), mot.acc, mot.dYaw, raw.yawDeg, step)
        placeAttachedBalloon(b, step)
      }
    } else {
      const knot = backAnchor(raw)
      for (const b of c.balloons) {
        tickHome(b, step)
        const rest = restLocal(b, clock, TRAIL_SWAY)
        const w = rotateYaw(rest, raw.yawDeg)
        placeTrailBalloon(b, v(knot.x + w.x, knot.y + w.y, knot.z + w.z), knot, step)
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
    const s = BODY_XZ + u * 0.55
    const tf = Transform.getMutableOrNull(p.ent)
    if (tf) tf.scale = Vector3.create(s, s, s)
    paintBalloon(p.ent, 1 - u)
    if (p.t >= POP_S) {
      engine.removeEntity(p.ent)
      pops.splice(i, 1)
    }
  }
}

export function initBalloons(): void {
  events.on('balloon:state', ({ entries }) => setCounts(entries))
  events.on('balloon:pop', ({ id, n }) => applyPop(id, n))
  events.on('round:ended', () => teardownBalloons())
  events.on('round:reset', () => teardownBalloons())
  events.on('lobby:floor', () => teardownBalloons())
  events.on('team:roster', ({ entries }) => dropLeavers(entries))
  engine.addSystem((dt: number) => {
    clock += dt
    syncClusters(dt)
    tickPops(dt)
  })
}
