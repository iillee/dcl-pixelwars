/**
 * lunge.ts — Lunge (shoulder-charge) PvP mechanic, client side.
 * Replaces Dash / Punch. Config: shared/pvp.ts LUNGE_*; pure logic:
 * shared/lunge.ts (swept hit, knock direction, dedupe/stale gates).
 *
 * A. Movement (local player only — SDK Physics can't move other avatars):
 *    press → one HORIZONTAL impulse along avatar facing (LUNGE_LIFT 0, so
 *    gravity/grounding stay in charge and ramps/crests don't launch), then
 *    at the end of LUNGE_ACTIVE_S a brake impulse cancels what's left of it
 *    (scaled by measured speed / peak speed, so lunging into a wall doesn't
 *    bounce back). No forces held, no teleport: the character controller
 *    still collides with walls. Jump/run/jog disabled via InputModifier
 *    during active + LUNGE_RECOVERY_S (walk only = "reduced control").
 * B. Hits (attacker's client): every frame of the active window (+ grace)
 *    the capsule swept from last frame's position to this one is tested
 *    against every visible opposing avatar and the ghost (so fast frames
 *    can't skip a target). Each target once per lunge → lungeHit.
 *    Server dedupes (attacker, lunge id, target), checks the window and
 *    teams, broadcasts lungeImpact; the VICTIM's client applies its own
 *    knockback and drops it if it arrives > LUNGE_IMPACT_MAX_AGE_MS after
 *    it saw that lunge start, or twice.
 * C. Feedback: press = team glow puff (no input delay) + random lunge take (assets/sounds/lunge_0N.wav, preloaded) + upper-body 'punch' emote (LUNGE_EMOTE); active =
 *    streak behind the avatar (shown on remote avatars too via
 *    lungeStarted); hit = pop + impact boom + big burst at contact, attacker
 *    brakes on the spot (hit-stop stand-in); miss = small grey dust puff
 *    at the end, nothing else. Pressing during cooldown does nothing.
 * Debug (LUNGE_DEBUG): hitbox spheres per frame, direction dots, hit and
 * knockback markers, state log.
 */

import {
  engine, Entity, InputAction, InputModifier, Material, MaterialTransparencyMode, MeshRenderer,
  PlayerIdentityData, PointerEventType, Transform, AudioSource, inputSystem, Physics, Tween, EasingFunction, AvatarMask,
} from '@dcl/sdk/ecs'
import { triggerEmote } from '~system/RestrictedActions'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  LUNGE_MODE, LUNGE_DEBUG, LUNGE_ACTIVE_S, LUNGE_DISTANCE, LUNGE_IMPULSE, LUNGE_LIFT, LUNGE_BRAKE,
  LUNGE_RECOVERY_S, LUNGE_COOLDOWN_S, LUNGE_HIT_GRACE_S, LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT,
  LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S, LUNGE_IMPACT_MAX_AGE_MS, lungeEnabledForRound,
  LUNGE_EMOTE, LUNGE_EMOTE_NAME,
} from '../shared/pvp'
import { sweptHit, knockDir, ImpactGate, V3 } from '../shared/lunge'
import { playLungeSfx, pickLungeSrc, DASH_HIT_SRC } from './audio'
import { sendLungeStart, sendLungeHit } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { getDummyTargets, hitDummy } from './lungeDummy'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

const BOOM_SRC = 'assets/sounds/bomb_exploding.mp3' // strong impact layer under the pop
const BOT_FLOAT = 1 // botVisual FLOAT_HEIGHT
const LAST_HIT_S = 5

type State = 'ready' | 'active' | 'recovery' | 'cooldown'
let state: State = 'ready'
let stateLeft = 0
let cooldownLeft = 0
let lungeId = 0
let dir = { x: 0, z: 1 }
let startPos: V3 = { x: 0, y: 0, z: 0 }
let prevPos: V3 | null = null
let hitWindowLeft = 0
let hitAny = false
let peakSpeed = 0
let curSpeed = 0
let baseSpeed = 0 // forward speed at the press (run momentum), kept by the brake
const lastVel = { x: 0, z: 0 }
const hitThis = new Set<string>()
const gate = new ImpactGate(LUNGE_IMPACT_MAX_AGE_MS)
let knockForceEnt: Entity = 0 as Entity
let lastHitBy = ''
let lastHitAge = 999

