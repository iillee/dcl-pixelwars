/**
 * botPose.ts — jump, double jump, glide, fall, and slide on a bot avatar.
 *
 * Human players get those poses from the explorer locomotion tree (rise / fall /
 * slide / double-jump / glide) plus the glider prop on the avatar. A scene
 * AvatarShape does not. Unity's SDK avatar mover forces every scene avatar
 * grounded and plays run from how far the entity moved. Godot leaves the
 * locomotion flags at idle and hides the built-in glider on AvatarShapes.
 * Neither client exposes jump count or glide state on PBAvatarShape.
 *
 * The server sends `an` (shared/botAnim.ts) beside `st`. This file maps `an`
 * onto the same clips, as scene emotes, and draws the explorer glider mesh
 * while `an` is glide. The emote is restarted before the clip ends so a long
 * fall or glide does not drop back to the run cycle.
 *
 * It does not write the avatar transform, parent it, or touch the lerp.
 */
import { engine, Entity, AvatarShape, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getBotDrawState } from './botVisual'
import {
  BOT_ANIM_DOUBLE, BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP, BOT_ANIM_LOCO, BOT_ANIM_SLIDE,
} from '../shared/botAnim'

/** Clip length is just under the hold, so the pose restarts before the client drops it. */
const POSE_EMOTE: Record<number, { src: string; holdS: number }> = {
  [BOT_ANIM_SLIDE]: { src: 'assets/emotes/bot_slide_emote.glb', holdS: 0.58 },
  [BOT_ANIM_JUMP]: { src: 'assets/emotes/bot_jump_emote.glb', holdS: 0.58 },
  [BOT_ANIM_DOUBLE]: { src: 'assets/emotes/bot_double_emote.glb', holdS: 0.58 },
  [BOT_ANIM_GLIDE]: { src: 'assets/emotes/bot_glide_emote.glb', holdS: 0.85 },
  [BOT_ANIM_FALL]: { src: 'assets/emotes/bot_fall_emote.glb', holdS: 0.58 },
}

/** Explorer GliderProp sits on the avatar origin, turned 180° around Y. */
const GLIDER_SRC = 'assets/models/glider.glb'

type Track = { pose: number; nextAt: number }
const tracks = new Map<number, Track>()
const gliders = new Map<number, Entity>()

function showPose(root: Entity, src: string): void {
  if (!AvatarShape.has(root)) return
  const av = AvatarShape.getMutable(root)
  av.expressionTriggerId = src
  av.expressionTriggerTimestamp = Date.now()
}

function clearPose(root: Entity): void {
  if (!AvatarShape.has(root)) return
  const av = AvatarShape.getMutable(root)
  if (!av.expressionTriggerId) return
  av.expressionTriggerId = ''
  av.expressionTriggerTimestamp = Date.now()
}

function placeGlider(id: number, pos: Vector3, yawDeg: number): void {
  let wing = gliders.get(id)
  if (wing === undefined) {
    wing = engine.addEntity()
    gliders.set(id, wing)
    GltfContainer.create(wing, { src: GLIDER_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    Transform.create(wing)
  }
  const tf = Transform.getMutable(wing)
  tf.position = Vector3.create(pos.x, pos.y, pos.z)
  tf.rotation = Quaternion.fromEulerDegrees(0, yawDeg + 180, 0)
}

function dropGlider(id: number): void {
  const wing = gliders.get(id)
  if (wing === undefined) return
  engine.removeEntity(wing)
  gliders.delete(id)
}

export function initBotPose(): void {
  engine.addSystem(() => {
    const seen = new Set<number>()
    const now = Date.now()
    for (const bot of getBotDrawState()) {
      seen.add(bot.id)
      const clip = POSE_EMOTE[bot.pose]
      const track = tracks.get(bot.id)
      if (!clip) {
        if (track && track.pose !== BOT_ANIM_LOCO) clearPose(bot.root)
        tracks.set(bot.id, { pose: BOT_ANIM_LOCO, nextAt: 0 })
        dropGlider(bot.id)
        continue
      }
      if (!track || track.pose !== bot.pose || now >= track.nextAt) {
        showPose(bot.root, clip.src)
        tracks.set(bot.id, { pose: bot.pose, nextAt: now + clip.holdS * 1000 })
      }
      if (bot.pose === BOT_ANIM_GLIDE) placeGlider(bot.id, bot.pos, bot.yawDeg)
      else dropGlider(bot.id)
    }
    for (const id of [...tracks.keys()]) if (!seen.has(id)) tracks.delete(id)
    for (const id of [...gliders.keys()]) if (!seen.has(id)) dropGlider(id)
  })
}
