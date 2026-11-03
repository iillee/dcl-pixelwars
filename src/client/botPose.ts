/**
 * botPose.ts — wings while a bot glides. The avatar itself is never emoted.
 *
 * AvatarEmoteCommand is a grow-only set the explorer writes to report a
 * player's emote. Adding values from the scene made the explorer spawn a
 * scene-emote avatar at the position where the command was added and stop
 * applying this entity's Transform to the AvatarShape mesh. The mesh froze
 * in the air (and a new copy appeared on every 0.8 s re-arm) while the
 * entity kept walking and painting. A round reset moved the entity and left
 * that mesh behind, so the bot looked invisible at its new spot.
 *
 * The glider file is an ordinary glTF child of the bot entity. Its vertices
 * already sit about 2.4 m up, and it inherits the entity transform, so it
 * turns with the avatar and cannot detach it. No extra yaw: the mesh faces
 * the avatar's forward, and an added half-turn made the wings look backwards.
 * Jump, fall, and slide stay on the run cycle. The explorer's own jump
 * locomotion is driven by the player motor, and a one-shot expression
 * trigger is cancelled by the transform write that moves the bot. Playing
 * one would not survive the flight, and parenting the avatar under a mover
 * so its own transform stays put would change the hierarchy.
 */
import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getBotDrawState, refreshBotAvatars } from './botVisual'
import { events } from '../shared/events'
import { BOT_ANIM_GLIDE } from '../shared/botAnim'

const GLIDER = 'assets/models/glider.glb'

const wings = new Map<number, Entity>()

function clearWing(id: number): void {
  const wing = wings.get(id)
  if (wing === undefined) return
  wings.delete(id)
  engine.removeEntity(wing)
}

function showWing(root: Entity, id: number): void {
  if (wings.has(id)) return
  const wing = engine.addEntity()
  Transform.create(wing, {
    parent: root,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
  })
  GltfContainer.create(wing, {
    src: GLIDER,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0,
  })
  wings.set(id, wing)
}

export function initBotPose(): void {
  events.on('round:reset', () => {
    for (const id of [...wings.keys()]) clearWing(id)
    refreshBotAvatars()
  })
  engine.addSystem(() => {
    const seen = new Set<number>()
    for (const bot of getBotDrawState()) {
      seen.add(bot.id)
      if (bot.pose === BOT_ANIM_GLIDE) showWing(bot.root, bot.id)
      else clearWing(bot.id)
    }
    for (const id of [...wings.keys()]) if (!seen.has(id)) clearWing(id)
  })
}
