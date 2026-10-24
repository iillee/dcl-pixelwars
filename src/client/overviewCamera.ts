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
 * Steps are a table, not a fixed subtraction. Each entry is ~×1.35 the last.
 * Pitch is OV_PITCH_DEG at every step — the same fixed isometric angle as main.
 * A 35.26° throw cannot back up past about scale 50 (scene ceiling), so desktop
 * steps past that clamp, including the default 55 and then 74, 100 and 135,
 * keep the camera where the clamp put it and zoom out only by widening
 * VirtualCamera.fov. Do not lower the pitch to fake those steps: if a live fov
 * write does not take effect, the picture stays put and that has to be reported
 * as a client limit.
 *
 * Mobile stays on its original three levels (max 25) and starts at the closest.
 * Desktop starts at 55 and keeps that step across toggles. The table is latched
 * when overview opens: isMobile() resolves async, and a live re-read would
 * compare scale 55 to the mobile max of 25 and disable minus.
 */
const MOBILE_ZOOM_SCALES = [5, 15, 25]
const DESKTOP_ZOOM_SCALES = [5, 7, 9, 12, 17, 22, 30, 41, 55, 74, 100, 135]
const DESKTOP_DEFAULT_SCALE = 55
/** Safety cap. 74 / 100 / 135 at a typical play height land well under this. */
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
let scale = DESKTOP_DEFAULT_SCALE
let scaleInit = false
/** Index into the table latched in `zoomMobile`. Desktop starts on 55, so minus has 74, 100, 135 left. */
let zoomIndex = DESKTOP_ZOOM_SCALES.indexOf(DESKTOP_DEFAULT_SCALE)
/** Platform latched while overview is open. Reading isMobile() live would
 *  judge a desktop scale of 55 against the mobile max of 25 once detection
 *  resolves, and minus would disable with no click. */
let zoomMobile = false
/** Eased scale. Distance and fov come from this. Pitch stays OV_PITCH_DEG. */
let viewScale = DESKTOP_DEFAULT_SCALE
/** Lens used when the wanted throw is longer than the fixed-pitch clamp. */
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
    if (mobileWant && !active && resumeIn <= 0 && isMobile()) setActive(true)
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
  viewScale += (scale - viewScale) * ease
  if (Math.abs(scale - viewScale) < 0.02) viewScale = scale
  applyFraming(viewScale)
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

/** Longest throw at the fixed isometric pitch that stays inside the scene and under the ceiling. */
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

/** Camera stays on OV_PITCH_DEG. Past the clamp, only the lens changes. */
function applyFraming(view: number): void {
  const wantDist = view * DIST_PER_SCALE
  const cap = maxDistance()
  camDist = Math.min(wantDist, cap)
  fov = targetFov(wantDist, camDist)
  writeFov(fov)
}

function zoomTable(): readonly number[] {
  return zoomMobile ? MOBILE_ZOOM_SCALES : DESKTOP_ZOOM_SCALES
}

/** `snapDefault` on the first open, and on every mobile open (closest level). Desktop keeps its step, which starts at 55. */
function useZoomTable(mobile: boolean, snapDefault: boolean): void {
  zoomMobile = mobile
  const table = mobile ? MOBILE_ZOOM_SCALES : DESKTOP_ZOOM_SCALES
  if (snapDefault) {
    const i = mobile ? 0 : table.indexOf(DESKTOP_DEFAULT_SCALE)
    zoomIndex = i >= 0 ? i : 0
  } else if (zoomIndex < 0 || zoomIndex >= table.length) {
    zoomIndex = 0
  }
  scale = table[zoomIndex]
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
/** After a forced exit (respawn / teleport), wait this long before mobile re-enters overview. */
const MOBILE_RESUME_S = 1.0
function setActive(on: boolean): void {
  if (camEntity === null) return
  active = on
  if (active) {
    const mobile = isMobile()
    // First open picks the platform default. Mobile re-opens at its closest
    // level. Desktop stays on the step it already had, which begins at 55.
    useZoomTable(mobile, !scaleInit || mobile)
    scaleInit = true
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (p) { focus.x = p.x; focus.y = Math.max(p.y, BASE_Y - 15); focus.z = p.z }
    viewScale = scale
    applyFraming(viewScale)
    place()
  }
  const main = MainCamera.getMutableOrNull(engine.CameraEntity) ?? MainCamera.create(engine.CameraEntity)
  main.virtualCameraEntity = active ? camEntity : undefined
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

/** Same framed width as an OV_FOV_DEG camera at `wantDist`, when it can only sit at `distCap`. In range, the lens stays OV_FOV_DEG. */
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
  const table = zoomTable()
  const next = zoomIndex + dir
  if (next < 0 || next >= table.length) return
  zoomIndex = next
  scale = table[zoomIndex]
}

export function overviewZoomIn(): void { if (active) stepScale(-1) }
export function overviewZoomOut(): void { if (active) stepScale(1) }
export function canOverviewZoomIn(): boolean { return active && zoomIndex > 0 }
export function canOverviewZoomOut(): boolean { return active && zoomIndex < zoomTable().length - 1 }
