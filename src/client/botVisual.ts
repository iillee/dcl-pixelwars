/**
 * botVisual.ts — client-side bot renderer.
 *
 * Every live mode draws a GltfContainer bot. Flip BOT_MODEL between
 * 'custom' (Luke's Tripo mesh with a small arm rig; arms raise only in
 * the glide clip) and 'ghost' (the original Aug 2026 mesh in
 * ghost-recover.glb, with official DCL locomotion clips). The glider
 * pops out only while gliding. Classic, Base Charge, and Paint Limit get
 * a team light and, for the custom mesh, a runtime body tint from the
 * team palette (GltfNodeModifiers on BotBody, Arm_L, and Arm_R). Balloon
 * Battle is FFA so the body uses the balloon swatch (blue) and the light
 * is neutral.
 * The visual is always this mesh (not gated on the current format), so a
 * late mode sync cannot leave an AvatarShape standing. The AvatarShape
 * path remains as a gated fallback only.
 * botPositions is smoothed with per-frame lerp, velocity dead-reckoning, and
 * snapshot interpolation (long enough to cover a hosted ~530 ms tick).
 *
 * The lerp target is the feet. A same-point Tween.Move is refreshed every
 * frame on humanoid bots so the NPC's built-in walker (about 4 m/s toward
 * whatever position you write) does not drag the body off that target.
 *
 * ── Why per-frame lerp ──────────────────────────────────────────────
 *
 * Tween durations are fixed at issue time, so any drift between the
 * server's broadcast cadence and the client's render frame hitches
 * (Tween finishes early, entity sits still for a beat, then a new Tween
 * starts).
 *
 *   1. When a new server position arrives, estimate velocity from the
 *      delta since the last one.
 *   2. Each frame, predict where the body SHOULD be = lastServerPos +
 *      velocity * lookAhead.
 *   3. Lerp renderPos toward that prediction with a rate proportional
 *      to dt: `renderPos = lerp(renderPos, predicted, min(1, k*dt))`.
 *   4. Yaw toward the smoothed velocity, except after a knock: hold the
 *      pre-hit facing for KNOCK_FACE_HOLD_S (or until the knock speed decays),
 *      then ease toward the recovery heading. Never face the knock velocity.
 *   5. On a double jump, add a 360° ease-out spin over DOUBLE_JUMP_SPIN_DUR_S,
 *      composed on that facing yaw so smoothing is not overwritten.
 *   6. On a jump or double jump, a short squash-and-stretch pop on the visual
 *      root (face and outline follow). Jump height uses the live server Y
 *      instead of the delayed 2 Hz lerp, so takeoff reads as a hop.
 */

