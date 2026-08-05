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

// Paths relative to the deployed scene root (matches teleportOrbs.ts convention).
const GHOST_MODEL_SRC = 'assets/models/bots/ghost.glb'
const GHOST_SOUND_SRC = 'assets/sounds/ghost.mp3'

const GHOST_SCALE   = 1.2   // matches flagtag — reads well against player scale
const FLOAT_HEIGHT  = 1.0   // metres above surface (ghost floats at head height)

// Team signal is now a coloured LightSource attached to the ghost.
// Why not a visible halo sphere: the sphere read as a floating orb next
// to the ghost, ugly. A point light tints the ghost's own body from
// nearby geometry, gives an atmospheric glow at distance, and adds no
// visible geometry. Range/intensity tuned to be visible without
// washing the maze.
const LIGHT_INTENSITY = 250
const LIGHT_RANGE     = 8
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

interface BotVisual {
  root: Entity          // moves each frame (ghost.glb + parent for light+audio)
  team: number
  timeSec: number       // ambient-animation phase; randomised per bot at spawn
  lastServerPos: Vector3
  velocity: Vector3     // metres/sec, estimated from server updates
  renderPos: Vector3    // smoothed position we actually draw at
  lastYawDeg: number    // last committed yaw — held when velocity too low
  lightEntity: Entity   // child, for team-recolour on restart
}

// Keyed by bot id (stable per bot, server-assigned).
const bots = new Map<number, BotVisual>()

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

/** Build root (ghost.glb + spatial audio) + child point light. */
function createBotVisual(team: number, pos: Vector3): BotVisual {
  const root = engine.addEntity()
  Transform.create(root, {
    position: pos,
    scale: Vector3.create(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE),
    rotation: Quaternion.Identity(),
  })
  GltfContainer.create(root, { src: GHOST_MODEL_SRC })

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
  }
}

export function initBotVisual(): void {
  // ── Server updates: dead-reckoning inputs ────────────────────────
  events.on('bots:positions', ({ bots: msg }) => {
    const seen = new Set<number>()
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
        rec.team = b.team
      }

      const dx = serverPos.x - rec.lastServerPos.x
      const dy = serverPos.y - rec.lastServerPos.y
      const dz = serverPos.z - rec.lastServerPos.z
      const distSq = dx * dx + dy * dy + dz * dz

      if (distSq > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
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
    for (const rec of bots.values()) {
      rec.timeSec += dt

      // Predicted position = last server position + velocity * lookAhead.
      // Puts us one broadcast ahead of the arriving packets so we stop
      // chasing them.
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

      // Ambient sine motion on top so idle ghosts still feel alive.
      const t = rec.timeSec
      const bob    = Math.sin(t * BOB_HZ    * Math.PI * 2) * BOB_AMPLITUDE
      const drX    = Math.sin(t * DRIFT_HZ_X * Math.PI * 2) * DRIFT_AMPLITUDE
      const drZ    = Math.cos(t * DRIFT_HZ_Z * Math.PI * 2) * DRIFT_AMPLITUDE
      const pulse  = 1.0 + Math.sin(t * PULSE_HZ * Math.PI * 2) * PULSE_AMPLITUDE

      const tf = Transform.getMutable(rec.root)
      tf.position = Vector3.create(
        rec.renderPos.x + drX,
        rec.renderPos.y + bob,
        rec.renderPos.z + drZ,
      )
      tf.scale = Vector3.create(
        GHOST_SCALE * pulse,
        GHOST_SCALE * pulse,
        GHOST_SCALE * pulse,
      )

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
