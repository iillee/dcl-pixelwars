/**
 * Foam rings on the columns. One decal per tile, lifted to the live swell
 * surface. Whitecaps on the swell itself are a crest-band texture in water.ts.
 */
import {
  engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, TextureWrapMode, Transform, Tween,
  TextureMovementType,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector2, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { CELL, MAZE_ORIGIN, ROT_OFFSET, getPlacedTilesInOrder } from '../maze/generator'
import { MIN_Y } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { FOAM, resolvedWaterY } from '../shared/waterLook'
import { liveSwell, swellSurfaceY } from '../shared/swell'

let shownSeconds = 0

/** Called from the swell clock so the rings use the same phase as the meshes. */
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

function paintRing(ent: Entity, alpha: number): void {
  Material.setPbrMaterial(ent, {
    texture: Material.Texture.Common({
      src: FOAM.ringSrc,
      wrapMode: TextureWrapMode.TWM_CLAMP,
    }),
    albedoColor: Color4.create(0.9, 0.95, 1, alpha),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

function spawnRings(): void {
  for (const ring of rings) engine.removeEntity(ring.ent)
  rings = []
  const tiles = getPlacedTilesInOrder()
  if (!tiles.length) return
  const centre = tiles.map(pillarAt).map((at) => ({ ...at, d: 0 }))
  const sceneMid = MAZE_ORIGIN + 2.5 * CELL
  for (const c of centre) c.d = Math.hypot(c.x - sceneMid, c.z - sceneMid)
  centre.sort((a, b) => a.d - b.d)
  const cap = Math.min(FOAM.maxRings, isMobile() ? FOAM.mobileMax : centre.length)
  for (let n = 0; n < cap; n++) {
    const at = centre[n]
    const ent = engine.addEntity()
    Transform.create(ent, {
      position: Vector3.create(at.x, 0, at.z),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(FOAM.ringSizeM, FOAM.ringSizeM, 1),
    })
    MeshRenderer.setPlane(ent)
    paintRing(ent, FOAM.baseAlpha)
    Tween.setTextureMoveContinuous(ent, Vector2.create(FOAM.scrollPerSec, FOAM.scrollPerSec * 0.35), 1, TextureMovementType.TMT_OFFSET)
    rings.push({ ent, x: at.x, z: at.z })
  }
  signature = tiles.map((t) => `${t.x},${t.z},${t.r}`).join('|')
  console.log(`[Foam] rings ${rings.length}${isMobile() ? ' mobile' : ''}`)
}

function tick(dt: number): void {
  if (!FOAM.rings) return
  const tiles = getPlacedTilesInOrder()
  const next = tiles.map((t) => `${t.x},${t.z},${t.r}`).join('|')
  if (next !== signature) spawnRings()
  if (!rings.length) return
  spin += dt * FOAM.spinDegPerSec
  const seconds = shownSeconds
  const mean = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  const amp = liveSwell().amplitudeM
  const pulse = 1 + FOAM.pulse * Math.sin((seconds / FOAM.pulseSeconds) * Math.PI * 2)
  for (const ring of rings) {
    const surface = swellSurfaceY(ring.x, ring.z, seconds)
    const crest = Math.max(0, Math.min(1, (surface - mean) / amp))
    const tr = Transform.getMutable(ring.ent)
    tr.position.y = surface + FOAM.ringLiftM
    tr.rotation = Quaternion.fromEulerDegrees(90, spin, 0)
    tr.scale.x = FOAM.ringSizeM * pulse
    tr.scale.y = FOAM.ringSizeM * pulse
    paintRing(ring.ent, FOAM.baseAlpha + FOAM.crestBoost * crest)
  }
}

export function initFoam(): void {
  engine.addSystem(tick)
}