// ─── FX (pooled-free: few entities, removed after life) ─────────────
type Fx = { ent: Entity; t: number; dur: number; life: number; from: number; to: number }
const fx: Fx[] = []

function spawnFx(pos: V3, rgb: { r: number; g: number; b: number }, dur: number, life: number, from: number, to: number,
  alpha: number, sound?: { src: string; vol: number }): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(pos.x, pos.y, pos.z), scale: Vector3.create(from, from, from) })
  MeshRenderer.setSphere(ent)
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(rgb.r, rgb.g, rgb.b, alpha),
    emissiveColor: Color4.create(rgb.r, rgb.g, rgb.b, 1),
    emissiveIntensity: 3,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
  if (sound) AudioSource.create(ent, { audioClipUrl: sound.src, playing: true, loop: false, volume: sound.vol, global: false })
  fx.push({ ent, t: 0, dur, life, from, to })
}
const teamRgb = (t: Team) => TEAM_RGB[t] ?? { r: 1, g: 1, b: 1 }
const GREY = { r: 0.7, g: 0.7, b: 0.7 }
const WHITE = { r: 1, g: 1, b: 1 }

function impactFx(p: V3, team: Team, withSound: boolean): void {
  spawnFx({ x: p.x, y: p.y + 1, z: p.z }, teamRgb(team), 0.22, 0.9, 0.5, 3.2, 0.6,
    withSound ? { src: DASH_HIT_SRC, vol: 1 } : undefined)
  spawnFx({ x: p.x, y: p.y + 1, z: p.z }, WHITE, 0.1, 0.9, 0.3, 1.4, 0.9,
    withSound ? { src: BOOM_SRC, vol: 0.5 } : undefined)
}

// Streak (dash.ts wind trail, short + dense). Also drawn on remote avatars.
const STREAK_INTERVAL = 0.025
const STREAK_LIFE_MS = 280
const STREAK_POOL = 24
const STREAK_HIDDEN = Vector3.create(0, -100, 0)
const STREAK_MAT = {
  albedoColor: Color4.create(0.85, 0.95, 1.0, 0.5), emissiveColor: Color4.create(0.6, 0.85, 1.0, 1),
  emissiveIntensity: 2.5, roughness: 1.0, metallic: 0.0, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
}
const streakPool: Entity[] = []
let streakIdx = 0
const streakLive: Array<{ e: Entity; until: number }> = []
/** Avatars currently lunging (us = '' key uses PlayerEntity). */
const lungers = new Map<string, { left: number; accum: number }>()

function spawnStreak(p: V3): void {
  if (streakPool.length === 0) {
    for (let i = 0; i < STREAK_POOL; i++) {
      const e = engine.addEntity()
      Transform.create(e, { position: STREAK_HIDDEN, scale: Vector3.Zero() })
      MeshRenderer.setSphere(e)
      Material.setPbrMaterial(e, STREAK_MAT)
      streakPool.push(e)
    }
  }
  const e = streakPool[streakIdx++ % STREAK_POOL]
  const s = 0.4 * (0.8 + Math.random() * 0.4)
  const t = Transform.getMutable(e)
  t.position = Vector3.create(p.x, p.y + 0.5 + Math.random() * 0.7, p.z)
  t.scale = Vector3.create(s, s, s)
  Tween.createOrReplace(e, {
    mode: Tween.Mode.Scale({ start: Vector3.create(s, s, s), end: Vector3.Zero() }),
    duration: STREAK_LIFE_MS, easingFunction: EasingFunction.EF_EASEINQUAD,
  })
  streakLive.push({ e, until: Date.now() + STREAK_LIFE_MS + 50 })
}

function avatarPos(addrLower: string): V3 | null {
  if (addrLower === '') return Transform.getOrNull(engine.PlayerEntity)?.position ?? null
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    if (pid.address.toLowerCase() === addrLower) return tr.position
  }
  return null
}

