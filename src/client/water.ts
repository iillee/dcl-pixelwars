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
  Transform, Tween, EasingFunction, TweenSequence, TweenLoop,
} from '@dcl/sdk/ecs'
import { EnvironmentFog } from '../shared/environmentFog'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { HAZE_COLOR, RIM_COLOR, WATER, WATER_COLOR, WATER_FOG, meanSwellWavelength, resolvedWaterSize, resolvedWaterY } from '../shared/waterLook'

export function initWater(): void {
  const rescueY = MIN_Y - FALL_RESPAWN_DROP
  const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  if (!(y < rescueY)) {
    console.log(`[Water] surface ${y.toFixed(2)} is not below the rescue line ${rescueY.toFixed(2)}; not spawned`)
    return
  }
  const size = resolvedWaterSize(SCENE_SIZE)
  const mid = SCENE_SIZE / 2

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
  if (mobileNow) {
    addSwell(root, WATER.swellLiteSrc)
    addFlat(root, WATER.flatLiteSrc)
  } else {
    desktop.push(addSwell(root, WATER.swellNearSrc))
    desktop.push(addSwell(root, WATER.swellMidSrc))
    desktop.push(addSwell(root, WATER.swellFarSrc))
    desktop.push(addFlat(root, WATER.flatSrc))
    watchMobile(root, desktop)
  }
  if (WATER_FOG.skirt) addSkirt(y, size)
  if (WATER_FOG.mist) addMist(root, size)
  if (WATER_FOG.haze) addHaze()

  const crest = y + WATER.swellAmplitudeM + Math.max(0, WATER.swellM)
  console.log(`[Water] y=${y.toFixed(2)} crest=${crest.toFixed(2)} size=${size.toFixed(0)} rescue=${rescueY.toFixed(2)} swell=${meanSwellWavelength().toFixed(0)}m/${WATER.swellPeriodS}s`)
}

function addSwell(root: Entity, src: string): Entity {
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
      speed: WATER.swellClipS / WATER.swellPeriodS,
      weight: 1,
    }],
  })
  const c = WATER_COLOR
  GltfNodeModifiers.create(wave, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: {
        material: {
          $case: 'pbr',
          pbr: {
            albedoColor: Color4.create(c.r, c.g, c.b, c.a),
            metallic: WATER.metallic,
            roughness: WATER.roughness,
            specularIntensity: WATER.specular,
            reflectivityColor: Color3.create(c.r, c.g, c.b),
            transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
            castShadows: false,
          },
        },
      },
    }],
  })
  return wave
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
      addSwell(root, WATER.swellLiteSrc)
      addFlat(root, WATER.flatLiteSrc)
    }
    engine.removeSystem(tick)
  }
  engine.addSystem(tick)
}
