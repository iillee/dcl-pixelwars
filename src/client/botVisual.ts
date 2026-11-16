/**
 * botVisual.ts — client-side bot renderer.
 *
 * Each bot is an AvatarShape standing on the server position: red clothes
 * with blue skin, or blue clothes with red skin. botPositions is smoothed
 * with per-frame lerp, velocity dead-reckoning, and snapshot interpolation
 * (long enough to cover a hosted ~530 ms tick).
 *
 * The lerp target is where the body should be. A same-point Tween.Move is
 * refreshed every frame so the NPC's built-in walker (about 4 m/s toward
 * whatever position you write) does not drag the body off that target.
 * Locomotion from that setup is untested until a preview pass.
 *
 * ── Why per-frame lerp ──────────────────────────────────────────────
 *
 * Tween durations are fixed at issue time, so any drift between the
 * server's broadcast cadence and the client's render frame hitches
 * (Tween finishes early, entity sits still for a beat, then a new Tween
 * starts).
 *
 *   1. When a new server position arrives, estimate velocity from the
 *      delta since the last one.
 *   2. Each frame, predict where the body SHOULD be = lastServerPos +
 *      velocity * lookAhead.
 *   3. Lerp renderPos toward that prediction with a rate proportional
 *      to dt: `renderPos = lerp(renderPos, predicted, min(1, k*dt))`.
 *   4. Yaw toward the smoothed velocity.
 */

