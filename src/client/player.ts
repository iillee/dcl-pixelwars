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

import { engine, Transform, MeshCollider, ColliderLayer, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isLobbyLayout, isMazeReady } from '../maze/rebuild'
import { movePlayerTo } from '~system/RestrictedActions'
import { exitOverview } from './overviewCamera'
import { events } from '../shared/events'
import { earlySpawnPads, padContains } from '../shared/lobby'
import { clearLobbyHoldFloor, installLobbyHoldFloor, lobbyHoldContains } from '../lobbyHoldFloor'
import { Team, isPlayingTeam } from '../shared/team'
import { BASE_Y, CELL, MAZE_ORIGIN, baseSpawn } from '../maze/generator'
import { IS_SKY } from '../maze/level'
import { assignedRescueHome, cancelFallRescue, fallRescueCameraRide, holdFallLine, initFallRescue } from './fallRescue'
import { lobbyStand } from './lobby'
import { gamePhase } from './phase'

// Classic centre cross: cell (2,2), MAZE_ORIGIN=8, CELL=32 → centre (88, 88).
const CLASSIC_SPAWN = { x: 88, y: 2, z: 88 }
const CLASSIC_CAMERA_TARGET = { x: 88, y: 2, z: 96 }

let myTeam: Team = Team.None
let spawnPads: Entity[] = []
// After a lobby-to-match teleport, GLB colliders can still be late on mobile
// even once isMazeReady() is true (the reveal cascade finished, the physics
// meshes may not have). Keep the primitive hold floors up and snap a drop
// back for this long, then clear — well before a mid-match fall should reach
// the water / rescue.
const MATCH_HOLD_MS = 6000
let matchHoldUntil = 0
let matchHoldPads: ReturnType<typeof earlySpawnPads> = []

function armMatchHold(): void {
  installLobbyHoldFloor()
  clearSpawnPads()
  ensureSpawnPads()
  matchHoldPads = earlySpawnPads(MAZE_ORIGIN, CELL, BASE_Y, [1, 2, 3, 4].map(t => baseSpawn(t).pos))
  matchHoldUntil = Date.now() + MATCH_HOLD_MS
}

function overMatchHold(x: number, z: number): boolean {
  for (const p of matchHoldPads) {
    if (padContains({ ...p, sx: p.sx + 4, sz: p.sz + 4 }, x, z)) return true
  }
  return lobbyHoldContains(x, z)
}

function clearSpawnPads(): void {
  for (const e of spawnPads) engine.removeEntity(e)
  spawnPads = []
}

function ensureSpawnPads(): void {
  if (!IS_SKY || spawnPads.length) return
  for (const p of earlySpawnPads(MAZE_ORIGIN, CELL, BASE_Y, [1, 2, 3, 4].map(t => baseSpawn(t).pos))) {
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(p.x, p.y, p.z),
      rotation: Quaternion.fromEulerDegrees(0, p.yaw, 0),
      scale: Vector3.create(p.sx, p.sy, p.sz),
    })
    MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
    spawnPads.push(e)
  }
}

