/**
 * paintBurst.ts — Paint Burst (F), client side. Spec: Luke 2026-10-20.
 * Numbers in shared/pvp.ts (BURST_*), pure logic in shared/burst.ts.
 *
 * Cooldown: BURST_COOLDOWN_S timer (like Lunge), enforced by the server too.
 *
 * Use (F / the hotbar slot on mobile): start the cooldown and fire one shockwave at our feet:
 *   - opponents within BURST_RADIUS (horizontal, ≤ BURST_HIT_MAX_DY up/down) → burstHit immediately
 *     (BURST_LOS off for lag; was 0-300 ms raycast wait) → server dedupes → burstImpact → the victim's own
 *     client knocks itself outward (ImpactGate: dedupe + stale; respawn-immune).
 *   - local test dummies are knocked directly; ghost bots are shoved server-side.
 * One-time paint: burstUse carries our current cell and the server paints the
 * whole footprint (shared/burst.ts burstFootprint, 7×7) once, immediately, via
 * the normal paintDelta sync. Afterwards the slot is back to charging (0/100).
 */
import {
  engine, Entity, InputAction, Material, MaterialTransparencyMode, MeshRenderer, Transform, AudioSource,
  inputSystem, PointerEventType, Physics, PlayerIdentityData, raycastSystem, RaycastQueryType, ColliderLayer,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  BURST_MODE, BURST_COOLDOWN_S, BURST_RADIUS, BURST_LOS, BURST_LOS_HEIGHT, BURST_LOS_TIMEOUT_S,
  BURST_KNOCKBACK, BURST_KNOCK_LIFT, BURST_KNOCK_FORCE, BURST_KNOCK_FORCE_S, BURST_IMPACT_MAX_AGE_MS,
  BURST_RING_S, BURST_PARTICLES,
  LUNGE_KNOCKBACK, burstEnabledForRound,
} from '../shared/pvp'
import { inBurst, burstDir, V3 } from '../shared/burst'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { holdForEmote } from './lunge'
import { BURST_EMOTE_ENABLED, BURST_EMOTE_SRC, BURST_EMOTE_S, BURST_EMOTE_FREEZE_S } from '../shared/pvp'

// Pending switch from the one-shot ground punch to the looping hold of its final pose.
let emoteLeft = 0 // > 0 while the burst one-shot plays; at 0 we stopEmote so it always releases
import { ImpactGate } from '../shared/lunge'
import { getCurrentCellId } from '../paint'
import { initBurstRipple, startRipple } from './burstRipple'
import { playDashHitSfx, playBurstSfx, BURST_SFX_SRC } from './audio'
import { sendBurstUse, sendBurstHit } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { getDummyTargets, hitDummy } from './lungeDummy'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

const BOT_FLOAT = 1 // botVisual FLOAT_HEIGHT

let cooldownLeft = 0
let burstId = 0
let knockForceEnt: Entity = 0 as Entity
const gate = new ImpactGate(BURST_IMPACT_MAX_AGE_MS)

const rgbOf = (t: Team) => TEAM_RGB[t] ?? { r: 1, g: 1, b: 1 }
function glow(ent: Entity, rgb: { r: number; g: number; b: number }, a: number, intensity: number): void {
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(rgb.r, rgb.g, rgb.b, a), emissiveColor: Color4.create(rgb.r, rgb.g, rgb.b, 1),
    emissiveIntensity: intensity, roughness: 1, metallic: 0, specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false,
  })
}

// ─── Short-lived FX (few entities, removed after life) ──────────────
type Fx = { ent: Entity; t: number; life: number; step: (ent: Entity, u: number) => void }
const fx: Fx[] = []
function addFx(life: number, setup: (ent: Entity) => void, step: Fx['step'] = () => {}): void {
  const ent = engine.addEntity()
  setup(ent)
  fx.push({ ent, t: 0, life, step })
}
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)