import {
  engine, Entity, Transform, AvatarShape, AvatarNametag, Tween, EasingFunction,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { remoteRiderFeet } from './fallRescue'
import { registerBotLookup } from './knockback'
import { room } from '../shared/messages'
import { BOT_AIM_REPORT_HZ, BOT_FRICTION, BOT_GRAVITY, BOT_KNOCK_UNIT } from '../shared/pvp'
import { burstKnock, lungeKnock, spikeKnock } from '../shared/knocks'
import { Team, TEAM_RGB } from '../shared/team'
import { teamPlatesHidden } from './nametags'

const BODY = 'urn:decentraland:off-chain:base-avatars:BaseMale'
const FACE = [
  'urn:decentraland:off-chain:base-avatars:short_hair',
  'urn:decentraland:off-chain:base-avatars:eyes_00',
  'urn:decentraland:off-chain:base-avatars:eyebrows_00',
  'urn:decentraland:off-chain:base-avatars:mouth_00',
]
// Base-avatar catalog slots. Red kit / blue kit. Skin is the other team's paint.
const RED_CLOTHES = [
  'urn:decentraland:off-chain:base-avatars:red_tshirt',
  'urn:decentraland:off-chain:base-avatars:f_red_comfy_pants',
  'urn:decentraland:off-chain:base-avatars:ruby_red_loafer',
]
const BLUE_CLOTHES = [
  'urn:decentraland:off-chain:base-avatars:blue_tshirt',
  'urn:decentraland:off-chain:base-avatars:elegant_blue_trousers',
  'urn:decentraland:off-chain:base-avatars:sport_blue_shoes',
]

/** Avatar origin is the feet, same as a player. Hit tests subtract this. */
export const FLOAT_HEIGHT = 0

// Walking: extrapolate along last velocity for up to this long so a hosted
// ~530 ms tick does not stall the body between packets.
const WALK_EXTRAPOLATE_MAX_S = 0.85
// How aggressively the render position chases the prediction. Larger =
// snappier response, smaller = smoother but laggy.
const LERP_SPEED_PER_SEC = 6.0
// Fallback only when we have no measured packet interval yet.
const BROADCAST_INTERVAL_SEC = 0.1

// Big teleport threshold — beyond this distance we snap instead of
// lerping, so a round-reseat doesn't slide the body across the map.
const TELEPORT_THRESHOLD = 8
// Knocked or riding the cloud (st != 0): the server body moves fast
// (launches, falls, 45 m/s cloud rise) and the server sim advances in
// uneven chunks, so chasing the latest packet lurches and stops. Instead
// draw INTERP_DELAY_S in the past on the server's sim clock (botPositions
// t), between the two snapshots around that moment.
const TELEPORT_THRESHOLD_FAST = 60
const INTERP_DELAY_S = 0.25
const SNAP_KEEP = 16
/** Past the newest snapshot, extrapolate at most this long (covers a 2 Hz gap). */
const INTERP_EXTRAPOLATE_MAX_S = 0.7
/** Keep interpolating this long after the last fast packet (covers the delay). */
const FAST_HOLD_S = INTERP_DELAY_S + 0.5
const KNOCK_BLEND_S = 0.35
const LOCAL_KNOCK_S = 2

type V3 = { x: number; y: number; z: number }
type Snap = { t: number; pos: Vector3 }
type LocalKnock = {
  pos: V3
  vel: V3
  force: V3
  forceLeft: number
  floorY: number | null
}
/** Client wall time minus server sim time (s): tracks the lowest-latency packet, drifts up slowly. */
let clockOffset: number | null = null

interface BotVisual {
  root: Entity
  id: number
  team: number
  lastServerPos: Vector3
  velocity: Vector3     // metres/sec, estimated from server updates
  renderPos: Vector3    // smoothed position we actually draw at
  lastYawDeg: number    // last committed yaw — held when velocity too low
  fastUntil: number     // Date.now() until which the snapshot interpolation draws it
  snaps: Snap[]         // recent server snapshots on the sim clock
  riding: boolean       // last packet said rescue (st 2)
  pktAt: number         // Date.now() of the last position packet
  lastSimT: number      // server sim time of that packet
  localKnock: LocalKnock | null
  knockBlend: number
  localKnockUntil: number
}

/** Draw far enough in the past to stay between snapshots: the usual gap plus margin. */
function interpDelay(snaps: Snap[]): number {
  if (snaps.length < 2) return INTERP_DELAY_S
  const gap = (snaps[snaps.length - 1].t - snaps[0].t) / (snaps.length - 1)
  return Math.min(0.9, Math.max(INTERP_DELAY_S, gap * 1.5 + 0.05))
}

function interpolate(snaps: Snap[], rt: number): Vector3 | null {
  if (snaps.length === 0) return null
  if (rt <= snaps[0].t) return snaps[0].pos
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i]
    if (rt <= b.t) return Vector3.lerp(a.pos, b.pos, (rt - a.t) / Math.max(1e-4, b.t - a.t))
  }
  const last = snaps[snaps.length - 1]
  if (snaps.length < 2) return last.pos
  const prev = snaps[snaps.length - 2]
  const ahead = Math.min(INTERP_EXTRAPOLATE_MAX_S, rt - last.t)
  const s = ahead / Math.max(1e-4, last.t - prev.t)
  return Vector3.create(last.pos.x + (last.pos.x - prev.pos.x) * s, last.pos.y + (last.pos.y - prev.pos.y) * s, last.pos.z + (last.pos.z - prev.pos.z) * s)
}

// Keyed by bot id (stable per bot, server-assigned).
const bots = new Map<number, BotVisual>()

function rgb(team: number): Color3 {
  const c = TEAM_RGB[team] ?? TEAM_RGB[Team.Red]
  return Color3.create(c.r, c.g, c.b)
}

/** Red wears red and has blue skin. Blue wears blue and has red skin. */
function paintAvatar(entity: Entity, team: number, id: number): void {
  const red = team === Team.Red
  const suffix = String(id).padStart(4, '0').slice(-4)
  AvatarShape.createOrReplace(entity, {
    id: `${red ? 'red' : 'blue'}-${suffix}`,
    name: red ? 'RED' : 'BLUE',
    bodyShape: BODY,
    skinColor: rgb(red ? Team.Blue : Team.Red),
    hairColor: rgb(red ? Team.Red : Team.Blue),
    eyeColor: Color3.create(0.93, 0.96, 1),
    wearables: FACE.concat(red ? RED_CLOTHES : BLUE_CLOTHES),
    emotes: [],
  })
  // Same red/blue plate as players, except in Balloon Battle (no teams).
  if (teamPlatesHidden()) {
    AvatarNametag.deleteFrom(entity)
  } else {
    const bg = rgb(team)
    AvatarNametag.createOrReplace(entity, {
      label: red ? 'RED' : 'BLUE',
      labelColor: Color3.White(),
      backgroundColor: bg,
      borderColor: bg,
    })
  }
}

