/**
 * fallRescue.ts — Lakitu-style fall pickup (slice 1).
 *
 * Crossing the sky fall line catches the player once. An invisible physics
 * panel (same pattern as the early-join spawn pads in player.ts) appears under
 * their feet, one movePlayerTo puts them on it, and they stand there for the
 * beat. The body does not freefall, and nothing re-teleports them during
 * grab/carry — that loop was the stutter.
 *
 * The panel does not slide toward base. SDK7 MeshColliders do not carry the
 * character controller, so moving the panel would drop them off the edge.
 * Y stays steady; the floater (parented to the panel) bobs. At drop the panel
 * is removed and one teleport sends them to the team base.
 *
 * Beat (Luke: tweak FALL_RESCUE):
 *   trip (t=0)     lock movement + paint / Lunge / Burst, send playerFell, soft swoosh,
 *                  spawn the panel, one movePlayerTo onto it (holdFallLine so it does not re-trip)
 *   grab           floater swoops in, parented to the panel
 *   carry          floater hangs and bobs; still locked; panel stays put
 *   drop           remove the panel, movePlayerTo team base, player:respawned
 *   peel           floater rises off and despawns, once the base teleport has landed
 *   land           walk only, abilities still off, then normal play
 *
 * Trip → drop = GRAB_S + CARRY_S (target 3.0–3.5s). Land lock is after that.
 * Round reset / team / initial teleports call cancelFallRescue via teleportHome
 * and do not wait out a pickup. player:respawned fires only on the base drop.
 */

import { engine, Entity, Material, MeshCollider, MeshRenderer, Transform, ColliderLayer } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { isMazeReady } from '../maze/rebuild'
import { baseSpawn, MIN_Y, SCENE_SIZE } from '../maze/generator'
import { FALL_RESPAWN_DROP, IS_SKY } from '../maze/level'
import { Team } from '../shared/team'
import { playFallRescueSfx } from './audio'
import { localTeam } from './knockback'
import { interruptLocalLunge, setFallMoveLock } from './lunge'
import { exitOverview } from './overviewCamera'

/** Pickup timings and floater offsets. One place to tune in playtest. */
export const FALL_RESCUE = {
  /** Floater swoops in. Movement already locked. */
  GRAB_S: 0.4,
  /** Out of the fight, floater overhead. GRAB_S + CARRY_S = 3.2s trip to drop. */
  CARRY_S: 2.8,
  /** Rise-and-shrink after the base teleport is visible. */
  PEEL_S: 0.3,
  /** Walk only / no abilities after the drop, before full control. Target 0.5–0.8s. */
  LAND_LOCK_S: 0.65,
  /** If movePlayerTo hasn't put us back above the fall line, allow another trip after this. */
  REARM_S: 2,
  /** Don't wait longer than this for the drop teleport before peeling the floater. */
  PEEL_WAIT_S: 0.45,
  /** Floater root height above the player origin while carrying. */
  HANG_Y: 2.65,
  /** Extra height at the start of the grab swoop. */
  APPROACH_EXTRA_Y: 4.5,
  /** How far the floater climbs while it peels off. */
  PEEL_RISE: 2.2,
  /** Panel top is this far below the fall line (MIN_Y - FALL_RESPAWN_DROP). ~2 m → y≈64, under the arena, not the ground. */
  HOLD_BELOW_LINE: 2,
  /** Invisible pad width (m). Wide enough that leftover knock momentum still lands on it. */
  PAD_SIZE: 12,
  /** Invisible pad thickness (m). Thick so a fast fall doesn't tunnel through before the catch teleport lands. */
  PAD_THICK: 2,
  /** Feet this far above the pad top for the one catch teleport, so they settle onto it once. */
  FEET_CLEAR: 0.25,
  /** Floater bob (m) while the pad Y stays fixed. */
  BOB: 0.12,
}

