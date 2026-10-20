/**
 * punch.ts — Punch PvP mechanic, client side (replaces Dash + Paint Bomb).
 *
 * Goal: knock opponents off the edge of the sky map (falling respawns them).
 * Config in shared/pvp.ts. Flow:
 *   1. E (IA_PRIMARY) or the PUNCH hotbar slot → swing: whoosh sound, a small
 *      team-coloured puff in front of the avatar, cooldown PUNCH_COOLDOWN_S.
 *   2. The nearest opponent (avatar or ghost bot) within PUNCH_RANGE and the
 *      PUNCH_CONE_DEG cone in front of the avatar is the target; we send
 *      `punch` with the push direction (puncher → target) and our position.
 *   3. Server validates and broadcasts punchImpact. A player victim's own
 *      client pushes itself (a scene can only move its local player);
 *      the ghost is shoved server-side. Everyone sees a burst + hears a pop.
 *   4. If we fall within LAST_HIT_S of being punched, the console logs who
 *      knocked us off (no UI yet).
 * Respawn immunity lives in client/knockback.
 */

import {
  engine, Entity, InputAction, Material, MaterialTransparencyMode, MeshRenderer, PlayerIdentityData,
  PointerEventType, Transform, AudioSource, inputSystem, Physics,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  PUNCH_MODE, PUNCH_COOLDOWN_S, PUNCH_RANGE, PUNCH_CONE_DEG, PUNCH_MAX_DY, PUNCH_KNOCKBACK,
  PUNCH_LIFT, PUNCH_FORCE, PUNCH_FORCE_S, punchEnabledForRound,
} from '../shared/pvp'
import { playDashSfx, playDashHitSfx, DASH_HIT_SRC } from './audio'
import { sendPunch } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

/** Burst at the impact point: grows FROM → TO over BURST_S. */
const BURST_S = 0.25
const BURST_LIFE_S = 0.6 // entity outlives the mesh so the positional pop isn't cut
const BURST_FROM = 0.4
const BURST_TO = 2.0
/** Swing puff in front of the avatar (also shows on a miss). */
const SWING_S = 0.15
const SWING_FROM = 0.25
const SWING_TO = 0.8
const SWING_AHEAD = 1.2
/** Remember the last puncher this long for the "knocked off by" log (s). */
const LAST_HIT_S = 5

let cooldownLeft = 0
let knockForceEnt: Entity = 0 as Entity
type Fx = { ent: Entity; t: number; dur: number; life: number; from: number; to: number }
const fx: Fx[] = []
let lastHitBy = ''
let lastHitAge = 999

export function isPunchEnabledNow(): boolean {
  return punchEnabledForRound(getRoundIndex())
}

/** HUD state for client/abilityHotbar.tsx. cooldownFrac: 1 = just used, 0 = ready. */
export function getPunchHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number } {
  const enabled = isPunchEnabledNow()
  const cd = Math.max(0, cooldownLeft)
  return {
    show: PUNCH_MODE !== 'off',
    enabled,
    ready: enabled && localTeam() !== Team.None && cd <= 0,
    cooldown: cd,
    cooldownFrac: cd / PUNCH_COOLDOWN_S,
  }
}

function spawnFx(pos: Vector3, team: Team, dur: number, life: number, from: number, to: number, alpha: number, withSound: boolean): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: pos, scale: Vector3.create(from, from, from) })
  MeshRenderer.setSphere(ent)
  const c = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(c.r, c.g, c.b, alpha),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 3,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
  if (withSound) AudioSource.create(ent, { audioClipUrl: DASH_HIT_SRC, playing: true, loop: false, volume: 1, global: false })
  fx.push({ ent, t: 0, dur, life, from, to })
}

function burst(pos: Vector3, team: Team, withSound: boolean): void {
  spawnFx(Vector3.create(pos.x, pos.y + 1, pos.z), team, BURST_S, BURST_LIFE_S, BURST_FROM, BURST_TO, 0.55, withSound)
}

type Target = { id: string; pos: Vector3; d: number }

/** Nearest opponent in range + cone in front of `me` (facing fx, fz). */
function findTarget(me: Vector3, fx_: number, fz: number): Target | null {
  const myTeam = localTeam()
  const cosHalf = Math.cos((PUNCH_CONE_DEG / 2) * Math.PI / 180)
  let best: Target | null = null
  const consider = (id: string, p: Vector3, dyOffset: number) => {
    const dx = p.x - me.x, dz = p.z - me.z
    if (Math.abs(p.y - dyOffset - me.y) > PUNCH_MAX_DY) return
    const d = Math.hypot(dx, dz)
    if (d > PUNCH_RANGE) return
    // Overlapping avatars count regardless of angle.
    if (d > 0.4 && (dx * fx_ + dz * fz) / d < cosHalf) return
    if (!best || d < best.d) best = { id, pos: p, d }
  }
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const team = teamOfUser(pid.address)
    if ((team !== Team.Red && team !== Team.Blue) || team === myTeam) continue
    consider(pid.address, tr.position, 0)
  }
  // Ghost floats 1 m above its floor (botVisual FLOAT_HEIGHT).
  for (const b of getBotRenderPositions()) {
    if (b.team === myTeam) continue
    consider(`bot:${b.id}`, b.pos, 1)
  }
  return best
}

