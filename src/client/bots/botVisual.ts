/**
 * botVisual.ts - client-side ghost renderer.
 *
 * Observes synced BotState + Transform entities the server owns (one
 * per active bot). Spawns a floating ghost.glb + team-coloured point
 * light + spatial audio per bot. Smooths the incoming server position
 * into fluid motion via per-frame lerp with velocity dead-reckoning
 * and adds ambient bob/drift/scale-pulse on top so idle ghosts still
 * feel alive.
 *
 * Why per-frame lerp instead of Tween: Tween durations are fixed at
 * issue time, so any drift between server tick cadence and client
 * render frame produces visible hitches. Per-frame lerp adapts to dt
 * automatically and composes trivially with the ambient sine motion.
 *
 * Why ghost over AvatarShape: humanoid avatars expect driven
 * locomotion; without a walk animation they T-pose while sliding.
 * A ghost is *supposed* to glide, so the same latency reads as
 * atmospheric instead of broken. Also ~1/50th the entity cost.
 */

import {
	AudioSource,
	engine,
	Entity,
	GltfContainer,
	LightSource,
	Transform,
} from '@dcl/sdk/ecs'
import {
	Color3,
	Quaternion,
	Vector3,
} from '@dcl/sdk/math'

import { BotState } from 'src/shared/components'


// MARK: tuning constants

const GHOST_MODEL_SRC = 'assets/models/bots/ghost.glb'
const GHOST_SOUND_SRC = 'assets/sounds/ghost.mp3'

const GHOST_SCALE  = 1.2
const FLOAT_HEIGHT = 1.0 // metres above surface (head height)

const LIGHT_INTENSITY = 250
const LIGHT_RANGE     = 8
const RED_LIGHT       = Color3.create(1.00, 0.25, 0.28)
const BLUE_LIGHT      = Color3.create(0.30, 0.55, 1.00)

// Lerp speed: renderPos chases serverPos at k*dt per frame. Higher =
// snappier response, lower = smoother lag. 6/s tracks a 4.8-step/sec
// bot well without visible overshoot.
const LERP_SPEED_PER_SEC = 6.0

// Snap threshold - past this distance we don't lerp (e.g. round-reseat
// teleports a bot; lerping would slide it through walls).
const TELEPORT_THRESHOLD = 8

// Ambient sine periods deliberately incommensurate so multiple ghosts
// don't visibly synchronise.
const BOB_AMPLITUDE   = 0.25
const BOB_HZ          = 0.5
const DRIFT_AMPLITUDE = 0.15
const DRIFT_HZ_X      = 0.27
const DRIFT_HZ_Z      = 0.21
const PULSE_AMPLITUDE = 0.04
const PULSE_HZ        = 0.8

// Below this XZ speed the yaw is held instead of chasing tiny numerical
// noise around a stationary position.
const MIN_YAW_SPEED = 0.5


// MARK: BotVisual

interface BotVisual {
	root:          Entity  // ghost.glb + audio + parent for light
	lightEntity:   Entity
	team:          number
	timeSec:       number  // ambient phase, randomised per bot
	serverPos:     Vector3
	renderPos:     Vector3
	velocity:      Vector3
	lastYawDeg:    number
}

// Keyed by botId (stable per bot for the bot's lifetime).
const visuals = new Map<number, BotVisual>()


// MARK: lightColor

function lightColor(team: number): Color3 {
	return team === 1 ? RED_LIGHT : BLUE_LIGHT
}


// MARK: paintLight

function paintLight(entity: Entity, team: number): void {
	LightSource.createOrReplace(entity, {
		type:      LightSource.Type.Point({}),
		color:     lightColor(team),
		intensity: LIGHT_INTENSITY,
		range:     LIGHT_RANGE,
	})
}


// MARK: createVisual

/** Build ghost.glb + spatial audio root + team-coloured child light. */
function createVisual(team: number, pos: Vector3): BotVisual {
	const root = engine.addEntity()
	Transform.create(root, {
		position: pos,
		scale:    Vector3.create(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE),
		rotation: Quaternion.Identity(),
	})
	GltfContainer.create(root, { src: GHOST_MODEL_SRC })
	AudioSource.create(root, {
		audioClipUrl: GHOST_SOUND_SRC,
		playing:      true,
		loop:         true,
		volume:       0.3,
		global:       false,
	})

	const light = engine.addEntity()
	Transform.create(light, { parent: root, position: Vector3.Zero() })
	paintLight(light, team)

	return {
		root,
		lightEntity: light,
		team,
		timeSec:    Math.random() * 100,
		serverPos:  Vector3.clone(pos),
		renderPos:  Vector3.clone(pos),
		velocity:   Vector3.Zero(),
		lastYawDeg: 0,
	}
}


