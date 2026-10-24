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
 * Input (desktop): key 4 (IA_ACTION_6) toggles; while open 1 (IA_ACTION_3) zoom in, 2 (IA_ACTION_4) zoom out, 3 (IA_ACTION_5) rotate
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
/**
 * Zoom "view scale": frames like a 60°-FOV camera at this many metres.
 * Steps are a table, not a fixed subtraction. A linear step of 10 is only
 * ~10% at the far end (and scales past ~45–52 never move the camera — the
 * scene ceiling clamps the throw), so the first zoom-ins from a far zoom
 * did nothing. Each entry is ~×1.35 the last, so every click changes the
 * framed size by a similar amount.
 *
 * Mobile stays on its original three levels (max 25). Desktop keeps the
 * closest (5) and the default (55) and continues past the old max of 90.
 * isMobile() resolves async, so the table is read live.
 */
const MOBILE_ZOOM_SCALES = [5, 15, 25]
const DESKTOP_ZOOM_SCALES = [5, 7, 9, 12, 17, 22, 30, 41, 55, 74, 100, 135]
const zoomScales = () => isMobile() ? MOBILE_ZOOM_SCALES : DESKTOP_ZOOM_SCALES
const scaleDefault = () => isMobile() ? MOBILE_ZOOM_SCALES[0] : 55
/** Past this, a wider lens stands in for a throw the scene ceiling will not allow. */
const FOV_MAX = 80
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
let scale = 55
let scaleInit = false
/** Lens used when the wanted throw is longer than maxDistance() allows. */
let fov = OV_FOV_DEG
let fovApplied = -1
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
    // Desktop keys (one press = one click, same sound): 4 toggles; while open 1 = zoom in, 2 = zoom out, 3 = rotate.
    // Key 2 with the overview closed stays the test "respawn dummies" (lungeDummy.ts).
    const wasActive = active
    if (inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) {
      playUiClick()
      toggleOverview()
    }
    if (wasActive && active && inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN) && canOverviewZoomIn()) { playUiClick(); overviewZoomIn() }
    if (wasActive && active && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN) && canOverviewZoomOut()) { playUiClick(); overviewZoomOut() }
    if (active && inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
      playUiClick()
      rotateOverview(1)
    }
    // Mobile: start in overview once platform detection resolves, and come back after a respawn/teleport
    // exit unless the player turned it off.
    // Mobile starts in the regular view (Luke); the overview returns after a respawn only if the player opened it (mobileWant).
    if (resumeIn > 0) resumeIn -= dt
    if (!overviewPinned && mobileWant && !active && resumeIn <= 0 && isMobile()) setActive(true)
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
  const ease = 1 - Math.exp(-DIST_RATE * dt)
  const cap = maxDistance()
  const wantDist = scale * DIST_PER_SCALE
  const placeDist = Math.min(wantDist, cap)
  // Pull in immediately when the ceiling/bounds shrink; ease when zooming out.
  if (camDist > placeDist) camDist = placeDist
  else camDist += (placeDist - camDist) * ease
  const goalFov = targetFov(wantDist, cap)
  fov += (goalFov - fov) * ease
  if (Math.abs(goalFov - fov) < 0.02) fov = goalFov
  writeFov(fov)
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
  setActive(!active)
  mobileWant = active
}
let mobileWant = false
let resumeIn = 0
/** While set, do not resume overview. A fall-rescue camera ride owns MainCamera. */
let overviewPinned = false
/** After a forced exit (respawn / teleport), wait this long before mobile re-enters overview. */
const MOBILE_RESUME_S = 1.0
function setActive(on: boolean): void {
  if (camEntity === null) return
  active = on
  if (!scaleInit) { scaleInit = true; scale = scaleDefault() }
  if (active) {
    if (isMobile()) scale = scaleDefault()
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (p) { focus.x = p.x; focus.y = Math.max(p.y, BASE_Y - 15); focus.z = p.z }
    const cap = maxDistance()
    const wantDist = scale * DIST_PER_SCALE
    camDist = Math.min(wantDist, cap)
    fov = targetFov(wantDist, cap)
    writeFov(fov)
    place()
  }
  const main = MainCamera.getMutableOrNull(engine.CameraEntity) ?? MainCamera.create(engine.CameraEntity)
  main.virtualCameraEntity = active ? camEntity : undefined
}

/** Keep overview from taking MainCamera back. The mobile rescue ride uses it. */
export function pinOverviewClosed(on: boolean): void {
  overviewPinned = on
  if (on && active) exitOverview()
  // The ride outlasts MOBILE_RESUME_S, so the countdown has already hit zero.
  // Arm it again or overview takes the camera the frame the ride lets go.
  if (!on) resumeIn = MOBILE_RESUME_S
}

/** Leave overview if it's on (e.g. before movePlayerTo so its cameraTarget lands). */
export function exitOverview(): void {
  if (active) { setActive(false); resumeIn = MOBILE_RESUME_S } // mobileWant kept: mobile re-enters after the move
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

/** Framing of `wantDist` when the camera can only sit at `distCap`. In range, the lens stays OV_FOV_DEG. */
function targetFov(wantDist: number, distCap: number): number {
  if (wantDist <= distCap) return OV_FOV_DEG
  const tanHalf = Math.tan(OV_FOV_DEG * DEG / 2) * (wantDist / distCap)
  return Math.min(FOV_MAX, 2 * Math.atan(tanHalf) / DEG)
}

function writeFov(next: number): void {
  if (camEntity === null || Math.abs(next - fovApplied) < 0.05) return
  fovApplied = next
  VirtualCamera.getMutable(camEntity).fov = next
}

function stepScale(dir: 1 | -1): void {
  const table = zoomScales()
  if (dir < 0) {
    for (let i = table.length - 1; i >= 0; i--) if (table[i] < scale - 0.01) { scale = table[i]; return }
    scale = table[0]
  } else {
    for (const step of table) if (step > scale + 0.01) { scale = step; return }
    scale = table[table.length - 1]
  }
}

export function overviewZoomIn(): void { if (active) stepScale(-1) }
export function overviewZoomOut(): void { if (active) stepScale(1) }
export function canOverviewZoomIn(): boolean { return active && scale > zoomScales()[0] + 0.01 }
export function canOverviewZoomOut(): boolean { return active && scale < zoomScales()[zoomScales().length - 1] - 0.01 }
