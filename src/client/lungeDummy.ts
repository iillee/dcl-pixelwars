/**
 * lungeDummy.ts — renders the SHARED anvil dummies (LUNGE_TEST_DUMMY). The server owns them
 * (server/anvils.ts + shared/anvilSim.ts: spawn spots, yaw, slide sim, falls, respawns) and
 * broadcasts anvilState (~10 Hz while moving, keep-alive every 2 s). This client:
 *  - renders each anvil smoothed toward the latest snapshot (extrapolated by its velocity for
 *    up to 150 ms), model + collider follow the rendered position;
 *  - reports lunge / burst hits on an anvil to the server (anvilHit; server dedupes);
 *  - key 2 asks the server to re-roll all anvils (anvilRespawn);
 *  - victim-side anvil launch: a moving anvil touching the LOCAL player launches them
 *    (ANVIL_LAUNCH_*), once per anvil slide, with cooldown and respawn protection.
 */

import { engine, Entity, GltfContainer, ColliderLayer, Transform, Physics, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import {
  LUNGE_TEST_DUMMY, LUNGE_DUMMY_COUNT,
  ANVIL_LAUNCH_ENABLED, ANVIL_LAUNCH_MIN_SPEED, ANVIL_LAUNCH_IMPULSE, ANVIL_LAUNCH_LIFT, ANVIL_LAUNCH_COOLDOWN_S,
} from '../shared/pvp'
import { room } from '../shared/messages'
import { isKnockbackImmune, safePhysics } from './knockback'
import { startKnockLock } from './lunge'
import { playDashHitSfx } from './audio'

/** Anvil model (Creator Hub asset pack). GLB bounds: x −0.50…0.63, y 0…0.77 (origin at its
 *  base), z ±0.35 m. Scaled ×ANVIL_SCALE → ≈1.7 × 1.15 × 1.06 m; ANVIL_OFFSET_X centres the
 *  horn-heavy x extent on the dummy's feet point. */
const ANVIL_SRC = 'assets/asset-packs/anvil/Anvil_01/Anvil_01.glb'
const ANVIL_SCALE = 1.5
const ANVIL_OFFSET_X = -0.07 * ANVIL_SCALE
const HIDDEN = Vector3.create(8, -50, 8)
const EXTRAPOLATE_MAX_S = 0.15
const SMOOTH_RATE = 15 // 1/s, exponential approach to the extrapolated server position
const SNAP_DIST = 3 // m: farther than this → snap (respawn / big correction)

type V3 = { x: number; y: number; z: number }
type Dummy = {
  ent: Entity
  pos: V3 // rendered feet position
  srv: V3 // last server position
  vel: V3 // last server velocity
  age: number // s since that snapshot
  alive: boolean
  moving: boolean
  yaw: number
  slide: number
  launchedSlide: number // slide id that already launched the local player
  launchGraceS: number // we just hit it: no launch yet (lunging into it doesn't launch you)
}
const dummies: Dummy[] = []

export function isDummyEnabled(): boolean { return LUNGE_TEST_DUMMY }

/** Live anvils' rendered feet positions (lunge.ts / paintBurst.ts hit targets). */
export function getDummyTargets(): Array<{ i: number; pos: V3 }> {
  const out: Array<{ i: number; pos: V3 }> = []
  dummies.forEach((d, i) => { if (d.alive) out.push({ i, pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z } }) })
  return out
}

/** Key 2: ask the server to re-roll every anvil. */
export function respawnDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  room.send('anvilRespawn', { n: 0 })
}

const ANVIL_LAUNCH_GRACE_S = 0.35
/** Lunge (kind 0) or burst (kind 1) `id` hit anvil i: the server applies the knock (mult is
 *  applied server-side from kind). */
export function hitDummy(i: number, dx: number, dz: number, kind: 0 | 1, id: number): void {
  const d = dummies[i]
  if (!d || !d.alive) return
  d.launchGraceS = ANVIL_LAUNCH_GRACE_S
  room.send('anvilHit', { kind, id, i, dx, dz })
}

// Anvil launch contact volume: anvil ≈ 1.7 × 1.15 × 1.06 m around the feet point + player radius.
const ANVIL_LAUNCH_REACH = 0.85 + 0.4 // horizontal, m
const ANVIL_LAUNCH_BELOW = 0.5
const ANVIL_LAUNCH_ABOVE = 1.2
let launchCooldown = 0

