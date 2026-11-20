/**
 * nametags.ts — team plates above every avatar.
 *
 * The server broadcasts `teamRoster` (all active players + team) on join,
 * leave and round reset. AvatarNametag is client-local and never relayed,
 * so every client writes plates for every avatar it can see, including
 * its own (engine.PlayerEntity also carries PlayerIdentityData).
 *
 * Player entity ids are not stable across disconnects, so we resolve
 * userId → entity from PlayerIdentityData on every pass and drop plates
 * from entities whose user is no longer in the roster.
 *
 * Balloon Battle is a free-for-all, so team plates stay off for that
 * round (players and bots) and any leftover pills are stripped at start.
 */

import { engine, Entity, PlayerIdentityData, AvatarNametag } from '@dcl/sdk/ecs'
import { Color3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { isLobbyLayout } from '../maze/rebuild'
import { Team, TEAM_NAME, TEAM_RGB, isPlayingTeam } from '../shared/team'

const teamByUser = new Map<string, Team>() // lowercased userId → team
// What we last wrote per entity, so we only touch the component on change.
const applied = new Map<Entity, string>() // entity → `${userId}:${team}`

const PASS_INTERVAL_S = 0.5
/** True while a Balloon Battle arena is live (not the lobby). */
let balloonMode = false

export function teamPlatesHidden(): boolean {
  return balloonMode || isLobbyLayout()
}

function color(team: Team): Color3 {
  const c = TEAM_RGB[team]
  return Color3.create(c.r, c.g, c.b)
}

function clearNametags(): void {
  teamByUser.clear()
  const extra = new Set(applied.keys())
  for (const [entity] of engine.getEntitiesWith(AvatarNametag)) extra.add(entity)
  for (const entity of extra) AvatarNametag.deleteFrom(entity)
  applied.clear()
}

function applyPass(): void {
  if (teamPlatesHidden()) {
    clearNametags()
    return
  }
  const seen = new Set<Entity>()
  for (const [entity, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    const uid = pid.address.toLowerCase()
    const team = teamByUser.get(uid)
    if (team === undefined || !isPlayingTeam(team)) continue
    seen.add(entity)
    const key = `${uid}:${team}`
    if (applied.get(entity) === key) continue
    const bg = color(team)
    AvatarNametag.createOrReplace(entity, {
      label: TEAM_NAME[team],
      labelColor: Color3.White(),
      backgroundColor: bg,
      borderColor: bg,
    })
    applied.set(entity, key)
  }
  // Plates on entities that left or are no longer on a team.
  for (const entity of Array.from(applied.keys())) {
    if (seen.has(entity)) continue
    AvatarNametag.deleteFrom(entity)
    applied.delete(entity)
  }
}

export function initNametags(): void {
  events.on('team:roster', ({ entries }) => {
    teamByUser.clear()
    for (const { userId, team } of entries) teamByUser.set(userId.toLowerCase(), team)
    console.log(`[Nametags] roster: ${entries.length} player(s)`)
    applyPass()
  })
  events.on('lobby:floor', () => {
    balloonMode = false
    clearNametags()
  })
  events.on('round:reset', ({ format, layout }) => {
    balloonMode = layout !== 'lobby' && format === 'balloon'
    if (teamPlatesHidden()) clearNametags()
    else applyPass()
  })
  // Late join into a Balloon Battle already running (no roundReset).
  events.on('round:clock', ({ format, active }) => {
    if (!active || format !== 'balloon') return
    balloonMode = true
    clearNametags()
  })
  // Periodic pass picks up avatars that load after the roster arrived.
  let clock = 0
  engine.addSystem((dt: number) => {
    clock += dt
    if (clock < PASS_INTERVAL_S) return
    clock = 0
    applyPass()
  })
}