const CLOUD_MAT = {
  albedoColor: Color4.create(0.75, 0.92, 1, 1),
  emissiveColor: Color4.create(0.55, 0.85, 1, 1),
  emissiveIntensity: 3,
  roughness: 0.35,
  metallic: 0,
  castShadows: false,
}
const HOOK_MAT = {
  albedoColor: Color4.create(1, 0.86, 0.25, 1),
  emissiveColor: Color4.create(1, 0.75, 0.15, 1),
  emissiveIntensity: 4,
  roughness: 0.4,
  metallic: 0,
  castShadows: false,
}

type Phase = 'idle' | 'grab' | 'carry' | 'land'
type FloaterMode = 'in' | 'hang' | 'wait' | 'peel'
type Floater = { root: Entity; ents: Entity[]; mode: FloaterMode; peelLeft: number; waitLeft: number; bob: number }

let installed = false
let onDrop: () => void = () => {}
let phase: Phase = 'idle'
let phaseLeft = 0
let floater: Floater | null = null
/** False from a home teleport until we're above the fall line again (or REARM_S). */
let rearm = true
let rearmLeft = 0
/** Panel root (unit scale, at the surface). Null once we drop or cancel. */
let padRoot: Entity | null = null
let padCollider: Entity | null = null

function fallLine(): number { return MIN_Y - FALL_RESPAWN_DROP }
function holdHeight(): number { return fallLine() - FALL_RESCUE.HOLD_BELOW_LINE }

/** Camera / body aim: team base, level with the hold so the view doesn't tip into the void. */
function catchLook(hold: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const base = baseSpawn(localTeam() === Team.Blue ? 2 : 1).pos
  let dx = base.x - hold.x
  let dz = base.z - hold.z
  if (dx * dx + dz * dz < 4) {
    dx = SCENE_SIZE / 2 - hold.x
    dz = SCENE_SIZE / 2 - hold.z
  }
  const len = Math.hypot(dx, dz) || 1
  return { x: hold.x + (dx / len) * 8, y: hold.y, z: hold.z + (dz / len) * 8 }
}

/** One catch. The panel is already in the world; this only places the avatar on it. */
function catchOnce(hold: { x: number; y: number; z: number }): void {
  holdFallLine()
  exitOverview()
  const feet = { x: hold.x, y: hold.y + FALL_RESCUE.FEET_CLEAR, z: hold.z }
  const look = catchLook(feet)
  movePlayerTo({ newRelativePosition: feet, cameraTarget: look, avatarTarget: look }).catch(() => {})
}

function playerPos(): { x: number; y: number; z: number } | null {
  const t = Transform.getOrNull(engine.PlayerEntity)
  return t ? { x: t.position.x, y: t.position.y, z: t.position.z } : null
}

/** Local offset while parented to the pad; world position once the pad is gone (peel / base). */
function placeFloater(yOff: number, scale: number, world: { x: number; y: number; z: number } | null): void {
  if (!floater) return
  const tr = Transform.getMutable(floater.root)
  const s = Math.max(0.02, scale)
  tr.scale = Vector3.create(s, s, s)
  if (padRoot && (phase === 'grab' || phase === 'carry')) tr.position = Vector3.create(0, yOff, 0)
  else if (world) tr.position = Vector3.create(world.x, world.y + yOff, world.z)
}

function despawnFloater(): void {
  if (!floater) return
  for (let i = floater.ents.length - 1; i >= 0; i--) engine.removeEntity(floater.ents[i])
  floater = null
}

function despawnPad(): void {
  if (padCollider) { engine.removeEntity(padCollider); padCollider = null }
  if (padRoot) { engine.removeEntity(padRoot); padRoot = null }
}

/** Unit-scale root at the surface, thick physics box hanging below it. No mesh: invisible, same as the spawn pads. */
function spawnPad(hold: { x: number; y: number; z: number }): void {
  despawnPad()
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(hold.x, hold.y, hold.z) })
  const box = engine.addEntity()
  const thick = FALL_RESCUE.PAD_THICK
  Transform.create(box, {
    parent: root,
    position: Vector3.create(0, -thick / 2, 0),
    scale: Vector3.create(FALL_RESCUE.PAD_SIZE, thick, FALL_RESCUE.PAD_SIZE),
  })
  MeshCollider.setBox(box, ColliderLayer.CL_PHYSICS)
  padRoot = root
  padCollider = box
}