/** Moving shared anvil touching the local player → launch them (victim-side). */
function checkLaunch(d: Dummy, i: number, dt: number): void {
  if (d.launchGraceS > 0) { d.launchGraceS -= dt; return }
  if (!ANVIL_LAUNCH_ENABLED || !d.alive || !d.moving || d.launchedSlide === d.slide || launchCooldown > 0 || isKnockbackImmune()) return
  const speed = Math.hypot(d.vel.x, d.vel.z)
  if (speed < ANVIL_LAUNCH_MIN_SPEED) return
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) return
  const dx = p.x - d.pos.x, dz = p.z - d.pos.z, dy = p.y - d.pos.y
  if (Math.hypot(dx, dz) > ANVIL_LAUNCH_REACH || dy < -ANVIL_LAUNCH_BELOW || dy > ANVIL_LAUNCH_ABOVE) return
  let ux = d.vel.x / speed, uz = d.vel.z / speed
  if (!isFinite(ux) || !isFinite(uz)) { const l = Math.hypot(dx, dz) || 1; ux = dx / l; uz = dz / l }
  d.launchedSlide = d.slide
  launchCooldown = ANVIL_LAUNCH_COOLDOWN_S
  startKnockLock()
  safePhysics('anvil launch', () => Physics.applyImpulseToPlayer(Vector3.create(ux * ANVIL_LAUNCH_IMPULSE, ANVIL_LAUNCH_LIFT, uz * ANVIL_LAUNCH_IMPULSE)))
  playDashHitSfx()
  console.log(`[Dummy ${i}] launched the player at ${speed.toFixed(1)} m/s`)
}

function render(d: Dummy, dt: number): void {
  const tr = Transform.getMutable(d.ent)
  if (!d.alive) { tr.position = HIDDEN; return }
  d.age += dt
  const t = d.moving ? Math.min(d.age, EXTRAPOLATE_MAX_S) : 0
  const target = { x: d.srv.x + d.vel.x * t, y: d.srv.y + d.vel.y * t, z: d.srv.z + d.vel.z * t }
  if (Math.hypot(target.x - d.pos.x, target.y - d.pos.y, target.z - d.pos.z) > SNAP_DIST) d.pos = target
  else {
    const k = 1 - Math.exp(-SMOOTH_RATE * dt)
    d.pos = { x: d.pos.x + (target.x - d.pos.x) * k, y: d.pos.y + (target.y - d.pos.y) * k, z: d.pos.z + (target.z - d.pos.z) * k }
  }
  tr.position = Vector3.create(d.pos.x, d.pos.y, d.pos.z) // root at the feet; anvil base sits on the floor
  tr.rotation = Quaternion.fromEulerDegrees(0, d.yaw, 0)
}

export function initLungeDummy(): void {
  if (!LUNGE_TEST_DUMMY) return
  for (let i = 0; i < LUNGE_DUMMY_COUNT; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN })
    const model = engine.addEntity()
    Transform.create(model, { parent: ent, position: Vector3.create(ANVIL_OFFSET_X, 0, 0), scale: Vector3.create(ANVIL_SCALE, ANVIL_SCALE, ANVIL_SCALE) })
    // Solid for players: the GLB's own invisible collision mesh on CL_PHYSICS; child of the root,
    // so it follows the rendered position.
    GltfContainer.create(model, { src: ANVIL_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
    const z = { x: 0, y: 0, z: 0 }
    dummies.push({ ent, pos: { ...z }, srv: { ...z }, vel: { ...z }, age: 0, alive: false, moving: false, yaw: 0, slide: -1, launchedSlide: -1, launchGraceS: 0 })
  }
  room.onMessage('anvilState', ({ a }) => {
    a.forEach((s, i) => {
      const d = dummies[i]
      if (!d) return
      const respawned = s.alive === 1 && (!d.alive || (s.slide !== d.slide && s.moving === 0))
      d.srv = { x: s.x, y: s.y, z: s.z }
      d.vel = { x: s.vx, y: s.vy, z: s.vz }
      d.age = 0
      d.alive = s.alive === 1
      d.moving = s.moving === 1
      d.yaw = s.yaw
      d.slide = s.slide
      if (respawned) d.pos = { ...d.srv } // appear in place, don't glide from the old spot
    })
  })
  engine.addSystem((dt: number) => {
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) respawnDummy()
    if (launchCooldown > 0) launchCooldown -= dt
    dummies.forEach((d, i) => {
      render(d, dt)
      checkLaunch(d, i, dt)
    })
  })
}
