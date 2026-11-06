/**
 * Parked sticker foam. `FOAM.rings` and `FOAM.whitecaps` are off: the
 * alpha-tested rings and crest blobs read as decals. Surface ripples and
 * the soft foam sheet live on the swell meshes in water.ts.
 */
import {
  engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, TextureWrapMode, Transform,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { CELL, MAZE_ORIGIN, MIN_Y, ROT_OFFSET, SCENE_SIZE, getPlacedTilesInOrder } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { FOAM, resolvedWaterY } from '../shared/waterLook'
import { liveSwell, swellAngle, swellSurfaceY } from '../shared/swell'

let shownSeconds = 0

/** Called from the swell clock so foam uses the same phase as the meshes. */
export function setFoamSeconds(seconds: number): void {
  shownSeconds = seconds
}

/** Column centre in the tile's unrotated, scaled space. Footprint is 20 m. */
const PILLAR_LOCAL_X = -16
const PILLAR_LOCAL_Z = 16

type Ring = { ent: Entity; x: number; z: number }

let rings: Ring[] = []
let signature = ''
let spin = 0

type Cap = { ent: Entity }
const caps: Cap[] = []
let loggedCaps = false

function yawOffset(r: number, x: number, z: number): [number, number] {
  switch (((r % 4) + 4) % 4) {
    case 1: return [z, -x]
    case 2: return [-x, -z]
    case 3: return [-z, x]
    default: return [x, z]
  }
}

function pillarAt(p: { x: number; z: number; r: number }): { x: number; z: number } {
  const [dx, dz] = ROT_OFFSET[p.r]
  const [ox, oz] = yawOffset(p.r, PILLAR_LOCAL_X, PILLAR_LOCAL_Z)
  return {
    x: p.x * CELL + dx + MAZE_ORIGIN + ox,
    z: p.z * CELL + dz + MAZE_ORIGIN + oz,
  }
}

function paintFoam(ent: Entity, src: string): void {
  Material.setPbrMaterial(ent, {
    texture: Material.Texture.Common({
      src,
      wrapMode: TextureWrapMode.TWM_CLAMP,
    }),
    albedoColor: Color4.create(1, 1, 1, 1),
    emissiveColor: Color3.create(1, 1, 1),
    emissiveIntensity: 1.8,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_TEST,
    alphaTest: 0.35,
    castShadows: false,
  })
}

function spawnRings(): void {
  for (const ring of rings) engine.removeEntity(ring.ent)
  rings = []
  const tiles = getPlacedTilesInOrder()
  if (!tiles.length) return
  const centre = tiles.map(pillarAt).map((at) => ({ ...at, d: 0 }))
  const sceneMid = SCENE_SIZE / 2
  for (const c of centre) c.d = Math.hypot(c.x - sceneMid, c.z - sceneMid)
  centre.sort((a, b) => a.d - b.d)
  const cap = Math.min(FOAM.maxRings, isMobile() ? FOAM.mobileMax : centre.length)
  const seconds = shownSeconds
  for (let n = 0; n < cap; n++) {
    const at = centre[n]
    const y = swellSurfaceY(at.x, at.z, seconds) + FOAM.ringLiftM
    const ent = engine.addEntity()
    Transform.create(ent, {
      position: Vector3.create(at.x, y, at.z),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(FOAM.ringSizeM, FOAM.ringSizeM, 1),
    })
    MeshRenderer.setPlane(ent)
    paintFoam(ent, FOAM.ringSrc)
    rings.push({ ent, x: at.x, z: at.z })
  }
  signature = tiles.map((t) => `${t.x},${t.z},${t.r}`).join('|')
  const first = Transform.get(rings[0].ent).position
  console.log(`[Foam] rings ${rings.length}${isMobile() ? ' mobile' : ''} first world x=${first.x.toFixed(1)} y=${first.y.toFixed(1)} z=${first.z.toFixed(1)}`)
}

function spawnWhitecaps(): void {
  const n = Math.min(FOAM.whitecapCount, isMobile() ? 10 : FOAM.whitecapCount)
  for (let i = 0; i < n; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, {
      position: Vector3.create(SCENE_SIZE / 2, resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP), SCENE_SIZE / 2),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(FOAM.whitecapSizeM, FOAM.whitecapThickM, 1),
    })
    MeshRenderer.setPlane(ent)
    paintFoam(ent, FOAM.whitecapSrc)
    caps.push({ ent })
  }
}

/** Broken patches along the dominant crest. The two smaller trains stay out of this. */
function placeWhitecaps(seconds: number): void {
  if (!caps.length) return
  const part = liveSwell().parts[0]
  const spacing = (Math.PI * 2) / part.k
  const base = (Math.PI / 2 - part.phase - swellAngle(seconds)) / part.k
  const n0 = Math.round(-base / spacing)
  const lines = [n0, n0 + 1]
  const mid = SCENE_SIZE / 2
  const acrossX = -part.dz
  const acrossZ = part.dx
  const yaw = (Math.atan2(-acrossZ, acrossX) * 180) / Math.PI
  const perLine = Math.ceil(caps.length / lines.length)
  let i = 0
  for (const n of lines) {
    const along = base + n * spacing
    for (let s = 0; s < perLine && i < caps.length; s++, i++) {
      const slot = s - (perLine - 1) / 2
      const jitter = ((s * 13) % 7) - 3
      const across = slot * 48 + jitter * 4
      const lx = along * part.dx + across * acrossX
      const lz = along * part.dz + across * acrossZ
      const x = mid + lx
      const z = mid + lz
      const y = swellSurfaceY(x, z, seconds) + FOAM.whitecapLiftM
      const tr = Transform.getMutable(caps[i].ent)
      tr.position = Vector3.create(x, y, z)
      tr.rotation = Quaternion.fromEulerDegrees(90, yaw + jitter * 4, 0)
      const pulse = 1 + (((s * 5 + n) % 3) - 1) * 0.08
      tr.scale.x = FOAM.whitecapSizeM * pulse
      tr.scale.y = FOAM.whitecapThickM * (0.85 + ((s * 3) % 4) * 0.08)
    }
  }
  if (!loggedCaps) {
    loggedCaps = true
    const p = Transform.get(caps[0].ent).position
    console.log(`[Foam] whitecaps ${caps.length} first world x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} z=${p.z.toFixed(1)}`)
  }
}

function tick(dt: number): void {
  const seconds = shownSeconds
  if (FOAM.rings) {
    const tiles = getPlacedTilesInOrder()
    const next = tiles.map((t) => `${t.x},${t.z},${t.r}`).join('|')
    if (next !== signature) spawnRings()
    if (rings.length) {
      spin += dt * FOAM.spinDegPerSec
      const mean = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
      const amp = liveSwell().amplitudeM
      for (const ring of rings) {
        const surface = swellSurfaceY(ring.x, ring.z, seconds)
        const crest = Math.max(0, Math.min(1, (surface - mean) / amp))
        const tr = Transform.getMutable(ring.ent)
        tr.position.y = surface + FOAM.ringLiftM + crest * 0.4
        tr.rotation = Quaternion.fromEulerDegrees(90, spin, 0)
      }
    }
  }
  if (FOAM.whitecaps) placeWhitecaps(seconds)
}

export function initFoam(): void {
  if (FOAM.whitecaps) {
    spawnWhitecaps()
    placeWhitecaps(shownSeconds)
  }
  console.log(`[Foam] startup rings waiting=${FOAM.rings} whitecaps=${caps.length} lift=${FOAM.ringLiftM}m`)
  engine.addSystem(tick)
}
