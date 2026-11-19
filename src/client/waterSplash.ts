/**
 * Fall-in splash: a short droplet burst on the live swell, plus the splash sound slot.
 * Sized to read from the usual 70–90 m overview, cheap (pooled planes),
 * and shared with every client that already hears rescue:start.
 */
import {
  Billboard, BillboardMode, engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { swellSurfaceY } from '../shared/swell'
import { LOOK } from '../shared/waterLook'
import { playSplashSfx } from './audio'
import { waterVisualSeconds } from './water'

const DROP_POOL = 48
const DROP_COUNT = 12
const DROP_LIFE_S = 0.9
const DROP_GRAVITY = 22
const HIDDEN_Y = -200

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

const drops: Drop[] = []
let installed = false

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

function takeDrop(): Drop | null {
  for (const d of drops) if (!d.busy) return d
  let oldest = drops[0]
  for (const d of drops) if (d.t > oldest.t) oldest = d
  return oldest ?? null
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
  // Same clock as the visible swell meshes, re-sampled every frame so the
  // droplets ride the waves instead of sitting at the catch height.
  const seconds = waterVisualSeconds()
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
    const y = swellSurfaceY(sx, sz, seconds) + midY
    const fade = midY < 1.2 ? Math.max(0, midY / 1.2) : 1 - u * 0.35
    const tr = Transform.getMutable(d.ent)
    const size = d.size * (0.85 + 0.15 * (1 - u))
    tr.position.x = sx
    tr.position.y = y
    tr.position.z = sz
    tr.scale.x = size
    tr.scale.y = size
    tr.scale.z = size
    Material.setPbrMaterial(d.ent, dropMat(Math.max(0, fade)))
  }
}

/** Droplets at the live surface under a catch, plus the splash sound slot. */
export function playWaterSplash(x: number, z: number, forFaller: boolean): void {
  if (!LOOK.sea || !Number.isFinite(x) || !Number.isFinite(z)) return
  if (!installed) initWaterSplash()
  const y = surfaceY(x, z)
  playSplashSfx({ x, y, z }, forFaller)
  startDrops(x, z)
}

export function initWaterSplash(): void {
  if (installed) return
  installed = true
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
