/**
 * paintBurst.ts — Paint Burst (F), client side. Spec: Luke 2026-10-20.
 * Numbers in shared/pvp.ts (BURST_*), pure logic in shared/burst.ts.
 *
 * Charge: server-authoritative (burstState). The server counts our paintTick
 * cells that actually flipped to our team; at BURST_CHARGE_CELLS we hold 1
 * charge. Falls/respawns keep progress and the charge; a new round resets.
 *
 * Use (F / the hotbar slot on mobile): consume the charge (optimistic, the
 * server resyncs if it disagrees) and fire one shockwave at our feet:
 *   - opponents within BURST_RADIUS (3D) with clear line of sight (raycast,
 *     BURST_LOS) → burstHit → server dedupes → burstImpact → the victim's own
 *     client knocks itself outward (ImpactGate: dedupe + stale; respawn-immune).
 *   - local test dummies are knocked directly; ghost bots are shoved server-side.
 * Then for BURST_PAINT_S we send our current cell; the server paints the
 * footprint (shared/burst.ts burstFootprint) via the normal paintDelta sync.
 * F again while active does nothing. Falling (player:respawned) ends it, no refund.
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
  BURST_MODE, BURST_CHARGE_CELLS, BURST_RADIUS, BURST_LOS, BURST_LOS_HEIGHT, BURST_LOS_TIMEOUT_S,
  BURST_KNOCKBACK, BURST_KNOCK_LIFT, BURST_KNOCK_FORCE, BURST_KNOCK_FORCE_S, BURST_IMPACT_MAX_AGE_MS,
  BURST_PAINT_S, BURST_PAINT_RESEND_S, BURST_RING_S, BURST_PARTICLES, BURST_AURA_ALPHA,
  LUNGE_KNOCKBACK, burstEnabledForRound,
} from '../shared/pvp'
import { inBurst, burstDir, V3 } from '../shared/burst'
import { ImpactGate } from '../shared/lunge'
import { getCurrentCellId } from '../paint'
import { initBurstRipple, startRipple } from './burstRipple'
import { playDashHitSfx, playBurstSfx, BURST_SFX_SRC } from './audio'
import { sendBurstUse, sendBurstHit, sendBurstPaint, sendBurstEnd } from './clientHandler'
import { getBotRenderPositions } from './botVisual'
import { getDummyTargets, hitDummy } from './lungeDummy'
import { localTeam, teamOfUser, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

const CHARGE_SRC = 'assets/sounds/pop.mp3'
const BOT_FLOAT = 1 // botVisual FLOAT_HEIGHT

let progress = 0
let charged = false
let active = false
let activeLeft = 0
let burstId = 0
let lastCell: string | null = null
let resendLeft = 0
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

function showShockwave(p: V3, team: Team, local: boolean): void {
  const rgb = rgbOf(team)
  startRipple(p, team) // raised-tile ripple (BURST_TILE_RIPPLE)
  const d = BURST_RADIUS * 2
  // Fast flat ring out to the shockwave radius (diameter 2R), fading.
  addFx(BURST_RING_S, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 0.6, p.z), scale: Vector3.create(0.5, 0.05, 0.5) })
    MeshRenderer.setSphere(e)
    glow(e, rgb, 0.55, 4)
  }, (e, u) => {
    const s = 0.5 + (d - 0.5) * easeOut(Math.min(1, u / 0.7))
    Transform.getMutable(e).scale = Vector3.create(s, 0.05 * (1 - u) + 0.01, s)
  })
  // Light paint particle burst (BURST_PARTICLES blobs flying outward).
  for (let i = 0; i < BURST_PARTICLES; i++) {
    const a = (i / BURST_PARTICLES) * Math.PI * 2 + Math.random() * 0.4
    const r = BURST_RADIUS * (0.6 + Math.random() * 0.4)
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

// ─── Aura while active (1 entity per bursting avatar) ───────────────
const auras = new Map<string, { ent: Entity; left: number; t: number }>() // '' = us
function startAura(who: string, team: Team): void {
  stopAura(who)
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(8, -50, 8), scale: Vector3.create(1.6, 2.2, 1.6) })
  MeshRenderer.setSphere(ent)
  glow(ent, rgbOf(team), BURST_AURA_ALPHA, 1.5)
  auras.set(who, { ent, left: BURST_PAINT_S, t: 0 })
}
function stopAura(who: string): void {
  const a = auras.get(who)
  if (!a) return
  engine.removeEntity(a.ent)
  auras.delete(who)
}
function posOf(who: string): V3 | null {
  if (who === '') return Transform.getOrNull(engine.PlayerEntity)?.position ?? null
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    if (pid.address.toLowerCase() === who) return tr.position
  }
  return null
}

function chargeFlash(): void {
  const p = posOf('')
  if (!p) return
  const rgb = rgbOf(localTeam())
  addFx(0.35, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 1.1, p.z), scale: Vector3.create(0.4, 0.4, 0.4) })
    MeshRenderer.setSphere(e)
    glow(e, { r: (rgb.r + 1) / 2, g: (rgb.g + 1) / 2, b: (rgb.b + 1) / 2 }, 0.6, 5)
  }, (e, u) => {
    const q = posOf('')
    const s = 0.4 + 2.2 * easeOut(u)
    const tr = Transform.getMutable(e)
    tr.scale = Vector3.create(s, s, s)
    if (q) tr.position = Vector3.create(q.x, q.y + 1.1, q.z)
  })
  addFx(0.8, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 1.1, p.z) })
    AudioSource.create(e, { audioClipUrl: CHARGE_SRC, playing: true, loop: false, volume: 0.8, global: true })
  })
}

// ─── HUD ────────────────────────────────────────────────────────────
export function isBurstEnabledNow(): boolean { return burstEnabledForRound(getRoundIndex()) }

/** F slot state. text = '7/10' while charging, '2s' while active, '' when ready. */
export function getBurstHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number; text: string } {
  const enabled = isBurstEnabledNow() && localTeam() !== Team.None
  if (active) {
    return { show: BURST_MODE !== 'off', enabled, ready: false, cooldown: activeLeft, cooldownFrac: 1 - activeLeft / BURST_PAINT_S, text: `${Math.ceil(activeLeft)}s` }
  }
  return {
    show: BURST_MODE !== 'off', enabled, ready: enabled && charged, cooldown: charged ? 0 : 1,
    cooldownFrac: charged ? 0 : 1 - progress / BURST_CHARGE_CELLS,
    text: charged ? '' : `${progress}/${BURST_CHARGE_CELLS}`,
  }
}

