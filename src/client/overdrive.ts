/**
 * overdrive.ts — client mirror of the star pickup: sparkles, light, music, knock, feet.
 * The server owns spawn, pickup, touch knocks, and immunity. No local prediction.
 */
import { engine, Entity, Transform, AvatarAttach, Material, MaterialTransparencyMode, MeshRenderer, LightSource, Billboard, BillboardMode, AudioSource, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import { BOT_AIM_REPORT_HZ, STAR_MS, STAR_SPEED_MULT, STAR_THEME_SRC, STAR_THEME_ENABLED } from '../shared/pvp'
import { overdriveKnock } from '../shared/knocks'
import { playClaimSfx, playDashSfx, playDashHitSfx, setMusicDucked } from './audio'
import { applyKnock, isKnockbackImmune, myAddress, setOverdriveImmuneCheck } from './knockback'
import { setBotStarFace, clearBotStarFaces } from './botFace'
import { getBotVisualEntity, playBotKnock } from './botVisual'
import { setStarSpeedMult } from './speed'
import { inLobby } from './phase'
import { resolveStarHoldEnd } from '../shared/overdrive'
import { clearStarOrbs, hasStarOrbs, hideStarOrb, initStarOrbs, showStarOrb } from './starOrb'

const AAPT_POSITION = 0
const GLOW_Y = 0.95
const SPARK_SRC = 'assets/images/star_white.png'
const SPARK_N = 36
const SPARK_LIFE = 1.15
const SPARK_RISE_H = 3.6
const SPARK_START_Y = 0.4
const SPARK_SPREAD = 0.32
const SPARK_SIZE = 0.75
const SPARK_GOLD = { r: 255 / 255, g: 213 / 255, b: 74 / 255 }
const THEME_VOL = 0.5

let active = 0
let until = 0
type GlowRec = { attach: Entity; light: Entity; music: Entity; sparks: Entity[]; until: number }
const auras = new Map<string, number>()
const glows = new Map<string, GlowRec>()
let knockForceEnt: Entity | null = null
let wired = false
let feetClock = 0
let sparkClock = 0

export function isLocalOverdriveActive() {
  return active === 1 && until > Date.now()
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
  setMusicDucked(STAR_THEME_ENABLED && live)
  if (live && !was) {
    playDashSfx()
    playClaimSfx()
  }
}

function localStarExpired(now = Date.now()): boolean {
  return active === 1 && until > 0 && until <= now
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

function sparkMat(alpha: number) {
  const a = Math.max(0, Math.min(1, alpha))
  const c = SPARK_GOLD
  return {
    texture: Material.Texture.Common({ src: SPARK_SRC }),
    emissiveTexture: Material.Texture.Common({ src: SPARK_SRC }),
    albedoColor: Color4.create(c.r, c.g, c.b, a),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 6.5 * a,
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
    } else {
      // A leftover rec from a previous hold would skip creating a new aura
      // (music already stopped, sparkles gone) so the second pickup looked dead.
      dropGlow(id)
      rec = undefined as unknown as GlowRec
    }
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
  const light = engine.addEntity()
  Transform.create(light, { parent: attach, position: Vector3.create(0, GLOW_Y, 0) })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.88, 0.3), intensity: 160, range: 18 })
  const music = engine.addEntity()
  Transform.create(music, { parent: attach, position: Vector3.create(0, 1.2, 0) })
  if (STAR_THEME_ENABLED) {
    AudioSource.create(music, { audioClipUrl: STAR_THEME_SRC, playing: true, loop: false, volume: THEME_VOL, global: false })
  }
  const sparks: Entity[] = []
  for (let i = 0; i < SPARK_N; i++) {
    const spark = engine.addEntity()
    const ang = (i / SPARK_N) * Math.PI * 2
    Transform.create(spark, {
      parent: attach,
      position: Vector3.create(Math.cos(ang) * SPARK_SPREAD, SPARK_START_Y, Math.sin(ang) * SPARK_SPREAD),
      scale: Vector3.create(SPARK_SIZE, SPARK_SIZE, SPARK_SIZE),
    })
    MeshRenderer.setPlane(spark)
    Billboard.create(spark, { billboardMode: BillboardMode.BM_ALL })
    Material.setPbrMaterial(spark, sparkMat(1))
    sparks.push(spark)
  }
  rec = { attach, light, music, sparks, until: endAt }
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
  for (const e of [rec.light, rec.music, rec.attach]) {
    try { engine.removeEntity(e) } catch (err) { /* already gone */ }
  }
  glows.delete(id)
}

function clearGlows() {
  for (const id of [...glows.keys()]) dropGlow(id)
  auras.clear()
  clearBotStarFaces()
}

function setBotStarFromId(id: string, on: boolean): void {
  const bid = botIdOf(id)
  if (bid !== null) setBotStarFace(bid, on)
}

function applyHold(id: string, endAt: number, remainingMs?: number): void {
  const who = (id || '').toLowerCase()
  if (!who) return
  const now = Date.now()
  const localEnd = resolveStarHoldEnd(endAt, remainingMs, now)
  if (!localEnd) {
    const cur = auras.get(who)
    // A delayed until:0 from a previous hold must not clear a newer grant.
    if (cur && cur > now) return
    auras.delete(who)
    dropGlow(who)
    setBotStarFromId(who, false)
    if (who === myAddress()) setLocal(0)
    return
  }
  auras.set(who, localEnd)
  dropGlow(who)
  ensureGlow(who, localEnd)
  setBotStarFromId(who, true)
  if (who === myAddress()) setLocal(localEnd)
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
  events.on('star:hold', ({ id, until: endAt, ms }) => applyHold(id, endAt, ms))
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
    sparkClock += dt
    if (localStarExpired(now)) setLocal(0)
    for (const [id, endAt] of [...auras]) {
      if (endAt <= now) {
        auras.delete(id)
        dropGlow(id)
        setBotStarFromId(id, false)
        if (id === myAddress()) setLocal(0)
        continue
      }
      if (!glows.has(id)) ensureGlow(id, endAt)
      setBotStarFromId(id, true)
    }
    for (const [id, rec] of glows) {
      if (rec.until <= now) {
        dropGlow(id)
        auras.delete(id)
        setBotStarFromId(id, false)
        if (id === myAddress()) setLocal(0)
        continue
      }
      rec.sparks.forEach((spark, i) => {
        const t = (sparkClock / SPARK_LIFE + i / SPARK_N) % 1
        const fade = 1 - t
        const lift = SPARK_START_Y + t * SPARK_RISE_H
        const ang = (i / SPARK_N) * Math.PI * 2
        const st = Transform.getMutableOrNull(spark)
        const size = SPARK_SIZE * (0.75 + 0.25 * fade)
        if (st) {
          st.position = Vector3.create(Math.cos(ang) * SPARK_SPREAD, lift, Math.sin(ang) * SPARK_SPREAD)
          st.scale = Vector3.create(size, size, size)
        }
        Material.setPbrMaterial(spark, sparkMat(fade))
      })
    }
    // Send feet whenever an orb is out or a hold is live, and also during
    // a match so a second spawn is claimable even if the orb visual is a
    // frame late. Without this, a solo player with no bots stopped reporting
    // after the first star ended, and the next pickup never registered.
    const needFeet = isLocalOverdriveActive() || auras.size > 0 || hasStarOrbs() || !inLobby()
    if (!needFeet) return
    feetClock += dt
    if (feetClock < 1 / Math.max(BOT_AIM_REPORT_HZ, 10)) return
    feetClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch (err) { /* ignore */ }
  })
}
