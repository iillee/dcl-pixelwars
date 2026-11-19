/**
 * overdrive.ts — client mirror of the star pickup: glow, trail, music, knock, feet.
 * The server owns spawn, pickup, touch knocks, and immunity. No local prediction.
 */
import { engine, Entity, Transform, AvatarAttach, Material, MaterialTransparencyMode, MeshRenderer, LightSource, Billboard, BillboardMode, AudioSource, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import { BOT_AIM_REPORT_HZ, STAR_SPEED_MULT, STAR_THEME_SRC } from '../shared/pvp'
import { overdriveKnock } from '../shared/knocks'
import { playClaimSfx, playDashSfx, playDashHitSfx } from './audio'
import { applyKnock, isKnockbackImmune, myAddress, setOverdriveImmuneCheck } from './knockback'
import { getBotVisualEntity, playBotKnock } from './botVisual'
import { setStarSpeedMult } from './speed'
import { clearStarOrbs, hasStarOrbs, hideStarOrb, initStarOrbs, showStarOrb } from './starOrb'

const AAPT_POSITION = 0
const GLOW_Y = 0.95
const GLOW_SCALE = 1.85
const SPARK_SRC = 'assets/images/star_white.png'
const SPARK_N = 5
const THEME_VOL = 0.5

let active = 0
let until = 0
type GlowRec = { attach: Entity; ball: Entity; light: Entity; music: Entity; sparks: Entity[]; until: number }
const auras = new Map<string, number>()
const glows = new Map<string, GlowRec>()
let knockForceEnt: Entity | null = null
let wired = false
let feetClock = 0
let sparkClock = 0

export function isLocalOverdriveActive() {
  return active === 1 && until > Date.now()
}

/** Seconds left on the local star, or 0. Used by the compact HUD timer. */
export function starHudSeconds(): number {
  const now = Date.now()
  if (active !== 1 || until <= now) return 0
  return (until - now) / 1000
}

function applyLocalSpeed(): void {
  setStarSpeedMult(isLocalOverdriveActive() ? STAR_SPEED_MULT : 1)
}

function setLocal(endAt: number): void {
  const now = Date.now()
  const was = isLocalOverdriveActive()
  const live = typeof endAt === 'number' && isFinite(endAt) && endAt > now
  active = live ? 1 : 0
  until = live ? endAt : 0
  applyLocalSpeed()
  if (live && !was) {
    playDashSfx()
    playClaimSfx()
  }
}

function botIdOf(id: string): number | null {
  if (!id.startsWith('bot:')) return null
  const n = parseInt(id.slice(4), 10)
  return Number.isFinite(n) ? n : null
}

type StarAnchor = { kind: 'avatar'; avatarId: string | null } | { kind: 'bot'; entity: Entity }

function findStarAnchor(id: string): StarAnchor | null {
  const bid = botIdOf(id)
  if (bid !== null) {
    const entity = getBotVisualEntity(bid)
    return entity ? { kind: 'bot', entity } : null
  }
  const want = id.toLowerCase()
  const me = myAddress()
  if (me && want === me) return { kind: 'avatar', avatarId: null }
  for (const [entity, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if ((pid.address || '').toLowerCase() === want) return { kind: 'avatar', avatarId: pid.address }
  }
  return null
}

function glowMat(pulse: number) {
  const a = 0.22 + 0.16 * pulse
  return {
    albedoColor: Color4.create(1, 0.85, 0.25, a),
    emissiveColor: Color4.create(1, 0.82, 0.25, 1),
    emissiveIntensity: 3.2 + 1.4 * pulse,
    roughness: 1,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  }
}

function sparkMat(pulse: number) {
  const a = 0.45 + 0.4 * pulse
  return {
    texture: Material.Texture.Common({ src: SPARK_SRC }),
    emissiveTexture: Material.Texture.Common({ src: SPARK_SRC }),
    albedoColor: Color4.create(1, 0.92, 0.45, a),
    emissiveColor: Color4.create(1, 0.88, 0.35, 1),
    emissiveIntensity: 2.4 + pulse,
    roughness: 1,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  }
}

function ensureGlow(id: string, endAt: number): void {
  let rec = glows.get(id)
  if (rec) {
    rec.until = endAt
    const bid = botIdOf(id)
    if (bid !== null) {
      const ent = getBotVisualEntity(bid)
      const t = Transform.getOrNull(rec.attach)
      if (ent && t && t.parent === ent) return
      dropGlow(id)
      rec = undefined as unknown as GlowRec
    } else return
  }
  const who = findStarAnchor(id)
  if (!who) return
  const attach = engine.addEntity()
  if (who.kind === 'bot') {
    Transform.create(attach, { parent: who.entity })
  } else if (who.avatarId) {
    AvatarAttach.create(attach, { avatarId: who.avatarId, anchorPointId: AAPT_POSITION })
  } else {
    AvatarAttach.create(attach, { anchorPointId: AAPT_POSITION })
  }
  const ball = engine.addEntity()
  Transform.create(ball, { parent: attach, position: Vector3.create(0, GLOW_Y, 0), scale: Vector3.create(GLOW_SCALE, GLOW_SCALE, GLOW_SCALE) })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, glowMat(1))
  const light = engine.addEntity()
  Transform.create(light, { parent: attach, position: Vector3.create(0, GLOW_Y, 0) })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.8, 0.25), intensity: 80, range: 7 })
  const music = engine.addEntity()
  Transform.create(music, { parent: attach, position: Vector3.create(0, 1.2, 0) })
  AudioSource.create(music, { audioClipUrl: STAR_THEME_SRC, playing: true, loop: true, volume: THEME_VOL, global: false })
  const sparks: Entity[] = []
  for (let i = 0; i < SPARK_N; i++) {
    const spark = engine.addEntity()
    const ang = (i / SPARK_N) * Math.PI * 2
    Transform.create(spark, {
      parent: attach,
      position: Vector3.create(Math.cos(ang) * 0.35, 0.7, Math.sin(ang) * 0.35),
      scale: Vector3.create(0.22, 0.22, 0.22),
    })
    MeshRenderer.setPlane(spark)
    Billboard.create(spark, { billboardMode: BillboardMode.BM_ALL })
    Material.setPbrMaterial(spark, sparkMat(1))
    sparks.push(spark)
  }
  rec = { attach, ball, light, music, sparks, until: endAt }
  glows.set(id, rec)
}