/** A finished move tween replaces the NPC's 4 m/s walker. Position stays ours. */
function holdWalker(entity: Entity, pos: Vector3): void {
  Tween.createOrReplace(entity, {
    mode: Tween.Mode.Move({ start: pos, end: pos }),
    duration: 1,
    currentTime: 1,
    playing: true,
    easingFunction: EasingFunction.EF_LINEAR,
  })
}

function createBotVisual(team: number, pos: Vector3, id: number): BotVisual {
  const root = engine.addEntity()
  Transform.create(root, {
    position: pos,
    rotation: Quaternion.Identity(),
  })
  paintAvatar(root, team, id)
  holdWalker(root, pos)

  return {
    root,
    id,
    team,
    lastServerPos: Vector3.clone(pos),
    velocity: Vector3.Zero(),
    renderPos: Vector3.clone(pos),
    lastYawDeg: 0,
    fastUntil: 0,
    snaps: [],
    riding: false,
    pktAt: 0,
    lastSimT: 0,
    localKnock: null,
    knockBlend: 0,
    localKnockUntil: 0,
  }
}

function stepLocalKnock(rec: BotVisual, dt: number): void {
  const k = rec.localKnock
  if (!k) return
  let left = Math.min(Number.isFinite(dt) ? dt : 0, 0.1)
  while (left > 1e-6) {
    const s = Math.min(left, 0.05)
    left -= s
    if (k.forceLeft > 0) {
      k.vel.x += k.force.x * s
      k.vel.y += k.force.y * s
      k.vel.z += k.force.z * s
      k.forceLeft -= s
    }
    k.vel.y -= BOT_GRAVITY * s
    k.pos.x += k.vel.x * s
    k.pos.y += k.vel.y * s
    k.pos.z += k.vel.z * s
    if (k.floorY !== null && k.pos.y <= k.floorY) {
      k.pos.y = k.floorY
      if (k.vel.y < 0) k.vel.y = 0
      const h = Math.hypot(k.vel.x, k.vel.z)
      const nh = Math.max(0, h - BOT_FRICTION * s)
      if (h > 1e-4) { k.vel.x *= nh / h; k.vel.z *= nh / h } else { k.vel.x = 0; k.vel.z = 0 }
    }
  }
  rec.velocity = Vector3.create(k.vel.x, k.vel.y, k.vel.z)
}

/** Play the confirmed knock arc locally, then blend toward the server path once snapshots arrive. */
export function playBotKnock(id: number, dx: number, dz: number, kind: 'lunge' | 'burst' | 'spike'): void {
  const rec = bots.get(id)
  if (!rec || rec.riding) return
  const len = Math.hypot(dx, dz)
  const ux = len > 1e-3 ? dx / len : 0
  const uz = len > 1e-3 ? dz / len : 0
  const grounded = Math.abs(rec.velocity.y) < 2
  const spec = kind === 'lunge' ? lungeKnock(ux, uz) : kind === 'spike' ? spikeKnock(ux, uz, grounded) : burstKnock(ux, uz)
  const u = BOT_KNOCK_UNIT
  rec.localKnock = {
    pos: { x: rec.renderPos.x, y: rec.renderPos.y, z: rec.renderPos.z },
    vel: {
      x: rec.velocity.x + spec.impulse.x * u,
      y: rec.velocity.y + spec.impulse.y * u,
      z: rec.velocity.z + spec.impulse.z * u,
    },
    force: { x: spec.forceDir.x * spec.force * u, y: spec.forceDir.y * spec.force * u, z: spec.forceDir.z * spec.force * u },
    forceLeft: spec.forceS,
    floorY: grounded ? rec.renderPos.y : null,
  }
  rec.knockBlend = 0
  rec.snaps = []
  rec.fastUntil = Date.now() + LOCAL_KNOCK_S * 1000
  rec.localKnockUntil = rec.fastUntil
}

