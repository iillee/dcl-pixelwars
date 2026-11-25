/**
 * starOrb.ts — the star pickup visual. STAR_MODEL points at the star mesh;
 * an empty path falls back to an emissive gold sphere (~0.6 m).
 * The file pivot is at the base; the child is offset so bob/spin turn
 * around the visual center.
 */
import {
  engine, Entity, Transform, GltfContainer, LightSource, MeshRenderer, Material, Billboard, BillboardMode,
  MaterialTransparencyMode, AudioSource, ParticleSystem,
  PBParticleSystem_BlendMode, PBParticleSystem_SimulationSpace,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { STAR_FALL_HEIGHT, STAR_FALL_MS, STAR_ORB_DIAMETER } from '../shared/pvp'

export const STAR_MODEL = 'assets/models/star.glb'
/** Native size of star.glb (metres, glTF Y-up): 1.00 wide, 0.97 tall, 0.38 thick. */
const STAR_MODEL_CENTER_Y = 0.483978
/** Native height is already ~0.97 m, inside the 0.8-1 m target, so leave scale at 1. */
const STAR_MODEL_SCALE = 1

// Flagtag idle flag (flagSystem.ts): bob 0.15 m at speed 2, spin 25 deg/s on Y only.
const IDLE_BOB_AMPLITUDE = 0.15
const IDLE_BOB_SPEED = 2
const IDLE_ROT_SPEED_DEG_PER_SEC = 25
const GOLD = Color3.create(1, 0.78, 0.2)
const GOLD4 = Color4.create(1, 0.82, 0.25, 1)
// Small short yellow beacon, same textures as the Base Charge pillar, tinted #FFE04A.
// The alpha/gradient textures fade at both ends. Height is 25% taller than 5.4 m.
const BEACON_COLOR = { r: 255 / 255, g: 224 / 255, b: 74 / 255 }
const BEACON_H = 6.75
const BEACON_BASE_Y = 0.25
const BEACON_Y = BEACON_BASE_Y + BEACON_H / 2
const BEACON_INNER_W = 0.28
const BEACON_OUTER_W = 0.95
const BEACON_INNER_A = 0.7
const BEACON_OUTER_A = 0.35
const BEACON_EMISSIVE_IN = 0.55
const BEACON_EMISSIVE_OUT = 0.28
const BEACON_PULSE_SPEED = 2.5
const BEACON_PULSE_RANGE = 0.15
const GRADIENT_TEX = 'assets/images/star-beacon-gradient.png'
const ALPHA_TEX = 'assets/images/star-beacon-alpha.png'
export const STAR_IDLE_SRC = 'assets/sounds/star-idle.mp3'
const STAR_IDLE_VOL = 1

type Rec = {
  root: Entity
  spin: Entity
  inner: Entity | null
  outer: Entity | null
  parts: Entity[]
  baseY: number
  clock: number
  /** Seconds of drop still to play. 0 once it has landed. */
  fallLeft: number
  fallDur: number
  landed: boolean
  tail: Entity | null
  /** clock time after which a stopped tail is removed. 0 while it is still emitting. */
  tailStop: number
}
const orbs = new Map<number, Rec>()
let wired = false

export function hasStarOrbs(): boolean { return orbs.size > 0 }

function stopIdle(rec: Rec): void {
  for (const e of rec.parts) {
    const src = AudioSource.getMutableOrNull(e)
    if (src) src.playing = false
  }
}

function removeRec(rec: Rec): void {
  stopIdle(rec)
  for (const e of rec.parts) {
    try { engine.removeEntity(e) } catch (err) { /* already gone */ }
  }
  try { engine.removeEntity(rec.root) } catch (err) { /* already gone */ }
}

export function hideStarOrb(i: number): void {
  const rec = orbs.get(i)
  if (!rec) return
  removeRec(rec)
  orbs.delete(i)
}

export function clearStarOrbs(): void {
  for (const rec of orbs.values()) removeRec(rec)
  orbs.clear()
}

function beaconMat(inner: boolean) {
  const c = BEACON_COLOR
  const a = inner ? BEACON_INNER_A : BEACON_OUTER_A
  return {
    texture: Material.Texture.Common({ src: GRADIENT_TEX }),
    alphaTexture: Material.Texture.Common({ src: ALPHA_TEX }),
    albedoColor: Color4.create(c.r, c.g, c.b, a),
    emissiveColor: Color3.create(c.r, c.g, c.b),
    emissiveIntensity: inner ? BEACON_EMISSIVE_IN : BEACON_EMISSIVE_OUT,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  }
}

function makeBeacon(parent: Entity, inner: boolean): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, {
    parent,
    position: Vector3.create(0, BEACON_Y, 0),
    scale: Vector3.create(inner ? BEACON_INNER_W : BEACON_OUTER_W, BEACON_H, 1),
  })
  MeshRenderer.setPlane(ent)
  Billboard.create(ent, { billboardMode: BillboardMode.BM_Y })
  Material.setPbrMaterial(ent, beaconMat(inner))
  return ent
}

function fallHeight(elapsed: number, dur: number): number {
  if (dur <= 0) return 0
  const u = Math.max(0, Math.min(1, elapsed / dur))
  // Ease-out quad: starts moving, then settles onto the tile. Paired with STAR_FALL_MS.
  const remain = 1 - u
  return STAR_FALL_HEIGHT * remain * remain
}

