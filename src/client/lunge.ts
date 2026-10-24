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
 * C. Feedback: press = team glow puff (no input delay) + random lunge take (assets/sounds/lunge_0N.wav, preloaded) + upper-body 'punch' emote (LUNGE_EMOTE)
 *    + slash crescent (held readable). No hit-volume mesh. Active =
 *    streak behind the avatar (shown on remote avatars too via
 *    lungeStarted); hit = big team pop + white core + impact boom at contact, attacker
 *    brakes on the spot (hit-stop stand-in); miss = grey dust ahead of the feet,
 *    no boom. Recovery (walk only) is UI + a click: amber LOCK on the desktop
 *    slot, amber tint on the mobile slot. No disc, sphere, or hitbox mesh.
 *    Pressing during cooldown does nothing.
 * Debug (LUNGE_DEBUG): hitbox spheres per frame, direction dots, hit and
 * knockback markers, state log.
 */

import {
  engine, Entity, InputAction, InputModifier, Material, MaterialTransparencyMode, MeshRenderer,
  PlayerIdentityData, PointerEventType, Transform, AudioSource, inputSystem, Physics, Tween, EasingFunction, AvatarMask,
} from '@dcl/sdk/ecs'
import { triggerEmote } from '~system/RestrictedActions'
import { isPlayerGrounded } from '../paint'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  LUNGE_MODE, LUNGE_DEBUG, LUNGE_ACTIVE_S, LUNGE_DISTANCE, LUNGE_IMPULSE, LUNGE_LIFT, LUNGE_BRAKE, LUNGE_STICK_FORCE,
  LUNGE_RECOVERY_S, LUNGE_COOLDOWN_S, LUNGE_HIT_GRACE_S, LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT,
  LUNGE_KNOCK_FORCE, LUNGE_KNOCK_FORCE_S, LUNGE_IMPACT_MAX_AGE_MS, lungeEnabledForRound,
  LUNGE_EMOTE, LUNGE_EMOTE_NAME, LUNGE_KNOCKBACK_LOCK, LUNGE_KNOCKBACK_LOCK_S, LUNGE_HITBOX_FORWARD, LUNGE_HITBOX_D, LUNGE_HITBOX_W,
  LUNGE_HIT_POP_TO, LUNGE_HIT_CORE_TO, LUNGE_MISS_DUST_TO,
  VICTIM_SPECULATIVE_KNOCK,
} from '../shared/pvp'
import { boxHit, knockDir, ImpactGate, V3, hitboxAt } from '../shared/lunge'
import { initLungeHitbox, startHitbox, placeHitbox, flashHitbox } from './lungeHitbox'
import { playLungeSfx, pickLungeSrc, DASH_HIT_SRC } from './audio'
import { sendLungeStart, sendLungeHit } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { getDummyTargets, hitDummy } from './lungeDummy'
import { initLungeSlash, startSlash, flashSlash, tickSlash } from './lungeSlash'
import { dashPop, dashPopEnd } from './burstRipple'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'
import { getMoveLock, isMoveLocked, setMoveLock, type MoveLock } from './moveLock'

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
// Victim anticipation: remote lunges we may already be inside of. Key = attacker#id.
type PendingVictimLunge = { att: string; id: number; dx: number; dz: number; start: V3; left: number; prevAtt: V3 | null }
const pendingVictim = new Map<string, PendingVictimLunge>()
let knockForceEnt: Entity = 0 as Entity
let stickForceEnt: Entity = 0 as Entity
let lastHitBy = ''
let lastHitAge = 999

// ─── FX (pooled-free: few entities, removed after life) ─────────────
type Fx = { ent: Entity; t: number; dur: number; life: number; from: number; to: number; follow?: { who: string; off: V3 } }
const fx: Fx[] = []