import {
  engine, Entity, Transform, AvatarShape, AvatarNametag, Tween, EasingFunction,
  GltfContainer, LightSource, Animator,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { remoteRiderFeet } from './fallRescue'
import { rescueAllowsSnapshotInterp, snapsAfterRescueRelease } from '../shared/rescuePath'
import { registerBotLookup } from './knockback'
import { room } from '../shared/messages'
import {
  BOT_AIM_REPORT_HZ, BOT_FRICTION, BOT_GRAVITY, BOT_KNOCK_UNIT,
  RoundFormat,
} from '../shared/pvp'
import { botShowsGlider, ghostClipForPose, doubleJumpSpinDeg, DOUBLE_JUMP_SPIN_DUR_S, jumpPop, knockFaceYaw, KNOCK_FACE_HOLD_S, BOT_ANIM_JUMP, BOT_ANIM_DOUBLE, BOT_ANIM_GLIDE, type GhostClip } from '../shared/botAnim'
import { attachBotFace, destroyBotFace, hitBotFace, initBotFace, playBotFaceClip, tickBotFace } from './botFace'
import { burstKnock, lungeKnock, spikeKnock } from '../shared/knocks'
import { Team, TEAM_RGB } from '../shared/team'
import { applyBotBodyForTeam, clearBotBodyColor, onBotBodyThemeChange } from './botBody'
import { teamPlatesHidden } from './nametags'
import { resolveSupport } from '../shared/anvilSim'
import { buildWalkableGraph, type WalkableGraph } from '../shared/mazeGraph'
import { getPlacedTilesInOrder, type Placed } from '../maze/generator'
import { TILES } from '../maze/tiles'

const BODY = 'urn:decentraland:off-chain:base-avatars:BaseMale'
const FACE = [
  'urn:decentraland:off-chain:base-avatars:short_hair',
  'urn:decentraland:off-chain:base-avatars:eyes_00',
  'urn:decentraland:off-chain:base-avatars:eyebrows_00',
  'urn:decentraland:off-chain:base-avatars:mouth_00',
]
// Base-avatar catalog slots. Red kit / blue kit. Skin is the other team's paint.
const RED_CLOTHES = [
  'urn:decentraland:off-chain:base-avatars:red_tshirt',
  'urn:decentraland:off-chain:base-avatars:f_red_comfy_pants',
  'urn:decentraland:off-chain:base-avatars:ruby_red_loafer',
]
const BLUE_CLOTHES = [
  'urn:decentraland:off-chain:base-avatars:blue_tshirt',
  'urn:decentraland:off-chain:base-avatars:elegant_blue_trousers',
  'urn:decentraland:off-chain:base-avatars:sport_blue_shoes',
]

/** Avatar origin is the feet, same as a player. Hit tests subtract this. Ghost float is applied only when drawing. */
export const FLOAT_HEIGHT = 0

/** Flip to `'ghost'` to restore the official DCL ghost mesh. */
export const BOT_MODEL: 'ghost' | 'custom' = 'custom'

type BotModelProfile = {
  src: string
  scale: number
  /** Local-space Y of the glider on the scaled root. Negative lowers it toward the crown.
   *  With GHOST_SCALE 1.2, -0.25 is 0.30 m in world space. */
  gliderLocalY: number
  /** Local-space Y of the team point light on the scaled root. */
  lightLocalY: number
  /** Balloon knot in unscaled model space, parented to the scaled root. */
  knotLocalY: number
  knotLocalZ: number
  clipDurS: Record<GhostClip, number>
}

const BOT_PROFILES: Record<'ghost' | 'custom', BotModelProfile> = {
  ghost: {
    src: 'assets/models/bots/ghost-recover.glb',
    scale: 1.2,
    gliderLocalY: -0.25,
    lightLocalY: 0,
    knotLocalY: 1.68 / 1.2,
    knotLocalZ: 0.2 / 1.2,
    clipDurS: { idle: 2, jump: 0.633, double: 0.633, glide: 0.167, fall: 0.667, slide: 0.667 },
  },
  custom: {
    // Flattened underside. Flip to 'assets/models/bots/bot-custom.glb' to compare the original bumps.
    src: 'assets/models/bots/bot-custom-flat.glb',
    scale: 1.2,
    gliderLocalY: -0.25,
    lightLocalY: 1.35,
    knotLocalY: 1.48,
    knotLocalZ: 0.42,
    clipDurS: { idle: 2, jump: 0.667, double: 0.667, glide: 0.333, fall: 0.667, slide: 0.667 },
  },
}

const profile = BOT_PROFILES[BOT_MODEL]
const GLIDER_SRC = 'assets/models/glider.glb'
/** Seconds. Official ghost clips match scripts/build-ghost-anims.py; custom clips are 24 fps. */
const GHOST_CLIP_LOOP: Record<GhostClip, boolean> = {
  idle: true, jump: false, double: false, glide: true, fall: true, slide: true,
}
const GHOST_CLIP_DUR_S: Record<GhostClip, number> = profile.clipDurS
/** Uniform scale of the bot mesh. Balloon knots use BOT_KNOT_LOCAL_* so the tie stays on the upper back. */
export const GHOST_SCALE = profile.scale
/** Balloon string tie-off, in the unscaled model local space of the bot root. */
export const BOT_KNOT_LOCAL_Y = profile.knotLocalY
export const BOT_KNOT_LOCAL_Z = profile.knotLocalZ
const GHOST_FLOAT = 1.0
const LIGHT_INTENSITY = 250
const LIGHT_RANGE = 8
const RED_LIGHT = Color3.create(1.00, 0.25, 0.28)
const BLUE_LIGHT = Color3.create(0.30, 0.55, 1.00)
/** Soft white point light in Balloon Battle, where there are no teams. */
const NEUTRAL_LIGHT = Color3.create(0.92, 0.94, 1.00)
const BOB_AMPLITUDE = 0.25
const BOB_HZ = 0.5
const DRIFT_AMPLITUDE = 0.15
const DRIFT_HZ_X = 0.27
const DRIFT_HZ_Z = 0.21
const PULSE_AMPLITUDE = 0.04
const PULSE_HZ = 0.8
const GLIDER_POP_S = 0.16

// Walking: extrapolate along last velocity for up to this long so a hosted
// ~530 ms tick does not stall the body between packets.
const WALK_EXTRAPOLATE_MAX_S = 0.85
// How aggressively the render position chases the prediction. Larger =
// snappier response, smaller = smoother but laggy.
const LERP_SPEED_PER_SEC = 6.0
// Fallback only when we have no measured packet interval yet.
const BROADCAST_INTERVAL_SEC = 0.1

// Big teleport threshold — beyond this distance we snap instead of
// lerping, so a round-reseat doesn't slide the body across the map.
const TELEPORT_THRESHOLD = 8
// Knocked or riding the cloud (st != 0): the server body moves fast
// (launches, falls, 45 m/s cloud rise) and the server sim advances in
// uneven chunks, so chasing the latest packet lurches and stops. Instead
// draw INTERP_DELAY_S in the past on the server's sim clock (botPositions
// t), between the two snapshots around that moment.
const TELEPORT_THRESHOLD_FAST = 60
const INTERP_DELAY_S = 0.25
const SNAP_KEEP = 16
/** Past the newest snapshot, extrapolate at most this long (covers a 2 Hz gap). */
const INTERP_EXTRAPOLATE_MAX_S = 0.7
/** Keep interpolating this long after the last fast packet (covers the delay). */
const FAST_HOLD_S = INTERP_DELAY_S + 0.5
const KNOCK_BLEND_S = 0.35
const LOCAL_KNOCK_S = 2

type V3 = { x: number; y: number; z: number }
type Snap = { t: number; pos: Vector3 }
type LocalKnock = {
  pos: V3
  vel: V3
  force: V3
  forceLeft: number
  floorY: number | null
  grounded: boolean
}
type VisualKind = 'ghost' | 'avatar'
/** Client wall time minus server sim time (s): tracks the lowest-latency packet, drifts up slowly. */
let clockOffset: number | null = null
let roundFormat: RoundFormat = 'pvp'

interface BotVisual {
  root: Entity
  id: number
  team: number
  kind: VisualKind
  light: Entity | null
  glider: Entity | null
  gliderScale: number
  pose: number
  clip: GhostClip | null
  clipUntil: number
  timeSec: number
  lastServerPos: Vector3
  velocity: Vector3     // metres/sec, estimated from server updates
  renderPos: Vector3    // smoothed feet position we actually track
  lastYawDeg: number    // last committed yaw — held when velocity too low
  spinT0: number        // rec.timeSec when the double-jump spin started, or -1
  hopT0: number         // rec.timeSec when the jump / double-jump pop started, or -1
  knockFaceUntil: number // rec.timeSec until which pre-hit yaw is held, or -1
  knockHeldYaw: number   // pre-hit yaw to hold during the knock
  knockDirX: number     // unit XZ of the knock, used so facing never follows it
  knockDirZ: number
  fastUntil: number     // Date.now() until which the snapshot interpolation draws it
  snaps: Snap[]         // recent server snapshots on the sim clock
  riding: boolean       // last packet said rescue (st 2)
  st: number            // last packet wire state (0 walk, 1 knock, 2 rescue, 3 wind-up, 4 glide)
  pktAt: number         // Date.now() of the last position packet
  lastSimT: number      // server sim time of that packet
  localKnock: LocalKnock | null
  knockBlend: number
  localKnockUntil: number
}

/** Draw far enough in the past to stay between snapshots: the usual gap plus margin. */
function interpDelay(snaps: Snap[]): number {
  if (snaps.length < 2) return INTERP_DELAY_S
  const gap = (snaps[snaps.length - 1].t - snaps[0].t) / (snaps.length - 1)
  return Math.min(0.9, Math.max(INTERP_DELAY_S, gap * 1.5 + 0.05))
}

function interpolate(snaps: Snap[], rt: number): Vector3 | null {
  if (snaps.length === 0) return null
  if (rt <= snaps[0].t) return snaps[0].pos
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i]
    if (rt <= b.t) return Vector3.lerp(a.pos, b.pos, (rt - a.t) / Math.max(1e-4, b.t - a.t))
  }
  const last = snaps[snaps.length - 1]
  if (snaps.length < 2) return last.pos
  const prev = snaps[snaps.length - 2]
  const ahead = Math.min(INTERP_EXTRAPOLATE_MAX_S, rt - last.t)
  const s = ahead / Math.max(1e-4, last.t - prev.t)
  return Vector3.create(last.pos.x + (last.pos.x - prev.pos.x) * s, last.pos.y + (last.pos.y - prev.pos.y) * s, last.pos.z + (last.pos.z - prev.pos.z) * s)
}

