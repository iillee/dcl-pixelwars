/**
 * dash.ts — Dash PvP prototype, client side (EXPERIMENT, not V1 scope).
 *
 * Config lives in shared/dash.ts; flow and limitations in
 * design/dash-prototype.md. In short:
 *   1. F (IA_SECONDARY) or the on-screen DASH button → impulse + short
 *      sustain force on the LOCAL player along its movement direction
 *      (avatar facing when standing still). Cooldown DASH_COOLDOWN_S.
 *   2. During the hit window this client checks enemy avatars it can see
 *      (PlayerIdentityData + Transform, team from the roster) and reports
 *      the first contact per target as dashHit.
 *   3. The server validates and broadcasts dashImpact. The TARGET's own
 *      client pushes itself (a scene can only move its local player);
 *      everyone shows a flash + positional pop at the target.
 * Respawn (client/player teleportHome) grants RESPAWN_IMMUNITY_S of
 * knockback immunity. The cooldown is never reset.
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
  DASH_MODE, DASH_DURATION_S, DASH_COOLDOWN_S, DASH_IMPULSE, DASH_LIFT, DASH_FORCE,
  DASH_STOP_ON_HIT, DASH_MIN_MOVE_SPEED, HIT_RADIUS, HIT_MAX_DY, HIT_WINDOW_S,
  KNOCKBACK_DASH_DIR_WEIGHT, KNOCKBACK_IMPULSE, KNOCKBACK_LIFT, KNOCKBACK_FORCE,
  KNOCKBACK_FORCE_S, RESPAWN_IMMUNITY_S, dashEnabledForRound,
} from '../shared/dash'
import { playDashSfx, playDashHitSfx, DASH_HIT_SRC } from './audio'
import { sendDashHit } from './clientHandler'

const FLASH_S = 0.3
/** Entity outlives the mesh so the positional pop (~0.37 s) isn't cut off. */
const FLASH_LIFE_S = 0.6
const FLASH_FROM = 0.6
const FLASH_TO = 2.6
/** Velocity samples faster than this are teleports, not movement (m/s). */
const MAX_SANE_SPEED = 60
const VEL_SMOOTH_RATE = 12

let myTeam: Team = Team.None
const teamByUser = new Map<string, Team>() // lowercased userId → team

let cooldownLeft = 0
let dashLeft = 0      // sustain force time left
let hitWindowLeft = 0
let immuneLeft = 0
let dashDir = { x: 0, z: 1 }
const hitThisDash = new Set<string>()

let lastPos: Vector3 | null = null
const vel = { x: 0, z: 0 }

let dashForceEnt: Entity = 0 as Entity
let knockForceEnt: Entity = 0 as Entity

type Flash = { ent: Entity; t: number }
const flashes: Flash[] = []

function myAddress(): string {
  return (PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address ?? '').toLowerCase()
}

export function isDashEnabledNow(): boolean {
  return dashEnabledForRound(getRoundIndex())
}

/** HUD state for client/dashUi.tsx. */
export function getDashHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; roundLabel: string } {
  const enabled = isDashEnabledNow()
  return {
    show: DASH_MODE !== 'off',
    enabled,
    ready: enabled && myTeam !== Team.None && cooldownLeft <= 0,
    cooldown: Math.max(0, cooldownLeft),
    roundLabel: DASH_MODE === 'alternate' ? (enabled ? 'DASH ROUND' : 'PAINT ONLY') : '',
  }
}

function safe(what: string, fn: () => void): void {
  try { fn() } catch (err) { console.log(`[Dash] ${what} failed (Physics unsupported?):`, err) }
}

/** Start a dash if allowed. Bound to F and the DASH button. */
export function triggerDash(): void {
  if (!isDashEnabledNow() || myTeam === Team.None || cooldownLeft > 0) return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return

  const speed = Math.hypot(vel.x, vel.z)
  if (speed > DASH_MIN_MOVE_SPEED) {
    dashDir = { x: vel.x / speed, z: vel.z / speed }
  } else {
    const f = Vector3.rotate(Vector3.Forward(), t.rotation)
    const l = Math.hypot(f.x, f.z)
    dashDir = l > 1e-3 ? { x: f.x / l, z: f.z / l } : { x: 0, z: 1 }
  }

  cooldownLeft = DASH_COOLDOWN_S
  dashLeft = DASH_DURATION_S
  hitWindowLeft = HIT_WINDOW_S
  hitThisDash.clear()

  safe('dash impulse', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dashDir.x * DASH_IMPULSE, DASH_LIFT, dashDir.z * DASH_IMPULSE))
    if (DASH_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(dashForceEnt, DASH_DURATION_S, Vector3.create(dashDir.x, 0, dashDir.z), DASH_FORCE)
    }
  })
  playDashSfx()
  console.log(`[Dash] dash dir=(${dashDir.x.toFixed(2)},${dashDir.z.toFixed(2)}) moving=${speed > DASH_MIN_MOVE_SPEED}`)
}

function stopDashForce(): void {
  dashLeft = 0
  if (DASH_FORCE > 0) safe('remove dash force', () => Physics.removeForceFromPlayer(dashForceEnt))
}

