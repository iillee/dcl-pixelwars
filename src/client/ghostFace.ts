/**
 * ghostFace.ts — the ghost's eyes, drawn as primitives on the body mesh.
 *
 * The body is assets/models/bots/ghost-red.glb / ghost-blue.glb. These anchors
 * and the LOOK numbers match scripts/build-ghost-glbs.mjs. A lid is a thin
 * body-coloured band that slides over the eye: open, squint, shut.
 */
import { engine, Entity, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { TEAM_RGB } from '../shared/team'

const EYE_X = 0.185
const EYE_Y = 0.96
const EYE_Z = 0.56

export type GhostMood = 'calm' | 'focus' | 'glide' | 'hurt' | 'down'

type Look = { lid: number; pupil: number; py: number; px: number }
const LOOK: Record<GhostMood, Look> = {
  calm: { lid: 0.16, pupil: 0.15, py: 0, px: 0 },
  focus: { lid: 0.02, pupil: 0.10, py: -0.01, px: 0 },
  glide: { lid: 0.15, pupil: 0.13, py: 0.03, px: 0 },
  hurt: { lid: 0.22, pupil: 0.21, py: 0, px: 0.015 },
  down: { lid: -0.02, pupil: 0.12, py: 0.03, px: 0 },
}

type Eye = { side: number; pupil: Entity; catch: Entity; lid: Entity }
export type GhostFace = { lids: Entity[]; eyes: Eye[]; blink: number }

function bodyMat(team: number) {
  const c = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  return { albedoColor: Color4.create(c.r, c.g, c.b, 1), roughness: 0.62, metallic: 0, castShadows: false }
}

function part(parent: Entity, pos: Vector3, scale: Vector3): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos, scale })
  MeshRenderer.setSphere(e)
  return e
}

export function createGhostFace(parent: Entity, team: number): GhostFace {
  const eyes: Eye[] = []
  const lids: Entity[] = []
  for (const side of [-1, 1]) {
    const eye = engine.addEntity()
    Transform.create(eye, { parent, position: Vector3.create(EYE_X * side, EYE_Y, EYE_Z) })
    const sclera = part(eye, Vector3.Zero(), Vector3.create(0.34, 0.40, 0.30))
    Material.setPbrMaterial(sclera, { albedoColor: Color4.create(0.97, 0.98, 1, 1), roughness: 0.28, castShadows: false })
    const pupil = part(eye, Vector3.create(0, 0, 0.11), Vector3.create(0.15, 0.15, 0.12))
    Material.setPbrMaterial(pupil, { albedoColor: Color4.create(0.05, 0.05, 0.07, 1), roughness: 0.4, castShadows: false })
    const catchL = part(eye, Vector3.create(-0.045 * side, 0.05, 0.15), Vector3.create(0.07, 0.07, 0.04))
    Material.setPbrMaterial(catchL, {
      albedoColor: Color4.create(1, 1, 1, 1),
      emissiveColor: Color4.create(1, 1, 1, 1),
      emissiveIntensity: 2,
      roughness: 0.2,
      castShadows: false,
    })
    const lid = part(eye, Vector3.create(0, LOOK.calm.lid, 0.1), Vector3.create(0.46, 0.11, 0.34))
    Material.setPbrMaterial(lid, bodyMat(team))
    lids.push(lid)
    eyes.push({ side, pupil, catch: catchL, lid })
  }
  return { lids, eyes, blink: 1.5 }
}

export function recolorGhostFace(face: GhostFace, team: number): void {
  const m = bodyMat(team)
  for (const lid of face.lids) Material.setPbrMaterial(lid, m)
}

/** Slide the lids and pupils. `time` is the ghost's own clock, so blinks don't sync. */
export function poseGhostFace(face: GhostFace, mood: GhostMood, dt: number, time: number): void {
  if (mood !== 'hurt') {
    face.blink -= dt
    if (face.blink < -0.1) face.blink = 2.2 + (time % 1.3)
  }
  const look = LOOK[mood]
  const shut = mood !== 'hurt' && face.blink < 0
  const lidY = shut ? -0.04 : look.lid
  for (const e of face.eyes) {
    const glance = look.px * e.side + (mood === 'calm' ? Math.sin(time * 0.8 + e.side) * 0.012 : 0)
    const pt = Transform.getMutable(e.pupil)
    pt.position = Vector3.create(glance, look.py, 0.11)
    pt.scale = Vector3.create(look.pupil, look.pupil, 0.12)
    const ct = Transform.getMutable(e.catch)
    ct.position = Vector3.create(glance - 0.045 * e.side, look.py + 0.05, 0.15)
    Transform.getMutable(e.lid).position = Vector3.create(0, lidY, 0.1)
  }
}