// Keyed by bot id (stable per bot, server-assigned).
const bots = new Map<number, BotVisual>()

function visualKind(): VisualKind {
  // Always the ghost. Tying this to botRecoveryEnabled(roundFormat) left
  // humanoids in Base Charge whenever the client still had a stale format,
  // or when a deployed bundle had not been rebuilt after recovery was
  // turned on for every mode.
  return 'ghost'
}

function rgb(team: number): Color3 {
  const c = TEAM_RGB[team] ?? TEAM_RGB[Team.Red]
  return Color3.create(c.r, c.g, c.b)
}

function hideGhostPlates(): boolean {
  return roundFormat === 'balloon' || teamPlatesHidden()
}

function lightColor(team: number): Color3 {
  if (hideGhostPlates()) return NEUTRAL_LIGHT
  return team === Team.Red ? RED_LIGHT : BLUE_LIGHT
}

/** One custom body GLB for every team. Color is applied at runtime. The
 *  official ghost mesh is unchanged. */
function ghostModelSrc(): string {
  return profile.src
}

function applyCustomBotBody(entity: Entity, team: number): void {
  if (BOT_MODEL !== 'custom') return
  applyBotBodyForTeam(entity, team, hideGhostPlates())
}

function paintLight(entity: Entity, team: number): void {
  LightSource.createOrReplace(entity, {
    type: LightSource.Type.Point({}),
    color: lightColor(team),
    intensity: LIGHT_INTENSITY,
    range: LIGHT_RANGE,
  })
}

function paintPlate(entity: Entity, team: number, _id: number): void {
  const red = team === Team.Red
  if (teamPlatesHidden()) {
    AvatarNametag.deleteFrom(entity)
    return
  }
  const bg = rgb(team)
  AvatarNametag.createOrReplace(entity, {
    label: red ? 'RED' : 'BLUE',
    labelColor: Color3.White(),
    backgroundColor: bg,
    borderColor: bg,
  })
}