function spawnFx(pos: V3, rgb: { r: number; g: number; b: number }, dur: number, life: number, from: number, to: number,
  alpha: number, sound?: { src: string; vol: number }, follow?: { who: string; off: V3 }): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(pos.x, pos.y, pos.z), scale: Vector3.create(from, from, from) })
  MeshRenderer.setSphere(ent)
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(rgb.r, rgb.g, rgb.b, alpha),
    emissiveColor: Color4.create(rgb.r, rgb.g, rgb.b, 1),
    emissiveIntensity: 4,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
  if (sound) AudioSource.create(ent, { audioClipUrl: sound.src, playing: true, loop: false, volume: sound.vol, global: false })
  fx.push({ ent, t: 0, dur, life, from, to, follow })
}
const teamRgb = (t: Team) => TEAM_RGB[t] ?? { r: 1, g: 1, b: 1 }
const GREY = { r: 0.55, g: 0.55, b: 0.55 }
const WHITE = { r: 1, g: 1, b: 1 }
const RECOVERY_CLICK = 'assets/sounds/click.wav'
let recoveryClickEnt: Entity = 0 as Entity

/** Walk-only brace. Sound only — the slot UI carries the visual. */
function playRecoveryClick(): void {
  if (!recoveryClickEnt) return
  AudioSource.createOrReplace(recoveryClickEnt, {
    audioClipUrl: RECOVERY_CLICK, playing: true, loop: false, volume: 0.45, global: true, currentTime: 0,
  })
}

function impactFx(p: V3, team: Team, withSound: boolean): void {
  // Chest-height team burst + white core + boom. Miss dust never uses these.
  spawnFx({ x: p.x, y: p.y + 1, z: p.z }, teamRgb(team), 0.28, 0.85, 0.7, LUNGE_HIT_POP_TO, 0.75,
    withSound ? { src: DASH_HIT_SRC, vol: 1 } : undefined)
  spawnFx({ x: p.x, y: p.y + 1.05, z: p.z }, WHITE, 0.14, 0.9, 0.4, LUNGE_HIT_CORE_TO, 0.95,
    withSound ? { src: BOOM_SRC, vol: 0.7 } : undefined)
}

/** Whiff: grey puffs ahead of the feet. No boom, no team colour, no white core. */
function missDust(p: V3): void {
  const ahead = (side: number, to: number, dur: number) => spawnFx(
    { x: p.x + dir.x * 0.85 + dir.z * side, y: p.y + 0.18, z: p.z + dir.z * 0.85 - dir.x * side },
    GREY, dur, dur, 0.16, to, 0.4)
  ahead(0, LUNGE_MISS_DUST_TO, 0.28)
  ahead(0.45, 0.7, 0.24)
  ahead(-0.45, 0.7, 0.24)
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

function spawnStreak(p: V3, team: Team): void {
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
  const c = teamRgb(team)
  Material.setPbrMaterial(e, { ...STREAK_MAT, albedoColor: Color4.create(c.r, c.g, c.b, 0.5), emissiveColor: Color4.create(c.r, c.g, c.b, 1) })
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
    if (l.left <= 0) { lungers.delete(who); dashPopEnd(who); continue }
    const p = avatarPos(who)
    if (!p) continue
    const team = who === '' ? localTeam() : teamOfUser(who)
    dashPop(who, p, team)
    l.accum += dt
    while (l.accum >= STREAK_INTERVAL) { l.accum -= STREAK_INTERVAL; spawnStreak(p, team) }
  }
}

// ─── Debug overlay ──────────────────────────────────────────────────
function dbgMark(p: V3, rgb: { r: number; g: number; b: number }, size: number, life = 1.0): void {
  if (!LUNGE_DEBUG) return
  spawnFx(p, rgb, life, life, size, size, 0.25)
}
function dbgLog(msg: string): void { if (LUNGE_DEBUG) console.log(`[Lunge dbg] ${msg}`) }

