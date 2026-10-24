/**
 * player.ts — player-avatar side effects driven by game events.
 *
 * Owns spawning and respawning (needs ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE,
 * declared in scene.json):
 *   - classic: everyone goes to the centre cross on join and at each round reset.
 *   - sky:     each player goes to their TEAM BASE once the server has
 *              assigned a team (teamAssigned), at each round reset, and
 *              whenever a fall rescue finishes (client/fallRescue.ts). Crossing
 *              the fall line spawns an invisible panel under their feet. The
 *              catch does not teleport or retarget the camera. On desktop a
 *              Tween carries that panel to the base. On mobile the pad stays
 *              still. A camera and a stand-in ride the cloud, and the real
 *              avatar stays hidden until that camera returns, because that
 *              client only steps the body onto a moving collider at physics
 *              ticks.
 *              teleportHome('fell') runs only if they slipped off it.
 */

import { engine, Transform, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMazeReady } from '../maze/rebuild'
import { movePlayerTo } from '~system/RestrictedActions'
import { exitOverview } from './overviewCamera'
import { events } from '../shared/events'
import { Team } from '../shared/team'
import { baseSpawn } from '../maze/generator'
import { IS_SKY } from '../maze/level'
import { cancelFallRescue, fallRescueCameraRide, holdFallLine, initFallRescue } from './fallRescue'

// Classic centre cross: cell (2,2), MAZE_ORIGIN=8, CELL=32 → centre (88, 88).
const CLASSIC_SPAWN = { x: 88, y: 2, z: 88 }
const CLASSIC_CAMERA_TARGET = { x: 88, y: 2, z: 96 }

let myTeam: Team = Team.None

function teleportHome(why: string): void {
  // A spawn / round-reset teleport must not finish a pickup a few seconds later.
  // The fall drop ('fell') is the rescue ending — keep its land lock.
  if (why !== 'fell') cancelFallRescue(why)
  // movePlayerTo is async: don't treat the pre-teleport height as a new fall.
  holdFallLine()
  let pos = CLASSIC_SPAWN, look = CLASSIC_CAMERA_TARGET
  if (IS_SKY) {
    const s = baseSpawn(myTeam === Team.Blue ? 2 : 1) // no team yet → RED base (scene.json default)
    pos = s.pos; look = s.look
  }
  console.log(`[Player] teleport (${why}) → ${pos.x.toFixed(0)},${pos.y.toFixed(1)},${pos.z.toFixed(0)}`)
  // Fire-and-forget: movePlayerTo can reject if the player has left the scene.
  // Leave overview first so the cameraTarget look lands (as in snowdrift).
  exitOverview()
  movePlayerTo({ newRelativePosition: pos, cameraTarget: look }).catch(() => {})
  events.emit('player:respawned', { why })
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

  // Sky: until the maze exists, invisible static pads under both base spawns hold players that
  // spawn early (scene spawn point = RED base); removed once the maze has finished building.
  if (IS_SKY) {
    const pads = [1, 2].map(team => {
      const s = baseSpawn(team).pos
      const e = engine.addEntity()
      Transform.create(e, { position: Vector3.create(s.x, s.y - 1.1, s.z), scale: Vector3.create(16, 0.2, 16) }) // top = slab top
      MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
      return e
    })
    const sys = () => {
      if (!isMazeReady()) return
      pads.forEach(e => engine.removeEntity(e))
      engine.removeSystem(sys)
      console.log('[Player] maze ready → spawn pads removed')
    }
    engine.addSystem(sys)
  }

  // Sky fall line → timed pickup. Desktop: the panel tweens to the base.
  // Mobile: the body was already moved under the ride camera. Either way,
  // arrival does not teleport again. One teleport only if they slip off.
  initFallRescue((how) => {
    if (how === 'snap') { teleportHome('fell'); return }
    // Immunity and the land lock start here, with no teleport at this moment.
    holdFallLine()
    exitOverview()
    const via = fallRescueCameraRide() ? 'mobile camera ride, body already home' : 'tween-carry, no teleport'
    console.log(`[Player] fall rescue landed (${via})`)
    events.emit('player:respawned', { why: 'fell' })
  })
}