/** Red wears red and has blue skin. Blue wears blue and has red skin. */
function paintAvatar(entity: Entity, team: number, id: number): void {
  const red = team === Team.Red
  const suffix = String(id).padStart(4, '0').slice(-4)
  AvatarShape.createOrReplace(entity, {
    id: `${red ? 'red' : 'blue'}-${suffix}`,
    name: red ? 'RED' : 'BLUE',
    bodyShape: BODY,
    skinColor: rgb(red ? Team.Blue : Team.Red),
    hairColor: rgb(red ? Team.Red : Team.Blue),
    eyeColor: Color3.create(0.93, 0.96, 1),
    wearables: FACE.concat(red ? RED_CLOTHES : BLUE_CLOTHES),
    emotes: [],
  })
  paintPlate(entity, team, id)
}

/** A finished move tween replaces the NPC's 4 m/s walker. Position stays ours. */
function holdWalker(entity: Entity, pos: Vector3): void {
  Tween.createOrReplace(entity, {
    mode: Tween.Mode.Move({ start: pos, end: pos }),
    duration: 1,
    currentTime: 1,
    playing: true,
    easingFunction: EasingFunction.EF_LINEAR,
  })
}

function destroyBot(id: number): void {
  const rec = bots.get(id)
  if (!rec) return
  destroyBotFace(id)
  if (rec.glider) engine.removeEntity(rec.glider)
  if (rec.light) engine.removeEntity(rec.light)
  AvatarNametag.deleteFrom(rec.root)
  AvatarShape.deleteFrom(rec.root)
  Tween.deleteFrom(rec.root)
  Animator.deleteFrom(rec.root)
  clearBotBodyColor(rec.root)
  GltfContainer.deleteFrom(rec.root)
  LightSource.deleteFrom(rec.root)
  engine.removeEntity(rec.root)
  bots.delete(id)
}

function clearAllBots(): void {
  for (const id of [...bots.keys()]) destroyBot(id)
}

function setRoundFormat(format: RoundFormat): void {
  if (roundFormat === format) return
  roundFormat = format
  clearAllBots()
}