// ─── Input modifier: one owner ──────────────────────────────────────
// recoveryOn:    our own lunge (active + recovery) → walk only.
// lockLeft:      we were knocked back → no movement input at all.
// emoteLockLeft: short hold so a Burst emote isn't cancelled by locomotion.
// glideLockLeft: glider forced shut (aerial spike). Outlasts the movement lock
//                so the victim cannot reopen and parachute out of the fall.
// getMoveLock(): fall rescue — frozen for the pickup, walk for the land brace.
// Frozen / knock / emote win over walk-only. applyControl is the only writer.
// Explorer (player.gd): while the glider is opening or open, locomotion fall
// speed is clamped to 1 m/s. disableJump and disableGliding both force-close
// it; scene impulses are a separate velocity and are not part of that clamp.
// A fall-rescue freeze does not itself shut the glider; a spike lock, knock,
// or emote hold still does.
let recoveryOn = false
let lockLeft = 0
let glideLockLeft = 0
let sparkAccum = 0
function applyControl(): void {
  const noGlide = glideLockLeft > 0
  const gate = getMoveLock()
  safePhysics('input modifier', () => {
    if (lockLeft > 0 || emoteLockLeft > 0 || gate === 'frozen') {
      InputModifier.createOrReplace(engine.PlayerEntity, {
        mode: InputModifier.Mode.Standard({
          disableWalk: true, disableJog: true, disableRun: true, disableJump: true, disableDoubleJump: true,
          disableGliding: lockLeft > 0 || emoteLockLeft > 0 || noGlide,
        }),
      })
    } else if (recoveryOn || gate === 'walk') {
      InputModifier.createOrReplace(engine.PlayerEntity, {
        mode: InputModifier.Mode.Standard({
          disableJump: true, disableRun: true, disableJog: true, disableDoubleJump: true, disableGliding: noGlide,
        }),
      })
    } else if (noGlide) {
      InputModifier.createOrReplace(engine.PlayerEntity, {
        mode: InputModifier.Mode.Standard({ disableGliding: true }),
      })
    } else if (InputModifier.has(engine.PlayerEntity)) {
      InputModifier.deleteFrom(engine.PlayerEntity)
    }
  })
}
/** Fall rescue hold. Shares this component with the lunge / knockback lock. */
export function setFallMoveLock(next: MoveLock): void {
  setMoveLock(next)
  applyControl()
}
/** Drop our lunge on a fall trip (no brake, cooldown kept). Not a respawn. */
export function interruptLocalLunge(why: string): void {
  cancelLunge(why)
}
/** Short movement hold so a one-shot scene emote (Burst) isn't cancelled by locomotion. Shares this module's
 *  InputModifier so it never fights the lunge / knockback lock (applyControl owns the component). */
let emoteLockLeft = 0
export function holdForEmote(s: number): void {
  emoteLockLeft = Math.max(emoteLockLeft, s)
  applyControl()
}
function setReducedControl(on: boolean): void { recoveryOn = on; applyControl() }
/** Victim lock: extend (never stack) to LUNGE_KNOCKBACK_LOCK_S from now. */
export function startKnockLock(): void {
  if (!LUNGE_KNOCKBACK_LOCK) return
  lockLeft = Math.max(lockLeft, LUNGE_KNOCKBACK_LOCK_S)
  applyControl()
}
/** Keep the glider shut for `seconds` (extends, never stacks down). Closes an
 *  already-open glide via disableGliding. Shares applyControl with the knock lock. */
export function startGlideLock(seconds: number): void {
  if (seconds <= 0) return
  glideLockLeft = Math.max(glideLockLeft, seconds)
  applyControl()
}
function clearKnockLock(): void {
  if (lockLeft <= 0 && glideLockLeft <= 0) return
  lockLeft = 0
  glideLockLeft = 0
  applyControl()
}

// ─── Public HUD + trigger ───────────────────────────────────────────
export function isLungeEnabledNow(): boolean { return lungeEnabledForRound(getRoundIndex()) }

