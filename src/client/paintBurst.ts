/**
 * paintBurst.ts — Paint Burst (F), client side. Spec: Luke 2026-10-20.
 * Numbers in shared/pvp.ts (BURST_*), pure logic in shared/burst.ts.
 *
 * Cooldown: BURST_COOLDOWN_S timer (like Lunge), enforced by the server too.
 *
 * Use (F / the hotbar slot on mobile): one shared cooldown.
 *   Grounded: shockwave at our feet. Opponents within BURST_RADIUS → burstHit →
 *     the victim knocks itself outward (ImpactGate: dedupe + stale; respawn-immune).
 *     Server paints the radial footprint once.
 *   Airborne: downward spike. The attacker commits into a short dive. A player in
 *     the cylinder (clearly below, ~2 m across, ~5.5 m down) is a combat hit —
 *     strong downward knock, small outward, brief control lock, no paint. A miss
 *     that reaches the ground paints a 5-tile cross and bumps those tiles.
 *     No radial blast in the air. Ground Burst does not dive.
 * Local test dummies are knocked directly; ghost bots are shoved server-side.
 */
import {
  engine, Entity, InputAction, Material, MaterialTransparencyMode, MeshRenderer, Transform, AudioSource,
  inputSystem, PointerEventType, Physics, PlayerIdentityData, raycastSystem, RaycastQueryType, ColliderLayer,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  BURST_MODE, BURST_COOLDOWN_S, BURST_RADIUS, BURST_LOS, BURST_LOS_HEIGHT, BURST_LOS_TIMEOUT_S,
  BURST_KNOCKBACK, BURST_KNOCK_LIFT, BURST_KNOCK_FORCE, BURST_KNOCK_FORCE_S, BURST_IMPACT_MAX_AGE_MS,
  BURST_RING_S, BURST_PARTICLES,
  AIR_SPIKE_DOWN, AIR_SPIKE_OUT, AIR_SPIKE_FORCE, AIR_SPIKE_FORCE_S, AIR_SPIKE_CROSS_R,
  AIR_SPIKE_DIVE_IMPULSE, AIR_SPIKE_DIVE_FORWARD, AIR_SPIKE_DIVE_FORCE, AIR_SPIKE_DIVE_FORCE_S,
  AIR_SPIKE_ARC_W, AIR_SPIKE_ARC_H, AIR_SPIKE_ARC_DROP, AIR_SPIKE_ARC_S, AIR_SPIKE_ARC_ALPHA, AIR_SPIKE_ARC_CHEST,
  AIR_SPIKE_DIVE_VOL, AIR_SPIKE_HIT_VOL, AIR_SPIKE_STAMP_VOL,
  LUNGE_KNOCKBACK, burstEnabledForRound, VICTIM_SPECULATIVE_KNOCK,
} from '../shared/pvp'
import { inBurst, inAirSpike, burstDir, V3 } from '../shared/burst'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { holdForEmote, startKnockLock } from './lunge'
import { BURST_EMOTE_ENABLED, BURST_EMOTE_SRC, BURST_EMOTE_S, BURST_EMOTE_FREEZE_S } from '../shared/pvp'

// Pending switch from the one-shot ground punch to the looping hold of its final pose.
let emoteLeft = 0 // > 0 while the burst one-shot plays; at 0 we stopEmote so it always releases
import { ImpactGate } from '../shared/lunge'
import { getCurrentCellId, isPlayerGrounded } from '../paint'
import { initBurstRipple, startRipple, airLanding } from './burstRipple'
import {
  playDashHitSfx, playBurstSfx, playAirDiveSfx, playAirHitSfx, playAirStampSfx,
  BURST_SFX_SRC, AIR_DIVE_SRC, AIR_HIT_SRC, AIR_STAMP_SRC,
} from './audio'
import { sendBurstUse, sendBurstHit } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { getDummyTargets, hitDummy } from './lungeDummy'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

const BOT_FLOAT = 1 // botVisual FLOAT_HEIGHT

let cooldownLeft = 0
let burstId = 0
let knockForceEnt: Entity = 0 as Entity
let diveForceEnt: Entity = 0 as Entity
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

const ARC_TEX = 'assets/images/lunge_slash.png'