// MARK: destroyVisual

function destroyVisual(rec: BotVisual): void {
	// Removing the root reaps the parented light entity too.
	engine.removeEntity(rec.root)
}


// MARK: initBotVisual

/**
 * Start the visual system. Poll BotState entities every frame; spawn a
 * ghost per new botId, despawn when the BotState entity disappears.
 * Idempotent - safe to call once from client boot.
 */
export function initBotVisual(): void {
	engine.addSystem((dt: number) => {
		const seen = new Set<number>()

		// Sync: create/update visuals for every BotState entity.
		for (const [entity, state] of engine.getEntitiesWith(BotState)) {
			const botId = state.botId
			const team  = state.team
			seen.add(botId)

			const tf = Transform.getOrNull(entity)
			if (!tf) continue
			// Server publishes ground-level position; ghost floats above.
			const serverPos = Vector3.create(tf.position.x, tf.position.y + FLOAT_HEIGHT, tf.position.z)

			let rec = visuals.get(botId)
			if (!rec) {
				rec = createVisual(team, serverPos)
				visuals.set(botId, rec)
				continue
			}

			if (rec.team !== team) {
				// Server restart can reuse botId with a different team.
				// Recolour in place instead of tearing down the entity.
				paintLight(rec.lightEntity, team)
				rec.team = team
			}

			// Update velocity estimate from the position delta. dt=0 guard
			// avoids NaN on the very first tick.
			if (dt > 1e-4) {
				rec.velocity = Vector3.create(
					(serverPos.x - rec.serverPos.x) / dt,
					(serverPos.y - rec.serverPos.y) / dt,
					(serverPos.z - rec.serverPos.z) / dt,
				)
			}
			rec.serverPos = serverPos
		}

		// Reap ghosts whose BotState entity is gone (retired or round-reset).
		for (const [id, rec] of visuals) {
			if (!seen.has(id)) {
				destroyVisual(rec)
				visuals.delete(id)
			}
		}

		// Per-frame render: lerp renderPos -> serverPos + ambient motion.
		for (const rec of visuals.values()) {
			rec.timeSec += dt

			// Snap on big teleports so we don't slide through walls.
			const dx      = rec.serverPos.x - rec.renderPos.x
			const dy      = rec.serverPos.y - rec.renderPos.y
			const dz      = rec.serverPos.z - rec.renderPos.z
			const distSq  = dx * dx + dy * dy + dz * dz
			if (distSq > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
				rec.renderPos = Vector3.clone(rec.serverPos)
				rec.velocity  = Vector3.Zero()
			} else {
				const k = Math.min(1, LERP_SPEED_PER_SEC * dt)
				rec.renderPos = Vector3.create(
					rec.renderPos.x + dx * k,
					rec.renderPos.y + dy * k,
					rec.renderPos.z + dz * k,
				)
			}

			// Ambient sine motion on top.
			const t     = rec.timeSec
			const bob   = Math.sin(t * BOB_HZ     * Math.PI * 2) * BOB_AMPLITUDE
			const drX   = Math.sin(t * DRIFT_HZ_X * Math.PI * 2) * DRIFT_AMPLITUDE
			const drZ   = Math.cos(t * DRIFT_HZ_Z * Math.PI * 2) * DRIFT_AMPLITUDE
			const pulse = 1.0 + Math.sin(t * PULSE_HZ * Math.PI * 2) * PULSE_AMPLITUDE

			const tfRoot = Transform.getMutableOrNull(rec.root)
			if (!tfRoot) continue
			tfRoot.position = Vector3.create(
				rec.renderPos.x + drX,
				rec.renderPos.y + bob,
				rec.renderPos.z + drZ,
			)
			tfRoot.scale = Vector3.create(
				GHOST_SCALE * pulse,
				GHOST_SCALE * pulse,
				GHOST_SCALE * pulse,
			)

			// Yaw from smoothed velocity. Holding lastYawDeg below the
			// threshold prevents spinning on numerical noise when idle.
			const vx      = rec.velocity.x
			const vz      = rec.velocity.z
			const speedSq = vx * vx + vz * vz
			if (speedSq > MIN_YAW_SPEED * MIN_YAW_SPEED) {
				rec.lastYawDeg = Math.atan2(vx, vz) * (180 / Math.PI)
			}
			tfRoot.rotation = Quaternion.fromEulerDegrees(0, rec.lastYawDeg, 0)
		}
	})

	console.log('[BotVisual] initBotVisual: observing BotState entities')
}