function teleportHome(why: string): void {
  // A spawn / round-reset teleport must not finish a pickup a few seconds later.
  // The fall drop ('fell') is the rescue ending — keep its land lock.
  if (why !== 'fell') cancelFallRescue(why)
  // movePlayerTo is async: don't treat the pre-teleport height as a new fall.
  holdFallLine()
  let pos = CLASSIC_SPAWN, look = CLASSIC_CAMERA_TARGET
  // A mid-match / force join can arrive while the local floor is still the
  // lobby. Sending those teleports to lobbyStand leaves the player hanging
  // in the air as if they were still voting. Match destinations must go to
  // the team base even if the arena mesh has not swapped yet.
  if (IS_SKY && (why === 'lobby' || why === 'lobby-drop' || (isLobbyLayout() && why !== 'match' && why !== 'team assigned' && why !== 'round reset' && why !== 'match-drop'))) {
    const c = lobbyStand()
    pos = c
    look = { x: c.x, y: c.y, z: c.z + 8 }
  } else if (IS_SKY) {
    // Put a temporary collider under the current team floors (which may sit
    // above or below L0) before the tile mesh can hold the player. On mobile
    // the maze can report ready before GLB colliders actually hold, so keep
    // thick primitive slabs up for a short window after this teleport.
    if (why !== 'fell') armMatchHold()
    else {
      clearSpawnPads()
      ensureSpawnPads()
    }
    const assigned = why === 'fell' ? assignedRescueHome() : null
    const s = assigned
      ? { pos: assigned, look: { x: assigned.x, y: assigned.y, z: assigned.z + 8 } }
      : baseSpawn(isPlayingTeam(myTeam) ? myTeam : 1) // no team yet → RED base (scene.json default)
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
  events.on('round:reset', ({ layout }) => {
    if (layout === 'lobby') return // lobby:floor teleports after the cross exists
    teleportHome('round reset')
  })
  events.on('lobby:floor', () => {
    // Pads first, so the teleport lands on a floor if the mesh collider
    // is not ready on this frame. Re-install the early hold floor in case
    // a previous match cleared it.
    installLobbyHoldFloor()
    ensureSpawnPads()
    teleportHome('lobby')
  })
  // Entering a match from the boot lobby. Clocks repeat; only the transition moves us.
  let leftLobby = false
  events.on('round:clock', ({ phase }) => {
    if (phase === 'lobby' || phase === 'idle') { leftLobby = false; return }
    if (phase === 'match' && !leftLobby) { leftLobby = true; teleportHome('match') }
  })

  // Sky: team known → go to that team's base (once per assignment change).
  // Not while the server still has us in the lobby — that teleport raced the
  // cross move and left the joiner on the red base.
  events.on('team:assigned', ({ team }) => {
    const changed = team !== myTeam
    myTeam = team
    if (IS_SKY && changed && gamePhase() === 'match' && !isLobbyLayout()) teleportHome('team assigned')
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

  // Invisible boxes under the team bases, the cross center, and the Prototype
  // and Balloon Battle vote floors. The tile meshes are not colliders yet on
  // the frame a player is placed there (join, lobby return, match start). Bot
  // Fight and Team Fight keep the same base and cross pads they already had. Pads stay
  // through the lobby and until the match floor has finished growing, then
  // come back the next time the lobby is laid.
  if (IS_SKY) {
    installLobbyHoldFloor()
    ensureSpawnPads()
    engine.addSystem(() => {
      if (isLobbyLayout() || !isMazeReady()) return
      if (Date.now() < matchHoldUntil) return
      if (spawnPads.length) {
        clearSpawnPads()
        console.log('[Player] maze ready → spawn pads removed')
      }
      if (matchHoldUntil) matchHoldUntil = 0
      clearLobbyHoldFloor()
    })
    // If the avatar still tunnels through the lobby (thin or late colliders
    // on mobile), snap them back only while they are over the lobby footprint.
    // Off the island they are allowed to fall; rescue is unchanged.
    let dropLock = 0
    engine.addSystem((dt: number) => {
      dropLock = Math.max(0, dropLock - dt)
      if (dropLock > 0) return
      const p = Transform.getOrNull(engine.PlayerEntity)?.position
      if (!p) return
      if (p.y >= BASE_Y - 0.5) return
      if (isLobbyLayout()) {
        if (!lobbyHoldContains(p.x, p.z)) return
        dropLock = 1
        teleportHome('lobby-drop')
        return
      }
      // Match-start only: if they tunneled the team floor before GLB
      // colliders arrived, snap back. Off the island, rescue is unchanged.
      if (Date.now() >= matchHoldUntil) return
      if (!overMatchHold(p.x, p.z)) return
      dropLock = 1
      teleportHome('match-drop')
    })
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
