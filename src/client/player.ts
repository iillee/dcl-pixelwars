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

import { engine } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { eventBus, ClientEvents } from 'src/shared/utils/eventBus'

// Center cross tile world position. See generator.ts: cell (2,2) with
// MAZE_ORIGIN=8 and CELL=32 puts the tile's SW corner at (72, 72) and its
// center at (88, 88). Y=2 sits the player on the walkable floor slab.
const SPAWN_POSITION = { x: 88, y: 2, z: 88 }
const SPAWN_CAMERA_TARGET = { x: 88, y: 2, z: 96 }

function teleportHome(): void {
  // Fire-and-forget: movePlayerTo can reject if the player has moved
  // to another scene, and there's nothing useful to do about it.
  movePlayerTo({
    newRelativePosition: SPAWN_POSITION,
    cameraTarget: SPAWN_CAMERA_TARGET,
  }).catch(() => {})
}

export function initPlayerNet(): void {
  // Round boundary: everyone snaps back to the cross for a clean start.
  eventBus.on(ClientEvents.RoundReset, teleportHome)
  // Initial spawn-in: give the maze ~2s to grow in, then plant the player
  // on the center cross. Without this, players land wherever scene.json's
  // spawn range dropped them, which may or may not be on solid ground
  // depending on maze layout.
  let elapsed = 0
  let done = false
  const INIT_DELAY = 2
  engine.addSystem((dt: number) => {
    if (done) return
    elapsed += dt
    if (elapsed < INIT_DELAY) return
    done = true
    teleportHome()
  })
}