function arcMat(e: Entity, rgb: { r: number; g: number; b: number }, alpha: number): void {
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({ src: ARC_TEX }),
    emissiveTexture: Material.Texture.Common({ src: ARC_TEX }),
    albedoColor: Color4.create(rgb.r, rgb.g, rgb.b, alpha),
    emissiveColor: Color4.create(rgb.r, rgb.g, rgb.b, 1),
    emissiveIntensity: 3.4,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

/** Vertical crescent (same pointed half-moon as Lunge) shot down the dive.
 *  Two crossed planes so attackers and spectators both see a face. Not a hit volume. */
function showAirStreak(p: V3, team: Team, fx: number, fz: number): void {
  const rgb = rgbOf(team)
  const fl = Math.hypot(fx, fz) || 1
  const ux = fx / fl, uz = fz / fl
  const yaw = Math.atan2(ux, uz) * 180 / Math.PI
  const from = Vector3.create(p.x + ux * 0.35, p.y + AIR_SPIKE_ARC_CHEST, p.z + uz * 0.35)
  const to = Vector3.create(from.x, from.y - AIR_SPIKE_ARC_DROP, from.z)
  const easeIn = (u: number) => u * u
  for (const extra of [0, 90]) {
    const rot = Quaternion.multiply(
      Quaternion.fromEulerDegrees(0, yaw + extra, 0),
      Quaternion.fromEulerDegrees(180, 0, 0), // texture crown (image top) points down
    )
    addFx(AIR_SPIKE_ARC_S, e => {
      Transform.create(e, { position: from, rotation: rot, scale: Vector3.create(AIR_SPIKE_ARC_W, AIR_SPIKE_ARC_H, 1) })
      MeshRenderer.setPlane(e)
      arcMat(e, rgb, AIR_SPIKE_ARC_ALPHA)
    }, (e, u) => {
      const tr = Transform.getMutable(e)
      tr.position = Vector3.lerp(from, to, easeIn(u))
      const a = AIR_SPIKE_ARC_ALPHA * (u < 0.72 ? 1 : (1 - u) / 0.28)
      arcMat(e, rgb, Math.max(0, a))
    })
  }
}

function playPositional(p: V3, src: string, vol: number): void {
  addFx(1.1, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 0.8, p.z) })
    AudioSource.create(e, { audioClipUrl: src, playing: true, loop: false, volume: vol, global: false })
  })
}

/** Short downward body commit. Local attacker only; grounded Burst never calls this. */
function commitAirDive(fx: number, fz: number): void {
  const fl = Math.hypot(fx, fz) || 1
  safePhysics('air dive', () => {
    Physics.applyImpulseToPlayer(Vector3.create(
      (fx / fl) * AIR_SPIKE_DIVE_FORWARD, -AIR_SPIKE_DIVE_IMPULSE, (fz / fl) * AIR_SPIKE_DIVE_FORWARD,
    ))
    if (AIR_SPIKE_DIVE_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(diveForceEnt, AIR_SPIKE_DIVE_FORCE_S, Vector3.create(0, -1, 0), AIR_SPIKE_DIVE_FORCE)
    }
  })
}

/** Hit pop on the victim. Team sphere, not a ground disc. `positional` plays the sharp hit there. */
function showAirHit(p: V3, team: Team, positional = false): void {
  const rgb = rgbOf(team)
  if (positional) playPositional(p, AIR_HIT_SRC, AIR_SPIKE_HIT_VOL)
  addFx(0.28, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 1, p.z), scale: Vector3.create(0.35, 0.35, 0.35) })
    MeshRenderer.setSphere(e)
    glow(e, rgb, 0.95, 3.5)
  }, (e, u) => {
    const s = 0.35 + u * 1.3
    const tr = Transform.getMutable(e)
    tr.scale = Vector3.create(s * (1 - u * 0.35), s * (1 - u * 0.35), s * (1 - u * 0.35))
    glow(e, rgb, 0.95 * (1 - u), 3.5)
  })
}

function airPlayerHits(p: V3, team: Team, fx: number, fz: number): Array<{ addr: string; pos: V3; k: { x: number; z: number } }> {
  const out: Array<{ addr: string; pos: V3; k: { x: number; z: number } }> = []
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const tt = teamOfUser(pid.address)
    if ((tt !== Team.Red && tt !== Team.Blue) || tt === team) continue
    const tp: V3 = { x: tr.position.x, y: tr.position.y, z: tr.position.z }
    if (!inAirSpike(p, tp)) continue
    out.push({ addr: pid.address.toLowerCase(), pos: tp, k: burstDir(p, tp, fx, fz) })
  }
  return out
}