export function getLungeHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number; recovering: boolean } {
  const enabled = isLungeEnabledNow()
  const cd = Math.max(0, cooldownLeft)
  return {
    show: LUNGE_MODE !== 'off', enabled, ready: enabled && localTeam() !== Team.None && cd <= 0 && !isMoveLocked(),
    cooldown: cd, cooldownFrac: cd / LUNGE_COOLDOWN_S, recovering: state === 'recovery' || isMoveLocked(),
  }
}

/** E / LUNGE slot. Silent no-op while active, recovering, cooling down, or held by a fall rescue. */
export function triggerLunge(): void {
  if (isMoveLocked()) return
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
    // Downhill: push down during the lunge so we follow the ramp instead of launching off it.
    // Only when the lunge starts on the ground; an air lunge keeps its arc.
    if (isPlayerGrounded()) Physics.applyForceToPlayerForDuration(stickForceEnt, LUNGE_ACTIVE_S, Vector3.create(0, -1, 0), LUNGE_STICK_FORCE)
  })
  sendLungeStart(lungeId, dir.x, dir.z, startPos.x, startPos.y, startPos.z)
  // Anticipation without input delay: team glow at the chest + lunge take.
  spawnFx({ x: startPos.x + dir.x * 0.6, y: startPos.y + 1.1, z: startPos.z + dir.z * 0.6 }, teamRgb(localTeam()),
    0.08, 0.08, 0.5, 1.1, 0.5, undefined, { who: '', off: { x: dir.x * 0.6, y: 1.1, z: dir.z * 0.6 } })
  lungers.set('', { left: LUNGE_ACTIVE_S, accum: 0 })
  startSlash('', dir.x, dir.z, localTeam())
  startHitbox('', dir.x, dir.z, localTeam())
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
  if (p && !hitAny) missDust(p) // grey dust ahead; a hit is the chest pop + boom
  playRecoveryClick()
  state = 'recovery'; stateLeft = LUNGE_RECOVERY_S
  dbgLog(`#${lungeId} → recovery`)
}

function checkHits(a0: V3, a1: V3): void {
  const myTeam = localTeam()
  const tryHit = (id: string, t: V3) => {
    if (hitThis.has(id)) return
    if (!boxHit(a0, a1, t, startPos, dir.x, dir.z)) return
    hitThis.add(id)
    const k = knockDir(a1, t, dir.x, dir.z)
    if (id.startsWith('dummy:')) hitDummy(parseInt(id.slice(6), 10), k.x, k.z, 0, lungeId) // shared anvil: server applies it
    else sendLungeHit(lungeId, id, k.x, k.z, a1.x, a1.y, a1.z)
    impactFx(t, myTeam, true) // optimistic: the attacker feels it now
    flashSlash('')
    flashHitbox('')
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
  // Debug: hitbox centre + its 4 corners at chest height.
  const hb = hitboxAt(a1, dir.x, dir.z)
  dbgMark(hb.c, { r: 0, g: 1, b: 1 }, 0.2, 0.3)
  for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const u = LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D / 2 + su * LUNGE_HITBOX_D / 2, v = sv * LUNGE_HITBOX_W / 2
    dbgMark({ x: a1.x + dir.x * u + dir.z * v, y: hb.c.y, z: a1.z + dir.z * u - dir.x * v }, { r: 0, g: 1, b: 1 }, 0.12, 0.3)
  }
}

