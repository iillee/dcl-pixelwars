/**
 * player.ts — player-avatar side effects driven by game events.
 *
 * Owns spawning and respawning (needs ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE,
 * declared in scene.json):
 *   - classic: everyone goes to the centre cross on join and at each round reset.
 *   - sky:     each player goes to their TEAM BASE once the server has
 *              assigned a team (teamAssigned), at each round reset, and
 *              whenever they fall more than FALL_RESPAWN_DROP m below the
 *              base floor.
 */

import { engine, Transform } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { events } from '../shared/events'
import { Team } from '../shared/team'
import { BASE_Y, baseSpawn } from '../maze/generator'
import { IS_SKY, FALL_RESPAWN_DROP } from '../maze/level'

// Classic centre cross: cell (2,2), MAZE_ORIGIN=8, CELL=32 → centre (88, 88).
const CLASSIC_SPAWN = { x: 88, y: 2, z: 88 }
const CLASSIC_CAMERA_TARGET = { x: 88, y: 2, z: 96 }

let myTeam: Team = Team.None

function teleportHome(why: string): void {
  let pos = CLASSIC_SPAWN, look = CLASSIC_CAMERA_TARGET
  if (IS_SKY) {
    const s = baseSpawn(myTeam === Team.Blue ? 2 : 1) // no team yet → RED base (scene.json default)
    pos = s.pos; look = s.look
  }
  console.log(`[Player] teleport (${why}) → ${pos.x.toFixed(0)},${pos.y.toFixed(1)},${pos.z.toFixed(0)}`)
  // Fire-and-forget: movePlayerTo can reject if the player has left the scene.
  movePlayerTo({ newRelativePosition: pos, cameraTarget: look }).catch(() => {})
}

export function initPlayerNet(): void {
  events.on('round:reset', () => teleportHome('round reset'))

  // Sky: team known → go to that team's base (once per assignment change).
  events.on('team:assigned', ({ team }) => {
    const changed = team !== myTeam
    myTeam = team
    if (IS_SKY && changed) teleportHome('team assigned')
  })

  // Initial spawn-in after ~2 s so the maze has grown in. In sky mode the
  // teamAssigned handler normally wins; this is the fallback.
  let elapsed = 0
  let done = false
  const INIT_DELAY = 2
  engine.addSystem((dt: number) => {
    if (done) return
    elapsed += dt
    if (elapsed < INIT_DELAY) return
    done = true
    if (!IS_SKY || myTeam === Team.None) teleportHome('initial')
  })

  // Sky: fall respawn. Off when the level is on the ground (SKY_ALTITUDE <
  // FALL_RESPAWN_DROP): there is nothing below to fall to.
  if (IS_SKY && BASE_Y >= FALL_RESPAWN_DROP) {
    let cooldown = 0
    engine.addSystem((dt: number) => {
      if (cooldown > 0) { cooldown -= dt; return }
      const t = Transform.getOrNull(engine.PlayerEntity)
      if (!t || t.position.y >= BASE_Y - FALL_RESPAWN_DROP) return
      cooldown = 2
      teleportHome('fell')
    })
  }
}
