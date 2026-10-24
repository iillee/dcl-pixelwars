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
 *     strong downward knock, small outward, brief control lock. A miss over the
 *     void keeps the dive and falls. A miss that meets the floor plays the grounded
 *     shockwave and the server paints that footprint once (same path as a ground
 *     Burst). A connect does not play or paint it: most of the downward speed is
 *     cancelled, nothing is added upward, and the victim is spiked with the glider
 *     forced shut. Ground Burst does not dive.
 *   The hotbar only queues the press. Ground vs air uses a live stance sample
 *   (BURST_STANCE_SLACK), not the previous frame's grounded flag. A shockwave
 *   keeps resending its paint until the server confirms the footprint.
 * Local test dummies are knocked directly; ghost bots are shoved server-side.
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
  AIR_SPIKE_DOWN, AIR_SPIKE_OUT, AIR_SPIKE_FORCE, AIR_SPIKE_FORCE_S,
  AIR_SPIKE_DIVE_IMPULSE, AIR_SPIKE_DIVE_FORWARD, AIR_SPIKE_DIVE_FORCE, AIR_SPIKE_DIVE_FORCE_S,
  AIR_SPIKE_TRAIL_N, AIR_SPIKE_TRAIL_DROP, AIR_SPIKE_TRAIL_S, AIR_SPIKE_TRAIL_SIZE,
  AIR_SPIKE_HIT_VOL, AIR_SPIKE_STAMP_WINDOW_S,
  BURST_PAINT_RETRY_S, BURST_PAINT_RETRY_GAP_S, BURST_USE_RETRY_S,
  AIR_SPIKE_GLIDE_LOCK_S,
  AIR_SPIKE_KEEP_FRACTION, AIR_SPIKE_HANG_S, AIR_SPIKE_HANG_FORCE,
  AIR_SPIKE_RECOVER_GLIDE, AIR_SPIKE_RECOVER_GLIDE_S,
  LUNGE_KNOCKBACK, burstEnabledForRound, VICTIM_SPECULATIVE_KNOCK,
} from '../shared/pvp'
import { inBurst, inAirSpike, burstDir, V3 } from '../shared/burst'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { holdForEmote, startKnockLock, startGlideLock } from './lunge'
import { isMoveLocked } from './moveLock'
import { BURST_EMOTE_ENABLED, BURST_EMOTE_SRC, BURST_EMOTE_S, BURST_EMOTE_FREEZE_S } from '../shared/pvp'

// Pending switch from the one-shot ground punch to the looping hold of its final pose.
let emoteLeft = 0 // > 0 while the burst one-shot plays; at 0 we stopEmote so it always releases
import { ImpactGate } from '../shared/lunge'
import { sampleBurstStance } from '../paint'
import { initBurstRipple, startRipple, nearGround } from './burstRipple'
import {
  playDashHitSfx, playBurstSfx, playAirHitSfx,
  BURST_SFX_SRC, AIR_HIT_SRC,
} from './audio'
import { sendBurstUse, sendBurstHit, sendBurstLand } from './clientHandler'
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

/** Team motes falling down the dive, same sphere family as the ground Burst puff.
 *  Staggered so they read as a trail. Not a slash plane. */
