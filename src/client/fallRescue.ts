/**
 * fallRescue.ts — Lakitu-style fall pickup (slice 1).
 *
 * Crossing the sky fall line catches the player once. An invisible physics
 * panel (MeshCollider + CL_PHYSICS, same box as the early-join spawn pads)
 * appears just under their feet — led a little by fall speed — and a Tween
 * carries that panel up and over to just above the team base. The catch does
 * not move or aim the camera. movePlayerTo at the catch is only a tiny
 * position nudge if they are already under the surface, with no look target.
 *
 * SDK 7.30.2 does carry a standing avatar on a Tween platform. The explorer
 * docs say a player standing on an entity moves with it when that entity
 * moves, and a blocked InputModifier still leaves moving platforms in effect.
 * The earlier "colliders don't carry" note was about writing Transform every
 * frame — that is not a platform, and it stutters. This path does not write
 * Transform per frame. The collider sits on the tweened entity (a physics
 * child jitters). TweenSequence is not used: in this SDK its loop is only
 * restart or yoyo, and an emptied restart sequence replays the path.
 *
 * If they drift more than a few meters off the panel, one teleport sends
 * them to base (snap fallback). No rehold loop. A camera fly-along is not
 * used — the Tween API is here and is the documented carry.
 *
 * Beat (Luke: tweak FALL_RESCUE):
 *   trip (t=0)     lock movement + paint / Lunge / Burst, send playerFell, soft swoosh,
 *                  spawn the panel under their feet (holdFallLine so it does not re-trip).
 *                  No catch teleport and no camera / avatar target — the view stays put.
 *   grab           floater swoops in, parented to the panel; panel stays put so they can land on it
 *   carry          Tween: rise above the arena, cruise to the base, descend to just above it.
 *                  Floater rides along. Movement stays locked.
 *   arrive         remove the panel so they drop onto the base. player:respawned.
 *                  A movePlayerTo happens only on the snap fallback.
 *   peel           floater rises off and despawns
 *   land           walk only, abilities still off, then normal play
 *
 * Trip → landing = GRAB_S + RISE_S + CRUISE_S + DESCEND_S (about 3.8s).
 * Round reset / team / initial teleports call cancelFallRescue via teleportHome
 * and drop the panel and the tween. player:respawned fires only on arrival.
 */

