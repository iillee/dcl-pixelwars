/**
 * Sea under the sky arena. Tunables live in shared/waterLook.ts.
 *
 * Swells are morph-target meshes (`wave` clip): a dense centre, a coarser
 * middle ring and a far ring whose crests ease to nothing. The flat rim
 * beyond that is the same blue and fades to the sky colour, with a short
 * soft veil at the horizon. Mobile keeps one coarse mesh and a larger flat
 * rim. No collider and no splash trigger.
 *
 * EnvironmentFog has no start distance, so it stays off. A density high
 * enough to hide the parcel edge would also sit on the arena.
 */
import {
  engine, Entity, Animator, GltfContainer, GltfNodeModifiers, Material, MaterialTransparencyMode, MeshRenderer,
  TextureFilterMode, TextureWrapMode, Transform, Tween, EasingFunction, TweenSequence, TweenLoop,
} from '@dcl/sdk/ecs'
import { EnvironmentFog } from '../shared/environmentFog'
import { Color3, Color4, Quaternion, Vector2, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { FOAM, HAZE_COLOR, LOOK, RIM_COLOR, SURFACE, SWELL_VARIANT, WATER, WATER_COLOR, WATER_FOG, resolvedWaterSize, resolvedWaterY, swellMesh } from '../shared/waterLook'
import { liveSwell } from '../shared/swell'
import { initFoam, setFoamSeconds } from './foam'

const swellClips: Entity[] = []
let clipSeconds = 0

/** Clip time the swell meshes are actually showing. Fall checks use this so a crest you can see still counts. */
export function waterVisualSeconds(): number {
  return clipSeconds
}

/** The clip starts at 0 and stays at speed 1. Chasing the wall clock made the swells lurch. */
function trackSwell(dt: number): void {
  const period = liveSwell().periodS
  clipSeconds = (clipSeconds + dt) % period
  if (FOAM.rings || FOAM.whitecaps) setFoamSeconds(clipSeconds)
}

export function initWater(): void {
  const rescueY = MIN_Y - FALL_RESPAWN_DROP
  const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  const size = resolvedWaterSize(SCENE_SIZE)
  const mid = SCENE_SIZE / 2
  // Mean y 114 is above the fixed line at 112.5 on purpose (crests are higher).
  // The old guard returned here and spawned nothing, so the preview showed only sky.

  if (WATER_FOG.environment && WATER_FOG.density > 0) {
    EnvironmentFog.create(engine.RootEntity, {
      color: { keys: [{ time: 0, color: Color4.create(WATER_FOG.color.r, WATER_FOG.color.g, WATER_FOG.color.b, 1) }] },
      density: WATER_FOG.density,
    })
  }

  const root = engine.addEntity()
  const at = Vector3.create(mid, y, mid)
  Transform.create(root, { position: at })
  if (WATER.swellM > 0) {
    const up = Vector3.create(mid, y + WATER.swellM, mid)
    const swell = Math.max(0.5, WATER.swellSeconds)
    Tween.create(root, {
      duration: swell,
      easingFunction: EasingFunction.EF_EASESINE,
      mode: Tween.Mode.Move({ start: at, end: up }),
    })
    TweenSequence.create(root, {
      sequence: [{
        duration: swell,
        easingFunction: EasingFunction.EF_EASESINE,
        mode: Tween.Mode.Move({ start: up, end: at }),
      }],
      loop: TweenLoop.TL_RESTART,
    })
  }

  const mobileNow = isMobile()
  const desktop: Entity[] = []
  const foamOn = (mobile: boolean) => SURFACE.foam && (!mobile || SURFACE.mobileFoam)
  if (mobileNow) {
    addSwell(root, swellMesh('lite'), true)
    if (foamOn(true)) addFoam(root, swellMesh('lite'))
    addFlat(root, WATER.flatLiteSrc)
  } else {
    for (const part of ['near', 'mid', 'far'] as const) {
      desktop.push(addSwell(root, swellMesh(part), part !== 'far'))
      if (foamOn(false)) desktop.push(addFoam(root, swellMesh(part)))
    }
    desktop.push(addFlat(root, WATER.flatSrc))
    watchMobile(root, desktop)
  }
  if (LOOK.depth) addDepth(root)
  if (WATER_FOG.skirt) addSkirt(y, size)
  if (WATER_FOG.mist) addMist(root, size)
  if (WATER_FOG.haze) addHaze()
  if (FOAM.rings || FOAM.whitecaps) initFoam()
  clipSeconds = 0
  engine.addSystem(trackSwell)

  const spec = liveSwell()
  const weights = spec.parts.map((p) => p.weight.toFixed(2)).join('/')
  const crest = y + spec.amplitudeM + Math.max(0, WATER.swellM)
  console.log(`[Water] variant=${SWELL_VARIANT} root world x=${mid.toFixed(1)} y=${y.toFixed(2)} z=${mid.toFixed(1)} scale=1 parent=none mesh=${swellMesh('near')} crest≈${crest.toFixed(1)} rescue=${rescueY.toFixed(2)} period=${spec.periodS}s speed=1 trains=${weights} gloss=${LOOK.gloss} softNormal=${LOOK.softNormal} depth=${LOOK.depth} haze=on`)
}

/** Base-texture scroll. ADR-255 moves the normal map with this offset; the bump's own offset is ignored. */
function scrollTexture(ent: Entity, x: number, z: number, speed: number): void {
  const len = Math.hypot(x, z) || 1
  Tween.setTextureMoveContinuous(ent, Vector2.create(x / len, z / len), speed)
}

function repeatTex(src: string, tiling = 1) {
  return Material.Texture.Common({
    src,
    wrapMode: TextureWrapMode.TWM_REPEAT,
    filterMode: TextureFilterMode.TFM_TRILINEAR,
    tiling: Vector2.create(tiling, tiling),
  })
}

function swellShade(c: { r: number; g: number; b: number; a: number }, wet: boolean) {
  const clear = wet && LOOK.depth
  const gloss = LOOK.gloss
  const hi = LOOK.glossReflectivity
  const shade = {
    albedoColor: Color4.create(c.r, c.g, c.b, clear ? LOOK.depthAlpha : c.a),
    metallic: WATER.metallic,
    roughness: gloss ? LOOK.glossRoughness : WATER.roughness,
    specularIntensity: gloss ? LOOK.glossSpecular : WATER.specular,
    reflectivityColor: gloss ? Color3.create(hi.r, hi.g, hi.b) : Color3.create(c.r, c.g, c.b),
    transparencyMode: clear ? MaterialTransparencyMode.MTM_ALPHA_BLEND : MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false as const,
  }
  // No map unless this mesh is inside the far ring. A sampled texture would
  // show the baked metre grid; the far ring and the rim stay a plain color.
  if (!(wet && LOOK.softNormal)) return shade
  return {
    ...shade,
    texture: repeatTex(SURFACE.albedoSrc),
    bumpTexture: Material.Texture.Common({
      src: LOOK.softNormalSrc,
      wrapMode: TextureWrapMode.TWM_REPEAT,
      filterMode: TextureFilterMode.TFM_TRILINEAR,
    }),
  }
}

function foamShade() {
  return {
    texture: repeatTex(SURFACE.foamSrc, SURFACE.foamTile),
    albedoColor: Color4.create(1, 1, 1, SURFACE.foamAlpha),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false as const,
  }
}

function addSwell(root: Entity, src: string, wet: boolean): Entity {
  const wave = engine.addEntity()
  Transform.create(wave, {
    parent: root,
    position: Vector3.Zero(),
    scale: Vector3.One(),
  })
  GltfContainer.create(wave, {
    src,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  Animator.create(wave, {
    states: [{
      clip: 'wave',
      playing: true,
      loop: true,
      speed: 1,
      weight: 1,
    }],
  })
  swellClips.push(wave)
  const c = WATER_COLOR
  GltfNodeModifiers.create(wave, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: swellShade(c, wet),
        },
      },
    }],
  })
  if (wet && LOOK.softNormal) scrollTexture(wave, LOOK.softNormalDirX, LOOK.softNormalDirZ, LOOK.softNormalSpeed)
  return wave
}

