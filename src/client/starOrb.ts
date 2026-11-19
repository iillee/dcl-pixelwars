/**
 * starOrb.ts — the star pickup visual. Swap STAR_MODEL to a GLB later;
 * an empty path falls back to an emissive gold sphere (~0.6 m).
 */
import { engine, Entity, Transform, GltfContainer, LightSource, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { STAR_ORB_DIAMETER } from '../shared/pvp'

/** Set this to 'assets/models/star.glb' when the star mesh is ready. */
export const STAR_MODEL = ''

const SPIN_Y = 1.15
const SPIN_X = 0.35
const BOB_SPEED = 2.2
const BOB_RANGE = 0.1
const GOLD = Color3.create(1, 0.78, 0.2)
const GOLD4 = Color4.create(1, 0.82, 0.25, 1)

type Rec = { root: Entity; parts: Entity[]; baseY: number; clock: number }
const orbs = new Map<number, Rec>()
let wired = false

export function hasStarOrbs(): boolean { return orbs.size > 0 }

function removeRec(rec: Rec): void {
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

export function showStarOrb(i: number, x: number, y: number, z: number): void {
  hideStarOrb(i)
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(x, y, z),
    scale: Vector3.One(),
    rotation: Quaternion.Zero(),
  })
  const parts: Entity[] = []
  const body = engine.addEntity()
  const s = STAR_ORB_DIAMETER
  Transform.create(body, { parent: root, scale: Vector3.create(s, s, s) })
  if (STAR_MODEL) {
    GltfContainer.create(body, { src: STAR_MODEL })
  } else {
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
  Transform.create(light, { parent: root })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: GOLD, intensity: 120, range: 8 })
  parts.push(light)
  orbs.set(i, { root, parts, baseY: y, clock: 0 })
}

export function initStarOrbs(): void {
  if (wired) return
  wired = true
  engine.addSystem((dt) => {
    for (const rec of orbs.values()) {
      rec.clock += dt
      const t = Transform.getMutableOrNull(rec.root)
      if (!t) continue
      t.position = Vector3.create(t.position.x, rec.baseY + Math.sin(rec.clock * BOB_SPEED) * BOB_RANGE, t.position.z)
      t.rotation = Quaternion.fromEulerDegrees(rec.clock * SPIN_X * 60, rec.clock * SPIN_Y * 60, 0)
    }
  })
}