function makeTail(parent: Entity): Entity {
  const ent = engine.addEntity()
  Transform.create(ent, { parent, position: Vector3.create(0, 0.2, 0) })
  ParticleSystem.create(ent, {
    rate: 56,
    lifetime: 0.65,
    maxParticles: 70,
    gravity: 0,
    initialSize: { start: 0.16, end: 0.34 },
    sizeOverTime: { start: 1, end: 0.2 },
    initialVelocitySpeed: { start: 0.15, end: 0.7 },
    initialColor: {
      start: Color4.create(1, 0.97, 0.75, 1),
      end: Color4.create(1, 0.78, 0.25, 1),
    },
    colorOverTime: {
      start: Color4.create(1, 0.92, 0.45, 1),
      end: Color4.create(1, 0.45, 0.05, 0),
    },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.12 }),
    loop: true,
    billboard: true,
    blendMode: PBParticleSystem_BlendMode.PSB_ADD,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    texture: { src: 'assets/images/star_white.png' },
  })
  return ent
}

function startIdle(rec: Rec): void {
  if (rec.inner) return
  rec.inner = makeBeacon(rec.root, true)
  rec.outer = makeBeacon(rec.root, false)
  rec.parts.push(rec.inner, rec.outer)
  const hum = engine.addEntity()
  Transform.create(hum, { parent: rec.root })
  AudioSource.create(hum, {
    audioClipUrl: STAR_IDLE_SRC,
    playing: true,
    loop: true,
    volume: STAR_IDLE_VOL,
    global: false,
  })
  rec.parts.push(hum)
}

function landStar(rec: Rec): void {
  rec.landed = true
  rec.fallLeft = 0
  rec.clock = 0
  const t = Transform.getMutableOrNull(rec.root)
  if (t) t.position = Vector3.create(t.position.x, rec.baseY, t.position.z)
  const s = Transform.getMutableOrNull(rec.spin)
  if (s) s.rotation = Quaternion.Zero()
  startIdle(rec)
  if (rec.tail) {
    const ps = ParticleSystem.getMutableOrNull(rec.tail)
    if (ps) ps.active = false
    rec.tailStop = 0.8
  }
}

export function showStarOrb(i: number, x: number, y: number, z: number, fallMs = 0): void {
  hideStarOrb(i)
  const dur = STAR_FALL_MS / 1000
  const left = Math.max(0, Math.min(dur, Math.max(0, fallMs) / 1000))
  const falling = left > 0.05
  const elapsed = falling ? Math.max(0, dur - left) : dur
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(x, y + (falling ? fallHeight(elapsed, dur) : 0), z),
    scale: Vector3.One(),
    rotation: Quaternion.Zero(),
  })
  const parts: Entity[] = []
  const spin = engine.addEntity()
  Transform.create(spin, { parent: root })
  parts.push(spin)
  const body = engine.addEntity()
  if (STAR_MODEL) {
    const s = STAR_MODEL_SCALE
    Transform.create(body, {
      parent: spin,
      position: Vector3.create(0, -STAR_MODEL_CENTER_Y * s, 0),
      scale: Vector3.create(s, s, s),
    })
    GltfContainer.create(body, { src: STAR_MODEL })
  } else {
    const s = STAR_ORB_DIAMETER
    Transform.create(body, { parent: spin, scale: Vector3.create(s, s, s) })
    MeshRenderer.setSphere(body)
    Material.setPbrMaterial(body, {
      albedoColor: GOLD4,
      emissiveColor: Color4.create(1, 0.85, 0.3, 1),
      emissiveIntensity: 6,
      roughness: 0.25,
      metallic: 0.15,
    })
  }
  parts.push(body)
  const light = engine.addEntity()
  Transform.create(light, { parent: spin })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: GOLD, intensity: 120, range: 8 })
  parts.push(light)
  const tail = falling ? makeTail(root) : null
  if (tail) parts.push(tail)
  const rec: Rec = {
    root, spin, inner: null, outer: null, parts, baseY: y,
    clock: falling ? elapsed : 0,
    fallLeft: falling ? left : 0,
    fallDur: dur,
    landed: !falling,
    tail,
    tailStop: 0,
  }
  if (!falling) startIdle(rec)
  orbs.set(i, rec)
}

export function initStarOrbs(): void {
  if (wired) return
  wired = true
  engine.addSystem((dt) => {
    for (const rec of orbs.values()) {
      rec.clock += dt
      if (rec.tail && rec.tailStop > 0 && rec.clock >= rec.tailStop) {
        try { engine.removeEntity(rec.tail) } catch (err) { /* already gone */ }
        rec.tail = null
        rec.tailStop = 0
      }
      if (!rec.landed) {
        rec.fallLeft -= dt
        const elapsed = rec.fallDur - Math.max(0, rec.fallLeft)
        const t = Transform.getMutableOrNull(rec.root)
        if (t) t.position = Vector3.create(t.position.x, rec.baseY + fallHeight(elapsed, rec.fallDur), t.position.z)
        if (rec.fallLeft <= 0) landStar(rec)
        continue
      }
      const t = Transform.getMutableOrNull(rec.root)
      if (t) {
        t.position = Vector3.create(t.position.x, rec.baseY + Math.sin(rec.clock * IDLE_BOB_SPEED) * IDLE_BOB_AMPLITUDE, t.position.z)
      }
      const s = Transform.getMutableOrNull(rec.spin)
      if (s) s.rotation = Quaternion.fromEulerDegrees(0, (rec.clock * IDLE_ROT_SPEED_DEG_PER_SEC) % 360, 0)
      const pulse = 1 + BEACON_PULSE_RANGE * Math.sin(rec.clock * BEACON_PULSE_SPEED)
      const innerT = rec.inner ? Transform.getMutableOrNull(rec.inner) : null
      const outerT = rec.outer ? Transform.getMutableOrNull(rec.outer) : null
      if (innerT) innerT.scale = Vector3.create(BEACON_INNER_W * pulse, BEACON_H, 1)
      if (outerT) outerT.scale = Vector3.create(BEACON_OUTER_W * (2 - pulse), BEACON_H, 1)
    }
  })
}
