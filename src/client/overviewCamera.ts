/**
 * overviewCamera.ts — "overview mode": an angled, isometric-style camera
 * that follows the local player from far above. Ported from
 * dcl-snowdrift/src/client/topDownCamera.ts and trimmed for pixelwars.
 *
 * How it works (same as snowdrift):
 *   DCL has no orthographic camera, so a VirtualCamera sits far from a
 *   focus point along a fixed diagonal (yaw OV_YAW_DEG, pitch OV_PITCH_DEG
 *   down) with a narrow FOV. The long throw + narrow lens keeps perspective
 *   low so it reads close to isometric. `lookAtEntity` on the focus entity
 *   aims it. MainCamera.virtualCameraEntity switches it on/off; the
 *   VirtualCamera transition glides in and out.
 *
 *   Each frame while active, the focus lerps toward the player (XZ and,
 *   for the 3-level sky layout, Y), and the camera is placed along the
 *   diagonal, clamped inside the 320 m scene and under the height limit.
 *
 * Kept from snowdrift: toggle, follow, zoom in/out, 90° manual rotate,
 *   bounds + ceiling clamps, glide transition, auto-exit on teleport.
 * Dropped: terrain occlusion auto-rotate (pixelwars has no terrain cells to
 *   ray-test — tiles are thin slabs), free pan (desktop drag + mobile d-pad),
 *   off-screen avatar hint. Painting and movement are untouched: paint reads
 *   the player position, not the camera.
 *
 * Input: desktop key 1 (IA_ACTION_3) toggles, key 4 (IA_ACTION_6) rotates
 * 90°. UI: the overview button + zoom buttons in ui.tsx (also on mobile).
 */

import { engine, Entity, InputAction, MainCamera, PointerEventType, Transform, VirtualCamera, inputSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { SCENE_SIZE, BASE_Y } from '../maze/generator'
import { playUiClick } from './audio'

// MARK: Tuning
export const OV_PITCH_DEG = 35.26  // true isometric ≈ 35.26°
export const OV_YAW_DEG = 45      // axis-aligned with the maze grid: WASD (camera-relative) walks straight along corridors; rotate steps by 90
export const OV_FOV_DEG   = 24
/** Zoom "view scale": frames like a 60°-FOV camera at this many metres. */
const SCALE_DEFAULT = isMobile() ? 45 : 55
const SCALE_MIN     = 15
const SCALE_MAX     = 90
const SCALE_STEP    = 10
const DEG = Math.PI / 180
const DIST_PER_SCALE = Math.tan(60 * DEG / 2) / Math.tan(OV_FOV_DEG * DEG / 2) // ≈ 2.72
/** 20×20 parcels → height limit 20·log2(401) ≈ 172.9 m. */
const SCENE_HEIGHT_LIMIT = 20 * Math.log2(400 + 1)
const BOUNDS_INSET_M   = 2
const CEILING_MARGIN_M = 3
const MIN_ABOVE_FOCUS  = 3
const DIST_RATE        = 6
const FOLLOW_RATE      = 5
const FOCUS_Y_RATE     = 4
const YAW_BLEND_S      = 0.8
const TRANSITION_SPEED = 260 // m/s glide in/out

const SIN_P = Math.sin(OV_PITCH_DEG * DEG)
const COS_P = Math.cos(OV_PITCH_DEG * DEG)
const FWD = { x: Math.sin(OV_YAW_DEG * DEG), z: Math.cos(OV_YAW_DEG * DEG) }

// MARK: State
let camEntity: Entity | null = null
let lookEnt: Entity | null = null
let active = false
let scale = SCALE_DEFAULT
const focus = { x: SCENE_SIZE / 2, y: BASE_Y, z: SCENE_SIZE / 2 }
let camDist = scale * DIST_PER_SCALE
let yawSlot = 0
let yawDeg = OV_YAW_DEG, yawFrom = OV_YAW_DEG, yawTo = OV_YAW_DEG, yawT = YAW_BLEND_S

function setYaw(d: number): void {
  yawDeg = d
  FWD.x = Math.sin(d * DEG); FWD.z = Math.cos(d * DEG)
}

// MARK: setup
/** Create the VirtualCamera + look target and the update system. Call once. */
export function setupOverviewCamera(): void {
  if (camEntity !== null) return
  lookEnt = engine.addEntity()
  Transform.create(lookEnt, { position: Vector3.create(focus.x, focus.y, focus.z) })
  camEntity = engine.addEntity()
  Transform.create(camEntity, { position: Vector3.create(focus.x, focus.y + 50, focus.z) })
  VirtualCamera.create(camEntity, {
    lookAtEntity: lookEnt,
    fov: OV_FOV_DEG,
    defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(TRANSITION_SPEED) },
  })
  engine.addSystem((dt: number) => {
    if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) {
      playUiClick()
      toggleOverview()
    }
    if (active && inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) {
      playUiClick()
      rotateOverview(1)
    }
    if (active) update(dt)
  })
}