function showAirTrail(p: V3, team: Team, fx: number, fz: number): void {
  const rgb = rgbOf(team)
  const fl = Math.hypot(fx, fz) || 1
  const ux = fx / fl, uz = fz / fl
  const from = Vector3.create(p.x + ux * 0.25, p.y + 1.2, p.z + uz * 0.25)
  const to = Vector3.create(from.x, from.y - AIR_SPIKE_TRAIL_DROP, from.z)
  for (let i = 0; i < AIR_SPIKE_TRAIL_N; i++) {
    const lag = (i / AIR_SPIKE_TRAIL_N) * 0.45
    const side = (i - (AIR_SPIKE_TRAIL_N - 1) / 2) * 0.14
    const start = Vector3.create(from.x + uz * side, from.y, from.z - ux * side)
    const end = Vector3.create(to.x + uz * side, to.y, to.z - ux * side)
    const size = AIR_SPIKE_TRAIL_SIZE * (0.75 + (i % 3) * 0.12)
    addFx(AIR_SPIKE_TRAIL_S, e => {
      Transform.create(e, { position: start, scale: Vector3.create(size, size, size) })
      MeshRenderer.setSphere(e)
      glow(e, rgb, 0.9, 3)
    }, (e, u) => {
      const k = Math.min(1, Math.max(0, (u - lag) / (1 - lag)))
      const tr = Transform.getMutable(e)
      tr.position = Vector3.lerp(start, end, k * k)
      const s = size * (1 - k)
      tr.scale = Vector3.create(s, s, s)
      glow(e, rgb, 0.9 * (1 - k), 3)
    })
  }
}

/** One grounded shockwave per dive, when feet meet the floor.
 *  Same presentation as a ground Burst (showShockwave). Audio is one
 *  burst_impact per landing: camera-parented for the diver, positional for
 *  everyone else. A second stamp for the same dive (own echo) does not play
 *  it again. The local client also asks the server to paint that footprint
 *  once. No second knock — the cylinder hit already resolved at the press.
 *  The first few frames are skipped so a low hop does not fire on the press. */
/** Last local landing that already played burst_impact, so a self echo cannot. */
let localShockId = -1
let localShockAt = 0
const STAMP_ARM_S = 0.08
/** One hitch must not burn the whole landing window. Low fps still gets later frames. */
const STAMP_STEP_CAP_S = 0.25
const stampWatch: Array<{ who: string; team: Team; id: number; left: number; fx: number; fz: number }> = []

/** Shockwave already played. Resend until burstPainted, with a fresh grounded sample. */
type PaintHold = { id: number; kind: 'ground' | 'land'; x: number; y: number; z: number; fx: number; fz: number; cell: string; arm: number; left: number }
const paintHolds: PaintHold[] = []
/** Airborne burstUse, original sample. Resend until our own burstFired. Position stays the press. */
type UseHold = { id: number; x: number; y: number; z: number; fx: number; fz: number; cell: string; arm: number; left: number }
const useHolds: UseHold[] = []

