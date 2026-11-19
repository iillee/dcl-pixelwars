/**
 * botFace.ts — 2D cartoon expressions on a curved shell that follows the
 * ghost's front surface.
 *
 * The shell is assets/models/bots/bot-face.glb (same armature and clips as
 * the body, skinned to the body bone). Expression art is a PNG per mood in
 * assets/images/bots/faces/. Swap a PNG to revise the drawing; you only
 * rebuild the GLB if the shell itself changes.
 *
 * GltfContainer textures can't be swapped on their own, so we override the
 * face material with GltfNodeModifiers (the same path the water mesh uses).
 * Face state is independent of team color and of the body's material.
 *
 * Wired expressions, highest priority first: hit (lunge / burst / knock /
 * dash impact, latched ~0.6 s), glide (glider open), fall (fall clip or
 * uncontrolled fall pose), burst (burst:fired, latched ~0.55 s), dash
 * (lunge:started, latched ~0.55 s), idle otherwise. Short actions are
 * latched so a 2 Hz botPositions stream cannot skip them.
 */
import {
  Animator, engine, Entity, GltfContainer, GltfNodeModifiers, Material,
  MaterialTransparencyMode, Transform,
} from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { type GhostClip } from '../shared/botAnim'
import {
  FACE_MIN_S,
  botIdFromActor,
  latchFace,
  resolveBotFace,
  type BotFaceExpr,
  type FaceLatches,
} from '../shared/botFaceState'

export type { BotFaceExpr }

const FACE_GLB = 'assets/models/bots/bot-face.glb'
const FACE_SRC: Record<BotFaceExpr, string> = {
  idle: 'assets/images/bots/faces/idle.png',
  dash: 'assets/images/bots/faces/dash.png',
  burst: 'assets/images/bots/faces/burst.png',
  hit: 'assets/images/bots/faces/hit.png',
  fall: 'assets/images/bots/faces/fall.png',
  glide: 'assets/images/bots/faces/glide.png',
  star: 'assets/images/bots/faces/star.png',
}

const FACE_CLIP_LOOP: Record<GhostClip, boolean> = {
  idle: true, jump: false, double: false, glide: true, fall: true, slide: true,
}

type FaceRec = {
  ent: Entity
  expr: BotFaceExpr
  latches: FaceLatches
  clip: GhostClip | null
  pose: number
  st: number
  starred: boolean
}

const faces = new Map<number, FaceRec>()
let hooked = false

function faceMaterial(expr: BotFaceExpr) {
  const src = FACE_SRC[expr]
  const tex = Material.Texture.Common({ src })
  return {
    texture: tex,
    alphaTexture: tex,
    emissiveTexture: tex,
    emissiveColor: Color3.White(),
    emissiveIntensity: 0.35,
    metallic: 0,
    roughness: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_TEST,
    alphaTest: 0.4,
    castShadows: false,
  }
}

function applyExpr(ent: Entity, expr: BotFaceExpr): void {
  GltfNodeModifiers.createOrReplace(ent, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: faceMaterial(expr),
        },
      },
    }],
  })
}

function resolve(rec: FaceRec, nowMs = Date.now()): void {
  const next = resolveBotFace({
    nowMs,
    pose: rec.pose,
    st: rec.st,
    clip: rec.clip,
    latches: rec.latches,
    starred: rec.starred,
  })
  rec.latches = next.latches
  if (rec.expr !== next.expr) {
    applyExpr(rec.ent, next.expr)
    rec.expr = next.expr
  }
}

function latch(id: number, expr: BotFaceExpr, minS = FACE_MIN_S[expr]): void {
  const rec = faces.get(id)
  if (!rec) return
  rec.latches = latchFace(rec.latches, expr, Date.now(), minS)
  resolve(rec)
}

export function attachBotFace(parent: Entity, id: number): void {
  destroyBotFace(id)
  const ent = engine.addEntity()
  Transform.create(ent, {
    parent,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One(),
  })
  GltfContainer.create(ent, {
    src: FACE_GLB,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  Animator.create(ent, {
    states: (['idle', 'jump', 'double', 'glide', 'fall', 'slide'] as GhostClip[]).map(clip => ({
      clip,
      playing: clip === 'idle',
      loop: FACE_CLIP_LOOP[clip],
      speed: 1,
      weight: 1,
    })),
  })
  applyExpr(ent, 'idle')
  faces.set(id, { ent, expr: 'idle', latches: {}, clip: 'idle', pose: 0, st: 0, starred: false })
}

export function destroyBotFace(id: number): void {
  const rec = faces.get(id)
  if (!rec) return
  Animator.deleteFrom(rec.ent)
  GltfNodeModifiers.deleteFrom(rec.ent)
  GltfContainer.deleteFrom(rec.ent)
  engine.removeEntity(rec.ent)
  faces.delete(id)
}

export function playBotFaceClip(id: number, clip: GhostClip): void {
  const rec = faces.get(id)
  if (!rec || rec.clip === clip) return
  Animator.playSingleAnimation(rec.ent, clip, true)
  rec.clip = clip
}

export function setBotFace(id: number, expr: BotFaceExpr, minS = FACE_MIN_S[expr]): void {
  latch(id, expr, minS)
}

/** Swap to the star-eyes face while this bot holds the star; revert when it ends. */
export function setBotStarFace(id: number, on: boolean): void {
  const rec = faces.get(id)
  if (!rec || rec.starred === on) return
  rec.starred = on
  resolve(rec)
}

export function clearBotStarFaces(): void {
  for (const rec of faces.values()) {
    if (!rec.starred) continue
    rec.starred = false
    resolve(rec)
  }
}

/** Latch the hit face when a lunge, burst, spike, or dash knocks this bot. */
export function hitBotFace(id: number): void {
  latch(id, 'hit')
}

/** Hold latched faces and apply glide / fall from the latest pose and wire state. */
export function tickBotFace(id: number, pose = 0, st = 0): void {
  const rec = faces.get(id)
  if (!rec) return
  rec.pose = pose
  rec.st = st
  resolve(rec)
}

export function initBotFace(): void {
  if (hooked) return
  hooked = true
  events.on('burst:fired', ({ attacker }) => {
    const id = botIdFromActor(attacker)
    if (id === null) return
    latch(id, 'burst')
  })
  events.on('lunge:started', ({ attacker }) => {
    const id = botIdFromActor(attacker)
    if (id === null) return
    latch(id, 'dash')
  })
  const onHitTarget = ({ target }: { target: string }) => {
    const id = botIdFromActor(target)
    if (id === null) return
    latch(id, 'hit')
  }
  events.on('lunge:impact', onHitTarget)
  events.on('burst:impact', onHitTarget)
  // dash:impact currently only targets human victims (dashHit is roster-only),
  // but hook it so a bot target would still get a hit face if that changes.
  events.on('dash:impact', onHitTarget)
}