/** Opaque deep blue a few metres under the trough. Near and mid are see-through onto it. */
function addDepth(root: Entity): void {
  const spec = liveSwell()
  const bed = engine.addEntity()
  const span = WATER.swellMidM * 2
  Transform.create(bed, {
    parent: root,
    position: Vector3.create(0, -(spec.amplitudeM + LOOK.depthBelowTroughM), 0),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(span, span, 1),
  })
  MeshRenderer.setPlane(bed)
  const c = LOOK.depthColor
  Material.setPbrMaterial(bed, {
    albedoColor: Color4.create(c.r, c.g, c.b, 1),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false,
  })
}

/** Same morph clip as the swell, a little higher, so the foam stays on the surface. */
function addFoam(root: Entity, src: string): Entity {
  const veil = engine.addEntity()
  Transform.create(veil, {
    parent: root,
    position: Vector3.create(0, SURFACE.foamLiftM, 0),
    scale: Vector3.One(),
  })
  GltfContainer.create(veil, {
    src,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  Animator.create(veil, {
    states: [{
      clip: 'wave',
      playing: true,
      loop: true,
      speed: 1,
      weight: 1,
    }],
  })
  GltfNodeModifiers.create(veil, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: foamShade(),
        },
      },
    }],
  })
  scrollTexture(veil, SURFACE.foamDirX, SURFACE.foamDirZ, SURFACE.foamSpeed)
  return veil
}

