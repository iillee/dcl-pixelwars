/**
 * starPickupPop.ts — coin/mushroom-style pop above the picker's head.
 *
 * Ported from flagtag src/systems/coinPickupSystem.ts (spawnHeadBounceCoin,
 * the head-bounce VFX pool) and src/systems/mushroomSystem.ts
 * (spawnHeadBounceMushroom). Same timings, easing, and Y offsets: pop from
 * (0, 0.5, 0) to (0, 2.0, 0) in 200 ms EF_EASEOUTQUAD, then fall to
 * (0, 0.8, 0) in 350 ms EF_EASEINQUAD, hold full size during the pop and
 * shrink to 0 during the fall. The rig is parked at 0.6 s, before the
 * TweenSequence YOYO would bounce a second time. The flag pickup sound is
 * flagtag src/systems/flagSystem.ts playPickupSound (assets/sounds/pickup2.wav).
 */
import { engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType, AudioSource, Tween, TweenSequence, TweenLoop, EasingFunction } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { STAR_MODEL } from './starOrb'
import { STAR_ORB_DIAMETER } from '../shared/pvp'

export type StarPopAnchor =
  | { kind: 'bot'; entity: Entity }
  | { kind: 'player'; avatarId?: string }

const POP_POOL_SIZE = 4
const POP_DURATION = 0.6
const PICKUP_SRC = 'assets/sounds/pickup2.wav'
const STAR_SCALE = Vector3.create(STAR_ORB_DIAMETER, STAR_ORB_DIAMETER, STAR_ORB_DIAMETER)
const POP_START = Vector3.create(0, 0.5, 0)
const POP_PEAK = Vector3.create(0, 2.0, 0)
const POP_END = Vector3.create(0, 0.8, 0)
const BOT_HEAD_Y = 1.6

interface PopRig {
  anchor: Entity
  shrinkParent: Entity
  star: Entity
  timer: number
  busy: boolean
}

const pool: PopRig[] = []
let poolReady = false
let tickWired = false
let pickupSoundEntity: Entity | null = null
let lastPickupSoundMs = 0

function playFlagPickupSound(): void {
  const now = Date.now()
  if (pickupSoundEntity && now - lastPickupSoundMs < 80) return
  lastPickupSoundMs = now
  if (!pickupSoundEntity) {
    pickupSoundEntity = engine.addEntity()
    Transform.create(pickupSoundEntity, { position: Vector3.Zero() })
    AudioSource.create(pickupSoundEntity, { audioClipUrl: PICKUP_SRC, playing: true, loop: false, volume: 2, global: true })
    return
  }
  AudioSource.createOrReplace(pickupSoundEntity, { audioClipUrl: PICKUP_SRC, playing: true, loop: false, volume: 2, global: true })
}

function initPool(): void {
  if (poolReady) return
  poolReady = true
  for (let i = 0; i < POP_POOL_SIZE; i++) {
    const anchor = engine.addEntity()
    Transform.create(anchor, { position: Vector3.Zero() })
    const shrinkParent = engine.addEntity()
    Transform.create(shrinkParent, { parent: anchor, position: Vector3.Zero(), scale: Vector3.Zero() })
    const star = engine.addEntity()
    Transform.create(star, { parent: shrinkParent, position: POP_START, scale: STAR_SCALE })
    GltfContainer.create(star, {
      src: STAR_MODEL,
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0,
    })
    pool.push({ anchor, shrinkParent, star, timer: 0, busy: false })
  }
}

function releaseRig(rig: PopRig): void {
  rig.busy = false
  rig.timer = 0
  Tween.deleteFrom(rig.star)
  TweenSequence.deleteFrom(rig.star)
  Tween.deleteFrom(rig.shrinkParent)
  TweenSequence.deleteFrom(rig.shrinkParent)
  if (AvatarAttach.has(rig.anchor)) AvatarAttach.deleteFrom(rig.anchor)
  const at = Transform.getMutableOrNull(rig.anchor)
  if (at) { at.parent = undefined as unknown as Entity; at.position = Vector3.Zero() }
  Transform.getMutable(rig.shrinkParent).scale = Vector3.Zero()
}

function wireTick(): void {
  if (tickWired) return
  tickWired = true
  engine.addSystem((dt: number) => {
    for (const rig of pool) {
      if (!rig.busy) continue
      rig.timer -= dt
      if (rig.timer <= 0) releaseRig(rig)
    }
  })
}

/** Play the flagtag head-bounce pop on this carrier. The star vanishes; it does not stay over the head. */
export function spawnStarPickupPop(who: StarPopAnchor): void {
  initPool()
  wireTick()
  playFlagPickupSound()

  let rig = pool.find(r => !r.busy)
  if (!rig) {
    rig = pool[0]
    for (const r of pool) if (r.timer < rig.timer) rig = r
  }

  rig.busy = true
  rig.timer = POP_DURATION

  if (AvatarAttach.has(rig.anchor)) AvatarAttach.deleteFrom(rig.anchor)
  const at = Transform.getMutable(rig.anchor)
  if (who.kind === 'bot') {
    at.parent = who.entity
    at.position = Vector3.create(0, BOT_HEAD_Y, 0)
  } else {
    at.parent = undefined as unknown as Entity
    at.position = Vector3.Zero()
    if (who.avatarId) {
      AvatarAttach.createOrReplace(rig.anchor, {
        avatarId: who.avatarId,
        anchorPointId: AvatarAnchorPointType.AAPT_HEAD,
      })
    } else {
      AvatarAttach.createOrReplace(rig.anchor, {
        anchorPointId: AvatarAnchorPointType.AAPT_HEAD,
      })
    }
  }

  Transform.getMutable(rig.shrinkParent).scale = Vector3.One()
  const st = Transform.getMutable(rig.star)
  st.position = POP_START
  st.scale = STAR_SCALE

  Tween.createOrReplace(rig.star, {
    mode: Tween.Mode.Move({ start: POP_START, end: POP_PEAK }),
    duration: 200,
    easingFunction: EasingFunction.EF_EASEOUTQUAD,
  })
  TweenSequence.createOrReplace(rig.star, {
    sequence: [{
      mode: Tween.Mode.Move({ start: POP_PEAK, end: POP_END }),
      duration: 350,
      easingFunction: EasingFunction.EF_EASEINQUAD,
    }],
    loop: TweenLoop.TL_YOYO,
  })

  Tween.createOrReplace(rig.shrinkParent, {
    mode: Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.One() }),
    duration: 200,
    easingFunction: EasingFunction.EF_LINEAR,
  })
  TweenSequence.createOrReplace(rig.shrinkParent, {
    sequence: [{
      mode: Tween.Mode.Scale({ start: Vector3.One(), end: Vector3.create(0, 0, 0) }),
      duration: 350,
      easingFunction: EasingFunction.EF_EASEINQUAD,
    }],
    loop: TweenLoop.TL_YOYO,
  })
}