function tickStreaks(dt: number): void {
  const now = Date.now()
  for (let i = streakLive.length - 1; i >= 0; i--) {
    if (now < streakLive[i].until) continue
    const e = streakLive[i].e
    const tr = Transform.getMutableOrNull(e)
    if (tr) { tr.position = STREAK_HIDDEN; tr.scale = Vector3.Zero() }
    if (Tween.has(e)) Tween.deleteFrom(e)
    streakLive.splice(i, 1)
  }
  for (const [who, l] of lungers) {
    l.left -= dt
    if (l.left <= 0) { lungers.delete(who); continue }
    const p = avatarPos(who)
    if (!p) continue
    l.accum += dt
    while (l.accum >= STREAK_INTERVAL) { l.accum -= STREAK_INTERVAL; spawnStreak(p) }
  }
}

// ─── Debug overlay ──────────────────────────────────────────────────
function dbgMark(p: V3, rgb: { r: number; g: number; b: number }, size: number, life = 1.0): void {
  if (!LUNGE_DEBUG) return
  spawnFx(p, rgb, life, life, size, size, 0.25)
}
function dbgLog(msg: string): void { if (LUNGE_DEBUG) console.log(`[Lunge dbg] ${msg}`) }

// ─── Input modifier (reduced control during active + recovery) ──────
function setReducedControl(on: boolean): void {
  safePhysics('input modifier', () => {
    if (on) {
      InputModifier.createOrReplace(engine.PlayerEntity, {
        mode: InputModifier.Mode.Standard({ disableJump: true, disableRun: true, disableJog: true, disableDoubleJump: true }),
      })
    } else if (InputModifier.has(engine.PlayerEntity)) {
      InputModifier.deleteFrom(engine.PlayerEntity)
    }
  })
}

// ─── Public HUD + trigger ───────────────────────────────────────────
export function isLungeEnabledNow(): boolean { return lungeEnabledForRound(getRoundIndex()) }

export function getLungeHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number } {
  const enabled = isLungeEnabledNow()
  const cd = Math.max(0, cooldownLeft)
  return { show: LUNGE_MODE !== 'off', enabled, ready: enabled && localTeam() !== Team.None && cd <= 0, cooldown: cd, cooldownFrac: cd / LUNGE_COOLDOWN_S }
}

/** E / LUNGE slot. Silent no-op while active, recovering or cooling down. */
export function triggerLunge(): void {
  if (!isLungeEnabledNow() || localTeam() === Team.None || cooldownLeft > 0 || state !== 'ready') return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return
  // Feedback first, on the input frame, before any physics or network work.
  playLungeSfx()
  if (LUNGE_EMOTE) {
    triggerEmote({ predefinedEmote: LUNGE_EMOTE_NAME, mask: AvatarMask.AM_UPPER_BODY })
      .catch(err => console.log('[Lunge] emote failed:', err))
  }
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  const fl = Math.hypot(f.x, f.z)
  dir = fl > 1e-3 ? { x: f.x / fl, z: f.z / fl } : { x: 0, z: 1 }
  lungeId = (lungeId + 1) % 1_000_000
  startPos = { x: t.position.x, y: t.position.y, z: t.position.z }
  prevPos = startPos
  state = 'active'; stateLeft = LUNGE_ACTIVE_S
  cooldownLeft = LUNGE_COOLDOWN_S
  hitWindowLeft = LUNGE_ACTIVE_S + LUNGE_HIT_GRACE_S
  hitAny = false
  baseSpeed = Math.max(0, lastVel.x * dir.x + lastVel.z * dir.z)
  peakSpeed = baseSpeed; curSpeed = baseSpeed
  hitThis.clear()
  setReducedControl(true)
  safePhysics('lunge impulse', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dir.x * LUNGE_IMPULSE, LUNGE_LIFT, dir.z * LUNGE_IMPULSE))
  })
  sendLungeStart(lungeId, dir.x, dir.z, startPos.x, startPos.y, startPos.z)
  // Anticipation without input delay: team glow at the chest + lunge take.
  spawnFx({ x: startPos.x + dir.x * 0.6, y: startPos.y + 1.1, z: startPos.z + dir.z * 0.6 }, teamRgb(localTeam()),
    0.08, 0.08, 0.5, 1.1, 0.5)
  lungers.set('', { left: LUNGE_ACTIVE_S, accum: 0 })
  dbgLog(`#${lungeId} start dir=(${dir.x.toFixed(2)},${dir.z.toFixed(2)})`)
  for (let s = 0.5; s <= 3; s += 0.5) dbgMark({ x: startPos.x + dir.x * s, y: startPos.y + 0.2, z: startPos.z + dir.z * s }, { r: 1, g: 1, b: 0 }, 0.15)
  checkHits(startPos, startPos)
}