function createBotVisual(team: number, pos: Vector3, id: number, kind: VisualKind): BotVisual {
  const root = engine.addEntity()
  Transform.create(root, {
    position: pos,
    rotation: Quaternion.Identity(),
    scale: kind === 'ghost' ? Vector3.create(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE) : Vector3.One(),
  })
  let light: Entity | null = null
  if (kind === 'ghost') {
    GltfContainer.create(root, { src: ghostModelSrc(), visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    Animator.create(root, {
      states: (['idle', 'jump', 'double', 'glide', 'fall', 'slide'] as GhostClip[]).map(clip => ({
        clip,
        playing: clip === 'idle',
        loop: GHOST_CLIP_LOOP[clip],
        speed: 1,
        weight: 1,
      })),
    })
    applyCustomBotBody(root, team)
    attachBotFace(root, id)
    light = engine.addEntity()
    Transform.create(light, { parent: root, position: Vector3.create(0, profile.lightLocalY, 0) })
    paintLight(light, team)
  } else {
    paintAvatar(root, team, id)
    holdWalker(root, pos)
  }

  return {
    root,
    id,
    team,
    kind,
    light,
    glider: null,
    gliderScale: 0,
    pose: 0,
    clip: 'idle',
    clipUntil: 0,
    timeSec: Math.random() * 100,
    lastServerPos: Vector3.clone(pos),
    velocity: Vector3.Zero(),
    renderPos: Vector3.clone(pos),
    lastYawDeg: 0,
    spinT0: -1,
    hopT0: -1,
    knockFaceUntil: -1,
    knockHeldYaw: 0,
    knockDirX: 0,
    knockDirZ: 0,
    fastUntil: 0,
    snaps: [],
    riding: false,
    st: 0,
    pktAt: 0,
    lastSimT: 0,
    localKnock: null,
    knockBlend: 0,
    localKnockUntil: 0,
  }
}

function pickGhostClip(rec: BotVisual): GhostClip {
  if (rec.riding) return 'idle'
  const next = ghostClipForPose(rec.pose)
  // Let a one-shot jump or double jump finish so a short (or 2 Hz) pose
  // window still reads, unless a double jump or a landing cuts it short.
  if (rec.clip && rec.timeSec < rec.clipUntil && !GHOST_CLIP_LOOP[rec.clip]) {
    if (next === 'double' && rec.clip === 'jump') return 'double'
    if (next === 'idle' || next === 'slide') return next
    return rec.clip
  }
  return next
}

function syncGhostAnim(rec: BotVisual): void {
  if (rec.kind !== 'ghost') return
  const clip = pickGhostClip(rec)
  if (clip === rec.clip) return
  Animator.playSingleAnimation(rec.root, clip, true)
  playBotFaceClip(rec.id, clip)
  rec.clip = clip
  rec.clipUntil = GHOST_CLIP_LOOP[clip] ? 0 : rec.timeSec + GHOST_CLIP_DUR_S[clip]
  rec.spinT0 = clip === 'double' ? rec.timeSec : -1
  if (clip === 'jump' || clip === 'double') rec.hopT0 = rec.timeSec
  else rec.hopT0 = -1
}

function syncGlider(rec: BotVisual, want: boolean, dt: number): void {


  if (rec.kind !== 'ghost') {
    if (rec.glider) { engine.removeEntity(rec.glider); rec.glider = null; rec.gliderScale = 0 }
    return
  }
  const step = dt / GLIDER_POP_S
  if (want) {
    if (!rec.glider) {
      const wing = engine.addEntity()
      Transform.create(wing, {
        parent: rec.root,
        position: Vector3.create(0, profile.gliderLocalY, 0),
        rotation: Quaternion.Identity(),
        scale: Vector3.Zero(),
      })
      GltfContainer.create(wing, { src: GLIDER_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
      rec.glider = wing
      rec.gliderScale = 0
    }
    rec.gliderScale = Math.min(1, rec.gliderScale + step)
  } else if (rec.glider) {
    rec.gliderScale = Math.max(0, rec.gliderScale - step)
    if (rec.gliderScale <= 0) {
      engine.removeEntity(rec.glider)
      rec.glider = null
      rec.gliderScale = 0
      return
    }
  }
  if (rec.glider) {
    const tf = Transform.getMutable(rec.glider)
    const s = rec.gliderScale
    tf.scale = Vector3.create(s, s, s)
    tf.rotation = Quaternion.Identity()
  }
}

let knockMaze: { key: string; graph: WalkableGraph; rampTiles: Placed[]; tiles: Placed[] } | null = null

/** Walkable graph for the local knock arc, so the predicted path rides ramps like the server. */
function knockMazeWorld(): { graph: WalkableGraph; rampTiles: Placed[]; tiles: Placed[] } | null {
  const tiles = getPlacedTilesInOrder()
  if (!tiles.length) return null
  const first = tiles[0], last = tiles[tiles.length - 1]
  const key = tiles.length + ':' + first.x + ',' + first.z + ',' + first.y + ':' + last.x + ',' + last.z + ',' + last.y
  if (knockMaze && knockMaze.key === key) return knockMaze
  const graph = buildWalkableGraph(tiles)
  knockMaze = { key, graph, rampTiles: tiles.filter(t => TILES[t.type].isRamp), tiles }
  return knockMaze
}

function clearKnockMaze(): void { knockMaze = null }

function stepLocalKnock(rec: BotVisual, dt: number): void {
  const k = rec.localKnock
  if (!k) return
  const world = knockMazeWorld()
  let left = Math.min(Number.isFinite(dt) ? dt : 0, 0.1)
  while (left > 1e-6) {
    const s = Math.min(left, 0.05)
    left -= s
    if (k.forceLeft > 0) {
      k.vel.x += k.force.x * s
      k.vel.y += k.force.y * s
      k.vel.z += k.force.z * s
      k.forceLeft -= s
    }
    const wasGrounded = k.grounded && k.vel.y <= 0
    k.vel.y -= BOT_GRAVITY * s
    const nx = k.pos.x + k.vel.x * s
    const ny = k.pos.y + k.vel.y * s
    const nz = k.pos.z + k.vel.z * s
    if (world) {
      const hit = resolveSupport(world.graph, world.rampTiles, world.tiles, k.pos, nx, ny, nz, k.vel.y, wasGrounded)
      if (Math.abs(hit.x - nx) > 1e-6) k.vel.x = 0
      if (Math.abs(hit.z - nz) > 1e-6) k.vel.z = 0
      k.pos.x = hit.x
      k.pos.y = hit.y
      k.pos.z = hit.z
      k.vel.y = hit.velY
      k.grounded = hit.grounded
      if (k.grounded) k.floorY = hit.y
    } else {
      k.pos.x = nx
      k.pos.y = ny
      k.pos.z = nz
      if (k.floorY !== null && k.pos.y <= k.floorY) {
        k.pos.y = k.floorY
        if (k.vel.y < 0) k.vel.y = 0
        k.grounded = true
      } else {
        k.grounded = false
      }
    }
    if (k.grounded) {
      const h = Math.hypot(k.vel.x, k.vel.z)
      const nh = Math.max(0, h - BOT_FRICTION * s)
      if (h > 1e-4) { k.vel.x *= nh / h; k.vel.z *= nh / h } else { k.vel.x = 0; k.vel.z = 0 }
    }
  }
  rec.velocity = Vector3.create(k.vel.x, k.vel.y, k.vel.z)
}

function beginKnockFace(rec: BotVisual, dx: number, dz: number): void {
  rec.knockHeldYaw = rec.lastYawDeg
  rec.knockFaceUntil = rec.timeSec + KNOCK_FACE_HOLD_S
  const len = Math.hypot(dx, dz)
  if (len > 1e-3) { rec.knockDirX = dx / len; rec.knockDirZ = dz / len }
  else { rec.knockDirX = 0; rec.knockDirZ = 0 }
}

/** Play the confirmed knock arc locally, then blend toward the server path once snapshots arrive. */
export function playBotKnock(id: number, dx: number, dz: number, kind: 'lunge' | 'burst' | 'spike'): void {
  const rec = bots.get(id)
  if (!rec || rec.riding) return
  const len = Math.hypot(dx, dz)
  const ux = len > 1e-3 ? dx / len : 0
  const uz = len > 1e-3 ? dz / len : 0
  const grounded = Math.abs(rec.velocity.y) < 2
  const spec = kind === 'lunge' ? lungeKnock(ux, uz) : kind === 'spike' ? spikeKnock(ux, uz, grounded) : burstKnock(ux, uz)
  const u = BOT_KNOCK_UNIT
  rec.localKnock = {
    pos: { x: rec.renderPos.x, y: rec.renderPos.y, z: rec.renderPos.z },
    vel: {
      x: rec.velocity.x + spec.impulse.x * u,
      y: rec.velocity.y + spec.impulse.y * u,
      z: rec.velocity.z + spec.impulse.z * u,
    },
    force: { x: spec.forceDir.x * spec.force * u, y: spec.forceDir.y * spec.force * u, z: spec.forceDir.z * spec.force * u },
    forceLeft: spec.forceS,
    floorY: grounded ? rec.renderPos.y : null,
    grounded,
  }
  rec.knockBlend = 0
  rec.snaps = []
  rec.fastUntil = Date.now() + LOCAL_KNOCK_S * 1000
  rec.localKnockUntil = rec.fastUntil
  beginKnockFace(rec, ux, uz)
  hitBotFace(id)
}

export function initBotVisual(): void {
  initBotFace()
  onBotBodyThemeChange(() => {
    for (const rec of bots.values()) {
      if (rec.kind === 'ghost') applyCustomBotBody(rec.root, rec.team)
    }
  })
  registerBotLookup({
    team: id => { const r = bots.get(parseInt(id.slice(4), 10)); return r ? (r.team as Team) : Team.None },
    feet: id => {
      const r = bots.get(parseInt(id.slice(4), 10))
      return r ? { x: r.renderPos.x, y: r.renderPos.y - FLOAT_HEIGHT, z: r.renderPos.z } : null
    },
  })
  events.on('round:reset', ({ format }) => {
    setRoundFormat(format)
    clearKnockMaze()
    clearAllBots()
  })
  events.on('round:clock', ({ format }) => { setRoundFormat(format) })
  events.on('lobby:floor', () => { clearKnockMaze(); clearAllBots() })
  // While a bot is in the round, tell the server where we stand so it can chase and aim.
  let aimClock = 0
  engine.addSystem((dt: number) => {
    if (bots.size === 0) return
    aimClock += dt
    if (aimClock < 1 / BOT_AIM_REPORT_HZ) return
    aimClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch (err) { console.log('[Bots] botAim send failed', err) }
  })
  // ── Server updates: dead-reckoning inputs ────────────────────────
  events.on('bots:positions', ({ bots: msg, t }) => {
    const seen = new Set<number>()
    const now = Date.now()
    const simT = Number.isFinite(t) ? t : null
    if (simT !== null) {
      const sample = now / 1000 - simT
      if (clockOffset === null || sample < clockOffset || Math.abs(sample - clockOffset) > 5) clockOffset = sample
      else clockOffset += (sample - clockOffset) * 0.05
    }
    const kind = visualKind()
    for (const b of msg) {
      seen.add(b.id)
      // Server positions are feet. The avatar origin is the feet. The ghost floats at draw time.
      const serverPos = Vector3.create(b.x, b.y + FLOAT_HEIGHT, b.z)

      let rec = bots.get(b.id)
      if (rec && rec.kind !== kind) {
        destroyBot(b.id)
        rec = undefined
      }
      if (!rec) {
        rec = createBotVisual(b.team, serverPos, b.id, kind)
        rec.pktAt = now
        rec.lastSimT = simT ?? 0
        rec.pose = b.an ?? 0
        rec.st = b.st
        rec.riding = b.st === 2
        bots.set(b.id, rec)
        continue
      }

      rec.pose = b.an ?? 0
      const wasSt = rec.st
      rec.st = b.st
      if ((b.st ?? 0) === 1 && wasSt !== 1) beginKnockFace(rec, b.vx ?? 0, b.vz ?? 0)
      if ((b.st ?? 0) === 0 || (b.st ?? 0) === 2) rec.knockFaceUntil = -1
      if (rec.team !== b.team) {
        if (rec.kind === 'ghost') {
          if (rec.light) paintLight(rec.light, b.team)
          applyCustomBotBody(rec.root, b.team)
        } else {
          paintAvatar(rec.root, b.team, rec.id)
        }
        rec.team = b.team
      }

      const dx = serverPos.x - rec.lastServerPos.x
      const dy = serverPos.y - rec.lastServerPos.y
      const dz = serverPos.z - rec.lastServerPos.z
      const distSq = dx * dx + dy * dy + dz * dz
      if (simT !== null) {
        const lastT = rec.snaps.length > 0 ? rec.snaps[rec.snaps.length - 1].t : -Infinity
        if (simT < lastT - 1) rec.snaps = [] // server restarted its clock
        if (simT > lastT + 1e-4) rec.snaps.push({ t: simT, pos: serverPos })
        if (rec.snaps.length > SNAP_KEEP) rec.snaps.shift()
      }
      const wasFast = now < rec.fastUntil
      const wasRiding = rec.riding
      rec.riding = b.st === 2
      if (wasRiding && !rec.riding) {
        // The local cloud already lowered them. Delayed ride snapshots would
        // put them back up the descent, so forget that path and stop interpolating it.
        const landT = simT ?? rec.lastSimT
        rec.snaps = snapsAfterRescueRelease(landT, Vector3.clone(serverPos))
        rec.fastUntil = 0
        rec.localKnock = null
      } else if ((b.st ?? 0) !== 0 && simT !== null) {
        rec.fastUntil = now + FAST_HOLD_S * 1000
      }
      const interval = (simT !== null && rec.lastSimT > 0)
        ? Math.max(0.08, simT - rec.lastSimT)
        : rec.pktAt > 0 ? Math.max(0.08, (now - rec.pktAt) / 1000)
        : BROADCAST_INTERVAL_SEC
      rec.pktAt = now
      if (simT !== null) rec.lastSimT = simT
      if (now < rec.fastUntil) {
        // Knocked / riding: the render system interpolates the snapshots.
        rec.lastServerPos = Vector3.clone(serverPos)
        rec.velocity = Vector3.create(b.vx ?? 0, b.vy ?? 0, b.vz ?? 0)
        continue
      }
      const snapAt = wasFast ? TELEPORT_THRESHOLD_FAST : TELEPORT_THRESHOLD

      if (distSq > snapAt * snapAt) {
        // Snap. Kills accumulated velocity so we don't overshoot the target.
        rec.renderPos = Vector3.clone(serverPos)
        rec.lastServerPos = Vector3.clone(serverPos)
        rec.velocity = Vector3.Zero()
      } else if (distSq > 1e-5) {
        // New position — update velocity from the actual packet interval.
        rec.velocity = Vector3.create(dx / interval, dy / interval, dz / interval)
        rec.lastServerPos = serverPos
      }
      // If distSq ~ 0, keep the previous velocity — the bot may just
      // be mid-step; next update will correct.
    }

    for (const [id] of bots) {
      if (!seen.has(id)) destroyBot(id)
    }
  })

  // ── Per-frame render: lerp toward the predicted feet position ─
  engine.addSystem((dt: number) => {
    for (const [id, rec] of bots) {
      rec.timeSec += dt
      // Predicted position = last server position + velocity * lookAhead.
      // Puts us one broadcast ahead of the arriving packets so we stop
      // chasing them.
      const now = Date.now()
      // On the cloud: hang from the cloud this client draws (it runs on local
      // time, so a past-time interpolation would trail it by metres on the rise).
      const ride = rec.riding ? remoteRiderFeet(`bot:${id}`) : null
      const interp = !ride && rescueAllowsSnapshotInterp(rec.riding) && now < rec.fastUntil && clockOffset !== null && rec.snaps.length >= 2
        ? interpolate(rec.snaps, now / 1000 - clockOffset - interpDelay(rec.snaps))
        : null
      if (rec.localKnock && now > rec.localKnockUntil) rec.localKnock = null
      if (ride) {
        rec.localKnock = null
        rec.renderPos = Vector3.create(ride.x, ride.y + FLOAT_HEIGHT, ride.z)
      } else if (rec.riding) {
        // Cloud path finished or not drawn yet: follow live server feet (the
        // short drop), never delayed mid-descent snapshots.
        rec.localKnock = null
        const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
        rec.renderPos = Vector3.create(
          rec.renderPos.x + (rec.lastServerPos.x - rec.renderPos.x) * k,
          rec.renderPos.y + (rec.lastServerPos.y - rec.renderPos.y) * k,
          rec.renderPos.z + (rec.lastServerPos.z - rec.renderPos.z) * k,
        )
      } else if (rec.localKnock) {
        stepLocalKnock(rec, dt)
        if (interp) {
          rec.knockBlend = Math.min(1, rec.knockBlend + dt / KNOCK_BLEND_S)
          rec.renderPos = Vector3.lerp(Vector3.create(rec.localKnock.pos.x, rec.localKnock.pos.y, rec.localKnock.pos.z), interp, rec.knockBlend)
          if (rec.knockBlend >= 1) rec.localKnock = null
        } else {
          rec.renderPos = Vector3.create(rec.localKnock.pos.x, rec.localKnock.pos.y, rec.localKnock.pos.z)
        }
      } else if (interp) {
        const jumping = rec.pose === BOT_ANIM_JUMP || rec.pose === BOT_ANIM_DOUBLE
          || rec.clip === 'jump' || rec.clip === 'double'
        if (jumping) {
          // Delayed snapshot lerp smears a 0.3 s hop across a 2 Hz gap.
          // Keep XZ on the smoothed path; drive Y from the latest packet so
          // takeoff is a pop, not a drift. Cosmetic hop (jumpPop) is separate.
          const look = rec.pktAt > 0 ? Math.min(0.6, (now - rec.pktAt) / 1000) : 0
          const liveY = rec.lastServerPos.y + rec.velocity.y * look - 0.5 * BOT_GRAVITY * look * look
          rec.renderPos = Vector3.create(interp.x, liveY, interp.z)
        } else {
          rec.renderPos = Vector3.clone(interp)
        }
      } else {
        const look = rec.pktAt > 0 ? Math.min(WALK_EXTRAPOLATE_MAX_S, (now - rec.pktAt) / 1000) : 0
        const predX = rec.lastServerPos.x + rec.velocity.x * look
        const predY = rec.lastServerPos.y + rec.velocity.y * look
        const predZ = rec.lastServerPos.z + rec.velocity.z * look
        const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
        rec.renderPos = Vector3.create(
          rec.renderPos.x + (predX - rec.renderPos.x) * k,
          rec.renderPos.y + (predY - rec.renderPos.y) * k,
          rec.renderPos.z + (predZ - rec.renderPos.z) * k,
        )
      }

      const vx = rec.velocity.x
      const vz = rec.velocity.z
      const speedSq = vx * vx + vz * vz
      const speed = Math.sqrt(speedSq)
      const moveYaw = speedSq > 0.25 ? Math.atan2(vx, vz) * (180 / Math.PI) : null
      if (rec.knockFaceUntil >= 0) {
        const recovering = rec.pose === BOT_ANIM_JUMP || rec.pose === BOT_ANIM_DOUBLE || rec.pose === BOT_ANIM_GLIDE
          || rec.clip === 'jump' || rec.clip === 'double' || rec.clip === 'glide'
        const alongKnock = speed > 1e-3 && (rec.knockDirX !== 0 || rec.knockDirZ !== 0)
          && (vx * rec.knockDirX + vz * rec.knockDirZ) / speed > 0.5
        rec.lastYawDeg = knockFaceYaw({
          now: rec.timeSec, holdUntil: rec.knockFaceUntil, heldYaw: rec.knockHeldYaw,
          currentYaw: rec.lastYawDeg, moveYawDeg: moveYaw, recovering, speed, alongKnock, dt,
        })
        if (rec.st === 0 || rec.st === 2) rec.knockFaceUntil = -1
      } else if (moveYaw !== null) {
        rec.lastYawDeg = moveYaw
      }

      const tf = Transform.getMutable(rec.root)
      if (rec.kind === 'ghost') {
        const t = rec.timeSec
        syncGhostAnim(rec)
        tickBotFace(rec.id, rec.pose, rec.st)
        const air = rec.riding || rec.clip === 'jump' || rec.clip === 'double' || rec.clip === 'glide' || rec.clip === 'fall'
        const bob = air ? 0 : Math.sin(t * BOB_HZ * Math.PI * 2) * BOB_AMPLITUDE
        const drX = air ? 0 : Math.sin(t * DRIFT_HZ_X * Math.PI * 2) * DRIFT_AMPLITUDE
        const drZ = air ? 0 : Math.cos(t * DRIFT_HZ_Z * Math.PI * 2) * DRIFT_AMPLITUDE
        const pop = rec.hopT0 >= 0 ? jumpPop(rec.timeSec - rec.hopT0) : { y: 0, sx: 1, sy: 1, sz: 1 }
        const pulse = air ? 1 : 1.0 + Math.sin(t * PULSE_HZ * Math.PI * 2) * PULSE_AMPLITUDE
        tf.position = Vector3.create(
          rec.renderPos.x + drX,
          rec.renderPos.y + GHOST_FLOAT + bob + pop.y,
          rec.renderPos.z + drZ,
        )
        tf.scale = Vector3.create(GHOST_SCALE * pulse * pop.sx, GHOST_SCALE * pulse * pop.sy, GHOST_SCALE * pulse * pop.sz)
      } else {
        tf.position = rec.renderPos
        holdWalker(rec.root, rec.renderPos)
      }
      const spin = rec.spinT0 >= 0 ? doubleJumpSpinDeg(rec.timeSec - rec.spinT0, DOUBLE_JUMP_SPIN_DUR_S) : 0
      tf.rotation = Quaternion.fromEulerDegrees(0, rec.lastYawDeg + spin, 0)

      // Glider faces the ghost's travel direction via the parent yaw.
      // Retract on landing, a raw fall, or the Lakitu rescue.
      const wantWing = rec.kind === 'ghost' && !rec.riding && botShowsGlider(rec.pose)
      syncGlider(rec, wantWing, dt)
    }
  })
}

/** Where each bot is drawn right now (id, smoothed feet, facing, and the body entity). */
export function getBotRenderPositions(): Array<{ id: number; team: number; pos: Vector3; yawDeg: number; entity: Entity }> {
  const out: Array<{ id: number; team: number; pos: Vector3; yawDeg: number; entity: Entity }> = []
  for (const [id, rec] of bots) out.push({ id, team: rec.team, pos: rec.renderPos, yawDeg: rec.lastYawDeg, entity: rec.root })
  return out
}
