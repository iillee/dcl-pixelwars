/**
 * botVisual.ts — client-side bot renderer (Pacman-ghost style).
 *
 * Renders each bot as a floating ghost.glb + a team-coloured emissive
 * halo sphere for team identity. Subscribes to the server's 10 Hz
 * botPositions broadcast and smooths motion into fluid gliding via
 * per-frame lerp with dead-reckoning — NOT Tween.
 *
 * ── Why per-frame lerp instead of Tween ─────────────────────────────
 *
 * We tried Tween.Move at broadcast rate and it never felt right: Tween
 * durations are fixed at issue time, so any drift between the server's
 * broadcast cadence and the client's render frame produces visible
 * hitches (Tween finishes early, entity sits still for a beat, then a
 * new Tween starts). Also: Tweens don't compose with ambient bob/drift
 * without extra parent entities.
 *
 * The flagtag ghost system solved the same problem with per-frame lerp
 * plus dead-reckoning:
 *   1. When a new server position arrives, estimate velocity from the
 *      delta since the last one.
 *   2. Each frame, predict where the ghost SHOULD be = lastServerPos +
 *      velocity * lookAhead.
 *   3. Lerp renderPos toward that prediction with a rate proportional
 *      to dt: `renderPos = lerp(renderPos, predicted, min(1, k*dt))`.
 *   4. Add sine-wave bob + drift + scale-pulse on top for "alive" feel.
 *   5. Yaw toward the direction the ghost is moving (renderPos ->
 *      serverPos vector).
 *
 * This adapts naturally to variable frame rate, hides network jitter,
 * and composes trivially with ambient motion.
 *
 * ── Why ghost over AvatarShape (Step 7C revision) ───────────────────
 *
 * Humanoid AvatarShapes expect driven locomotion; without a walk
 * animation the avatar T-poses while sliding and every direction change
 * reads as uncanny in-place snap-rotation. A floating ghost *should*
 * glide, so the same jitter that felt broken on a humanoid feels
 * atmospheric on a ghost. Also: ~1/50th the entity cost and no rig
 * streaming, so the ghost appears instantly when the bot spawns.
 */

