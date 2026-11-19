/**
 * overdrive.ts — client mirror of server star power: HUD, glow, knock, and feet.
 * The server owns charge, activation, touch knocks, and immunity.
 */
import { engine, Entity, Transform, AvatarAttach, Material, MaterialTransparencyMode, MeshRenderer, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import { OVERDRIVE_TILES, OVERDRIVE_MS, BOT_AIM_REPORT_HZ } from '../shared/pvp'
import { overdriveKnock } from '../shared/knocks'
import { TEAM_RGB, isPlayingTeam } from '../shared/team'
import { playDashSfx, playDashHitSfx } from './audio'
import { applyKnock, isKnockbackImmune, myAddress, localTeam, setOverdriveImmuneCheck } from './knockback'
import { playBotKnock } from './botVisual'

const AAPT_POSITION = 0
const GLOW_Y = 0.95
const GLOW_SCALE = 1.85

let charge = 0
let ready = 0
let active = 0
let until = 0
type GlowRec = { attach: Entity; ball: Entity; until: number }
const auras = new Map<string, number>()
const glows = new Map<string, GlowRec>()
let knockForceEnt: Entity | null = null
let wired = false
let feetClock = 0

export function isLocalOverdriveActive() {
  return active === 1 && until > Date.now()
}

export function requestOverdrive() {
  if (ready !== 1 || isLocalOverdriveActive()) return
  try { room.send('overdriveUse', {}) } catch (err) { console.log('[Overdrive] use send failed', err) }
}

export function getOverdriveHud() {
  const now = Date.now()
  const live = active === 1 && until > now
  const isReady = !live && ready === 1
  const team = localTeam()
  const rgb = isPlayingTeam(team) ? TEAM_RGB[team] : { r: 1, g: 1, b: 1 }
  const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now / 180))
  let fill = OVERDRIVE_TILES > 0 ? Math.max(0, Math.min(1, charge / OVERDRIVE_TILES)) : 0
  let text = charge + '/' + OVERDRIVE_TILES
  if (isReady) { fill = 1; text = 'READY' }
  if (live) {
    fill = Math.max(0, Math.min(1, (until - now) / OVERDRIVE_MS))
    text = Math.max(1, Math.ceil((until - now) / 1000)) + 's'
  }
  const fillColor = Color4.create(rgb.r, rgb.g, rgb.b, (isReady || live) ? pulse : 0.95)
  return {
    show: true,
    enabled: isPlayingTeam(team),
    ready: isReady,
    cooldown: live ? (until - now) / 1000 : 0,
    cooldownFrac: 1 - fill,
    text,
    recovering: false,
    fillColor,
    pulse: isReady || live,
  }
}

function findAvatar(id: string): { entity: Entity; avatarId: string | null } | null {
  const want = id.toLowerCase()
  const me = myAddress()
  if (me && want === me) return { entity: engine.PlayerEntity, avatarId: null }
  for (const [entity, pid] of engine.getEntitiesWith(PlayerIdentityData)) {
    if ((pid.address || '').toLowerCase() === want) return { entity, avatarId: pid.address }
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

function ensureGlow(id: string, endAt: number): void {
  let rec = glows.get(id)
  if (rec) { rec.until = endAt; return }
  const who = findAvatar(id)
  if (!who) return
  const attach = engine.addEntity()
  if (who.avatarId) AvatarAttach.create(attach, { avatarId: who.avatarId, anchorPointId: AAPT_POSITION })
  else AvatarAttach.create(attach, { anchorPointId: AAPT_POSITION })
  const ball = engine.addEntity()
  Transform.create(ball, { parent: attach, position: Vector3.create(0, GLOW_Y, 0), scale: Vector3.create(GLOW_SCALE, GLOW_SCALE, GLOW_SCALE) })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, glowMat(1))
  rec = { attach, ball, until: endAt }
  glows.set(id, rec)
}

function dropGlow(id: string): void {
  const rec = glows.get(id)
  if (!rec) return
  try { engine.removeEntity(rec.ball) } catch (err) { /* already gone */ }
  try { engine.removeEntity(rec.attach) } catch (err) { /* already gone */ }
  glows.delete(id)
}

function clearGlows() {
  for (const id of [...glows.keys()]) dropGlow(id)
  auras.clear()
}

function setLocal(next: { charge: number; ready: number; active: number; until: number }): void {
  charge = Math.max(0, Math.floor(next.charge || 0))
  ready = next.ready ? 1 : 0
  active = next.active ? 1 : 0
  until = typeof next.until === 'number' && isFinite(next.until) ? next.until : 0
}

export function initOverdrive() {
  if (wired) return
  wired = true
  knockForceEnt = engine.addEntity()
  setOverdriveImmuneCheck(() => isLocalOverdriveActive())
  events.on('overdrive:state', (s) => setLocal(s))
  events.on('overdrive:aura', ({ id, until: endAt }) => {
    const who = (id || '').toLowerCase()
    if (!who) return
    if (!endAt || endAt <= Date.now()) {
      auras.delete(who)
      dropGlow(who)
      if (who === myAddress()) setLocal({ charge, ready: 0, active: 0, until: 0 })
      return
    }
    auras.set(who, endAt)
    ensureGlow(who, endAt)
    if (who === myAddress()) {
      setLocal({ charge: 0, ready: 0, active: 1, until: endAt })
      playDashSfx()
    }
  })
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
    setLocal({ charge: 0, ready: 0, active: 0, until: 0 })
    clearGlows()
  })
  events.on('lobby:floor', () => {
    setLocal({ charge: 0, ready: 0, active: 0, until: 0 })
    clearGlows()
  })
  engine.addSystem((dt) => {
    const now = Date.now()
    const pulse = 0.5 + 0.5 * Math.sin(now / 180)
    for (const [id, rec] of glows) {
      if (rec.until <= now) { dropGlow(id); auras.delete(id); continue }
      const s = GLOW_SCALE * (0.92 + 0.12 * pulse)
      const t = Transform.getMutableOrNull(rec.ball)
      if (t) t.scale = Vector3.create(s, s, s)
      Material.setPbrMaterial(rec.ball, glowMat(pulse))
    }
    // While a star is live, send feet so the server can test touches even without ghosts.
    const needFeet = isLocalOverdriveActive() || auras.size > 0
    if (!needFeet) return
    feetClock += dt
    if (feetClock < 1 / Math.max(BOT_AIM_REPORT_HZ, 10)) return
    feetClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch (err) { /* ignore */ }
  })
}