import {
  engine, Entity, Material, MeshCollider, MeshRenderer, Transform, Tween, TweenSequence, ColliderLayer, EasingFunction,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { room } from '../shared/messages'
import { isMazeReady } from '../maze/rebuild'
import { baseSpawn, MIN_Y } from '../maze/generator'
import { FALL_RESPAWN_DROP, IS_SKY, SKY_TOP_Y } from '../maze/level'
import { Team } from '../shared/team'
import { playFallRescueSfx } from './audio'
import { localTeam } from './knockback'
import { interruptLocalLunge, setFallMoveLock } from './lunge'
import { exitOverview } from './overviewCamera'

/** Pickup timings, carry path, and floater offsets. One place to tune in playtest. */
export const FALL_RESCUE = {
  /** Floater swoops in. Panel stays put so they can fall onto it. The rise does the lift. */
  GRAB_S: 0.4,
  /** Rise from the catch to cruise height. */
  RISE_S: 0.9,
  /** Cruise across, above the top floor, to the base's XZ. */
  CRUISE_S: 1.7,
  /** Descend so the panel top sits just above the base. */
  DESCEND_S: 0.8,
  /** Rise-and-shrink after arrival. */
  PEEL_S: 0.3,
  /** Walk only / no abilities after arrival, before full control. Target 0.5–0.8s. */
  LAND_LOCK_S: 0.65,
  /** If a teleport hasn't put us back above the fall line, allow another trip after this. */
  REARM_S: 2,
  /** Don't wait longer than this for a snap teleport before peeling the floater. */
  PEEL_WAIT_S: 0.45,
  /** Floater root height above the panel surface while carrying. */
  HANG_Y: 2.65,
  /** Extra height at the start of the grab swoop. */
  APPROACH_EXTRA_Y: 4.5,
  /** How far the floater climbs while it peels off. */
  PEEL_RISE: 2.2,
  /** Seconds of current velocity used to place the pad ahead of the fall, so they meet it. */
  CATCH_LEAD_S: 0.12,
  /** Pad surface at least this far under the feet. Keeps the box from spawning inside the body. */
  CATCH_MIN_DROP: 0.3,
  /** Cap that lead. A fast fall must not open a long drop before the rise; the box thickness covers one late frame. */
  CATCH_MAX_DROP: 1.2,
  /** If they are already under the surface by more than this, do not yoink them. Slip fallback handles a real miss. */
  CATCH_NUDGE_M: 0.75,
  /** Invisible pad width (m). Wide enough that leftover knock momentum still lands on it. */
  PAD_SIZE: 12,
  /** Invisible pad thickness (m). Thick so a fast fall doesn't tunnel through before the catch teleport lands. */
  PAD_THICK: 2,
  /** Feet this far above the pad top for the one catch teleport, so they settle onto it once. */
  FEET_CLEAR: 0.25,
  /** Floater bob (m). The pad itself does not bob — a per-frame Transform write is not the carry. */
  BOB: 0.12,
  /** Panel surface this many meters above SKY_TOP_Y while cruising, so the trip clears the roof. */
  CRUISE_CLEAR: 8,
  /**
   * Panel surface above the base feet (baseSpawn y). High enough that the
   * thick box stays clear of the base slab; removing the panel is the drop.
   */
  ARRIVE_ABOVE: 1.5,
  /** Metres past the panel edge, or off its surface, before the one snap teleport. */
  SLIP_M: 3,
  /** Ignore slip at the start of the move so landing on the pad can finish. */
  SLIP_GRACE_S: 0.5,
  /** Must stay off the panel this long. One bad frame is not a teleport. */
  SLIP_SUSTAIN_S: 0.35,
  /** After the last leg's duration, wait this long for the renderer to catch up before snapping. */
  ARRIVE_SLACK_S: 0.45,
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
type Vec = { x: number; y: number; z: number }
type Leg = { from: Vec; to: Vec; ms: number }
type Carry = { legs: Leg[]; index: number; legAt: number; beganAt: number }

/** How the rescue ended. `carry` already delivered them; `snap` still needs the base teleport. */
export type FallRescueEnd = 'snap' | 'carry'

let installed = false
let onEnd: (how: FallRescueEnd) => void = () => {}
let phase: Phase = 'idle'
let phaseLeft = 0
let floater: Floater | null = null
/** False from a home teleport until we're above the fall line again (or REARM_S). */
let rearm = true
let rearmLeft = 0
/** Tweened physics box. Its center is the transform; the surface is PAD_THICK/2 above that. */
let pad: Entity | null = null
/** Unit-scale child on the top face so the floater doesn't inherit the pad's scale. */
let anchor: Entity | null = null
let carry: Carry | null = null
let slipAccum = 0
/** Last idle sample, so the catch can lead the pad by fall speed instead of teleporting. */
let sample: { p: Vec; at: number } | null = null

function fallLine(): number { return MIN_Y - FALL_RESPAWN_DROP }
function ms(s: number): number { return Math.max(1, Math.round(s * 1000)) }
function lerp(a: Vec, b: Vec, u: number): Vec {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }
}
function v3(p: Vec): Vector3 { return Vector3.create(p.x, p.y, p.z) }

function remember(p: Vec): void {
  sample = { p, at: Date.now() }
}

/** Velocity since the previous sample. A stale or missing sample is zero — place the pad under where they are now. */
function fallVelocity(p: Vec): Vec {
  if (!sample) return { x: 0, y: 0, z: 0 }
  const dt = (Date.now() - sample.at) / 1000
  if (dt < 0.001 || dt > 0.5) return { x: 0, y: 0, z: 0 }
  return { x: (p.x - sample.p.x) / dt, y: (p.y - sample.p.y) / dt, z: (p.z - sample.p.z) / dt }
}

/**
 * Pad top just under the feet, a short step ahead of the fall. Same XZ, plus a
 * small horizontal lead that still leaves them near the middle of the pad.
 * No teleport: the rise leg is the lift, and the camera keeps its current aim.
 */
function catchPoint(p: Vec, v: Vec): Vec {
  const fall = Math.max(0, -v.y)
  const drop = Math.min(
    FALL_RESCUE.CATCH_MAX_DROP,
    Math.max(FALL_RESCUE.CATCH_MIN_DROP, fall * FALL_RESCUE.CATCH_LEAD_S),
  )
  let lx = v.x * FALL_RESCUE.CATCH_LEAD_S
  let lz = v.z * FALL_RESCUE.CATCH_LEAD_S
  const h = Math.hypot(lx, lz)
  const cap = FALL_RESCUE.PAD_SIZE * 0.2
  if (h > cap) { lx *= cap / h; lz *= cap / h }
  return { x: p.x + lx, y: p.y - drop, z: p.z + lz }
}

/**
 * They slipped through the top during the grab. Nudge Y only, and only when the
 * gap is tiny. No cameraTarget / avatarTarget — those were the one-frame look snap.
 * Returns the teleport distance, or 0 when the catch stays a plain landing.
 */
function nudgeOntoPad(): number {
  const p = playerPos()
  const surface = surfaceNow()
  if (!p || !surface) return 0
  const half = FALL_RESCUE.PAD_SIZE / 2
  if (Math.hypot(p.x - surface.x, p.z - surface.z) > half) return 0
  // On the surface, or still falling toward it: leave them. Only a body already inside the box is nudged.
  const below = surface.y - p.y
  if (below <= 0.15 || below > FALL_RESCUE.CATCH_NUDGE_M) return 0
  const feetY = surface.y + FALL_RESCUE.FEET_CLEAR
  const delta = feetY - p.y
  movePlayerTo({ newRelativePosition: { x: p.x, y: feetY, z: p.z } }).catch(() => {})
  holdFallLine()
  console.log(`[FallRescue] catch teleport ${delta.toFixed(2)}m (no look target)`)
  return delta
}

function playerPos(): Vec | null {
  const t = Transform.getOrNull(engine.PlayerEntity)
  return t ? { x: t.position.x, y: t.position.y, z: t.position.z } : null
}

/**
 * Where the box center is. Prefer the renderer Transform once the tween has
 * actually moved it (it stays in sync with the avatar). Until then use the
 * authored leg, so a Transform that never leaves the catch still counts as
 * the panel moving away.
 */
function padCenterNow(): Vec | null {
  if (!pad) return null
  const live = Transform.getOrNull(pad)
  const livePos = live ? { x: live.position.x, y: live.position.y, z: live.position.z } : null
  if (!carry) return livePos
  const leg = carry.legs[carry.index]
  if (livePos) {
    const start = leg.from
    const moved = Math.hypot(livePos.x - start.x, livePos.y - start.y, livePos.z - start.z)
    if (moved > 0.5) return livePos
  }
  const u = Math.min(1, Math.max(0, (Date.now() - carry.legAt) / leg.ms))
  return lerp(leg.from, leg.to, u)
}

function surfaceNow(): Vec | null {
  const c = padCenterNow()
  if (!c) return null
  return { x: c.x, y: c.y + FALL_RESCUE.PAD_THICK / 2, z: c.z }
}

/** Past the edge of the footprint, or more than a few meters off the surface. */
function offPanel(player: Vec, surface: Vec): boolean {
  const half = FALL_RESCUE.PAD_SIZE / 2
  const ox = Math.max(0, Math.abs(player.x - surface.x) - half)
  const oz = Math.max(0, Math.abs(player.z - surface.z) - half)
  if (Math.hypot(ox, oz) > FALL_RESCUE.SLIP_M) return true
  return Math.abs(player.y - surface.y) > FALL_RESCUE.SLIP_M
}

/** Local offset while parented to the anchor; world position once the pad is gone (peel / base). */
function placeFloater(yOff: number, scale: number, world: Vec | null): void {
  if (!floater) return
  const tr = Transform.getMutable(floater.root)
  const s = Math.max(0.02, scale)
  tr.scale = Vector3.create(s, s, s)
  if (anchor && (phase === 'grab' || phase === 'carry')) tr.position = Vector3.create(0, yOff, 0)
  else if (world) tr.position = Vector3.create(world.x, world.y + yOff, world.z)
}

function despawnFloater(): void {
  if (!floater) return
  for (let i = floater.ents.length - 1; i >= 0; i--) engine.removeEntity(floater.ents[i])
  floater = null
}

function stopMotion(): void {
  if (!pad) return
  if (Tween.has(pad)) Tween.deleteFrom(pad)
  if (TweenSequence.has(pad)) TweenSequence.deleteFrom(pad)
}

function despawnPad(): void {
  stopMotion()
  if (anchor) { engine.removeEntity(anchor); anchor = null }
  if (pad) { engine.removeEntity(pad); pad = null }
}

/**
 * Physics box is the tweened root (center at the transform, top at +scale.y/2).
 * The anchor cancels that scale so the floater stays metre-sized and rides along.
 */
function spawnPad(hold: Vec): void {
  despawnPad()
  const size = FALL_RESCUE.PAD_SIZE
  const thick = FALL_RESCUE.PAD_THICK
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(hold.x, hold.y - thick / 2, hold.z),
    scale: Vector3.create(size, thick, size),
  })
  MeshCollider.setBox(root, ColliderLayer.CL_PHYSICS)
  const hang = engine.addEntity()
  Transform.create(hang, {
    parent: root,
    position: Vector3.create(0, 0.5, 0),
    scale: Vector3.create(1 / size, 1 / thick, 1 / size),
  })
  pad = root
  anchor = hang
}