/** World position of the floater root. Parent scale is 1 and rotation is identity while it's on the pad. */
function floaterWorld(): { x: number; y: number; z: number } | null {
  if (!floater) return null
  const local = Transform.getOrNull(floater.root)
  if (!local) return null
  if (!padRoot) return local.position
  const pad = Transform.getOrNull(padRoot)
  if (!pad) return local.position
  return { x: pad.position.x + local.position.x, y: pad.position.y + local.position.y, z: pad.position.z + local.position.z }
}

/** Leave the pad before it is removed so the peel can play at the base. */
function detachFloater(): void {
  if (!floater || !padRoot) return
  const world = floaterWorld()
  const local = Transform.getOrNull(floater.root)
  if (!world || !local) return
  Transform.createOrReplace(floater.root, {
    position: Vector3.create(world.x, world.y, world.z),
    scale: Vector3.create(local.scale.x, local.scale.y, local.scale.z),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  })
}

function makePart(parent: Entity, pos: Vector3, scale: Vector3, shape: 'sphere' | 'box', mat: typeof CLOUD_MAT): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos, scale })
  if (shape === 'sphere') MeshRenderer.setSphere(e)
  else MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, mat)
  return e
}

/** Local placeholder parented to the pad: a bright cloud, a stem, and a hook. No character model. */
function spawnFloater(): void {
  if (!padRoot) return
  despawnFloater()
  const root = engine.addEntity()
  Transform.create(root, {
    parent: padRoot,
    position: Vector3.create(0, FALL_RESCUE.HANG_Y + FALL_RESCUE.APPROACH_EXTRA_Y, 0),
    scale: Vector3.create(0.2, 0.2, 0.2),
  })
  const cloud = makePart(root, Vector3.create(0, 0.35, 0), Vector3.create(1.45, 0.72, 1.15), 'sphere', CLOUD_MAT)
  const puffL = makePart(root, Vector3.create(-0.55, 0.22, 0.05), Vector3.create(0.7, 0.5, 0.62), 'sphere', CLOUD_MAT)
  const puffR = makePart(root, Vector3.create(0.58, 0.18, -0.08), Vector3.create(0.62, 0.46, 0.55), 'sphere', CLOUD_MAT)
  const stem = makePart(root, Vector3.create(0, -0.28, 0), Vector3.create(0.07, 0.85, 0.07), 'box', HOOK_MAT)
  const hook = makePart(root, Vector3.create(0, -0.78, 0), Vector3.create(0.34, 0.34, 0.34), 'sphere', HOOK_MAT)
  floater = { root, ents: [root, cloud, puffL, puffR, stem, hook], mode: 'in', peelLeft: 0, waitLeft: 0, bob: 0 }
}

function begin(y: number): void {
  const line = fallLine()
  const p = playerPos()
  phase = 'grab'
  phaseLeft = FALL_RESCUE.GRAB_S
  // Interrupt first: cancelling a lunge rewrites InputModifier, then the freeze wins.
  interruptLocalLunge('fell')
  setFallMoveLock('frozen')
  playFallRescueSfx()
  if (p) {
    const hold = { x: p.x, y: holdHeight(), z: p.z }
    spawnPad(hold)
    spawnFloater()
    catchOnce(hold)
  }
  try { room.send('playerFell', {}) } catch (err) { console.log('[FallRescue] playerFell send failed', err) }
  const beat = (FALL_RESCUE.GRAB_S + FALL_RESCUE.CARRY_S).toFixed(2)
  console.log(`[FallRescue] trip y=${y.toFixed(1)} line=${line.toFixed(1)} pad=${holdHeight().toFixed(1)} one catch, no rehold, pickup ${beat}s`)
}