// ─── Network events ─────────────────────────────────────────────────
function onStarted(attacker: string, id: number, dx: number, dz: number, x: number, y: number, z: number): void {
  const att = attacker.toLowerCase()
  gate.sawStart(att, id, Date.now())
  if (att === myAddress()) return
  lungers.set(att, { left: LUNGE_ACTIVE_S, accum: 0 })
  startSlash(att, dx, dz, teamOfUser(att))
  startHitbox(att, dx, dz, teamOfUser(att))
  const p = avatarPos(att)
  // Remote lunge: glow + the same lunge take set, positional at that avatar.
  // life 0.7 s so the take (~0.6 s) isn't cut when the fx entity is removed.
  if (p) spawnFx({ x: p.x, y: p.y + 1.1, z: p.z }, teamRgb(teamOfUser(att)), 0.08, 0.7, 0.5, 1.1, 0.5,
    { src: pickLungeSrc(), vol: 0.9 }, { who: att, off: { x: 0, y: 1.1, z: 0 } })
  // Victim anticipation: if we may be (or enter) the hit volume, knock ourselves
  // as soon as contact is visible here — don't wait for server Impact (~1 RTT).
  if (!VICTIM_SPECULATIVE_KNOCK) return
  const attTeam = teamOfUser(att)
  const my = localTeam()
  if ((attTeam !== Team.Red && attTeam !== Team.Blue) || my === Team.None || attTeam === my) return
  const start = { x, y, z }
  const key = `${att}#${id}`
  pendingVictim.set(key, {
    att, id, dx, dz, start,
    left: LUNGE_ACTIVE_S + LUNGE_HIT_GRACE_S + 0.2, // slack for avatar interpolation
    prevAtt: p ? { x: p.x, y: p.y, z: p.z } : start,
  })
}

