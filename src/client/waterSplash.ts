/**
 * Fall-in splash: a ripple on the live swell plus a short droplet burst.
 * Sized to read from the usual 70–90 m overview, cheap (pooled planes),
 * and shared with every client that already hears rescue:start.
 */
import {
  Billboard, BillboardMode, engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { swellSurfaceY } from '../shared/swell'
import { FOAM, LOOK } from '../shared/waterLook'
import { playSplashSfx } from './audio'
import { waterVisualSeconds } from './water'

const RING_POOL = 8
const RING_COUNT = 2
const RING_LIFE_S = 0.85
const RING_START_M = [5, 7]
const RING_END_M = [22, 28]
const RING_LIFT_M = 0.25
const DROP_POOL = 48
const DROP_COUNT = 12
const DROP_LIFE_S = 0.9
const DROP_GRAVITY = 22
const HIDDEN_Y = -200

type Ring = {
  ent: Entity
  busy: boolean
  t: number
  life: number
  x: number
  z: number
  start: number
  end: number
}

type Drop = {
  ent: Entity
  busy: boolean
  t: number
  life: number
  x: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
}

const rings: Ring[] = []
const drops: Drop[] = []
let installed = false

function ringMat(alpha: number) {
  return {
    texture: Material.Texture.Common({ src: FOAM.ringSrc }),
    albedoColor: Color4.create(1, 1, 1, alpha),
    emissiveColor: Color3.create(0.92, 0.97, 1),
    emissiveIntensity: 1.4,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  }
}

function dropMat(alpha: number) {
  return {
    albedoColor: Color4.create(0.92, 0.97, 1, alpha),
    emissiveColor: Color3.create(0.92, 0.97, 1),
    emissiveIntensity: 1.6,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  }
}

function park(ent: Entity): void {
  const tr = Transform.getMutableOrNull(ent)
  if (!tr) return
  tr.position = Vector3.create(0, HIDDEN_Y, 0)
  tr.scale = Vector3.create(0.001, 0.001, 0.001)
}

function surfaceY(x: number, z: number): number {
  return swellSurfaceY(x, z, waterVisualSeconds())
}

function takeRing(): Ring | null {
  for (const r of rings) if (!r.busy) return r
  let oldest = rings[0]
  for (const r of rings) if (r.t > oldest.t) oldest = r
  return oldest ?? null
}

function takeDrop(): Drop | null {
  for (const d of drops) if (!d.busy) return d
  let oldest = drops[0]
  for (const d of drops) if (d.t > oldest.t) oldest = d
  return oldest ?? null
}

function startRings(x: number, z: number): void {
  for (let i = 0; i < RING_COUNT; i++) {
    const r = takeRing()
    if (!r) return
    r.busy = true
    r.t = 0
    r.life = RING_LIFE_S
    r.x = x
    r.z = z
    r.start = RING_START_M[i]
    r.end = RING_END_M[i]
    const y = surfaceY(x, z) + RING_LIFT_M
    Transform.createOrReplace(r.ent, {
      position: Vector3.create(x, y, z),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(r.start, r.start, 1),
    })
    Material.setPbrMaterial(r.ent, ringMat(0.95))
  }
}

function startDrops(x: number, z: number): void {
  const y0 = surfaceY(x, z)
  for (let i = 0; i < DROP_COUNT; i++) {
    const d = takeDrop()
    if (!d) return
    const ang = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 8
    d.busy = true
    d.t = 0
    d.life = DROP_LIFE_S * (0.85 + Math.random() * 0.2)
    d.x = x
    d.z = z
    d.vx = Math.cos(ang) * speed
    d.vz = Math.sin(ang) * speed
    d.vy = 16 + Math.random() * 10
    d.size = 2 + Math.random() * 1.6
    Transform.createOrReplace(d.ent, {
      position: Vector3.create(x, y0 + 0.4, z),
      scale: Vector3.create(d.size, d.size, d.size),
    })
    Material.setPbrMaterial(d.ent, dropMat(1))
  }
}

function tick(dt: number): void {
  const step = Math.min(dt, 0.1)
  for (const r of rings) {
    if (!r.busy) continue
    r.t += step
    if (r.t >= r.life) {
      r.busy = false
      park(r.ent)
      continue
    }
    const u = r.t / r.life
    const s = r.start + (r.end - r.start) * u
    const y = surfaceY(r.x, r.z) + RING_LIFT_M
    const tr = Transform.getMutable(r.ent)
    tr.position = Vector3.create(r.x, y, r.z)
    tr.scale = Vector3.create(s, s, 1)
    Material.setPbrMaterial(r.ent, ringMat((1 - u) * (1 - u) * 0.95))
  }
  for (const d of drops) {
    if (!d.busy) continue
    d.t += step
    const midY = d.vy * d.t - 0.5 * DROP_GRAVITY * d.t * d.t
    if (d.t >= d.life || midY < 0) {
      d.busy = false
      park(d.ent)
      continue
    }
    const u = d.t / d.life
    const sx = d.x + d.vx * d.t
    const sz = d.z + d.vz * d.t
    const y = surfaceY(sx, sz) + midY
    const fade = midY < 1.2 ? Math.max(0, midY / 1.2) : 1 - u * 0.35
    const tr = Transform.getMutable(d.ent)
    const size = d.size * (0.85 + 0.15 * (1 - u))
    tr.position = Vector3.create(sx, y, sz)
    tr.scale = Vector3.create(size, size, size)
    Material.setPbrMaterial(d.ent, dropMat(Math.max(0, fade)))
  }
}

/** Ripple + droplets at the live surface under a catch, plus the splash sound slot. */
export function playWaterSplash(x: number, z: number, forFaller: boolean): void {
  if (!LOOK.sea || !Number.isFinite(x) || !Number.isFinite(z)) return
  if (!installed) initWaterSplash()
  const y = surfaceY(x, z)
  playSplashSfx({ x, y, z }, forFaller)
  startRings(x, z)
  startDrops(x, z)
}

export function initWaterSplash(): void {
  if (installed) return
  installed = true
  for (let i = 0; i < RING_POOL; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: Vector3.create(0, HIDDEN_Y, 0), scale: Vector3.create(0.001, 0.001, 0.001) })
    MeshRenderer.setPlane(ent)
    Material.setPbrMaterial(ent, ringMat(0))
    park(ent)
    rings.push({ ent, busy: false, t: 0, life: RING_LIFE_S, x: 0, z: 0, start: RING_START_M[0], end: RING_END_M[0] })
  }
  for (let i = 0; i < DROP_POOL; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: Vector3.create(0, HIDDEN_Y, 0), scale: Vector3.create(0.001, 0.001, 0.001) })
    MeshRenderer.setPlane(ent)
    Billboard.create(ent, { billboardMode: BillboardMode.BM_ALL })
    Material.setPbrMaterial(ent, dropMat(0))
    park(ent)
    drops.push({ ent, busy: false, t: 0, life: DROP_LIFE_S, x: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 2 })
  }
  engine.addSystem(tick)
}
