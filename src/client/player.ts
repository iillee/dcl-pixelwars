/**
 * player.ts — player-avatar side effects driven by game events.
 *
 * Currently owns just the round-boundary respawn: teleport every player
 * to the scene's center pad when the round resets. Requires the
 * ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE permission (declared in scene.json).
 *
 * Future homes here: locomotion tweaks (squid-swim on own paint),
 * respawn-on-death (Phase 6), team-color indicator attachments, etc.
 */

import { movePlayerTo } from '~system/RestrictedActions'
import { events } from '../shared/events'

const SPAWN_POSITION = { x: 80, y: 2, z: 80 }
const SPAWN_CAMERA_TARGET = { x: 80, y: 2, z: 88 }

export function initPlayerNet(): void {
  events.on('round:reset', () => {
    // Fire-and-forget: movePlayerTo can reject if the player has moved
    // to another scene, and there's nothing useful to do about it.
    movePlayerTo({
      newRelativePosition: SPAWN_POSITION,
      cameraTarget: SPAWN_CAMERA_TARGET,
    }).catch(() => {})
  })
}
