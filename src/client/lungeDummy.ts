/**
 * lungeDummy.ts — renders the SHARED anvil dummies (LUNGE_TEST_DUMMY). The server owns them
 * (server/anvils.ts + shared/anvilSim.ts: spawn spots, yaw, slide sim, falls, respawns) and
 * broadcasts anvilState (~10 Hz while moving, keep-alive every 2 s). This client:
 *  - renders each anvil smoothed toward the latest snapshot (extrapolated by its velocity for
 *    up to 150 ms), model + collider follow the rendered position;
 *  - reports lunge / burst hits on an anvil to the server (anvilHit; server dedupes) and, for
 *    our OWN hits, predicts the knock locally at once (ANVIL_PREDICT_*, shared/anvilSim.ts) until
 *    the server's snapshot for it arrives / times out, then blends to the server state;
 *  - key 2 asks the server to re-roll all anvils (anvilRespawn);
 *  - victim-side anvil launch: a moving anvil touching the LOCAL player launches them
 *    (ANVIL_LAUNCH_*), once per anvil slide, with cooldown and respawn protection.
 */

import { engine, Entity, GltfContainer, ColliderLayer, Transform, Physics, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import {
  LUNGE_TEST_DUMMY, LUNGE_DUMMY_COUNT,
  ANVIL_LAUNCH_ENABLED, ANVIL_LAUNCH_MIN_SPEED, ANVIL_LAUNCH_IMPULSE, ANVIL_LAUNCH_LIFT, ANVIL_LAUNCH_COOLDOWN_S,
  ANVIL_PREDICT_ENABLED, ANVIL_PREDICT_TIMEOUT_S, ANVIL_PREDICT_CLOSE_M, ANVIL_BLEND_S, ANVIL_BLEND_FAR_S, ANVIL_SNAP_M,
  BURST_KNOCKBACK, LUNGE_KNOCKBACK,
} from '../shared/pvp'
import { AnvilWorld } from '../shared/anvilSim'
import { buildWalkableGraph } from '../shared/mazeGraph'
import { getPlacedTilesInOrder } from '../maze/generator'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'
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
  predicted: boolean // rendering our local prediction (own hit not yet confirmed by the server)
  predictLeft: number // s until we give up waiting for the server's snapshot of our hit
  predictSlide: number // server slide id when our predicted hit started
  offset: V3 // render offset from the server target, decayed over blendLeft / blendTotal
  blendLeft: number
  blendTotal: number
}
const dummies: Dummy[] = []
// Local copy of the shared sim, used ONLY for predicted anvils (positions come from the server).
const predictWorld = new AnvilWorld()
let predictSeed = -1
let predictReady = false

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
  if (ANVIL_PREDICT_ENABLED && predictReady) startPredict(d, i, dx, dz, kind)
}

/** Same knock the server applies (normalised dir, burst multiplier), on our local sim copy. */
function startPredict(d: Dummy, i: number, dx: number, dz: number, kind: 0 | 1): void {
  const len = Math.hypot(dx, dz)
  if (len < 1e-3) return
  const a = predictWorld.anvils[i]
  if (!a) return
  if (!d.predicted) {
    // Start from what we render now (incl. a running slide), not from the stale sim copy.
    a.pos = { ...d.pos }
    a.vel = d.moving ? { ...d.vel } : { x: 0, y: 0, z: 0 }
    a.forceLeft = 0
    a.tracking = d.moving
    a.alive = true
    a.respawnIn = -1
    d.predictSlide = d.slide
  }
  predictWorld.hit(i, dx / len, dz / len, kind === 1 ? BURST_KNOCKBACK / LUNGE_KNOCKBACK : 1)
  d.predicted = true
  d.predictLeft = ANVIL_PREDICT_TIMEOUT_S
  d.blendLeft = 0
}

/** Server target position (latest snapshot, extrapolated by its velocity for ≤ 150 ms). */
function serverTarget(d: Dummy): V3 {
  const t = d.moving ? Math.min(d.age, EXTRAPOLATE_MAX_S) : 0
  return { x: d.srv.x + d.vel.x * t, y: d.srv.y + d.vel.y * t, z: d.srv.z + d.vel.z * t }
}

/** Leave prediction: keep the predicted position on screen and blend it into the server state
 *  (fast if far off, e.g. a rejected hit or someone else's hit won). */
function endPredict(d: Dummy, i: number, why: string): void {
  if (!d.predicted) return
  d.predicted = false
  const tgt = serverTarget(d)
  d.offset = { x: d.pos.x - tgt.x, y: d.pos.y - tgt.y, z: d.pos.z - tgt.z }
  const err = Math.hypot(d.offset.x, d.offset.y, d.offset.z)
  d.blendTotal = d.blendLeft = err <= ANVIL_PREDICT_CLOSE_M ? ANVIL_BLEND_S : ANVIL_BLEND_FAR_S
  console.log(`[Dummy ${i}] prediction ${why}: error ${err.toFixed(2)} m, blend ${d.blendTotal}s`)
}

