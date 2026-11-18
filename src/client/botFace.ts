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
 * Phase 1 wires idle (default) and burst (on burst:fired for `bot:N`, with
 * a short minimum display so it doesn't flicker). The other four PNGs are
 * already in the folder for a later pass.
 */
import {
  Animator, engine, Entity, GltfContainer, GltfNodeModifiers, Material,
  MaterialTransparencyMode, Transform,
} from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { type GhostClip } from '../shared/botAnim'

export type BotFaceExpr = 'idle' | 'dash' | 'burst' | 'hit' | 'fall' | 'glide'

const FACE_GLB = 'assets/models/bots/bot-face.glb'
const FACE_SRC: Record<BotFaceExpr, string> = {
  idle: 'assets/images/bots/faces/idle.png',
  dash: 'assets/images/bots/faces/dash.png',
  burst: 'assets/images/bots/faces/burst.png',
  hit: 'assets/images/bots/faces/hit.png',
  fall: 'assets/images/bots/faces/fall.png',
  glide: 'assets/images/bots/faces/glide.png',
}

const FACE_CLIP_LOOP: Record<GhostClip, boolean> = {
  idle: true, jump: false, double: false, glide: true, fall: true, slide: true,
}

/** Seconds the burst face stays up after burst:fired, even if the action is instant. */
const BURST_FACE_MIN_S = 0.55

type FaceRec = {
  ent: Entity
  expr: BotFaceExpr
  /** Date.now() until which a burst face must stay visible. 0 if none. */
  untilMs: number
  clip: GhostClip | null
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

function botIdFromAttacker(attacker: string): number | null {
  const s = attacker.toLowerCase()
  if (!s.startsWith('bot:')) return null
  const n = parseInt(s.slice(4), 10)
  return Number.isFinite(n) ? n : null
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
  faces.set(id, { ent, expr: 'idle', untilMs: 0, clip: 'idle' })
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

export function setBotFace(id: number, expr: BotFaceExpr, minS = 0): void {
  const rec = faces.get(id)
  if (!rec) return
  if (rec.expr !== expr) {
    applyExpr(rec.ent, expr)
    rec.expr = expr
  }
  rec.untilMs = minS > 0 ? Date.now() + minS * 1000 : 0
}

/** Hold burst for its minimum time, then return to idle. */
export function tickBotFace(id: number): void {
  const rec = faces.get(id)
  if (!rec) return
  if (rec.expr === 'burst' && rec.untilMs > 0 && Date.now() >= rec.untilMs) {
    applyExpr(rec.ent, 'idle')
    rec.expr = 'idle'
    rec.untilMs = 0
  }
}

export function initBotFace(): void {
  if (hooked) return
  hooked = true
  events.on('burst:fired', ({ attacker }) => {
    const id = botIdFromAttacker(attacker)
    if (id === null) return
    setBotFace(id, 'burst', BURST_FACE_MIN_S)
  })
}