function dropGlow(id: string): void {
  const rec = glows.get(id)
  if (!rec) return
  const src = AudioSource.getMutableOrNull(rec.music)
  if (src) src.playing = false
  for (const e of rec.sparks) {
    try { engine.removeEntity(e) } catch (err) { /* already gone */ }
  }
  for (const e of [rec.ball, rec.light, rec.music, rec.attach]) {
    try { engine.removeEntity(e) } catch (err) { /* already gone */ }
  }
  glows.delete(id)
}

function clearGlows() {
  for (const id of [...glows.keys()]) dropGlow(id)
  auras.clear()
}

function applyHold(id: string, endAt: number): void {
  const who = (id || '').toLowerCase()
  if (!who) return
  const now = Date.now()
  if (!endAt || endAt <= now) {
    auras.delete(who)
    dropGlow(who)
    if (who === myAddress()) setLocal(0)
    return
  }
  auras.set(who, endAt)
  ensureGlow(who, endAt)
  if (who === myAddress()) setLocal(endAt)
}

export function initOverdrive() {
  if (wired) return
  wired = true
  initStarOrbs()
  knockForceEnt = engine.addEntity()
  setOverdriveImmuneCheck(() => isLocalOverdriveActive())
  events.on('star:spawn', ({ i, x, y, z }) => {
    if (!Number.isFinite(i) || ![x, y, z].every(n => typeof n === 'number' && isFinite(n))) return
    showStarOrb(i, x, y, z)
  })
  events.on('star:despawn', ({ i }) => {
    if (Number.isFinite(i)) hideStarOrb(i)
  })
  events.on('star:hold', ({ id, until: endAt }) => applyHold(id, endAt))
  events.on('overdrive:impact', ({ attacker, target, dx, dz }) => {
    const me = myAddress()
    const want = (target || '').toLowerCase()
    if (want.startsWith('bot:')) {
      const bid = parseInt(want.slice(4), 10)
      if (Number.isFinite(bid)) playBotKnock(bid, dx, dz, 'overdrive')
      return
    }
    if (!me || want !== me) return
    if (isKnockbackImmune()) return
    if (!knockForceEnt) return
    applyKnock(overdriveKnock(dx, dz), knockForceEnt, 'overdrive knock')
    playDashHitSfx()
    console.log('[Overdrive] launched by ' + (attacker || '').slice(0, 8))
  })
  events.on('round:reset', () => {
    setLocal(0)
    clearGlows()
    clearStarOrbs()
  })
  events.on('lobby:floor', () => {
    setLocal(0)
    clearGlows()
    clearStarOrbs()
  })
  engine.addSystem((dt) => {
    const now = Date.now()
    const pulse = 0.5 + 0.5 * Math.sin(now / 180)
    sparkClock += dt
    if (isLocalOverdriveActive() && until <= now) setLocal(0)
    for (const [id, endAt] of [...auras]) {
      if (endAt <= now) {
        auras.delete(id)
        dropGlow(id)
        if (id === myAddress()) setLocal(0)
        continue
      }
      if (!glows.has(id)) ensureGlow(id, endAt)
    }
    for (const [id, rec] of glows) {
      if (rec.until <= now) { dropGlow(id); auras.delete(id); continue }
      const s = GLOW_SCALE * (0.92 + 0.12 * pulse)
      const t = Transform.getMutableOrNull(rec.ball)
      if (t) t.scale = Vector3.create(s, s, s)
      Material.setPbrMaterial(rec.ball, glowMat(pulse))
      rec.sparks.forEach((spark, i) => {
        const ang = (i / SPARK_N) * Math.PI * 2 + sparkClock * 1.6
        const lift = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(sparkClock * 3 + i))
        const st = Transform.getMutableOrNull(spark)
        if (st) st.position = Vector3.create(Math.cos(ang) * 0.4, lift, Math.sin(ang) * 0.4)
        Material.setPbrMaterial(spark, sparkMat(0.5 + 0.5 * Math.sin(sparkClock * 5 + i)))
      })
    }
    // While an orb or a star is live, send feet so the server can test pickup and touches.
    const needFeet = isLocalOverdriveActive() || auras.size > 0 || hasStarOrbs()
    if (!needFeet) return
    feetClock += dt
    if (feetClock < 1 / Math.max(BOT_AIM_REPORT_HZ, 10)) return
    feetClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch (err) { /* ignore */ }
  })
}