// Anvil launch contact volume: anvil ≈ 1.7 × 1.15 × 1.06 m around the feet point + player radius.
const ANVIL_LAUNCH_REACH = 0.85 + 0.4 // horizontal, m
const ANVIL_LAUNCH_BELOW = 0.5
const ANVIL_LAUNCH_ABOVE = 1.2
let launchCooldown = 0

/** Moving shared anvil touching the local player → launch them (victim-side). */
function checkLaunch(d: Dummy, i: number, dt: number): void {
  if (d.launchGraceS > 0) { d.launchGraceS -= dt; return }
  // Dedupe key: server slide id, or a marker for the slide we're predicting (carried over on reconcile).
  const key = d.predicted ? -2 - d.predictSlide : d.slide
  if (!ANVIL_LAUNCH_ENABLED || !d.alive || !(d.moving || d.predicted) || d.launchedSlide === key || launchCooldown > 0 || isKnockbackImmune()) return
  const v = d.predicted ? predictWorld.anvils[i].vel : d.vel
  const speed = Math.hypot(v.x, v.z)
  if (speed < ANVIL_LAUNCH_MIN_SPEED) return
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) return
  const dx = p.x - d.pos.x, dz = p.z - d.pos.z, dy = p.y - d.pos.y
  if (Math.hypot(dx, dz) > ANVIL_LAUNCH_REACH || dy < -ANVIL_LAUNCH_BELOW || dy > ANVIL_LAUNCH_ABOVE) return
  let ux = v.x / speed, uz = v.z / speed
  if (!isFinite(ux) || !isFinite(uz)) { const l = Math.hypot(dx, dz) || 1; ux = dx / l; uz = dz / l }
  d.launchedSlide = key
  launchCooldown = ANVIL_LAUNCH_COOLDOWN_S
  startKnockLock()
  safePhysics('anvil launch', () => Physics.applyImpulseToPlayer(Vector3.create(ux * ANVIL_LAUNCH_IMPULSE, ANVIL_LAUNCH_LIFT, uz * ANVIL_LAUNCH_IMPULSE)))
  playDashHitSfx()
  console.log(`[Dummy ${i}] launched the player at ${speed.toFixed(1)} m/s`)
}

function render(d: Dummy, i: number, dt: number): void {
  const tr = Transform.getMutable(d.ent)
  d.age += dt
  if (d.predicted) {
    const a = predictWorld.anvils[i]
    d.predictLeft -= dt
    if (a.alive) d.pos = { ...a.pos }
    if (d.predictLeft <= 0) endPredict(d, i, 'timed out (no server snapshot for our hit)')
    else {
      // Predicted fall off the map: hide until the server's respawn arrives.
      tr.position = a.alive ? Vector3.create(d.pos.x, d.pos.y, d.pos.z) : HIDDEN
      tr.rotation = Quaternion.fromEulerDegrees(0, d.yaw, 0)
      return
    }
  }
  if (!d.alive) { tr.position = HIDDEN; return }
  const target = serverTarget(d)
  if (d.blendLeft > 0) {
    d.blendLeft = Math.max(0, d.blendLeft - dt)
    const k = d.blendLeft / d.blendTotal // offset 1 → 0
    d.pos = { x: target.x + d.offset.x * k, y: target.y + d.offset.y * k, z: target.z + d.offset.z * k }
  } else if (Math.hypot(target.x - d.pos.x, target.y - d.pos.y, target.z - d.pos.z) > ANVIL_SNAP_M) d.pos = target
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
    dummies.push({ ent, pos: { ...z }, srv: { ...z }, vel: { ...z }, age: 0, alive: false, moving: false, yaw: 0, slide: -1, launchedSlide: -1, launchGraceS: 0,
      predicted: false, predictLeft: 0, predictSlide: -1, offset: { ...z }, blendLeft: 0, blendTotal: 1 })
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
      if (respawned) { d.predicted = false; d.blendLeft = 0; d.pos = { ...d.srv } } // appear in place (snap only on respawn)
      else if (d.predicted && s.slide !== d.predictSlide) {
        if (d.launchedSlide === -2 - d.predictSlide) d.launchedSlide = s.slide // launched during prediction: same slide
        endPredict(d, i, 'reconciled') // server's state for our hit (or a newer one)
      }
    })
  })
  engine.addSystem((dt: number) => {
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) respawnDummy()
    if (launchCooldown > 0) launchCooldown -= dt
    // Local sim copy for prediction: same walk graph / ramps as the server; never respawns here.
    const seed = getCurrentSeed()
    if (ANVIL_PREDICT_ENABLED && !isRebuilding() && seed !== predictSeed && getPlacedTilesInOrder().length > 0) {
      predictWorld.setMaze(buildWalkableGraph(getPlacedTilesInOrder()), getPlacedTilesInOrder(), [], false)
      predictSeed = seed
      predictReady = true
    }
    if (predictReady) {
      dummies.forEach((d, i) => { const a = predictWorld.anvils[i]; if (!d.predicted && a) a.alive = false; if (a) a.respawnIn = -1 })
      predictWorld.tick(Math.min(dt, 0.1))
    }
    dummies.forEach((d, i) => {
      render(d, i, dt)
      checkLaunch(d, i, dt)
    })
  })
}