export function initBotVisual(): void {
  registerBotLookup({
    team: id => { const r = bots.get(parseInt(id.slice(4), 10)); return r ? (r.team as Team) : Team.None },
    feet: id => {
      const r = bots.get(parseInt(id.slice(4), 10))
      return r ? { x: r.renderPos.x, y: r.renderPos.y - FLOAT_HEIGHT, z: r.renderPos.z } : null
    },
  })
  // While a bot is in the round, tell the server where we stand so it can chase and aim.
  let aimClock = 0
  engine.addSystem((dt: number) => {
    if (bots.size === 0) return
    aimClock += dt
    if (aimClock < 1 / BOT_AIM_REPORT_HZ) return
    aimClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch (err) { console.log('[Bots] botAim send failed', err) }
  })
  // ── Server updates: dead-reckoning inputs ────────────────────────
  events.on('bots:positions', ({ bots: msg, t }) => {
    const seen = new Set<number>()
    const now = Date.now()
    const simT = Number.isFinite(t) ? t : null
    if (simT !== null) {
      const sample = now / 1000 - simT
      if (clockOffset === null || sample < clockOffset || Math.abs(sample - clockOffset) > 5) clockOffset = sample
      else clockOffset += (sample - clockOffset) * 0.05
    }
    for (const b of msg) {
      seen.add(b.id)
      // Server positions are feet. The avatar origin is the feet.
      const serverPos = Vector3.create(b.x, b.y + FLOAT_HEIGHT, b.z)

      let rec = bots.get(b.id)
      if (!rec) {
        rec = createBotVisual(b.team, serverPos, b.id)
        rec.pktAt = now
        rec.lastSimT = simT ?? 0
        bots.set(b.id, rec)
        continue
      }

      if (rec.team !== b.team) {
        paintAvatar(rec.root, b.team, rec.id)
        rec.team = b.team
      }

      const dx = serverPos.x - rec.lastServerPos.x
      const dy = serverPos.y - rec.lastServerPos.y
      const dz = serverPos.z - rec.lastServerPos.z
      const distSq = dx * dx + dy * dy + dz * dz
      if (simT !== null) {
        const lastT = rec.snaps.length > 0 ? rec.snaps[rec.snaps.length - 1].t : -Infinity
        if (simT < lastT - 1) rec.snaps = [] // server restarted its clock
        if (simT > lastT + 1e-4) rec.snaps.push({ t: simT, pos: serverPos })
        if (rec.snaps.length > SNAP_KEEP) rec.snaps.shift()
      }
      const wasFast = now < rec.fastUntil
      rec.riding = b.st === 2
      if ((b.st ?? 0) !== 0 && simT !== null) rec.fastUntil = now + FAST_HOLD_S * 1000
      const interval = (simT !== null && rec.lastSimT > 0)
        ? Math.max(0.08, simT - rec.lastSimT)
        : rec.pktAt > 0 ? Math.max(0.08, (now - rec.pktAt) / 1000)
        : BROADCAST_INTERVAL_SEC
      rec.pktAt = now
      if (simT !== null) rec.lastSimT = simT
      if (now < rec.fastUntil) {
        // Knocked / riding: the render system interpolates the snapshots.
        rec.lastServerPos = Vector3.clone(serverPos)
        rec.velocity = Vector3.create(b.vx ?? 0, b.vy ?? 0, b.vz ?? 0)
        continue
      }
      const snapAt = wasFast ? TELEPORT_THRESHOLD_FAST : TELEPORT_THRESHOLD

      if (distSq > snapAt * snapAt) {
        // Snap. Kills accumulated velocity so we don't overshoot the target.
        rec.renderPos = Vector3.clone(serverPos)
        rec.lastServerPos = Vector3.clone(serverPos)
        rec.velocity = Vector3.Zero()
      } else if (distSq > 1e-5) {
        // New position — update velocity from the actual packet interval.
        rec.velocity = Vector3.create(dx / interval, dy / interval, dz / interval)
        rec.lastServerPos = serverPos
      }
      // If distSq ~ 0, keep the previous velocity — the bot may just
      // be mid-step; next update will correct.
    }

    // Reap dropped bots. Halo is parented → root removal reaps both.
    for (const [id, rec] of bots) {
      if (!seen.has(id)) {
        engine.removeEntity(rec.root)
        bots.delete(id)
      }
    }
  })

  // ── Per-frame render: lerp toward the predicted feet position ─
  engine.addSystem((dt: number) => {
    for (const [id, rec] of bots) {
      // Predicted position = last server position + velocity * lookAhead.
      // Puts us one broadcast ahead of the arriving packets so we stop
      // chasing them.
      const now = Date.now()
      // On the cloud: hang from the cloud this client draws (it runs on local
      // time, so a past-time interpolation would trail it by metres on the rise).
      const ride = rec.riding ? remoteRiderFeet(`bot:${id}`) : null
      const interp = ride ? null : now < rec.fastUntil && clockOffset !== null && rec.snaps.length >= 2
        ? interpolate(rec.snaps, now / 1000 - clockOffset - interpDelay(rec.snaps))
        : null
      if (rec.localKnock && now > rec.localKnockUntil) rec.localKnock = null
      if (ride) {
        rec.localKnock = null
        rec.renderPos = Vector3.create(ride.x, ride.y + FLOAT_HEIGHT, ride.z)
      } else if (rec.localKnock) {
        stepLocalKnock(rec, dt)
        if (interp) {
          rec.knockBlend = Math.min(1, rec.knockBlend + dt / KNOCK_BLEND_S)
          rec.renderPos = Vector3.lerp(Vector3.create(rec.localKnock.pos.x, rec.localKnock.pos.y, rec.localKnock.pos.z), interp, rec.knockBlend)
          if (rec.knockBlend >= 1) rec.localKnock = null
        } else {
          rec.renderPos = Vector3.create(rec.localKnock.pos.x, rec.localKnock.pos.y, rec.localKnock.pos.z)
        }
      } else if (interp) {
        rec.renderPos = Vector3.clone(interp)
      } else {
        const look = rec.pktAt > 0 ? Math.min(WALK_EXTRAPOLATE_MAX_S, (now - rec.pktAt) / 1000) : 0
        const predX = rec.lastServerPos.x + rec.velocity.x * look
        const predY = rec.lastServerPos.y + rec.velocity.y * look
        const predZ = rec.lastServerPos.z + rec.velocity.z * look
        const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
        rec.renderPos = Vector3.create(
          rec.renderPos.x + (predX - rec.renderPos.x) * k,
          rec.renderPos.y + (predY - rec.renderPos.y) * k,
          rec.renderPos.z + (predZ - rec.renderPos.z) * k,
        )
      }

      const tf = Transform.getMutable(rec.root)
      tf.position = rec.renderPos
      holdWalker(rec.root, rec.renderPos)

      // Yaw from smoothed VELOCITY, not from renderPos -> lastServerPos.
      // The old approach flipped 180° the instant renderPos overshot its
      // target (the delta reversed sign each frame), which produced the
      // "facing forward then backward" flicker. Velocity is smoothed by
      // the broadcast cadence and only reverses on a genuine direction
      // change, so yaw stays stable.
      const vx = rec.velocity.x
      const vz = rec.velocity.z
      const speedSq = vx * vx + vz * vz
      // Threshold ≈ 0.5 m/s. Below this the bot is effectively idle;
      // holding lastYawDeg avoids yaw drift from tiny numerical noise.
      if (speedSq > 0.25) {
        rec.lastYawDeg = Math.atan2(vx, vz) * (180 / Math.PI)
      }
      tf.rotation = Quaternion.fromEulerDegrees(0, rec.lastYawDeg, 0)
    }
  })
}

/** Where each bot is drawn right now (id, smoothed feet, facing, and the body entity). */
export function getBotRenderPositions(): Array<{ id: number; team: number; pos: Vector3; yawDeg: number; entity: Entity }> {
  const out: Array<{ id: number; team: number; pos: Vector3; yawDeg: number; entity: Entity }> = []
  for (const [id, rec] of bots) out.push({ id, team: rec.team, pos: rec.renderPos, yawDeg: rec.lastYawDeg, entity: rec.root })
  return out
}
