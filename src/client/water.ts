/**
 * Sea under the sky arena. Tunables live in shared/waterLook.ts.
 *
 * The swell is a morph-target mesh (`wave` clip). Ripples are two
 * transparent sheets scrolling the same normal map at different speeds
 * and scales — the Creator Hub Water Plane does one scroll; this crosses
 * a second over it. Mobile keeps a single sheet and skips the mesh.
 * No collider and no splash trigger.
 */
import {
  engine, Entity, Animator, GltfContainer, Material, MaterialTransparencyMode, MeshRenderer,
  TextureMovementType, TextureWrapMode, Transform, Tween, EasingFunction, TweenSequence, TweenLoop,
} from '@dcl/sdk/ecs'
import { EnvironmentFog } from '../shared/environmentFog'
import { Color3, Color4, Quaternion, Vector2, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { WATER, WATER_FOG, resolvedWaterSize, resolvedWaterY } from '../shared/waterLook'

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
  const up = Vector3.create(mid, y + WATER.swellM, mid)
  Transform.create(root, { position: at })
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

  const mobileNow = isMobile()
  const extra: Entity[] = []
  if (!mobileNow) extra.push(addWaveMesh(root, size))
  for (let i = 0; i < WATER.ripples.length; i++) {
    if (mobileNow && i > 0) continue
    const sheet = addRipple(root, i, size)
    if (i > 0) extra.push(sheet)
  }
  if (!mobileNow && extra.length) watchMobile(extra)
  if (WATER_FOG.skirt) addSkirt(y, size)
  if (WATER_FOG.mist) addMist(root, size)

  console.log(`[Water] y=${y.toFixed(2)} size=${size.toFixed(0)} rescue=${rescueY.toFixed(2)} fog=${WATER_FOG.environment ? WATER_FOG.density : 0}`)
}

function addWaveMesh(root: Entity, size: number): Entity {
  const wave = engine.addEntity()
  Transform.create(wave, {
    parent: root,
    position: Vector3.Zero(),
    scale: Vector3.create(size, Math.max(0.05, WATER.waveAmplitudeM), size),
  })
  GltfContainer.create(wave, {
    src: WATER.waveMesh,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  Animator.create(wave, {
    states: [{ clip: 'wave', playing: true, loop: true, speed: WATER.waveSpeed, weight: 1 }],
  })
  return wave
}

function addRipple(root: Entity, index: number, size: number): Entity {
  const ripple = WATER.ripples[index]
  const sheet = engine.addEntity()
  Transform.create(sheet, {
    parent: root,
    position: Vector3.create(0, 0.15 + index * 0.2, 0),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(size, size, 1),
  })
  MeshRenderer.setPlane(sheet)
  const repeats = (size / WATER.rippleSizeM) * ripple.scale
  const len = Math.hypot(ripple.x, ripple.y) || 1
  Material.setPbrMaterial(sheet, {
    albedoColor: Color4.create(WATER.color.r, WATER.color.g, WATER.color.b, index === 0 ? WATER.color.a : WATER.color.a * 0.45),
    metallic: WATER.metallic,
    roughness: WATER.roughness,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
    bumpTexture: Material.Texture.Common({
      src: WATER.normalSrc,
      wrapMode: TextureWrapMode.TWM_REPEAT,
      tiling: Vector2.create(repeats, repeats),
    }),
  })
  Tween.setTextureMoveContinuous(
    sheet,
    Vector2.create(ripple.x / len, ripple.y / len),
    ripple.speed,
    TextureMovementType.TMT_OFFSET,
  )
  return sheet
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

function watchMobile(extra: Entity[]): void {
  let age = 0
  function tick(dt: number): void {
    age += dt
    if (!isMobile()) {
      if (age > 5) engine.removeSystem(tick)
      return
    }
    for (const e of extra) engine.removeEntity(e)
    engine.removeSystem(tick)
  }
  engine.addSystem(tick)
}