function safeSend(label: string, fn: () => void): boolean {
  try { fn(); return true } catch (e) { console.log(`[Burst] ${label} send failed`, e); return false }
}
function queuePaint(kind: 'ground' | 'land', id: number, cell: string, p: V3, fx: number, fz: number): void {
  const row: PaintHold = { id, kind, x: p.x, y: p.y, z: p.z, fx, fz, cell, arm: BURST_PAINT_RETRY_GAP_S, left: BURST_PAINT_RETRY_S }
  const i = paintHolds.findIndex(h => h.id === id)
  if (i >= 0) paintHolds[i] = row
  else paintHolds.push(row)
}
function kickPaint(id: number): void {
  const h = paintHolds.find(x => x.id === id)
  if (h) h.arm = 0
}
function clearPaint(id: number): void {
  const i = paintHolds.findIndex(h => h.id === id)
  if (i >= 0) paintHolds.splice(i, 1)
}
function queueUse(id: number, cell: string, p: V3, fx: number, fz: number): void {
  const row: UseHold = { id, x: p.x, y: p.y, z: p.z, fx, fz, cell, arm: BURST_PAINT_RETRY_GAP_S, left: BURST_USE_RETRY_S }
  const i = useHolds.findIndex(h => h.id === id)
  if (i >= 0) useHolds[i] = row
  else useHolds.push(row)
}
function kickUse(id: number): void {
  const h = useHolds.find(x => x.id === id)
  if (h) h.arm = 0
}
function clearUse(id: number): void {
  const i = useHolds.findIndex(h => h.id === id)
  if (i >= 0) useHolds.splice(i, 1)
}
function flushBurstNet(dt: number): void {
  for (let i = useHolds.length - 1; i >= 0; i--) {
    const h = useHolds[i]
    h.left -= dt
    h.arm -= dt
    if (h.arm > 0) { if (h.left <= 0) useHolds.splice(i, 1); continue }
    safeSend('burstUse retry', () => sendBurstUse(h.id, h.cell, h.x, h.y, h.z, h.fx, h.fz, 1))
    h.arm = BURST_PAINT_RETRY_GAP_S
    if (h.left <= 0) useHolds.splice(i, 1)
  }
  for (let i = paintHolds.length - 1; i >= 0; i--) {
    const h = paintHolds[i]
    h.left -= dt
    h.arm -= dt
    if (h.arm > 0) { if (h.left <= 0) { console.log(`[Burst] #${h.id} paint retry gave up (${h.kind})`); paintHolds.splice(i, 1) }; continue }
    const live = sampleBurstStance()
    if (live?.grounded) { h.x = live.x; h.y = live.y; h.z = live.z; h.cell = live.cell }
    if (h.kind === 'ground') safeSend('burstUse retry', () => sendBurstUse(h.id, h.cell, h.x, h.y, h.z, h.fx, h.fz, 0))
    else {
      // The landing paint needs the airborne ledger. A lost press is started here; a
      // press the server already has is ignored (same id, no second broadcast).
      safeSend('burstLand retry', () => {
        sendBurstUse(h.id, h.cell, h.x, h.y, h.z, h.fx, h.fz, 1)
        sendBurstLand(h.id, h.cell, h.x, h.y, h.z)
      })
    }
    h.arm = BURST_PAINT_RETRY_GAP_S
    if (h.left <= 0) { console.log(`[Burst] #${h.id} paint retry gave up (${h.kind})`); paintHolds.splice(i, 1) }
  }
}

function armLandingStamp(who: string, team: Team, id: number, fx = 0, fz = 1): void {
  const i = stampWatch.findIndex(s => s.who === who)
  const row = { who, team, id, left: AIR_SPIKE_STAMP_WINDOW_S, fx, fz }
  if (i >= 0) stampWatch[i] = row
  else stampWatch.push(row)
}
/** A connect is the air-hit, not a ground slam. Drop the landing shockwave and its paint. */
function disarmLandingStamp(who: string): void {
  const i = stampWatch.findIndex(s => s.who === who)
  if (i < 0) return
  if (who === '') clearPaint(stampWatch[i].id)
  stampWatch.splice(i, 1)
}
function tickStamps(dt: number): void {
  const step = Math.min(Math.max(dt, 0), STAMP_STEP_CAP_S)
  for (let i = stampWatch.length - 1; i >= 0; i--) {
    const s = stampWatch[i]
    s.left -= step
    const elapsed = AIR_SPIKE_STAMP_WINDOW_S - s.left
    if (elapsed < STAMP_ARM_S) continue
    const stance = s.who === '' ? sampleBurstStance() : null
    const pos: V3 | null = s.who === ''
      ? (stance ? { x: stance.x, y: stance.y, z: stance.z } : null)
      : posOf(s.who)
    const landed = s.who === '' ? !!stance?.grounded : !!(pos && nearGround(pos))
    if (landed && pos) {
      // Local: camera-parented burst_impact + reported cell, same as a grounded press.
      // Remote: positional burst_impact and ripple from the avatar's landing point,
      // same call ground Burst uses when burstFired arrives for someone else.
      // Own echo (address stamp while we already slammed, or the address matches
      // us) must not play the positional copy on top of the camera one.
      const me = myAddress()
      const localShock = s.who === '' || (me !== '' && s.who === me)
      const cell = s.who === '' ? (stance?.cell ?? '') : ''
      const now = Date.now()
      const repeat = localShock && localShockId === s.id && now - localShockAt < AIR_SPIKE_STAMP_WINDOW_S * 1000
      if (!repeat) {
        if (localShock) { localShockId = s.id; localShockAt = now }
        showShockwave(pos, s.team, localShock, cell)
      }
      // The server paints once. Retries keep going until burstPainted, so a lost
      // burstUse or an empty centre does not leave the shockwave unpainted.
      if (s.who === '') {
        queuePaint('land', s.id, cell, pos, s.fx, s.fz)
        if (!safeSend('burstLand', () => sendBurstLand(s.id, cell, pos.x, pos.y, pos.z))) kickPaint(s.id)
      }
      console.log(`[Burst] #${s.id} landing shockwave ${localShock ? 'local' : s.who.slice(0, 8)} pos=${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}${repeat ? ' (audio already played)' : ''}`)
      stampWatch.splice(i, 1)
    } else if (s.left <= 0) stampWatch.splice(i, 1)
  }
}