function endActive(): void {
  // Brake: cancel what's left of the start impulse (no slide, no launch carry).
  // Only the lunge's extra speed above the run speed at the press is braked.
  const peakExtra = peakSpeed - baseSpeed
  const frac = peakExtra > 0.5 ? Math.max(0, Math.min(1, (curSpeed - baseSpeed) / peakExtra)) : 1
  const b = LUNGE_IMPULSE * LUNGE_BRAKE * frac
  if (b > 0.01) safePhysics('lunge brake', () => Physics.applyImpulseToPlayer(Vector3.create(-dir.x * b, 0, -dir.z * b)))
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  const travelled = p ? Math.hypot(p.x - startPos.x, p.z - startPos.z) : 0
  console.log(`[Lunge] #${lungeId} travelled ${travelled.toFixed(2)} m (target ${LUNGE_DISTANCE}) hit=${hitAny} brake=${frac.toFixed(2)} run=${baseSpeed.toFixed(1)} peak=${peakSpeed.toFixed(1)}`)
  if (!hitAny && p) spawnFx({ x: p.x, y: p.y + 0.15, z: p.z }, GREY, 0.2, 0.2, 0.3, 0.9, 0.35) // miss: dust
  state = 'recovery'; stateLeft = LUNGE_RECOVERY_S
  dbgLog(`#${lungeId} → recovery`)
}

function checkHits(a0: V3, a1: V3): void {
  const myTeam = localTeam()
  const tryHit = (id: string, t: V3) => {
    if (hitThis.has(id)) return
    if (!sweptHit(a0, a1, t, startPos, dir.x, dir.z)) return
    hitThis.add(id)
    const k = knockDir(a1, t, dir.x, dir.z)
    if (id.startsWith('dummy:')) hitDummy(parseInt(id.slice(6), 10), k.x, k.z) // local test box, no server
    else sendLungeHit(lungeId, id, k.x, k.z, a1.x, a1.y, a1.z)
    impactFx(t, myTeam, true) // optimistic: the attacker feels it now
    dbgMark({ x: t.x, y: t.y + 2.2, z: t.z }, { r: 1, g: 0, b: 0 }, 0.5)
    for (let s = 0.5; s <= 3; s += 0.5) dbgMark({ x: t.x + k.x * s, y: t.y + 0.3, z: t.z + k.z * s }, { r: 1, g: 0.3, b: 0 }, 0.18)
    if (!hitAny && state === 'active') {
      hitAny = true
      // Hit-stop stand-in: the attacker stops dead on contact.
      curSpeed = peakSpeed
      stateLeft = 0
    }
  }
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const team = teamOfUser(pid.address)
    if ((team !== Team.Red && team !== Team.Blue) || team === myTeam) continue
    tryHit(pid.address.toLowerCase(), tr.position)
  }
  for (const b of getBotRenderPositions()) {
    if (b.team === myTeam) continue
    tryHit(`bot:${b.id}`, { x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z })
  }
  for (const d of getDummyTargets()) tryHit(`dummy:${d.i}`, d.pos)
  dbgMark({ x: a1.x, y: a1.y + 1, z: a1.z }, { r: 0, g: 1, b: 1 }, 2.2, 0.3)
}

// ─── Network events ─────────────────────────────────────────────────
function onStarted(attacker: string, id: number): void {
  const att = attacker.toLowerCase()
  gate.sawStart(att, id, Date.now())
  if (att === myAddress()) return
  lungers.set(att, { left: LUNGE_ACTIVE_S, accum: 0 })
  const p = avatarPos(att)
  // Remote lunge: glow + the same lunge take set, positional at that avatar.
  // life 0.7 s so the take (~0.6 s) isn't cut when the fx entity is removed.
  if (p) spawnFx({ x: p.x, y: p.y + 1.1, z: p.z }, teamRgb(teamOfUser(att)), 0.08, 0.7, 0.5, 1.1, 0.5,
    { src: pickLungeSrc(), vol: 0.9 })
}