function showShockwave(p: V3, team: Team, local: boolean, cell = ''): void {
  const rgb = rgbOf(team)
  startRipple(p, team, cell) // raised-tile ripple over the paint footprint (BURST_TILE_RIPPLE)
  // Light paint particle burst (BURST_PARTICLES blobs flying outward).
  for (let i = 0; i < BURST_PARTICLES; i++) {
    const a = (i / BURST_PARTICLES) * Math.PI * 2 + Math.random() * 0.4
    const r = 4 * (0.6 + Math.random() * 0.4) // visual ring size unchanged (was BURST_RADIUS = 4)
    const from = Vector3.create(p.x, p.y + 0.8, p.z)
    const to = Vector3.create(p.x + Math.cos(a) * r, p.y + 0.3 + Math.random() * 1.2, p.z + Math.sin(a) * r)
    const size = 0.25 + Math.random() * 0.15
    addFx(0.45, e => {
      Transform.create(e, { position: from, scale: Vector3.create(size, size, size) })
      MeshRenderer.setSphere(e)
      glow(e, rgb, 0.9, 2.5)
    }, (e, u) => {
      const tr = Transform.getMutable(e)
      tr.position = Vector3.lerp(from, to, easeOut(u))
      const s = size * (1 - u)
      tr.scale = Vector3.create(s, s, s)
    })
  }
  if (local) { playBurstSfx(); return }
  addFx(1.0, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 0.8, p.z) })
    AudioSource.create(e, { audioClipUrl: BURST_SFX_SRC, playing: true, loop: false, volume: 1, global: false })
  })
}

function posOf(who: string): V3 | null {
  if (who === '') return Transform.getOrNull(engine.PlayerEntity)?.position ?? null
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    if (pid.address.toLowerCase() === who) return tr.position
  }
  return null
}

// ─── HUD ────────────────────────────────────────────────────────────
export function isBurstEnabledNow(): boolean { return burstEnabledForRound(getRoundIndex()) }

/** F slot state, same shape as getLungeHud (fill = cooldown, no number). cooldownFrac: 1 = just used, 0 = ready. */
export function getBurstHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number } {
  const enabled = isBurstEnabledNow() && localTeam() !== Team.None
  const cd = Math.max(0, cooldownLeft)
  return { show: BURST_MODE !== 'off', enabled, ready: enabled && cd <= 0, cooldown: cd, cooldownFrac: cd / BURST_COOLDOWN_S }
}

// ─── Use ────────────────────────────────────────────────────────────
/** endSlack: hits this close to the target don't count (the target's own collider, e.g. an anvil dummy). */
// Anvil dummies have a solid collider reaching ~0.9 m from their centre; skip it in the LOS ray.
const DUMMY_LOS_SLACK = 1.2

function losThen(from: V3, to: V3, cb: () => void, endSlack = 0.6): void {
  if (!BURST_LOS) { cb(); return }
  const o = Vector3.create(from.x, from.y + BURST_LOS_HEIGHT, from.z)
  const t = Vector3.create(to.x, to.y + BURST_LOS_HEIGHT, to.z)
  const dist = Vector3.distance(o, t)
  if (dist < 0.5) { cb(); return }
  const ent = engine.addEntity()
  Transform.create(ent, { position: o })
  let done = false
  const finish = (clear: boolean) => {
    if (done) return
    done = true
    raycastSystem.removeRaycasterEntity(ent)
    engine.removeEntity(ent)
    if (clear) cb()
  }
  raycastSystem.registerGlobalDirectionRaycast({
    entity: ent,
    opts: { direction: Vector3.normalize(Vector3.subtract(t, o)), maxDistance: dist, queryType: RaycastQueryType.RQT_HIT_FIRST, collisionMask: ColliderLayer.CL_PHYSICS, continuous: false },
  }, res => {
    const blocked = res.hits.some(h => h.length < dist - endSlack)
    if (blocked) console.log('[Burst] target behind geometry, no hit')
    finish(!blocked)
  })
  // Fail open if the explorer never answers.
  addFx(BURST_LOS_TIMEOUT_S, () => {}, (_e, u) => { if (u >= 0.95) finish(true) })
}