/** Punch if allowed. Bound to E and the PUNCH slot/tooltip. */
export function triggerPunch(): void {
  if (!isPunchEnabledNow() || localTeam() === Team.None || cooldownLeft > 0) return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return
  cooldownLeft = PUNCH_COOLDOWN_S
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  const fl = Math.hypot(f.x, f.z)
  const fx_ = fl > 1e-3 ? f.x / fl : 0, fz = fl > 1e-3 ? f.z / fl : 1
  const me = t.position
  playDashSfx()
  spawnFx(Vector3.create(me.x + fx_ * SWING_AHEAD, me.y + 1.1, me.z + fz * SWING_AHEAD), localTeam(),
    SWING_S, SWING_S, SWING_FROM, SWING_TO, 0.35, false)

  const tgt = findTarget(me, fx_, fz)
  if (!tgt) { console.log('[Punch] swing, no target'); return }
  let dx = tgt.pos.x - me.x, dz = tgt.pos.z - me.z
  const d = Math.hypot(dx, dz)
  if (d < 0.3) { dx = fx_; dz = fz } else { dx /= d; dz /= d }
  sendPunch(tgt.id, dx, dz, me.x, me.y, me.z)
  // Optimistic feedback for the puncher (server may still reject).
  playDashHitSfx()
  burst(tgt.id.startsWith('bot:') ? Vector3.create(tgt.pos.x, tgt.pos.y - 1, tgt.pos.z) : tgt.pos, localTeam(), false)
}

function avatarPosition(addressLower: string): Vector3 | null {
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    if (pid.address.toLowerCase() === addressLower) return tr.position
  }
  return null
}

function onImpact(attacker: string, target: string, dx: number, dz: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase()
  const tgt = target.toLowerCase()
  const attackerTeam = teamOfUser(att)
  if (me && att === me) return // already showed our own burst

  if (tgt.startsWith('bot:')) {
    const id = parseInt(tgt.slice(4), 10)
    const b = getBotRenderPositions().find(x => x.id === id)
    if (b) burst(Vector3.create(b.pos.x, b.pos.y - 1, b.pos.z), attackerTeam, true)
    return
  }
  if (me && tgt === me) {
    if (isKnockbackImmune() || !isPunchEnabledNow()) {
      console.log(`[Punch] punch from ${att.slice(0, 8)} ignored (immune=${isKnockbackImmune()})`)
      return
    }
    safePhysics('punch knockback', () => {
      Physics.applyImpulseToPlayer(Vector3.create(dx * PUNCH_KNOCKBACK, PUNCH_LIFT, dz * PUNCH_KNOCKBACK))
      if (PUNCH_FORCE > 0) {
        Physics.applyForceToPlayerForDuration(knockForceEnt, PUNCH_FORCE_S, Vector3.create(dx, 0, dz), PUNCH_FORCE)
      }
    })
    playDashHitSfx()
    const pos = Transform.getOrNull(engine.PlayerEntity)?.position
    if (pos) burst(pos, attackerTeam, false)
    lastHitBy = att
    lastHitAge = 0
    console.log(`[Punch] punched by ${att.slice(0, 8)} dir=(${dx.toFixed(2)},${dz.toFixed(2)})`)
    return
  }
  const pos = avatarPosition(tgt)
  if (pos) burst(pos, attackerTeam, true)
}

export function initPunch(): void {
  if (PUNCH_MODE === 'off') return
  initKnockbackState()
  knockForceEnt = engine.addEntity()
  events.on('punch:impact', ({ attacker, target, dx, dz }) => onImpact(attacker, target, dx, dz))
  events.on('player:respawned', ({ why }) => {
    if (lastHitBy && lastHitAge < LAST_HIT_S) console.log(`[Punch] knocked off by ${lastHitBy.slice(0, 8)} (${why})`)
    lastHitBy = ''
  })

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    lastHitAge += dt
    if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) triggerPunch()
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) { engine.removeEntity(f.ent); fx.splice(i, 1); continue }
      if (f.t >= f.dur) { if (MeshRenderer.has(f.ent)) MeshRenderer.deleteFrom(f.ent); continue }
      const s = f.from + (f.to - f.from) * (f.t / f.dur)
      Transform.getMutable(f.ent).scale = Vector3.create(s, s, s)
    }
  })
}