function onImpact(attacker: string, id: number, target: string, dx: number, dz: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase()
  const tgt = target.toLowerCase()
  const attTeam = teamOfUser(att)
  if (me && att === me) return // attacker already showed its FX
  if (tgt.startsWith('bot:')) {
    const b = getBotRenderPositions().find(x => `bot:${x.id}` === tgt)
    if (b) impactFx({ x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z }, attTeam, true)
    return
  }
  if (me && tgt === me) {
    const verdict = gate.accept(att, id, Date.now())
    if (verdict !== 'ok' || isKnockbackImmune() || !isLungeEnabledNow()) {
      console.log(`[Lunge] impact #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
      return
    }
    safePhysics('lunge knockback', () => {
      Physics.applyImpulseToPlayer(Vector3.create(dx * LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, dz * LUNGE_KNOCKBACK))
      if (LUNGE_KNOCK_FORCE > 0) {
        Physics.applyForceToPlayerForDuration(knockForceEnt, LUNGE_KNOCK_FORCE_S, Vector3.create(dx, 0, dz), LUNGE_KNOCK_FORCE)
      }
    })
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (p) {
      impactFx(p, attTeam, true)
      for (let s = 0.5; s <= 3; s += 0.5) dbgMark({ x: p.x + dx * s, y: p.y + 0.3, z: p.z + dz * s }, { r: 1, g: 0.3, b: 0 }, 0.18)
    }
    lastHitBy = att; lastHitAge = 0
    console.log(`[Lunge] knocked by ${att.slice(0, 8)} #${id} dir=(${dx.toFixed(2)},${dz.toFixed(2)})`)
    return
  }
  const p = avatarPos(tgt)
  if (p) impactFx(p, attTeam, true)
}

function cancelLunge(why: string): void {
  if (state === 'active' || state === 'recovery') dbgLog(`#${lungeId} cancelled (${why})`)
  if (state === 'active' || state === 'recovery') setReducedControl(false)
  state = cooldownLeft > 0 ? 'cooldown' : 'ready'
  hitWindowLeft = 0
  lungers.delete('')
  prevPos = null
}

export function initLunge(): void {
  if (LUNGE_MODE === 'off') return
  initKnockbackState()
  knockForceEnt = engine.addEntity()
  events.on('lunge:started', ({ attacker, id }) => onStarted(attacker, id))
  events.on('lunge:impact', ({ attacker, id, target, dx, dz }) => onImpact(attacker, id, target, dx, dz))
  events.on('player:respawned', ({ why }) => {
    // Fall/respawn mid-attack: drop the lunge (no brake after a teleport).
    cancelLunge(why)
    if (lastHitBy && lastHitAge < LAST_HIT_S) console.log(`[Lunge] knocked off by ${lastHitBy.slice(0, 8)} (${why})`)
    lastHitBy = ''
  })

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    lastHitAge += dt
    if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) triggerLunge()

    const t = Transform.getOrNull(engine.PlayerEntity)
    const pos: V3 | null = t ? { x: t.position.x, y: t.position.y, z: t.position.z } : null

    if (state === 'active' && pos && prevPos && dt > 0) {
      const v = ((pos.x - prevPos.x) * dir.x + (pos.z - prevPos.z) * dir.z) / dt
      curSpeed = Math.max(0, v)
      if (curSpeed > peakSpeed) peakSpeed = curSpeed
    }
    if (hitWindowLeft > 0 && pos) {
      hitWindowLeft -= dt
      checkHits(prevPos ?? pos, pos)
    }
    if (state === 'active') {
      stateLeft -= dt
      if (stateLeft <= 0) endActive()
    } else if (state === 'recovery') {
      stateLeft -= dt
      if (stateLeft <= 0) { setReducedControl(false); state = cooldownLeft > 0 ? 'cooldown' : 'ready'; dbgLog(`#${lungeId} → ${state}`) }
    } else if (state === 'cooldown' && cooldownLeft <= 0) {
      state = 'ready'
    }
    if (pos && prevPos && dt > 0) {
      const vx = (pos.x - prevPos.x) / dt, vz = (pos.z - prevPos.z) / dt
      if (Math.hypot(vx, vz) < 60) { lastVel.x = vx; lastVel.z = vz } // ignore teleports
    }
    prevPos = pos

    tickStreaks(dt)
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