function playPositional(p: V3, src: string, vol: number): void {
  addFx(1.1, e => {
    Transform.create(e, { position: Vector3.create(p.x, p.y + 0.8, p.z) })
    AudioSource.create(e, { audioClipUrl: src, playing: true, loop: false, volume: vol, global: false })
  })
}

/** Short downward body commit. Local attacker only; grounded Burst never calls this.
 *  A connect does not call this — the dive must not carry the attacker off the map. */
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

/** Recent locomotion fall (m/s, negative = down), sampled before this frame's impulse.
 *  Clamped so a teleport doesn't look like a meteor. */
let fallSampleY: number | null = null
let fallVy = 0
function sampleFall(dt: number): void {
  const y = Transform.getOrNull(engine.PlayerEntity)?.position.y
  if (y === undefined) { fallSampleY = null; return }
  if (fallSampleY !== null && dt > 1e-4) fallVy = Math.max(-40, Math.min(40, (y - fallSampleY) / dt))
  fallSampleY = y
}

/** Connect: keep a fraction of the downward speed, no upward hop.
 *  Same-frame impulses add. The dive impulse is applied, then a smaller upward
 *  cancel, so net vertical stays negative. The upward one also zeros locomotion
 *  fall; that cleared speed is included in the fraction via `fallVy`. The
 *  sustained dive force is not applied — a miss is the path that keeps it.
 *  Gravity resumes unless AIR_SPIKE_HANG_S > 0, which only offsets gravity. */