import {
  engine, Entity, Transform, GltfContainer,
  LightSource, AudioSource,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { remoteRiderFeet } from './fallRescue'
import { registerBotLookup } from './knockback'
import { room } from '../shared/messages'
import { BOT_AIM_REPORT_HZ } from '../shared/pvp'
import { Team } from '../shared/team'
import { createGhostFace, poseGhostFace, recolorGhostFace, GhostFace, GhostMood } from './ghostFace'

// Paths relative to the deployed scene root (matches teleportOrbs.ts convention).
const GHOST_RED = 'assets/models/bots/ghost-red.glb'
const GHOST_BLUE = 'assets/models/bots/ghost-blue.glb'
const GHOST_SOUND_SRC = 'assets/sounds/ghost.mp3'

const GHOST_SCALE = 1 // the mesh is already about player height
/** Hem sits this far above the floor. Hit tests subtract it to get the feet. */
export const FLOAT_HEIGHT = 0.5
/** Extra lift while the cloud has it, so the crown reaches the hook. Not part of the feet offset. */
const RESCUE_LIFT = 0.55

// Team signal is now a coloured LightSource attached to the ghost.
// Why not a visible halo sphere: the sphere read as a floating orb next
// to the ghost, ugly. A point light tints the ghost's own body from
// nearby geometry, gives an atmospheric glow at distance, and adds no
// visible geometry. Range/intensity tuned to be visible without
// washing the maze.
const LIGHT_INTENSITY = 90
const LIGHT_RANGE     = 6
const RED_LIGHT  = Color3.create(1.00, 0.25, 0.28)
const BLUE_LIGHT = Color3.create(0.30, 0.55, 1.00)

// Dead-reckoning: how far ahead of the last server position to aim the
// render lerp. Roughly one broadcast interval (100ms at 10Hz) so we
// stay one step ahead of the arriving packets instead of chasing them.
const PREDICT_AHEAD_SEC = 0.1
// How aggressively the render position chases the prediction. Larger =
// snappier response, smaller = smoother but laggy. 4/s tracks well
// without visible overshoot at typical bot walking speed.
const LERP_SPEED_PER_SEC = 4.0
// Broadcast rate; used only to size the velocity denominator. Keep in
// sync with BOT_POS_HZ in server.ts.
const BROADCAST_INTERVAL_SEC = 0.1

// Ambient motion — added on top of tracked position so the ghost looks
// alive even when it's paused. Sine periods deliberately incommensurate
// so different ghosts don't visibly synchronise.
const BOB_AMPLITUDE   = 0.25
const BOB_HZ          = 0.5     // vertical cycles/sec
const DRIFT_AMPLITUDE = 0.15
const DRIFT_HZ_X      = 0.27
const DRIFT_HZ_Z      = 0.21
const PULSE_AMPLITUDE = 0.04    // scale pulse
const PULSE_HZ        = 0.8

// Big teleport threshold — beyond this distance we snap instead of
// lerping, so a round-reseat doesn't send the ghost sliding across the
// whole map through walls.
const TELEPORT_THRESHOLD = 8
// Knocked or riding the cloud (st != 0): the server body moves fast
// (launches, falls, 45 m/s cloud rise) and the server sim advances in
// uneven chunks, so chasing the latest packet lurches and stops. Instead
// draw INTERP_DELAY_S in the past on the server's sim clock (botPositions
// t), between the two snapshots around that moment.
const TELEPORT_THRESHOLD_FAST = 60
const INTERP_DELAY_S = 0.25
const SNAP_KEEP = 16
/** Past the newest snapshot, extrapolate at most this long. */
const INTERP_EXTRAPOLATE_MAX_S = 0.1
/** Keep interpolating this long after the last fast packet (covers the delay). */
const FAST_HOLD_S = INTERP_DELAY_S + 0.15

type Snap = { t: number; pos: Vector3 }
/** Client wall time minus server sim time (s): tracks the lowest-latency packet, drifts up slowly. */
let clockOffset: number | null = null

interface BotVisual {
  root: Entity          // moves each frame (ghost.glb + parent for light+audio)
  team: number
  timeSec: number       // ambient-animation phase; randomised per bot at spawn
  lastServerPos: Vector3
  velocity: Vector3     // metres/sec, estimated from server updates
  renderPos: Vector3    // smoothed position we actually draw at
  lastYawDeg: number    // last committed yaw — held when velocity too low
  lightEntity: Entity   // child, for team-recolour on restart
  fastUntil: number     // Date.now() until which the snapshot interpolation draws it
  snaps: Snap[]         // recent server snapshots on the sim clock
  riding: boolean       // last packet said rescue (st 2)
  pose: 'walk' | 'wind' | 'glide' | 'hurt' // wind = lunge telegraph (st 3), glide = recovery (st 4)
  face: GhostFace
  lightI: number
}

/** Draw far enough in the past to stay between snapshots: the usual gap plus margin. */
function interpDelay(snaps: Snap[]): number {
  if (snaps.length < 2) return INTERP_DELAY_S
  const gap = (snaps[snaps.length - 1].t - snaps[0].t) / (snaps.length - 1)
  return Math.min(0.6, Math.max(INTERP_DELAY_S, gap * 1.5 + 0.05))
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

function ghostSrc(team: number): string {
  return team === 1 ? GHOST_RED : GHOST_BLUE
}

function moodOf(riding: boolean, pose: BotVisual['pose']): GhostMood {
  if (riding) return 'down'
  if (pose === 'wind') return 'focus'
  if (pose === 'glide') return 'glide'
  if (pose === 'hurt') return 'hurt'
  return 'calm'
}

function lightColor(team: number): Color3 {
  return team === 1 ? RED_LIGHT : BLUE_LIGHT
}

function paintLight(entity: Entity, team: number): void {
  LightSource.createOrReplace(entity, {
    type: LightSource.Type.Point({}),
    color: lightColor(team),
    intensity: LIGHT_INTENSITY,
    range: LIGHT_RANGE,
  })
}

/** Build root (team ghost + eyes + spatial audio) + child point light. */
function createBotVisual(team: number, pos: Vector3): BotVisual {
  const root = engine.addEntity()
  Transform.create(root, {
    position: pos,
    scale: Vector3.create(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE),
    rotation: Quaternion.Identity(),
  })
  GltfContainer.create(root, { src: ghostSrc(team) })
  const face = createGhostFace(root, team)

  // Spatial looping ghost audio — solo-mode = only ever one bot at a
  // time, so no risk of a chorus. Attenuates naturally with distance.
  AudioSource.create(root, {
    audioClipUrl: GHOST_SOUND_SRC,
    playing: true,
    loop: true,
    volume: 0.3,
    global: false,
  })

  const light = engine.addEntity()
  Transform.create(light, { parent: root, position: Vector3.Zero() })
  paintLight(light, team)

  return {
    root,
    team,
    timeSec: Math.random() * 100,   // desync ambient sine per bot
    lastServerPos: Vector3.clone(pos),
    velocity: Vector3.Zero(),
    renderPos: Vector3.clone(pos),
    lastYawDeg: 0,
    lightEntity: light,
    fastUntil: 0,
    snaps: [],
    riding: false,
    pose: 'walk',
    face,
    lightI: LIGHT_INTENSITY,
  }
}

export function initBotVisual(): void {
  registerBotLookup({
    team: id => { const r = bots.get(parseInt(id.slice(4), 10)); return r ? (r.team as Team) : Team.None },
    feet: id => {
      const r = bots.get(parseInt(id.slice(4), 10))
      return r ? { x: r.renderPos.x, y: r.renderPos.y - FLOAT_HEIGHT, z: r.renderPos.z } : null
    },
  })
  // While a ghost is in the round, tell the server where we stand so it can chase and aim.
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
      // Server positions come in at ground level; ghost floats above.
      const serverPos = Vector3.create(b.x, b.y + FLOAT_HEIGHT, b.z)

      let rec = bots.get(b.id)
      if (!rec) {
        rec = createBotVisual(b.team, serverPos)
        bots.set(b.id, rec)
        continue
      }

      if (rec.team !== b.team) {
        // Team mismatch — happens after server restart (ids reset while
        // client still has stale entities). Recolour light in place.
        paintLight(rec.lightEntity, b.team)
        GltfContainer.createOrReplace(rec.root, { src: ghostSrc(b.team) })
        recolorGhostFace(rec.face, b.team)
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
      rec.pose = b.st === 3 ? 'wind' : b.st === 4 ? 'glide' : b.st === 1 ? 'hurt' : 'walk'
      if ((b.st ?? 0) !== 0 && simT !== null) rec.fastUntil = now + FAST_HOLD_S * 1000
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
        // New position — update velocity estimate from the delta.
        rec.velocity = Vector3.create(
          dx / BROADCAST_INTERVAL_SEC,
          dy / BROADCAST_INTERVAL_SEC,
          dz / BROADCAST_INTERVAL_SEC,
        )
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

  // ── Per-frame render: lerp toward predicted position + ambient motion ─
  engine.addSystem((dt: number) => {
    for (const [id, rec] of bots) {
      rec.timeSec += dt

      // Predicted position = last server position + velocity * lookAhead.
      // Puts us one broadcast ahead of the arriving packets so we stop
      // chasing them.
      const now = Date.now()
      // On the cloud: hang from the cloud this client draws (it runs on local
      // time, so a past-time interpolation would trail it by metres on the rise).
      const ride = rec.riding ? remoteRiderFeet(`bot:${id}`) : null
      const interp = ride ? null : now < rec.fastUntil && clockOffset !== null
        ? interpolate(rec.snaps, now / 1000 - clockOffset - interpDelay(rec.snaps))
        : null
      if (ride) {
        rec.renderPos = Vector3.create(ride.x, ride.y + FLOAT_HEIGHT, ride.z)
      } else if (interp) {
        rec.renderPos = Vector3.clone(interp)
      } else {
        const predX = rec.lastServerPos.x + rec.velocity.x * PREDICT_AHEAD_SEC
        const predY = rec.lastServerPos.y + rec.velocity.y * PREDICT_AHEAD_SEC
        const predZ = rec.lastServerPos.z + rec.velocity.z * PREDICT_AHEAD_SEC
        // Per-frame lerp — adapts to dt automatically.
        const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
        rec.renderPos = Vector3.create(
          rec.renderPos.x + (predX - rec.renderPos.x) * k,
          rec.renderPos.y + (predY - rec.renderPos.y) * k,
          rec.renderPos.z + (predZ - rec.renderPos.z) * k,
        )
      }

      // Ambient sine motion on top so idle ghosts still feel alive.
      const t = rec.timeSec
      const bob    = Math.sin(t * BOB_HZ    * Math.PI * 2) * BOB_AMPLITUDE
      const drX    = Math.sin(t * DRIFT_HZ_X * Math.PI * 2) * DRIFT_AMPLITUDE
      const drZ    = Math.cos(t * DRIFT_HZ_Z * Math.PI * 2) * DRIFT_AMPLITUDE
      const pulse  = 1.0 + Math.sin(t * PULSE_HZ * Math.PI * 2) * PULSE_AMPLITUDE

      const tf = Transform.getMutable(rec.root)
      tf.position = Vector3.create(
        rec.renderPos.x + drX,
        rec.renderPos.y + bob + (rec.riding ? RESCUE_LIFT : 0),
        rec.renderPos.z + drZ,
      )
      poseGhostFace(rec.face, moodOf(rec.riding, rec.pose), dt, t)
      // Wind-up: crouch and flare. Glide: a slight spread. The face carries the rest.
      const wind = rec.pose === 'wind'
      const glide = rec.pose === 'glide'
      const wide = wind ? 1.35 : glide ? 1.15 : 1
      const tall = wind ? 0.62 : glide ? 0.88 : 1
      tf.scale = Vector3.create(
        GHOST_SCALE * pulse * wide,
        GHOST_SCALE * pulse * tall,
        GHOST_SCALE * pulse * wide,
      )
      const wantI = wind ? LIGHT_INTENSITY * 2.4 : LIGHT_INTENSITY
      if (rec.lightI !== wantI) {
        rec.lightI = wantI
        LightSource.createOrReplace(rec.lightEntity, {
          type: LightSource.Type.Point({}),
          color: lightColor(rec.team),
          intensity: wantI,
          range: LIGHT_RANGE,
        })
      }

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

/** Punch: where each ghost is drawn right now (id → smoothed position, incl. float height). */
export function getBotRenderPositions(): Array<{ id: number; team: number; pos: Vector3 }> {
  const out: Array<{ id: number; team: number; pos: Vector3 }> = []
  for (const [id, rec] of bots) out.push({ id, team: rec.team, pos: rec.renderPos })
  return out
}