/** World position of the floater root. Anchor world scale is 1 and rotation stays identity. */
function floaterWorld(): Vec | null {
  if (!floater) return null
  const local = Transform.getOrNull(floater.root)
  if (!local) return null
  const localPos = { x: local.position.x, y: local.position.y, z: local.position.z }
  if (!anchor || (phase !== 'grab' && phase !== 'carry')) return localPos
  const surface = surfaceNow()
  if (!surface) return localPos
  return { x: surface.x + localPos.x, y: surface.y + localPos.y, z: surface.z + localPos.z }
}

/** Leave the pad before it is removed so the peel can play at the arrival point. */
function detachFloater(): void {
  if (!floater || !anchor) return
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
  if (!anchor) return
  despawnFloater()
  const root = engine.addEntity()
  Transform.create(root, {
    parent: anchor,
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

function playLeg(index: number): void {
  if (!pad || !carry) return
  const leg = carry.legs[index]
  carry.index = index
  carry.legAt = Date.now()
  // Explicit start equals the current end. An omitted start would snap the entity to the origin.
  Tween.setMove(pad, v3(leg.from), v3(leg.to), leg.ms, EasingFunction.EF_LINEAR)
}

/** Three linear legs. Start positions are the pad center, not the surface. */
function startCarry(): void {
  if (!pad) { finish('snap', 'no panel'); return }
  const tr = Transform.getOrNull(pad)
  if (!tr) { finish('snap', 'panel has no transform'); return }
  const start = { x: tr.position.x, y: tr.position.y, z: tr.position.z }
  const base = baseSpawn(localTeam() === Team.Blue ? 2 : 1).pos
  const thick = FALL_RESCUE.PAD_THICK
  const cruiseY = SKY_TOP_Y + FALL_RESCUE.CRUISE_CLEAR - thick / 2
  const arriveY = base.y + FALL_RESCUE.ARRIVE_ABOVE - thick / 2
  const riseTo = { x: start.x, y: cruiseY, z: start.z }
  const cruiseTo = { x: base.x, y: cruiseY, z: base.z }
  const landAt = { x: base.x, y: arriveY, z: base.z }
  const now = Date.now()
  carry = {
    legs: [
      { from: start, to: riseTo, ms: ms(FALL_RESCUE.RISE_S) },
      { from: riseTo, to: cruiseTo, ms: ms(FALL_RESCUE.CRUISE_S) },
      { from: cruiseTo, to: landAt, ms: ms(FALL_RESCUE.DESCEND_S) },
    ],
    index: 0,
    legAt: now,
    beganAt: now,
  }
  slipAccum = 0
  playLeg(0)
  const trip = (FALL_RESCUE.GRAB_S + FALL_RESCUE.RISE_S + FALL_RESCUE.CRUISE_S + FALL_RESCUE.DESCEND_S).toFixed(2)
  const surfaceCruise = cruiseY + thick / 2
  const surfaceArrive = arriveY + thick / 2
  console.log(
    `[FallRescue] tween-carry ${trip}s trip, cruiseY=${surfaceCruise.toFixed(1)} arriveY=${surfaceArrive.toFixed(1)} → base ${base.x.toFixed(0)},${base.z.toFixed(0)}`,
  )
}

/** Close enough to the last waypoint that dropping the panel lands them on the base. */
function atDestination(player: Vec): boolean {
  if (!carry) return false
  const end = carry.legs[carry.legs.length - 1].to
  const surfaceY = end.y + FALL_RESCUE.PAD_THICK / 2
  const dx = player.x - end.x
  const dz = player.z - end.z
  return Math.hypot(dx, dz) <= FALL_RESCUE.PAD_SIZE / 2 + 1 && Math.abs(player.y - surfaceY) <= FALL_RESCUE.SLIP_M
}

/** Renderer Transform has reached this leg's end, or it never left the start (not tracking). */
function legVisuallyDone(leg: Leg): boolean {
  if (!pad) return true
  const live = Transform.getOrNull(pad)
  if (!live) return true
  const fromStart = Math.hypot(live.position.x - leg.from.x, live.position.y - leg.from.y, live.position.z - leg.from.z)
  if (fromStart < 0.5) return true
  const left = Math.hypot(live.position.x - leg.to.x, live.position.y - leg.to.y, live.position.z - leg.to.z)
  return left < 1.5
}

function tickCarry(dt: number): void {
  if (!carry || !pad) { finish('snap', 'carry missing'); return }
  const graceOver = (Date.now() - carry.beganAt) / 1000 >= FALL_RESCUE.SLIP_GRACE_S
  const p = playerPos()
  const surface = surfaceNow()
  if (graceOver && p && surface) {
    if (offPanel(p, surface)) slipAccum += dt
    else slipAccum = 0
    if (slipAccum >= FALL_RESCUE.SLIP_SUSTAIN_S) {
      finish('snap', 'drifted off the panel')
      return
    }
  }
  const leg = carry.legs[carry.index]
  const elapsed = Date.now() - carry.legAt
  if (elapsed < leg.ms) return
  // Don't replace the tween while the renderer is still finishing this leg.
  if (!legVisuallyDone(leg) && (elapsed - leg.ms) / 1000 < FALL_RESCUE.ARRIVE_SLACK_S) return
  if (carry.index < carry.legs.length - 1) {
    playLeg(carry.index + 1)
    return
  }
  // Clock is done. Drop only once they're actually over the base; a renderer
  // still finishing the last meters gets a short slack, then one teleport.
  if (p && atDestination(p)) { finish('carry', 'panel at base'); return }
  if ((elapsed - leg.ms) / 1000 >= FALL_RESCUE.ARRIVE_SLACK_S) finish('snap', 'not over the base when the carry ended')
}

/** Shared ending. Walk lock is set before player:respawned so the lunge listener keeps walk-only. */
function finish(how: FallRescueEnd, why: string): void {
  if (phase !== 'grab' && phase !== 'carry') return
  detachFloater()
  carry = null
  slipAccum = 0
  despawnPad()
  phase = 'land'
  phaseLeft = FALL_RESCUE.LAND_LOCK_S
  setFallMoveLock('walk')
  if (floater) { floater.mode = 'wait'; floater.waitLeft = FALL_RESCUE.PEEL_WAIT_S }
  if (how === 'snap') console.log(`[FallRescue] snap fallback (${why}) — one teleport, land lock ${FALL_RESCUE.LAND_LOCK_S}s`)
  else console.log(`[FallRescue] tween-carry arrived (${why}) — pad removed, land lock ${FALL_RESCUE.LAND_LOCK_S}s`)
  onEnd(how)
}

function begin(p: Vec): void {
  const line = fallLine()
  const v = fallVelocity(p)
  const hold = catchPoint(p, v)
  phase = 'grab'
  phaseLeft = FALL_RESCUE.GRAB_S
  // Interrupt first: cancelling a lunge rewrites InputModifier, then the freeze wins.
  interruptLocalLunge('fell')
  setFallMoveLock('frozen')
  playFallRescueSfx()
  // The catch itself does not move the player. Overview off so the follow camera rides the tween.
  holdFallLine()
  exitOverview()
  spawnPad(hold)
  spawnFloater()
  try { room.send('playerFell', {}) } catch (err) { console.log('[FallRescue] playerFell send failed', err) }
  const trip = (FALL_RESCUE.GRAB_S + FALL_RESCUE.RISE_S + FALL_RESCUE.CRUISE_S + FALL_RESCUE.DESCEND_S).toFixed(2)
  const under = p.y - hold.y
  console.log(
    `[FallRescue] trip y=${p.y.toFixed(1)} line=${line.toFixed(1)} pad=${hold.y.toFixed(1)} catch no teleport, pad ${under.toFixed(2)}m under feet, tween-carry in ${FALL_RESCUE.GRAB_S}s, trip ${trip}s`,
  )
}

function tickPhase(dt: number): void {
  if (phase === 'grab') {
    phaseLeft -= dt
    if (phaseLeft <= 0) {
      // Rare: they passed through the top. A short Y nudge only — never a look snap.
      nudgeOntoPad()
      phase = 'carry'
      if (floater) floater.mode = 'hang'
      startCarry()
    }
    return
  }
  if (phase === 'carry') {
    tickCarry(dt)
    return
  }
  if (phase === 'land') {
    phaseLeft -= dt
    if (phaseLeft <= 0) {
      phase = 'idle'
      phaseLeft = 0
      setFallMoveLock('open')
      console.log('[FallRescue] land lock done')
    }
  }
}

function tickFloater(dt: number, line: number): void {
  if (!floater) return
  const onPad = anchor !== null && (phase === 'grab' || phase === 'carry')
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
  const p = playerPos()
  if (p && phase === 'idle' && rearm && isMazeReady() && p.y < line) begin(p)
  // Sample after the trip so the lead uses the fall, not the frame we just caught.
  if (p && phase === 'idle') remember(p)
}

/** Ignore the fall line until we're above it again. movePlayerTo is async. */
export function holdFallLine(): void {
  rearm = false
  rearmLeft = FALL_RESCUE.REARM_S
}

/** Round reset / team / initial spawn: drop the pickup, the panel, and the tween. Idempotent. */
export function cancelFallRescue(why: string): void {
  if (phase === 'idle' && !floater && !pad) return
  console.log(`[FallRescue] cancel (${why})`)
  phase = 'idle'
  phaseLeft = 0
  carry = null
  slipAccum = 0
  despawnFloater()
  despawnPad()
  setFallMoveLock('open')
}

/**
 * `endRescue('snap')` is the single base teleport (they slipped off).
 * `endRescue('carry')` means the panel already delivered them — emit player:respawned, do not movePlayerTo.
 * No-op off sky.
 */
export function initFallRescue(endRescue: (how: FallRescueEnd) => void): void {
  if (installed) return
  installed = true
  onEnd = endRescue
  if (!IS_SKY || MIN_Y < FALL_RESPAWN_DROP) return
  engine.addSystem(tick)
}