function partialStopDive(fx: number, fz: number): void {
  const fl = Math.hypot(fx, fz) || 1
  const diveDown = AIR_SPIKE_DIVE_IMPULSE
  const preexisting = Math.max(0, -fallVy)
  const keepDown = (preexisting + diveDown) * AIR_SPIKE_KEEP_FRACTION
  const cancelY = Math.max(0, diveDown - keepDown)
  safePhysics('partial stop', () => {
    Physics.removeForceFromPlayer(diveForceEnt)
    Physics.applyImpulseToPlayer(Vector3.create(
      (fx / fl) * AIR_SPIKE_DIVE_FORWARD, -diveDown, (fz / fl) * AIR_SPIKE_DIVE_FORWARD,
    ))
    if (cancelY > 0) Physics.applyImpulseToPlayer(Vector3.create(0, cancelY, 0))
    if (AIR_SPIKE_HANG_S > 0 && AIR_SPIKE_HANG_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(diveForceEnt, AIR_SPIKE_HANG_S, Vector3.create(0, 1, 0), AIR_SPIKE_HANG_FORCE)
    }
  })
  if (!AIR_SPIKE_RECOVER_GLIDE) startGlideLock(AIR_SPIKE_RECOVER_GLIDE_S)
  console.log(`[Burst] partial stop keep=${keepDown.toFixed(1)} m/s cancel=${cancelY.toFixed(1)} glide=${AIR_SPIKE_RECOVER_GLIDE ? 'open' : `shut ${AIR_SPIKE_RECOVER_GLIDE_S}s`}`)
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

function knockAirAnvils(p: V3, fx: number, fz: number, id: number): number {
  let n = 0
  for (const d of getDummyTargets()) {
    if (!inAirSpike(p, d.pos)) continue
    const k = burstDir(p, d.pos, fx, fz)
    hitDummy(d.i, k.x, k.z, 1, id)
    n++
  }
  return n
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
export function getBurstHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number; recovering: boolean } {
  const enabled = isBurstEnabledNow() && localTeam() !== Team.None
  const cd = Math.max(0, cooldownLeft)
  const locked = isMoveLocked()
  return { show: BURST_MODE !== 'off', enabled, ready: enabled && cd <= 0 && !locked, cooldown: cd, cooldownFrac: cd / BURST_COOLDOWN_S, recovering: locked }
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

/** Hotbar press (mobile circle, desktop slot). The gameplay system fires it, so the
 *  stance sample is this frame's feet and the send runs there too. */
let burstRequested = false
export function requestBurst(): void { burstRequested = true }

export function triggerBurst(): void {
  if (isMoveLocked()) return
  const team = localTeam()
  if (!isBurstEnabledNow() || team === Team.None || cooldownLeft > 0) return
  const stance = sampleBurstStance()
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!stance || !t) return
  const p: V3 = { x: stance.x, y: stance.y, z: stance.z }
  const f = Vector3.rotate(Vector3.Forward(), t.rotation)
  burstId = (burstId + 1) % 1_000_000
  const id = burstId
  cooldownLeft = BURST_COOLDOWN_S
  if (!stance.grounded) {
    fireAirSpike(id, team, p, f.x, f.z)
    return
  }
  const cell = stance.cell
  // Feedback on the input frame before any network work (same rule as Lunge).
  showShockwave(p, team, true, cell)
  queuePaint('ground', id, cell, p, f.x, f.z)
  if (!safeSend('burstUse', () => sendBurstUse(id, cell, p.x, p.y, p.z, f.x, f.z, 0))) kickPaint(id)
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

/** Airborne F: downward spike. A player or bot in the cylinder is combat.
 *  Hit: keep a fraction of the fall, no landing shockwave and no burst paint.
 *  Miss: full dive (a void miss keeps falling). The landing shockwave and its
 *  paint wait until the feet meet the floor. */
function fireAirSpike(id: number, team: Team, p: V3, fx: number, fz: number): void {
  // No press clip. A miss plays burst_impact once, at the landing, the same
  // single sound as a ground Burst. Playing air_spike_dive here as well made
  // the local player hear the burst twice. A connect has no landing; its sound
  // is the hit clip only.
  showAirTrail(p, team, fx, fz)
  queueUse(id, '', p, fx, fz)
  if (!safeSend('burstUse', () => sendBurstUse(id, '', p.x, p.y, p.z, fx, fz, 1))) kickUse(id)
  const anvils = knockAirAnvils(p, fx, fz, id)
  const hits = airPlayerHits(p, team, fx, fz)
  const bot = airBotBelow(p, team)
  if (hits.length > 0 || bot || anvils > 0) {
    partialStopDive(fx, fz)
    disarmLandingStamp('')
    if (hits.length === 0) playAirHitSfx()
    for (const h of hits) {
      sendBurstHit(id, h.addr, h.k.x, h.k.z)
      playAirHitSfx()
      showAirHit(h.pos, team)
    }
    console.log(`[Burst] #${id} air spike hit players=${hits.length} bot=${bot} anvils=${anvils} pos=${p.y.toFixed(2)}`)
    return
  }
  // Full dive, including the sustained downward force. Nothing cancels this.
  commitAirDive(fx, fz)
  armLandingStamp('', team, id, fx, fz)
  console.log(`[Burst] #${id} air spike miss pos=${p.y.toFixed(2)}`)
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

/** Downward spike. Same ImpactGate as the radial knock, so speculative + confirmed do not stack.
 *  Glide first: the explorer clamps fall to ~1 m/s and swallows force-Y while the
 *  glider is open. disableGliding / disableJump force-close it. The impulse is
 *  external velocity, so it still spikes once the clamp is off, and the lock
 *  stays up long enough that reopening the glider cannot float the fall away. */
function applyAirKnock(att: string, id: number, dx: number, dz: number, why: string): boolean {
  const verdict = gate.accept(att, id, Date.now())
  if (verdict !== 'ok' || isKnockbackImmune() || !isBurstEnabledNow()) {
    console.log(`[Burst] air ${why} #${id} from ${att.slice(0, 8)} dropped (${verdict}, immune=${isKnockbackImmune()})`)
    return false
  }
  startGlideLock(AIR_SPIKE_GLIDE_LOCK_S)
  startKnockLock()
  const ox = dx * 0.35, oz = dz * 0.35
  const fl = Math.hypot(ox, oz, 1)
  safePhysics('air spike knockback', () => {
    Physics.applyImpulseToPlayer(Vector3.create(dx * AIR_SPIKE_OUT, -AIR_SPIKE_DOWN, dz * AIR_SPIKE_OUT))
    if (AIR_SPIKE_FORCE > 0) {
      Physics.applyForceToPlayerForDuration(knockForceEnt, AIR_SPIKE_FORCE_S, Vector3.create(ox / fl, -1 / fl, oz / fl), AIR_SPIKE_FORCE)
    }
  })
  playAirHitSfx()
  const self = Transform.getOrNull(engine.PlayerEntity)?.position
  if (self) showAirHit({ x: self.x, y: self.y, z: self.z }, teamOfUser(att) === Team.None ? Team.Red : teamOfUser(att))
  console.log(`[Burst] air ${why} by ${att.slice(0, 8)} #${id} glide locked ${AIR_SPIKE_GLIDE_LOCK_S}s`)
  return true
}

function onImpact(attacker: string, id: number, target: string, dx: number, dz: number, air: number): void {
  const me = myAddress()
  const att = attacker.toLowerCase(), tgt = target.toLowerCase()
  // Connect cancels the landing shockwave for everyone watching this dive.
  // Player and bot hits both arrive as burstImpact; an anvil connect is local only.
  if (air) {
    disarmLandingStamp(att)
    if (me && att === me) {
      disarmLandingStamp('')
      clearPaint(id)
    }
  }
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
  events.on('burst:fired', ({ attacker, id, team, x, y, z, air }) => {
    const att = attacker.toLowerCase()
    const selfAddr = myAddress()
    if (selfAddr !== '' && att === selfAddr) clearUse(id)
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
        showAirTrail({ x, y, z }, team, faceX, faceZ)
        // Landing plays burst_impact once. The press dive clip is not played
        // here either, or a remote would hear the burst twice.
        armLandingStamp(att, team, id)
      } else showShockwave({ x, y, z }, team, false)
    }
    // Victim anticipation: if we're already in the volume, knock now
    // (Impact arrives ~same RTT; this wins when Fired is processed before Impact).
    // Air uses the downward cylinder and the spike impulse, never the radial lift.
    if (!VICTIM_SPECULATIVE_KNOCK) return
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
  events.on('burst:painted', ({ id, n }) => { if (n > 0) { clearPaint(id); clearUse(id) } })

  engine.addSystem((dt: number) => {
    sampleFall(dt)
    if (cooldownLeft > 0) cooldownLeft -= dt
    // Key and hotbar share this call, after the paint system has run. One press, one burst.
    if (burstRequested || inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
      burstRequested = false
      triggerBurst()
    }
    tickStamps(dt)
    flushBurstNet(dt)
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) { f.step(f.ent, 1); engine.removeEntity(f.ent); fx.splice(i, 1); continue }
      f.step(f.ent, f.t / f.life)
    }
  })
}