function drop(): void {
  detachFloater()
  despawnPad()
  phase = 'land'
  phaseLeft = FALL_RESCUE.LAND_LOCK_S
  setFallMoveLock('walk')
  if (floater) { floater.mode = 'wait'; floater.waitLeft = FALL_RESCUE.PEEL_WAIT_S }
  console.log(`[FallRescue] drop → base (pad removed, land lock ${FALL_RESCUE.LAND_LOCK_S}s)`)
  onDrop()
}

function tickPhase(dt: number): void {
  phaseLeft -= dt
  if (phase === 'grab' && phaseLeft <= 0) {
    phase = 'carry'
    phaseLeft = FALL_RESCUE.CARRY_S
    if (floater) floater.mode = 'hang'
    return
  }
  if (phase === 'carry' && phaseLeft <= 0) {
    drop()
    return
  }
  if (phase === 'land' && phaseLeft <= 0) {
    phase = 'idle'
    phaseLeft = 0
    setFallMoveLock('open')
    console.log('[FallRescue] land lock done')
  }
}

function tickFloater(dt: number, line: number): void {
  if (!floater) return
  const onPad = padRoot !== null && (phase === 'grab' || phase === 'carry')
  const world = onPad ? null : playerPos()
  if (!onPad && !world) { despawnFloater(); return }
  floater.bob += dt
  const bob = Math.sin(floater.bob * 3.2) * FALL_RESCUE.BOB
  if (floater.mode === 'in') {
    const u = 1 - Math.max(0, phaseLeft) / FALL_RESCUE.GRAB_S
    placeFloater(FALL_RESCUE.HANG_Y + (1 - u) * FALL_RESCUE.APPROACH_EXTRA_Y + bob * u, 0.2 + 0.8 * u, world)
    return
  }
  if (floater.mode === 'hang' || floater.mode === 'wait') {
    placeFloater(FALL_RESCUE.HANG_Y + bob, 1, world)
    if (floater.mode === 'wait') {
      floater.waitLeft -= dt
      const liveY = playerPos()?.y
      if ((liveY !== undefined && liveY >= line) || floater.waitLeft <= 0) {
        floater.mode = 'peel'
        floater.peelLeft = FALL_RESCUE.PEEL_S
      }
    }
    return
  }
  floater.peelLeft -= dt
  const u = 1 - Math.max(0, floater.peelLeft) / FALL_RESCUE.PEEL_S
  placeFloater(FALL_RESCUE.HANG_Y + u * FALL_RESCUE.PEEL_RISE, 1 - u, world)
  if (floater.peelLeft <= 0) despawnFloater()
}

function tick(dt: number): void {
  // A background hitch shouldn't skip the whole pickup and drop on the same frame.
  const step = Math.min(dt, 0.1)
  const line = fallLine()
  if (!rearm) {
    if (rearmLeft > 0) rearmLeft -= step
    const y = playerPos()?.y
    if ((y !== undefined && y >= line) || rearmLeft <= 0) rearm = true
  }
  if (phase !== 'idle') tickPhase(step)
  tickFloater(step, line)
  if (phase !== 'idle' || !rearm || !isMazeReady()) return
  const y = playerPos()?.y
  if (y === undefined || y >= line) return
  begin(y)
}

/** Ignore the fall line until we're above it again. movePlayerTo is async. */
export function holdFallLine(): void {
  rearm = false
  rearmLeft = FALL_RESCUE.REARM_S
}

/** Round reset / team / initial spawn: drop the pickup immediately. Idempotent. */
export function cancelFallRescue(why: string): void {
  if (phase === 'idle' && !floater && !padRoot) return
  console.log(`[FallRescue] cancel (${why})`)
  phase = 'idle'
  phaseLeft = 0
  despawnFloater()
  despawnPad()
  setFallMoveLock('open')
}

/** `dropAtBase` is teleportHome('fell') — base move + player:respawned. No-op off sky. */
export function initFallRescue(dropAtBase: () => void): void {
  if (installed) return
  installed = true
  onDrop = dropAtBase
  if (!IS_SKY || MIN_Y < FALL_RESPAWN_DROP) return
  engine.addSystem(tick)
}