// ─── Use ────────────────────────────────────────────────────────────
function losThen(from: V3, to: V3, cb: () => void): void {
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
    const blocked = res.hits.some(h => h.length < dist - 0.6)
    if (blocked) console.log('[Burst] target behind geometry, no hit')
    finish(!blocked)
  })
  // Fail open if the explorer never answers.
  addFx(BURST_LOS_TIMEOUT_S, () => {}, (_e, u) => { if (u >= 0.95) finish(true) })
}

export function triggerBurst(): void {
  const team = localTeam()
  if (!isBurstEnabledNow() || team === Team.None || !charged || active) return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return
  const p: V3 = { x: t.position.x, y: t.position.y, z: t.position.z }
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  burstId = (burstId + 1) % 1_000_000
  const id = burstId
  charged = false; progress = 0
  active = true; activeLeft = BURST_PAINT_S
  lastCell = null; resendLeft = 0
  sendBurstUse(id, p.x, p.y, p.z, f.x, f.z)
  showShockwave(p, team, true)
  startAura('', team)
  // Opponent players (attacker-detected, like Lunge; server dedupes).
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (entity === engine.PlayerEntity) continue
    const tt = teamOfUser(pid.address)
    if ((tt !== Team.Red && tt !== Team.Blue) || tt === team) continue
    const tp: V3 = { x: tr.position.x, y: tr.position.y, z: tr.position.z }
    if (!inBurst(p, tp)) continue
    const addr = pid.address.toLowerCase()
    const k = burstDir(p, tp, f.x, f.z)
    losThen(p, tp, () => sendBurstHit(id, addr, k.x, k.z))
  }
  // Local test dummies.
  for (const d of getDummyTargets()) {
    if (!inBurst(p, d.pos)) continue
    const k = burstDir(p, d.pos, f.x, f.z)
    losThen(p, d.pos, () => hitDummy(d.i, k.x, k.z, BURST_KNOCKBACK / LUNGE_KNOCKBACK))
  }
  console.log(`[Burst] #${id} fired`)
}

function endActive(why: string): void {
  if (!active) return
  active = false; activeLeft = 0
  stopAura('')
  if (why !== 'timeout') sendBurstEnd(burstId)
  console.log(`[Burst] #${burstId} ended (${why})`)
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
  events.on('burst:state', s => {
    const wasCharged = charged
    progress = s.progress
    charged = s.charged
    if (!s.active && active && activeLeft > BURST_PAINT_S - 0.3) {
      // Server rejected our use (no charge on its side): undo locally.
      active = false; stopAura('')
    }
    if (charged && !wasCharged) chargeFlash()
  })
  events.on('burst:fired', ({ attacker, id, team, x, y, z }) => {
    const att = attacker.toLowerCase()
    gate.sawStart(att, id, Date.now())
    if (att === myAddress()) return // shown at the press
    showShockwave({ x, y, z }, team, false)
    startAura(att, team)
  })
  events.on('burst:impact', ({ attacker, id, target, dx, dz }) => onImpact(attacker, id, target, dx, dz))
  events.on('player:respawned', () => endActive('fell')) // charge/progress kept, active ends, no refund
  events.on('round:reset', () => {
    endActive('round')
    progress = 0; charged = false
    for (const w of Array.from(auras.keys())) stopAura(w)
  })

  engine.addSystem((dt: number) => {
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) triggerBurst()
    if (active) {
      activeLeft -= dt
      if (activeLeft <= 0) endActive('timeout')
      else {
        resendLeft -= dt
        const cell = getCurrentCellId()
        if (cell && (cell !== lastCell || resendLeft <= 0)) {
          sendBurstPaint(burstId, cell)
          lastCell = cell; resendLeft = BURST_PAINT_RESEND_S
        }
      }
    }
    for (const [who, a] of auras) {
      a.left -= dt; a.t += dt
      if (a.left <= 0) { stopAura(who); continue }
      const p = posOf(who)
      if (!p) continue
      const s = 1.6 + 0.12 * Math.sin(a.t * 10)
      const tr = Transform.getMutable(a.ent)
      tr.position = Vector3.create(p.x, p.y + 1.0, p.z)
      tr.scale = Vector3.create(s, 2.2, s)
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) { f.step(f.ent, 1); engine.removeEntity(f.ent); fx.splice(i, 1); continue }
      f.step(f.ent, f.t / f.life)
    }
  })
}