export function triggerBurst(): void {
  const team = localTeam()
  if (!isBurstEnabledNow() || team === Team.None || cooldownLeft > 0) return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return
  const p: V3 = { x: t.position.x, y: t.position.y, z: t.position.z }
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  burstId = (burstId + 1) % 1_000_000
  const id = burstId
  cooldownLeft = BURST_COOLDOWN_S
  const cell = getCurrentCellId() ?? ''
  // Feedback on the input frame before any network work (same rule as Lunge).
  showShockwave(p, team, true, cell)
  sendBurstUse(id, cell, p.x, p.y, p.z, f.x, f.z)
  if (BURST_EMOTE_ENABLED) {
    // Hold movement for a moment first: the explorer cancels emotes on locomotion (desktop: never seen while running).
    holdForEmote(BURST_EMOTE_FREEZE_S)
    void triggerSceneEmote({ src: BURST_EMOTE_SRC, loop: false }).catch(() => {})
    emoteLeft = BURST_EMOTE_S
  }
  // Opponent players (attacker-detected, like Lunge; server dedupes).
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const tt = teamOfUser(pid.address)
    if ((tt !== Team.Red && tt !== Team.Blue) || tt === team) continue
    const tp: V3 = { x: tr.position.x, y: tr.position.y, z: tr.position.z }
    if (!inBurst(p, tp)) continue
    const addr = pid.address.toLowerCase()
    const k = burstDir(p, tp, f.x, f.z)
    losThen(p, tp, () => {
      // Optimistic connect: attacker hears/sees the hit now; victim knock still waits on burstImpact.
      sendBurstHit(id, addr, k.x, k.z)
      playDashHitSfx()
      playAt(tp)
    })
  }
  // Local test dummies.
  for (const d of getDummyTargets()) {
    if (!inBurst(p, d.pos)) continue
    const k = burstDir(p, d.pos, f.x, f.z)
    losThen(p, d.pos, () => hitDummy(d.i, k.x, k.z, 1, id), DUMMY_LOS_SLACK)
  }
  // TEMP (ramp paint debug): reported cell + feet position; compare with the [Server] burst line.
  console.log(`[Burst] #${id} fired cell=${cell || '(none)'} pos=${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`)
}

function onImpact(attacker: string, id: number, target: string, dx: number, dz: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase(), tgt = target.toLowerCase()
  if (tgt.startsWith('bot:')) {
    const b = getBotRenderPositions().find(x => `bot:${x.id}` === tgt)
    if (b) playAt({ x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z })
    return
  }
  if (!me || tgt !== me) return
  const verdict = gate.accept(att, id, Date.now())
  if (verdict !== 'ok' || isKnockbackImmune() || !isBurstEnabledNow()) {
    console.log(`[Burst] impact #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
    return
  }
  safePhysics('burst knockback', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dx * BURST_KNOCKBACK, BURST_KNOCK_LIFT, dz * BURST_KNOCKBACK))
    if (BURST_KNOCK_FORCE > 0) Physics.applyForceToPlayerForDuration(knockForceEnt, BURST_KNOCK_FORCE_S, Vector3.create(dx, 0, dz), BURST_KNOCK_FORCE)
  })
  playDashHitSfx()
  console.log(`[Burst] knocked by ${att.slice(0, 8)} #${id}`)
}
function playAt(p: V3): void {
  addFx(0.6, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 1, p.z) })
    AudioSource.create(e, { audioClipUrl: 'assets/sounds/pop.mp3', playing: true, loop: false, volume: 0.8, global: false })
  })
}

export function initPaintBurst(): void {
  if (BURST_MODE === 'off') return
  initKnockbackState()
  knockForceEnt = engine.addEntity()
  initBurstRipple()
  engine.addSystem((dt: number) => {
    if (emoteLeft <= 0 || (emoteLeft -= dt) > 0) return
    emoteLeft = 0
    void stopEmote({}).catch(() => {})
  })
  events.on('burst:fired', ({ attacker, id, team, x, y, z }) => {
    const att = attacker.toLowerCase()
    gate.sawStart(att, id, Date.now())
    if (att === myAddress()) return // shown at the press
    showShockwave({ x, y, z }, team, false)
  })
  events.on('burst:impact', ({ attacker, id, target, dx, dz }) => onImpact(attacker, id, target, dx, dz))

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) triggerBurst()
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) { f.step(f.ent, 1); engine.removeEntity(f.ent); fx.splice(i, 1); continue }
      f.step(f.ent, f.t / f.life)
    }
  })
}