function airBotBelow(p: V3, team: Team): boolean {
  for (const b of getBotRenderPositions()) {
    if (b.team === team) continue
    if (inAirSpike(p, { x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z })) return true
  }
  return false
}

function knockAirAnvils(p: V3, fx: number, fz: number, id: number): void {
  for (const d of getDummyTargets()) {
    if (!inAirSpike(p, d.pos)) continue
    const k = burstDir(p, d.pos, fx, fz)
    hitDummy(d.i, k.x, k.z, 1, id)
  }
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
  if (!isPlayerGrounded()) {
    fireAirSpike(id, team, p, f.x, f.z)
    return
  }
  const cell = getCurrentCellId() ?? ''
  // Feedback on the input frame before any network work (same rule as Lunge).
  showShockwave(p, team, true, cell)
  sendBurstUse(id, cell, p.x, p.y, p.z, f.x, f.z, 0)
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

/** Airborne F: downward spike. Player/bot in the cylinder → combat, no paint.
 *  Otherwise the landing cross, if the ground is inside the cylinder. Same cooldown. */
function fireAirSpike(id: number, team: Team, p: V3, fx: number, fz: number): void {
  commitAirDive(fx, fz)
  playAirDiveSfx()
  showAirStreak(p, team, fx, fz)
  const hits = airPlayerHits(p, team, fx, fz)
  const bot = airBotBelow(p, team)
  if (hits.length > 0 || bot) {
    sendBurstUse(id, '', p.x, p.y, p.z, fx, fz, 1)
    knockAirAnvils(p, fx, fz, id)
    if (hits.length === 0) playAirHitSfx()
    for (const h of hits) {
      sendBurstHit(id, h.addr, h.k.x, h.k.z)
      playAirHitSfx()
      showAirHit(h.pos, team)
    }
    console.log(`[Burst] #${id} air spike hit players=${hits.length} bot=${bot} pos=${p.y.toFixed(2)}`)
    return
  }
  const land = airLanding(p)
  if (land) {
    sendBurstUse(id, land.id, p.x, p.y, p.z, fx, fz, 2)
    knockAirAnvils(p, fx, fz, id)
    startRipple({ x: land.x, y: land.y, z: land.z }, team, land.id, 'cross', AIR_SPIKE_CROSS_R)
    playAirStampSfx()
    console.log(`[Burst] #${id} air spike miss → cross ${land.id}`)
    return
  }
  sendBurstUse(id, '', p.x, p.y, p.z, fx, fz, 1)
  knockAirAnvils(p, fx, fz, id)
  console.log(`[Burst] #${id} air spike whiff (ground out of reach) pos=${p.y.toFixed(2)}`)
}

/** Victim impulse (confirmed Impact or speculative). Marks ImpactGate applied. */
function applyVictimKnock(att: string, id: number, dx: number, dz: number, why: string): boolean {
  const verdict = gate.accept(att, id, Date.now())
  if (verdict !== 'ok' || isKnockbackImmune() || !isBurstEnabledNow()) {
    console.log(`[Burst] ${why} #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
    return false
  }
  safePhysics('burst knockback', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dx * BURST_KNOCKBACK, BURST_KNOCK_LIFT, dz * BURST_KNOCKBACK))
    if (BURST_KNOCK_FORCE > 0) Physics.applyForceToPlayerForDuration(knockForceEnt, BURST_KNOCK_FORCE_S, Vector3.create(dx, 0, dz), BURST_KNOCK_FORCE)
  })
  playDashHitSfx()
  console.log(`[Burst] ${why} by ${att.slice(0, 8)} #${id}`)
  return true
}

/** Downward spike. Same ImpactGate as the radial knock, so speculative + confirmed do not stack. */
function applyAirKnock(att: string, id: number, dx: number, dz: number, why: string): boolean {
  const verdict = gate.accept(att, id, Date.now())
  if (verdict !== 'ok' || isKnockbackImmune() || !isBurstEnabledNow()) {
    console.log(`[Burst] air ${why} #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
    return false
  }
  const ox = dx * 0.35, oz = dz * 0.35
  const fl = Math.hypot(ox, oz, 1)
  safePhysics('air spike knockback', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dx * AIR_SPIKE_OUT, -AIR_SPIKE_DOWN, dz * AIR_SPIKE_OUT))
    if (AIR_SPIKE_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(knockForceEnt, AIR_SPIKE_FORCE_S, Vector3.create(ox / fl, -1 / fl, oz / fl), AIR_SPIKE_FORCE)
    }
  })
  startKnockLock()
  playAirHitSfx()
  const self = Transform.getOrNull(engine.PlayerEntity)?.position
  if (self) showAirHit({ x: self.x, y: self.y, z: self.z }, teamOfUser(att) === Team.None ? Team.Red : teamOfUser(att))
  console.log(`[Burst] air ${why} by ${att.slice(0, 8)} #${id}`)
  return true
}

function onImpact(attacker: string, id: number, target: string, dx: number, dz: number, air: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase(), tgt = target.toLowerCase()
  if (tgt.startsWith('bot:')) {
    const b = getBotRenderPositions().find(x => `bot:${x.id}` === tgt)
    if (b) {
      const pos = { x: b.pos.x, y: b.pos.y - BOT_FLOAT, z: b.pos.z }
      const col = teamOfUser(att) === Team.None ? Team.Red : teamOfUser(att)
      if (air) showAirHit(pos, col, att !== me)
      else playAt(pos)
    }
    return
  }
  if (air && tgt !== me && att !== me) {
    const p = posOf(tgt)
    if (p) showAirHit(p, teamOfUser(att) === Team.None ? Team.Red : teamOfUser(att), true)
  }
  if (!me || tgt !== me) return
  if (air) applyAirKnock(att, id, dx, dz, 'spiked')
  else applyVictimKnock(att, id, dx, dz, 'knocked')
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
  diveForceEnt = engine.addEntity()
  initBurstRipple()
  engine.addSystem((dt: number) => {
    if (emoteLeft <= 0 || (emoteLeft -= dt) > 0) return
    emoteLeft = 0
    void stopEmote({}).catch(() => {})
  })
  events.on('burst:fired', ({ attacker, id, team, x, y, z, air, lx, ly, lz }) => {
    const att = attacker.toLowerCase()
    gate.sawStart(att, id, Date.now())
    let faceX = 0, faceZ = 1
    for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      if (entity === engine.PlayerEntity) continue
      if (pid.address.toLowerCase() !== att) continue
      const f = Vector3.rotate(Vector3.Forward(), tr.rotation)
      const fl = Math.hypot(f.x, f.z)
      if (fl > 1e-3) { faceX = f.x / fl; faceZ = f.z / fl }
      break
    }
    if (att !== myAddress()) {
      if (air) {
        showAirStreak({ x, y, z }, team, faceX, faceZ)
        playPositional({ x, y, z }, AIR_DIVE_SRC, AIR_SPIKE_DIVE_VOL)
        if (air === 2) {
          startRipple({ x: lx, y: ly, z: lz }, team, '', 'cross', AIR_SPIKE_CROSS_R)
          playPositional({ x: lx, y: ly, z: lz }, AIR_STAMP_SRC, AIR_SPIKE_STAMP_VOL)
        }
      } else showShockwave({ x, y, z }, team, false)
    }
    // Victim anticipation: if we're already in the volume, knock now
    // (Impact arrives ~same RTT; this wins when Fired is processed before Impact).
    // Air uses the downward cylinder and the spike impulse, never the radial lift.
    if (!VICTIM_SPECULATIVE_KNOCK || air === 2) return
    const my = localTeam()
    if (my === Team.None || team === my) return
    if (isKnockbackImmune() || !isBurstEnabledNow()) return
    const tp = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!tp) return
    const origin: V3 = { x, y, z }
    const me: V3 = { x: tp.x, y: tp.y, z: tp.z }
    if (air ? !inAirSpike(origin, me) : !inBurst(origin, me)) return
    const k = burstDir(origin, me, faceX, faceZ)
    if (air) applyAirKnock(att, id, k.x, k.z, 'speculative spike')
    else applyVictimKnock(att, id, k.x, k.z, 'speculative knock')
  })
  events.on('burst:impact', ({ attacker, id, target, dx, dz, air }) => onImpact(attacker, id, target, dx, dz, air))

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