// MARK: update
function update(dt: number): void {
  if (yawT < YAW_BLEND_S) {
    yawT = Math.min(YAW_BLEND_S, yawT + dt)
    const u = yawT / YAW_BLEND_S
    setYaw(yawFrom + (yawTo - yawFrom) * (u * u * (3 - 2 * u)))
  }
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (p) {
    const k = 1 - Math.exp(-FOLLOW_RATE * dt)
    focus.x += (p.x - focus.x) * k
    focus.z += (p.z - focus.z) * k
    // Follow the player's level (L-1 / L0 / L+1), but not a long fall.
    const ty = Math.max(p.y, BASE_Y - 15)
    focus.y += (ty - focus.y) * (1 - Math.exp(-FOCUS_Y_RATE * dt))
  }
  const want = Math.min(scale * DIST_PER_SCALE, maxDistance())
  camDist += (want - camDist) * (1 - Math.exp(-DIST_RATE * dt))
  if (camDist > want) camDist = Math.min(camDist, maxDistance())
  place()
}

function place(): void {
  const cx = focus.x - FWD.x * camDist * COS_P
  const cz = focus.z - FWD.z * camDist * COS_P
  let cy = focus.y + camDist * SIN_P
  cy = Math.max(focus.y + MIN_ABOVE_FOCUS, Math.min(cy, SCENE_HEIGHT_LIMIT - CEILING_MARGIN_M))
  if (lookEnt !== null) {
    const t = Transform.getMutable(lookEnt)
    t.position.x = focus.x; t.position.y = focus.y; t.position.z = focus.z
  }
  if (camEntity !== null) {
    const t = Transform.getMutable(camEntity)
    t.position.x = cx; t.position.y = cy; t.position.z = cz
  }
}

/** Longest throw that keeps the camera inside the scene and under the ceiling. */
function maxDistance(): number {
  let max = Infinity
  const bx = -FWD.x * COS_P, bz = -FWD.z * COS_P
  const lo = BOUNDS_INSET_M, hi = SCENE_SIZE - BOUNDS_INSET_M
  if (bx < -1e-6) max = Math.min(max, (focus.x - lo) / -bx)
  if (bx > 1e-6)  max = Math.min(max, (hi - focus.x) / bx)
  if (bz < -1e-6) max = Math.min(max, (focus.z - lo) / -bz)
  if (bz > 1e-6)  max = Math.min(max, (hi - focus.z) / bz)
  max = Math.min(max, (SCENE_HEIGHT_LIMIT - CEILING_MARGIN_M - focus.y) / SIN_P)
  return Math.max(4, max)
}

// MARK: API
/** Flip between overview and the normal player camera. */
export function toggleOverview(): void {
  if (camEntity === null) return
  active = !active
  if (active) {
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (p) { focus.x = p.x; focus.y = Math.max(p.y, BASE_Y - 15); focus.z = p.z }
    camDist = Math.min(scale * DIST_PER_SCALE, maxDistance())
    place()
  }
  const main = MainCamera.getMutableOrNull(engine.CameraEntity) ?? MainCamera.create(engine.CameraEntity)
  main.virtualCameraEntity = active ? camEntity : undefined
}

/** Leave overview if it's on (e.g. before movePlayerTo so its cameraTarget lands). */
export function exitOverview(): void {
  if (active) toggleOverview()
}

export function isOverviewActive(): boolean { return active }

/** Turn the view by steps × 90° (blended). */
export function rotateOverview(steps: number): void {
  yawSlot = (((yawSlot + steps) % 4) + 4) % 4
  yawFrom = yawDeg
  let to = OV_YAW_DEG + 90 * yawSlot
  while (to - yawFrom > 180) to -= 360
  while (to - yawFrom < -180) to += 360
  yawTo = to
  yawT = 0
}

export function overviewZoomIn(): void { if (active) scale = Math.max(SCALE_MIN, scale - SCALE_STEP) }
export function overviewZoomOut(): void { if (active) scale = Math.min(SCALE_MAX, scale + SCALE_STEP) }
export function canOverviewZoomIn(): boolean { return active && scale > SCALE_MIN }
export function canOverviewZoomOut(): boolean { return active && scale < SCALE_MAX }
