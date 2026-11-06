/**
 * Sea under the sky arena, plus the fog that hides the plane's edge.
 * Tunables live in shared/waterLook.ts.
 *
 * Same trick as the Creator Hub 0.52 Water Plane: a flat mesh, a scrolling
 * normal map, a small bob. No collider and no splash trigger, so a fall
 * still reaches the Lakitu line above the surface.
 */
import {
  engine, Entity, Material, MaterialTransparencyMode, MeshRenderer,
  TextureMovementType, TextureWrapMode, Transform, Tween, EasingFunction, TweenSequence, TweenLoop,
} from '@dcl/sdk/ecs'
import { EnvironmentFog } from '../shared/environmentFog'
import { Color4, Quaternion, Vector2, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP } from '../maze/level'
import { WATER, WATER_FOG, fogDensity, resolvedWaterY } from '../shared/waterLook'

export function initWater(): void {
  const rescueY = MIN_Y - FALL_RESPAWN_DROP
  const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  if (!(y < rescueY)) {
    console.log(`[Water] surface ${y.toFixed(2)} is not below the rescue line ${rescueY.toFixed(2)}; not spawned`)
    return
  }

  EnvironmentFog.create(engine.RootEntity, {
    color: { keys: [{ time: 0, color: Color4.create(WATER_FOG.color.r, WATER_FOG.color.g, WATER_FOG.color.b, 1) }] },
    density: fogDensity(),
  })

  const root = engine.addEntity()
  const mid = SCENE_SIZE / 2
  Transform.create(root, { position: Vector3.create(mid, y, mid) })

  const desktop = Math.max(1, WATER.layersDesktop)
  const mobile = Math.max(1, Math.min(WATER.layersMobile, desktop))
  const extra: Entity[] = []
  for (let i = 0; i < desktop; i++) {
    const sheet = addSheet(root, i)
    if (i >= mobile) extra.push(sheet)
  }
  if (extra.length > 0) watchMobile(extra)

  console.log(`[Water] surface y=${y.toFixed(2)} (rescue ${rescueY.toFixed(2)}) size ${WATER.sizeM} fog ${fogDensity().toFixed(4)}/m`)
}

function addSheet(root: Entity, index: number): Entity {
  const gap = index * WATER.layerGapM
  const bob = engine.addEntity()
  const at = Vector3.create(0, gap, 0)
  const up = Vector3.create(0, gap + WATER.bobM, 0)
  Transform.create(bob, { parent: root, position: at })
  const seconds = Math.max(0.5, WATER.bobSeconds)
  Tween.create(bob, {
    duration: seconds,
    easingFunction: EasingFunction.EF_EASESINE,
    mode: Tween.Mode.Move({ start: at, end: up }),
  })
  TweenSequence.create(bob, {
    sequence: [{
      duration: seconds,
      easingFunction: EasingFunction.EF_EASESINE,
      mode: Tween.Mode.Move({ start: up, end: at }),
    }],
    loop: TweenLoop.TL_RESTART,
  })

  const sheet = engine.addEntity()
  Transform.create(sheet, {
    parent: bob,
    position: Vector3.Zero(),
    // The plane primitive lies on XY. This lays it on the sea.
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(WATER.sizeM, WATER.sizeM, 1),
  })
  MeshRenderer.setPlane(sheet)
  const repeats = WATER.sizeM / WATER.rippleSizeM
  const drift = WATER.drifts[index % WATER.drifts.length]
  const len = Math.hypot(drift.x, drift.y) || 1
  Material.setPbrMaterial(sheet, {
    albedoColor: Color4.create(WATER.color.r, WATER.color.g, WATER.color.b, WATER.color.a),
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
    Vector2.create(drift.x / len, drift.y / len),
    WATER.driftSpeed,
    TextureMovementType.TMT_OFFSET,
  )
  return bob
}

/** isMobile() stays false until the explorer answers. Drop the extra sheets then. */
function watchMobile(extra: Entity[]): void {
  let age = 0
  function tick(dt: number): void {
    age += dt
    if (!isMobile()) {
      if (age > 5) engine.removeSystem(tick)
      return
    }
    for (const e of extra) engine.removeEntityWithChildren(e)
    engine.removeSystem(tick)
  }
  engine.addSystem(tick)
}
