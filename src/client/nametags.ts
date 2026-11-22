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
 *
 * The plate has no team word. Color is the team. A ★ per upgrade level
 * (Speed + Paint + Haste, nine at most) is how strong that player is.
 * The plate starts at the width of four stars and stays that wide until
 * a fifth star, then it grows. Empty slots are spaces, which this plate
 * keeps. A blank plate is four stars drawn in the plate color.
 */

import { engine, Entity, PlayerIdentityData, AvatarNametag } from '@dcl/sdk/ecs'
import { Color3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { events } from '../shared/events'
import { isLobbyLayout } from '../maze/rebuild'
import { Team, TEAM_RGB, isPlayingTeam } from '../shared/team'

const teamByUser = new Map<string, Team>() // lowercased userId → team
const marksByUser = new Map<string, number>() // lowercased userId → upgrade levels
// What we last wrote per entity, so we only touch the component on change.
const applied = new Map<Entity, string>() // entity → `${userId}:${team}:${marks}`
const STAR = '★'
const STAR_CAP = 9
/** Width before the plate is allowed to grow. */
const PLATE_MIN = 4
/** A ★ is wider than a space. Three spaces hold about one star. */
const SPACES_PER_SLOT = 3

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

/** Four stars wide until there are more than four. The blank plate is four stars in the plate color. */
function plateLabel(marks: number, team: Team): { label: string; labelColor: Color3 } {
  const n = Math.max(0, Math.min(STAR_CAP, marks))
  if (n <= 0) return { label: STAR.repeat(PLATE_MIN), labelColor: color(team) }
  if (n >= PLATE_MIN) return { label: STAR.repeat(n), labelColor: Color3.White() }
  const spaces = (PLATE_MIN - n) * SPACES_PER_SLOT
  const left = Math.floor(spaces / 2)
  return { label: ' '.repeat(left) + STAR.repeat(n) + ' '.repeat(spaces - left), labelColor: Color3.White() }
}

function localId(): string {
  const fromPlayer = (getPlayer()?.userId ?? '').toLowerCase()
  if (fromPlayer) return fromPlayer
  const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  return (pid?.address ?? '').toLowerCase()
}

function setMarks(id: string, speed: number, paint: number, haste: number): void {
  const n = Math.max(0, speed) + Math.max(0, paint) + Math.max(0, haste)
  if (n <= 0) marksByUser.delete(id)
  else marksByUser.set(id, Math.min(STAR_CAP, n))
}

function clearNametags(): void {
  teamByUser.clear()
  marksByUser.clear()
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
    const marks = marksByUser.get(uid) ?? 0
    const key = `${uid}:${team}:${marks}`
    if (applied.get(entity) === key) continue
    const bg = color(team)
    const plate = plateLabel(marks, team)
    AvatarNametag.createOrReplace(entity, {
      label: plate.label,
      labelColor: plate.labelColor,
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
  events.on('upgrade:buffs', ({ reset, entries }) => {
    if (reset) marksByUser.clear()
    for (const e of entries) {
      if (!e.id || e.id.startsWith('bot:')) continue
      setMarks(e.id, e.speed, e.paint, e.haste)
    }
    applyPass()
  })
  events.on('upgrade:state', (s) => {
    const me = localId()
    if (!me) return
    setMarks(me, s.speed, s.paint, s.haste)
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