function addFlat(root: Entity, src: string): Entity {
  const sea = engine.addEntity()
  Transform.create(sea, { parent: root, position: Vector3.Zero() })
  GltfContainer.create(sea, {
    src,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  GltfNodeModifiers.create(sea, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: {
            texture: Material.Texture.Common({ src: WATER_FOG.horizonSrc }),
            albedoColor: Color4.create(WATER_COLOR.r, WATER_COLOR.g, WATER_COLOR.b, 1),
            emissiveTexture: Material.Texture.Common({ src: WATER_FOG.horizonGlowSrc }),
            emissiveColor: Color3.create(RIM_COLOR.r, RIM_COLOR.g, RIM_COLOR.b),
            emissiveIntensity: 1,
            metallic: WATER.metallic,
            roughness: WATER.roughness,
            specularIntensity: WATER.specular,
            reflectivityColor: Color3.create(WATER_COLOR.r, WATER_COLOR.g, WATER_COLOR.b),
            transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
            castShadows: false,
          },
        },
      },
    }],
  })
  return sea
}

/** One inward ring. Scale carries the radius and the height; the mesh is the unit circle. */
function addHaze(): void {
  const mid = SCENE_SIZE / 2
  const bottom = WATER_FOG.hazeBottomY
  const height = Math.max(1, WATER_FOG.hazeTopY - bottom)
  const ring = engine.addEntity()
  Transform.create(ring, {
    position: Vector3.create(mid, bottom, mid),
    scale: Vector3.create(WATER_FOG.hazeRadiusM, height, WATER_FOG.hazeRadiusM),
  })
  GltfContainer.create(ring, {
    src: WATER_FOG.hazeSrc,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  const c = HAZE_COLOR
  GltfNodeModifiers.create(ring, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: {
            texture: Material.Texture.Common({ src: WATER_FOG.hazeMask }),
            albedoColor: Color4.create(c.r, c.g, c.b, c.a),
            emissiveTexture: Material.Texture.Common({ src: WATER_FOG.hazeMask }),
            emissiveColor: Color3.create(c.r, c.g, c.b),
            emissiveIntensity: 0.65,
            roughness: 1,
            metallic: 0,
            specularIntensity: 0,
            transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
            castShadows: false,
          },
        },
      },
    }],
  })
}

function addMist(root: Entity, size: number): void {
  const mist = engine.addEntity()
  Transform.create(mist, {
    parent: root,
    position: Vector3.create(0, WATER_FOG.mistAboveM, 0),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(size, size, 1),
  })
  MeshRenderer.setPlane(mist)
  const c = WATER_FOG.mistColor
  Material.setPbrMaterial(mist, {
    albedoColor: Color4.create(c.r, c.g, c.b, c.a),
    roughness: 1,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

/** Four cards just inside the parcel edge. The gradient fades them into the sky. */
function addSkirt(waterY: number, size: number): void {
  const h = WATER_FOG.skirtHeightM
  const y = waterY + h / 2
  const mid = SCENE_SIZE / 2
  const inset = 3
  const edges: Array<{ x: number; z: number; yaw: number }> = [
    { x: mid, z: inset, yaw: 0 },
    { x: mid, z: SCENE_SIZE - inset, yaw: 180 },
    { x: inset, z: mid, yaw: 90 },
    { x: SCENE_SIZE - inset, z: mid, yaw: -90 },
  ]
  for (const edge of edges) {
    const card = engine.addEntity()
    Transform.create(card, {
      position: Vector3.create(edge.x, y, edge.z),
      rotation: Quaternion.fromEulerDegrees(0, edge.yaw, 0),
      scale: Vector3.create(SCENE_SIZE - 8, h, 1),
    })
    MeshRenderer.setPlane(card)
    Material.setPbrMaterial(card, {
      texture: Material.Texture.Common({ src: WATER_FOG.skirtSrc }),
      albedoColor: Color4.create(1, 1, 1, 1),
      roughness: 1,
      metallic: 0,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false,
      emissiveColor: Color3.create(0.45, 0.62, 0.75),
      emissiveIntensity: 0.35,
    })
  }
}

function watchMobile(root: Entity, desktop: Entity[]): void {
  let age = 0
  let swapped = false
  function tick(dt: number): void {
    age += dt
    if (!isMobile()) {
      if (age > 5) engine.removeSystem(tick)
      return
    }
    if (!swapped) {
      swapped = true
      for (const e of desktop) engine.removeEntity(e)
      swellClips.length = 0
      clipSeconds = 0
      addSwell(root, swellMesh('lite'), true)
      addFlat(root, WATER.flatLiteSrc)
    }
    engine.removeSystem(tick)
  }
  engine.addSystem(tick)
}