/** Shared victim impulse (confirmed Impact or speculative). Marks ImpactGate applied. */
function applyVictimKnock(att: string, id: number, dx: number, dz: number, why: string): boolean {
  const verdict = gate.accept(att, id, Date.now())
  if (verdict !== 'ok' || isKnockbackImmune() || !isLungeEnabledNow()) {
    console.log(`[Lunge] ${why} #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
    return false
  }
  safePhysics('lunge knockback', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dx * LUNGE_KNOCKBACK, LUNGE_KNOCK_LIFT, dz * LUNGE_KNOCKBACK))
    if (LUNGE_KNOCK_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(knockForceEnt, LUNGE_KNOCK_FORCE_S, Vector3.create(dx, 0, dz), LUNGE_KNOCK_FORCE)
    }
  })
  startKnockLock()
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (p) {
    impactFx(p, teamOfUser(att), true)
    for (let s = 0.5; s <= 3; s += 0.5) dbgMark({ x: p.x + dx * s, y: p.y + 0.3, z: p.z + dz * s }, { r: 1, g: 0.3, b: 0 }, 0.18)
  }
  lastHitBy = att; lastHitAge = 0
  console.log(`[Lunge] ${why} by ${att.slice(0, 8)} #${id} dir=(${dx.toFixed(2)},${dz.toFixed(2)})`)
  return true
}

/** Each frame: if a remote lunger's box reaches us on our screen, knock now. */
function trySpeculativeVictim(dt: number): void {
  if (pendingVictim.size === 0) return
  const myPos = Transform.getOrNull(engine.PlayerEntity)?.position
  for (const [key, pend] of pendingVictim) {
    pend.left -= dt
    if (pend.left <= 0) { pendingVictim.delete(key); continue }
    if (!VICTIM_SPECULATIVE_KNOCK || !myPos || isKnockbackImmune() || !isLungeEnabledNow()) continue
    const attPos = avatarPos(pend.att)
    if (!attPos) continue
    const a0 = pend.prevAtt ?? attPos
    const a1 = { x: attPos.x, y: attPos.y, z: attPos.z }
    pend.prevAtt = a1
    const me: V3 = { x: myPos.x, y: myPos.y, z: myPos.z }
    if (!boxHit(a0, a1, me, pend.start, pend.dx, pend.dz)) continue
    pendingVictim.delete(key)
    const k = knockDir(a1, me, pend.dx, pend.dz)
    flashSlash(pend.att)
    flashHitbox(pend.att)
    applyVictimKnock(pend.att, pend.id, k.x, k.z, 'speculative knock')
  }
}

function onImpact(attacker: string, id: number, target: string, dx: number, dz: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase()
  const tgt = target.toLowerCase()
  const attTeam = teamOfUser(att)
  if (me && att === me) return // attacker already showed its FX
  flashSlash(att)
  flashHitbox(att)
  if (tgt.startsWith('bot:')) {
    const b = getBotRenderPositions().find(x => `bot:${x.id}` === tgt)
    if (b) impactFx({ x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z }, attTeam, true)
    return
  }
  if (me && tgt === me) {
    pendingVictim.delete(`${att}#${id}`) // confirmed path; drop any watch
    applyVictimKnock(att, id, dx, dz, 'knocked')
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
  // Glide lock is owned here (applyControl) but aerial Burst uses it even if a
  // future change turns the lunge off, so the timer is not inside that early-out.
  engine.addSystem((dt: number) => {
    if (glideLockLeft <= 0) return
    glideLockLeft -= dt
    if (glideLockLeft <= 0) { glideLockLeft = 0; applyControl() }
  })
  if (LUNGE_MODE === 'off') return
  initKnockbackState()
  knockForceEnt = engine.addEntity()
  stickForceEnt = engine.addEntity()
  recoveryClickEnt = engine.addEntity()
  Transform.create(recoveryClickEnt, { parent: engine.CameraEntity })
  initLungeSlash(who => { const p = avatarPos(who); return p ? Vector3.create(p.x, p.y, p.z) : null })
  initLungeHitbox(avatarPos)
  events.on('lunge:started', ({ attacker, id, dx, dz, x, y, z }) => onStarted(attacker, id, dx, dz, x, y, z))
  events.on('round:reset', () => { cancelLunge('round reset'); clearKnockLock(); pendingVictim.clear() })
  events.on('lunge:impact', ({ attacker, id, target, dx, dz }) => onImpact(attacker, id, target, dx, dz))
  events.on('player:respawned', ({ why }) => {
    // Fall/respawn mid-attack: drop the lunge (no brake after a teleport).
    cancelLunge(why)
    clearKnockLock()
    pendingVictim.clear()
    if (lastHitBy && lastHitAge < LAST_HIT_S) console.log(`[Lunge] knocked off by ${lastHitBy.slice(0, 8)} (${why})`)
    lastHitBy = ''
  })

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    lastHitAge += dt
    if (emoteLockLeft > 0) { emoteLockLeft -= dt; if (emoteLockLeft <= 0) { emoteLockLeft = 0; applyControl() } }
    if (lockLeft > 0) {
      lockLeft -= dt
      // Dizzy sparks: a small yellow puff circling the head every 0.08 s.
      sparkAccum += dt
      const hp = Transform.getOrNull(engine.PlayerEntity)?.position
      if (hp && sparkAccum >= 0.08) {
        sparkAccum = 0
        const a = Math.random() * Math.PI * 2
        spawnFx({ x: hp.x + Math.cos(a) * 0.35, y: hp.y + 1.9, z: hp.z + Math.sin(a) * 0.35 }, { r: 1, g: 0.9, b: 0.3 }, 0.15, 0.15, 0.12, 0.02, 0.9)
      }
      if (lockLeft <= 0) { lockLeft = 0; applyControl() }
    }
    if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) triggerLunge()
    trySpeculativeVictim(dt)

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
      placeHitbox('', pos) // same position the hit test just used
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

    tickSlash(dt, t ? t.position : null) // same PlayerEntity position as the hit test + box
    tickStreaks(dt)
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) { engine.removeEntity(f.ent); fx.splice(i, 1); continue }
      if (f.follow) { // glow (and its positional sound) rides on the avatar, no trailing
        const a = f.follow.who === '' ? pos : avatarPos(f.follow.who)
        if (a) Transform.getMutable(f.ent).position = Vector3.create(a.x + f.follow.off.x, a.y + f.follow.off.y, a.z + f.follow.off.z)
      }
      if (f.t >= f.dur) { if (MeshRenderer.has(f.ent)) MeshRenderer.deleteFrom(f.ent); continue }
      const s = f.from + (f.to - f.from) * (f.t / f.dur)
      const tr = Transform.getMutable(f.ent)
      tr.scale = Vector3.create(s, s, s)
    }
  })
}
