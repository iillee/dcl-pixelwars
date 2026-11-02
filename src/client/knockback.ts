/**
 * knockback.ts — shared local state for the PvP prototype (Dash + Paint Bomb).
 *
 * Owns the local team, the roster's userId → team map, the post-respawn
 * knockback immunity window and a guarded wrapper around the SDK Physics
 * calls, so client/dash and client/paintBomb don't each track them.
 */

import { engine, Entity, Physics, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team } from '../shared/team'
import { RESPAWN_IMMUNITY_S } from '../shared/pvp'
import { KnockSpec, KNOCK_TRACE, KnockTrace } from '../shared/knocks'

let myTeam: Team = Team.None
const teamByUser = new Map<string, Team>() // lowercased userId → team
let immuneLeft = 0
let installed = false

export function localTeam(): Team { return myTeam }
export function teamOfUser(userId: string): Team { return teamByUser.get(userId.toLowerCase()) ?? Team.None }
export function isKnockbackImmune(): boolean { return immuneLeft > 0 }

export function myAddress(): string {
  return (PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address ?? '').toLowerCase()
}

/** Run a Physics call; older explorers may not support the components. */
export function safePhysics(what: string, fn: () => void): void {
  try { fn() } catch (err) { console.log(`[PvP] ${what} failed (Physics unsupported?):`, err) }
}

let trace: KnockTrace | null = null

/** Push the local player with a shared knock (shared/knocks.ts). `forceEnt` owns the held force. */
export function applyKnock(spec: KnockSpec, forceEnt: Entity, what: string): void {
  safePhysics(what, () => {
    Physics.applyImpulseToPlayer(Vector3.create(spec.impulse.x, spec.impulse.y, spec.impulse.z))
    if (spec.force > 0) {
      Physics.applyForceToPlayerForDuration(forceEnt, spec.forceS, Vector3.create(spec.forceDir.x, spec.forceDir.y, spec.forceDir.z), spec.force)
    }
  })
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (KNOCK_TRACE && p) trace = new KnockTrace(spec.kind, 'human', p)
}

export function initKnockbackState(): void {
  if (installed) return
  installed = true
  events.on('team:assigned', ({ team }) => { myTeam = team })
  events.on('team:roster', ({ entries }) => {
    teamByUser.clear()
    for (const { userId, team } of entries) teamByUser.set(userId.toLowerCase(), team)
  })
  events.on('player:respawned', () => { immuneLeft = RESPAWN_IMMUNITY_S })
  engine.addSystem((dt: number) => {
    if (immuneLeft > 0) immuneLeft -= dt
    if (trace) {
      const p = Transform.getOrNull(engine.PlayerEntity)?.position
      const line = trace.sample(dt, p ?? null)
      if (line) { console.log(line); trace = null }
    }
  })
}