function spawnFlash(pos: Vector3, team: Team, withSound: boolean): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(pos.x, pos.y + 1, pos.z), scale: Vector3.create(FLASH_FROM, FLASH_FROM, FLASH_FROM) })
  MeshRenderer.setSphere(ent)
  const c = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(c.r, c.g, c.b, 0.55),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 3,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
  if (withSound) {
    AudioSource.create(ent, { audioClipUrl: DASH_HIT_SRC, playing: true, loop: false, volume: 1, global: false })
  }
  flashes.push({ ent, t: 0 })
}

function avatarPosition(addressLower: string): Vector3 | null {
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    if (pid.address.toLowerCase() === addressLower) return tr.position
  }
  return null
}

function checkHits(me: Vector3): void {
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const uid = pid.address.toLowerCase()
    if (!uid || hitThisDash.has(uid)) continue
    const team = teamByUser.get(uid)
    if (team !== Team.Red && team !== Team.Blue) continue
    if (team === myTeam) continue
    const p = tr.position
    const dx = p.x - me.x, dz = p.z - me.z
    if (Math.abs(p.y - me.y) > HIT_MAX_DY) continue
    const d = Math.hypot(dx, dz)
    if (d > HIT_RADIUS) continue

    hitThisDash.add(uid)
    const w = KNOCKBACK_DASH_DIR_WEIGHT
    let px = dashDir.x * w, pz = dashDir.z * w
    if (d > 1e-3) { px += (dx / d) * (1 - w); pz += (dz / d) * (1 - w) }
    const pl = Math.hypot(px, pz)
    if (pl < 1e-3) { px = dashDir.x; pz = dashDir.z } else { px /= pl; pz /= pl }

    sendDashHit(pid.address, px, pz)
    playDashHitSfx()
    spawnFlash(p, myTeam, false)
    if (DASH_STOP_ON_HIT) stopDashForce()
  }
}

function onImpact(attacker: string, target: string, dx: number, dz: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase()
  const tgt = target.toLowerCase()
  const attackerTeam = teamByUser.get(att) ?? Team.None

  if (me && tgt === me) {
    const pos = Transform.getOrNull(engine.PlayerEntity)?.position
    if (immuneLeft > 0 || !isDashEnabledNow()) {
      console.log(`[Dash] impact from ${att.slice(0, 8)} ignored (immune=${immuneLeft > 0})`)
      return
    }
    safe('knockback', () => {
      Physics.applyImpulseToPlayer(Vector3.create(dx * KNOCKBACK_IMPULSE, KNOCKBACK_LIFT, dz * KNOCKBACK_IMPULSE))
      if (KNOCKBACK_FORCE > 0) {
        Physics.applyForceToPlayerForDuration(knockForceEnt, KNOCKBACK_FORCE_S, Vector3.create(dx, 0, dz), KNOCKBACK_FORCE)
      }
    })
    playDashHitSfx()
    if (pos) spawnFlash(pos, attackerTeam, false)
    console.log(`[Dash] knocked back by ${att.slice(0, 8)} dir=(${dx.toFixed(2)},${dz.toFixed(2)})`)
    return
  }
  // Our own hit already showed its flash when we detected it.
  if (me && att === me) return
  const pos = avatarPosition(tgt)
  if (pos) spawnFlash(pos, attackerTeam, true)
}

export function initDash(): void {
  if (DASH_MODE === 'off') return
  dashForceEnt = engine.addEntity()
  knockForceEnt = engine.addEntity()

  events.on('team:assigned', ({ team }) => { myTeam = team })
  events.on('team:roster', ({ entries }) => {
    teamByUser.clear()
    for (const { userId, team } of entries) teamByUser.set(userId.toLowerCase(), team)
  })
  events.on('player:respawned', () => {
    immuneLeft = RESPAWN_IMMUNITY_S
    lastPos = null
    vel.x = 0; vel.z = 0
  })
  events.on('dash:impact', ({ attacker, target, dx, dz }) => onImpact(attacker, target, dx, dz))

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    if (immuneLeft > 0) immuneLeft -= dt

    const t = Transform.getOrNull(engine.PlayerEntity)
    if (t && dt > 0) {
      const p = t.position
      if (lastPos) {
        const vx = (p.x - lastPos.x) / dt, vz = (p.z - lastPos.z) / dt
        if (Math.hypot(vx, vz) < MAX_SANE_SPEED) {
          const k = 1 - Math.exp(-VEL_SMOOTH_RATE * dt)
          vel.x += (vx - vel.x) * k
          vel.z += (vz - vel.z) * k
        }
      }
      lastPos = Vector3.clone(p)
    }

    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) triggerDash()

    if (dashLeft > 0) dashLeft -= dt
    if (hitWindowLeft > 0) {
      hitWindowLeft -= dt
      if (t) checkHits(t.position)
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]
      f.t += dt
      if (f.t >= FLASH_LIFE_S) {
        engine.removeEntity(f.ent)
        flashes.splice(i, 1)
        continue
      }
      if (f.t >= FLASH_S) {
        if (MeshRenderer.has(f.ent)) MeshRenderer.deleteFrom(f.ent)
        continue
      }
      const s = FLASH_FROM + (FLASH_TO - FLASH_FROM) * (f.t / FLASH_S)
      Transform.getMutable(f.ent).scale = Vector3.create(s, s, s)
    }
  })
}
