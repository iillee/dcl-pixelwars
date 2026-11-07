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
import { FOAM, HAZE_COLOR, LOOK, RIM_COLOR, SURFACE, SWELL_VARIANT, WATER, WATER_COLOR, WATER_FOG, horizonRadiusM, resolvedWaterSize, resolvedWaterY, swellMesh } from '../shared/waterLook'
import { liveSwell } from '../shared/swell'
import { events } from '../shared/events'
import { combatVfxReady } from './audio'
import { initFoam, setFoamSeconds } from './foam'

/** Module load, close to scene start. Water logs are milliseconds from here. */
const WATER_BOOT = Date.now()

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

let seaRoot: Entity = 0 as Entity
let seaY = 0
let seaSize = 0
let seaMobile = false
let seaDesktop: Entity[] = []
let seaPhase = 0
let seaRooted = false
let seaTracking = false

function seaMark(part: string): void {
  console.log(`[Water] loaded at t=${Date.now() - WATER_BOOT}ms part=${part}`)
}

function bootSeaRoot(): void {
  if (seaRooted) return
  seaRooted = true
  const rescueY = MIN_Y - FALL_RESPAWN_DROP
  seaY = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
  seaSize = resolvedWaterSize(SCENE_SIZE)
  const mid = SCENE_SIZE / 2
  seaMobile = isMobile()
  if (WATER_FOG.environment && WATER_FOG.density > 0) {
    EnvironmentFog.create(engine.RootEntity, {
      color: { keys: [{ time: 0, color: Color4.create(WATER_FOG.color.r, WATER_FOG.color.g, WATER_FOG.color.b, 1) }] },
      density: WATER_FOG.density,
    })
  }
  seaRoot = engine.addEntity()
  const at = Vector3.create(mid, seaY, mid)
  Transform.create(seaRoot, { position: at })
  if (WATER.swellM > 0) {
    const up = Vector3.create(mid, seaY + WATER.swellM, mid)
    const swell = Math.max(0.5, WATER.swellSeconds)
    Tween.create(seaRoot, {
      duration: swell,
      easingFunction: EasingFunction.EF_EASESINE,
      mode: Tween.Mode.Move({ start: at, end: up }),
    })
    TweenSequence.create(seaRoot, {
      sequence: [{
        duration: swell,
        easingFunction: EasingFunction.EF_EASESINE,
        mode: Tween.Mode.Move({ start: up, end: at }),
      }],
      loop: TweenLoop.TL_RESTART,
    })
  }
  // Every water GLB is created with both collision masks at 0. A collider
  // baked into the file is not used. The depth sheet is a plane with no collider.
  console.log('[Water] collision masks 0 on swell, rim, haze, and foam')
  const spec = liveSwell()
  console.log(`[Water] variant=${SWELL_VARIANT} y=${seaY.toFixed(2)} rescue=${rescueY.toFixed(2)} scene=${SCENE_SIZE}m gloss=${LOOK.gloss} seaLast=${LOOK.seaLast} trains=${spec.parts.length}`)
}

/** One ocean piece. Returns true when the meshes and the haze are in. */
function stepSea(): boolean {
  bootSeaRoot()
  const foamOn = (mobile: boolean) => SURFACE.foam && (!mobile || SURFACE.mobileFoam)
  if (seaPhase === 1) {
    if (seaMobile) {
      addSwell(seaRoot, swellMesh('lite'), true)
      if (foamOn(true)) addFoam(seaRoot, swellMesh('lite'))
    } else {
      seaDesktop.push(addSwell(seaRoot, swellMesh('near'), true))
      if (foamOn(false)) seaDesktop.push(addFoam(seaRoot, swellMesh('near')))
      watchMobile(seaRoot, seaDesktop)
    }
    if (!seaTracking) { seaTracking = true; clipSeconds = 0; engine.addSystem(trackSwell) }
    seaMark('near')
    seaPhase = 2
    return false
  }
  if (seaPhase === 2) {
    const disk = addSwell(seaRoot, swellMesh('mid'), true)
    if (!seaMobile) {
      seaDesktop.push(disk)
      if (foamOn(false)) seaDesktop.push(addFoam(seaRoot, swellMesh('mid')))
    }
    seaMark('mid')
    seaPhase = 3
    return false
  }
  if (seaPhase === 3) {
    // The far square is not spawned: its corners would pass the haze circle.
    // A spawned far mesh would skip the soft normal with `part !== 'far'`.
    seaMark('far')
    seaPhase = 4
    return false
  }
  if (seaPhase === 4) {
    // No flat sheet under or outside the disk. LOOK.depth (the under-sheet) stays off.
    if (LOOK.depth) addDepth(seaRoot)
    if (WATER_FOG.skirt) addSkirt(seaY, seaSize)
    if (WATER_FOG.mist) addMist(seaRoot, seaSize)
    seaMark(seaMobile ? 'rim' : 'rim-skipped')
    seaPhase = 5
    return false
  }
  if (WATER_FOG.haze) addHaze(seaY)
  if (FOAM.rings || FOAM.whitecaps) initFoam()
  seaMark('haze')
  seaPhase = 6
  return true
}

/** Spawn the whole sea on the caller’s turn. `LOOK.seaLast` uses `armSea` instead. */
export function initWater(): void {
  if (!LOOK.sea || seaPhase >= 6) return
  if (seaPhase === 0) seaPhase = 1
  while (!stepSea()) {}
}

/**
 * With `LOOK.seaLast`, the sea waits until the player has a team and the
 * burst/lunge clips have finished loading. Each mesh is then one frame apart
 * so a single frame does not decode every GLB. The ocean bed is `onAudio`,
 * after the haze.
 */
export function armSea(onAudio: () => void): void {
  if (!LOOK.sea) {
    console.log('[Water] LOOK.sea off — no swell, rim, haze, or ocean bed')
    return
  }
  if (!LOOK.seaLast) {
    initWater()
    onAudio()
    return
  }
  console.log('[Water] deferred until teamAssigned; burst ripple pool is already built')
  let team = false
  let age = 0
  let stepping = false
  events.on('team:assigned', () => { team = true })
  engine.addSystem(function seaLast(dt: number) {
    if (!team) return
    age += dt
    if (!stepping) {
      if (!combatVfxReady() && age < 4) return
      if (!combatVfxReady()) console.log(`[Water] vfx preload not reported after ${age.toFixed(1)}s — loading sea anyway`)
      stepping = true
      seaPhase = 1
    }
    if (!stepSea()) return
    onAudio()
    engine.removeSystem(seaLast)
  })
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

/** One inward ring just inside the parcel edge. Scale carries the radius and the height; the mesh is the unit circle. */
function addHaze(waterY: number): void {
  const mid = SCENE_SIZE / 2
  const radius = horizonRadiusM(SCENE_SIZE)
  const bottom = waterY - WATER_FOG.hazeBelowM
  const height = WATER_FOG.hazeBelowM + WATER_FOG.hazeAboveM
  const ring = engine.addEntity()
  Transform.create(ring, {
    position: Vector3.create(mid, bottom, mid),
    scale: Vector3.create(radius, height, radius),
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
      addSwell(root, swellMesh('mid'), true)
    }
    engine.removeSystem(tick)
  }
  engine.addSystem(tick)
}
