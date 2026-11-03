/**
 * botPose.ts — jump, double jump, glide, fall, and slide on a bot avatar.
 *
 * A position write makes the scene-avatar mover play run, and it cancels a
 * full-body emote. Refreshing expressionTriggerTimestamp every frame never
 * let the clip take: the client restarted it before the state could blend,
 * and AvatarShape's expression trigger does not register the scene file the
 * way AvatarEmoteCommand does, so the glide clip often never loaded. The run
 * cycle kept playing under a glider that was a separate entity.
 *
 * The command is sent once per pose (and again only if a one-shot clip would
 * have ended). loop is true, so the explorer holds it. The glider mesh is a
 * prop inside that emote (Armature_Prop). The client shows the prop only
 * while the emote is playing and hides it when the emote is cancelled, so a
 * run cycle and the glider cannot be on screen together. No extra 180° yaw:
 * the prop inherits the avatar's facing, and the added turn made it look
 * backwards.
 *
 * It does not write the avatar transform, parent it, or touch the lerp.
 */
import { engine, Entity, AvatarShape, AvatarEmoteCommand } from '@dcl/sdk/ecs'
import { getBotDrawState } from './botVisual'
import {
  BOT_ANIM_DOUBLE, BOT_ANIM_FALL, BOT_ANIM_GLIDE, BOT_ANIM_JUMP, BOT_ANIM_LOCO, BOT_ANIM_SLIDE,
} from '../shared/botAnim'

const POSE_EMOTE: Record<number, string> = {
  [BOT_ANIM_SLIDE]: 'assets/emotes/bot_slide_emote.glb',
  [BOT_ANIM_JUMP]: 'assets/emotes/bot_jump_emote.glb',
  [BOT_ANIM_DOUBLE]: 'assets/emotes/bot_double_emote.glb',
  [BOT_ANIM_GLIDE]: 'assets/emotes/bot_glide_emote.glb',
  [BOT_ANIM_FALL]: 'assets/emotes/bot_fall_emote.glb',
}

/** A one-shot hold is 1 s. Re-arm before it ends; do not restart every frame. */
const REARM_MS = 800

type Track = { pose: number; stamp: number }
const tracks = new Map<number, Track>()

function playPose(root: Entity, src: string, stamp: number): void {
  if (AvatarShape.has(root)) {
    const av = AvatarShape.getMutable(root)
    av.expressionTriggerId = src
    // Strictly increasing. A per-frame bump restarts the clip before it blends.
    av.expressionTriggerTimestamp = stamp
  }
  // Registers the scene file and honours loop. expressionTriggerId alone
  // hardcodes loop off and does not register the glb for the avatar.
  AvatarEmoteCommand.addValue(root, { emoteUrn: src, loop: true, timestamp: stamp })
}

function clearPose(root: Entity): void {
  if (!AvatarShape.has(root)) return
  const av = AvatarShape.getMutable(root)
  if (!av.expressionTriggerId) return
  av.expressionTriggerId = ''
  av.expressionTriggerTimestamp = Date.now()
}

export function initBotPose(): void {
  engine.addSystem(() => {
    const seen = new Set<number>()
    const now = Date.now()
    for (const bot of getBotDrawState()) {
      seen.add(bot.id)
      const src = POSE_EMOTE[bot.pose]
      const track = tracks.get(bot.id)
      if (!src) {
        if (track && track.pose !== BOT_ANIM_LOCO) clearPose(bot.root)
        tracks.set(bot.id, { pose: BOT_ANIM_LOCO, stamp: 0 })
        continue
      }
      if (!track || track.pose !== bot.pose || now - track.stamp >= REARM_MS) {
        playPose(bot.root, src, now)
        tracks.set(bot.id, { pose: bot.pose, stamp: now })
      }
    }
    for (const id of [...tracks.keys()]) if (!seen.has(id)) tracks.delete(id)
  })
}
