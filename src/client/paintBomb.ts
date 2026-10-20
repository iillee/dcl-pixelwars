/**
 * paintBomb.ts — Paint Bomb PvP prototype, client side (EXPERIMENT, not V1).
 *
 * Starting point: flagtag's bomb (src/systems/bombSystem.ts). Kept: the
 * blinking Bomb_01 / Bomb_red model pair (toggled by child scale, both
 * preloaded in a small pool so the 0.4 s fuse never waits on a GLB load),
 * fuse.mp3 during the fuse, bomb_exploding.mp3 at the blast, the fireball
 * + shockwave + debris explosion, and the victim-side
 * Physics.applyKnockbackToPlayer(blast, 40, 6, LINEAR). Dropped: flagtag's
 * stun / getHit emote / InputModifier lock and its 5 s fuse.
 *
 * Flow (shared/pvp.ts for the numbers, design/pvp-prototype.md for why):
 *   1. F (IA_SECONDARY) or the PAINT BOMB slot → bombDrop at our feet. We
 *      show the telegraph at once (predicted) so the short fuse reads.
 *   2. Server checks round/team/cooldown, snaps to the floor and
 *      broadcasts bombArmed → everyone else shows the telegraph.
 *   3. After BOMB_FUSE_S the server paints the circle (normal paintDelta)
 *      and broadcasts bombBlast → everyone shows the explosion; opponents
 *      of the bomber's team inside the radius push themselves.
 * The bomber and teammates are never knocked back.
 */

import {
  engine, Entity, GltfContainer, InputAction, Material, MaterialTransparencyMode, MeshRenderer,
  PointerEventType, Transform, AudioSource, inputSystem, Physics, KnockbackFalloff,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { Team, TEAM_RGB } from '../shared/team'
import { getRoundIndex } from '../shared/roundTiming'
import {
  BOMB_MODE, BOMB_FUSE_S, BOMB_COOLDOWN_S, BOMB_PAINT_RADIUS, BOMB_KNOCKBACK_RADIUS,
  BOMB_KNOCKBACK, BOMB_KNOCKBACK_LIFT, bombEnabledForRound,
} from '../shared/pvp'
import { playDashHitSfx } from './audio'
import { sendBombDrop } from './clientHandler'
import { localTeam, isKnockbackImmune, myAddress, safePhysics, initKnockbackState } from './knockback'

const BOMB_MODEL_SRC = 'assets/models/bomb/Bomb_01.glb'
const BOMB_RED_MODEL_SRC = 'assets/models/bomb/Bomb_red.glb'
const FUSE_SRC = 'assets/sounds/fuse.mp3'
const EXPLODE_SRC = 'assets/sounds/bomb_exploding.mp3'

const BOMB_SCALE = 2           // flagtag BOMB_SCALE
const BLINK_S = 0.08           // flagtag accelerates 800 → 100 ms over 5 s; our fuse is all "end"
const POOL_SIZE = 4
const HIDDEN_POS = Vector3.create(0, -200, 0)
/** Telegraph gives up if no bombBlast arrives (server rejected / lost). */
const TELEGRAPH_TIMEOUT_S = BOMB_FUSE_S + 1.5
const EXPLOSION_S = 0.6        // flagtag EXPLOSION_DURATION_MS
const EXPLODE_SOUND_S = 1.2

const FIRE_ALBEDO = Color4.create(1, 0.7, 0.15, 0.9)
const FIRE_EMISSIVE = Color4.create(1, 0.65, 0.1, 1)

let cooldownLeft = 0

// ── Bomb model pool (flagtag pattern) ───────────────────────────────
type PooledBomb = { root: Entity; normal: Entity; red: Entity; busy: boolean }
const pool: PooledBomb[] = []

function initPool(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    const root = engine.addEntity()
    // Tiny (not zero) scale so the explorer still loads the GLBs.
    Transform.create(root, { position: HIDDEN_POS, scale: Vector3.create(0.001, 0.001, 0.001) })
    const normal = engine.addEntity()
    Transform.create(normal, { parent: root })
    GltfContainer.create(normal, { src: BOMB_MODEL_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    const red = engine.addEntity()
    Transform.create(red, { parent: root, scale: Vector3.Zero() })
    GltfContainer.create(red, { src: BOMB_RED_MODEL_SRC, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    pool.push({ root, normal, red, busy: false })
  }
}

function setBlink(b: PooledBomb, red: boolean): void {
  Transform.getMutable(b.normal).scale = red ? Vector3.Zero() : Vector3.One()
  Transform.getMutable(b.red).scale = red ? Vector3.One() : Vector3.Zero()
}

function releaseBomb(b: PooledBomb): void {
  b.busy = false
  const t = Transform.getMutable(b.root)
  t.position = HIDDEN_POS
  t.scale = Vector3.create(0.001, 0.001, 0.001)
  setBlink(b, false)
}

// ── Telegraphs (one per bomber) ─────────────────────────────────────
type Telegraph = {
  attacker: string
  bomb: PooledBomb | null
  fuse: Entity
  pos: Vector3
  t: number
  blinkT: number
  blinkRed: boolean
}
const telegraphs = new Map<string, Telegraph>()

function teamColor(team: Team, a: number): Color4 {
  const c = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  return Color4.create(c.r, c.g, c.b, a)
}

function startTelegraph(attacker: string, team: Team, pos: Vector3): void {
  const existing = telegraphs.get(attacker)
  if (existing) {
    // Our own predicted telegraph: adopt the server's floor-snapped spot.
    moveTelegraph(existing, pos)
    return
  }
  const bomb = pool.find(b => !b.busy) ?? null
  if (bomb) {
    bomb.busy = true
    const t = Transform.getMutable(bomb.root)
    t.position = Vector3.create(pos.x, pos.y, pos.z)
    t.scale = Vector3.create(BOMB_SCALE, BOMB_SCALE, BOMB_SCALE)
    setBlink(bomb, false)
  }
  // No growing blast-area ring (Luke: read as a 'loading circle'). The
  // telegraph is the blinking bomb GLB + fuse.mp3; the blast FX shows the area.
  const fuse = engine.addEntity()
  Transform.create(fuse, { position: Vector3.create(pos.x, pos.y + 0.5, pos.z) })
  AudioSource.create(fuse, { audioClipUrl: FUSE_SRC, playing: true, loop: false, volume: 0.6, global: false })
  telegraphs.set(attacker, { attacker, bomb, fuse, pos: Vector3.clone(pos), t: 0, blinkT: 0, blinkRed: false })
}

function moveTelegraph(g: Telegraph, pos: Vector3): void {
  g.pos = Vector3.clone(pos)
  if (g.bomb) Transform.getMutable(g.bomb.root).position = Vector3.create(pos.x, pos.y, pos.z)
  Transform.getMutable(g.fuse).position = Vector3.create(pos.x, pos.y + 0.5, pos.z)
}

function endTelegraph(attacker: string): void {
  const g = telegraphs.get(attacker)
  if (!g) return
  telegraphs.delete(attacker)
  if (g.bomb) releaseBomb(g.bomb)
  engine.removeEntity(g.fuse)
}

// ── Explosion FX (flagtag showExplosionVFX, per-frame instead of Tween) ──
type Fx = { ent: Entity; t: number; life: number; step: (ent: Entity, u: number) => void }
const fx: Fx[] = []

function addFx(life: number, setup: (ent: Entity) => void, step: Fx['step']): void {
  const ent = engine.addEntity()
  setup(ent)
  fx.push({ ent, t: 0, life, step })
}

function glow(ent: Entity, albedo: Color4, emissive: Color4, intensity: number): void {
  Material.setPbrMaterial(ent, {
    albedoColor: albedo, emissiveColor: emissive, emissiveIntensity: intensity,
    roughness: 1, metallic: 0, specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
}

function easeOutExpo(u: number): number { return u >= 1 ? 1 : 1 - Math.pow(2, -10 * u) }
function easeOutQuad(u: number): number { return 1 - (1 - u) * (1 - u) }

function showExplosion(pos: Vector3, team: Team): void {
  // Central fireball: 0.3 → 4 m in the first half, back to 0 in the second.
  addFx(EXPLOSION_S, e => {
    Transform.create(e, { position: Vector3.create(pos.x, pos.y + 0.5, pos.z), scale: Vector3.create(0.3, 0.3, 0.3) })
    MeshRenderer.setSphere(e)
    glow(e, FIRE_ALBEDO, FIRE_EMISSIVE, 8)
  }, (e, u) => {
    const s = u < 0.5 ? 0.3 + 3.7 * easeOutExpo(u / 0.5) : 4 * (1 - ((u - 0.5) / 0.5) ** 2)
    Transform.getMutable(e).scale = Vector3.create(s, s, s)
  })
  // Shockwave ring in team colour, out to the painted circle.
  const ringEnd = BOMB_PAINT_RADIUS * 2
  addFx(EXPLOSION_S, e => {
    Transform.create(e, { position: Vector3.create(pos.x, pos.y + 0.2, pos.z), scale: Vector3.create(0.5, 0.05, 0.5) })
    MeshRenderer.setSphere(e)
    glow(e, teamColor(team, 0.6), teamColor(team, 1), 4)
  }, (e, u) => {
    const s = u < 0.6 ? 0.5 + (ringEnd - 0.5) * easeOutQuad(u / 0.6) : ringEnd * (1 - ((u - 0.6) / 0.4) ** 2)
    Transform.getMutable(e).scale = Vector3.create(s, 0.03, s)
  })
  // Six debris fragments flying outward, alternating fire / team colour.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5
    const dist = 1.5 + Math.random() * 2.5
    const from = Vector3.create(pos.x, pos.y + 0.5, pos.z)
    const to = Vector3.create(pos.x + Math.cos(angle) * dist, pos.y + 1 + Math.random() * 3, pos.z + Math.sin(angle) * dist)
    const size = 0.15 + Math.random() * 0.25
    addFx(EXPLOSION_S, e => {
      Transform.create(e, { position: from, scale: Vector3.create(size, size, size) })
      MeshRenderer.setSphere(e)
      if (i % 2 === 0) glow(e, FIRE_ALBEDO, FIRE_EMISSIVE, 3)
      else glow(e, teamColor(team, 0.9), teamColor(team, 1), 3)
    }, (e, u) => {
      const tr = Transform.getMutable(e)
      if (u < 0.5) tr.position = Vector3.lerp(from, to, easeOutQuad(u / 0.5))
      const s = u < 0.5 ? size : size * (1 - (u - 0.5) / 0.5)
      tr.scale = Vector3.create(s, s, s)
    })
  }
  addFx(EXPLODE_SOUND_S, e => {
    Transform.create(e, { position: Vector3.create(pos.x, pos.y + 0.5, pos.z) })
    AudioSource.create(e, { audioClipUrl: EXPLODE_SRC, playing: true, loop: false, volume: 1, global: false })
  }, () => {})
}

// ── Gameplay ────────────────────────────────────────────────────────
export function isBombEnabledNow(): boolean {
  return bombEnabledForRound(getRoundIndex())
}

/** HUD state for client/abilityHotbar.tsx. cooldownFrac: 1 = just used, 0 = ready. */
export function getBombHud(): { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number } {
  const enabled = isBombEnabledNow()
  const cd = Math.max(0, cooldownLeft)
  return {
    show: BOMB_MODE !== 'off',
    enabled,
    ready: enabled && localTeam() !== Team.None && cd <= 0,
    cooldown: cd,
    cooldownFrac: cd / BOMB_COOLDOWN_S,
  }
}

/** Drop a Paint Bomb at our feet if allowed. Bound to F and the PAINT BOMB slot/tooltip. */
export function triggerBomb(): void {
  const team = localTeam()
  if (!isBombEnabledNow() || team === Team.None || cooldownLeft > 0) return
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return
  cooldownLeft = BOMB_COOLDOWN_S
  const p = t.position
  const me = myAddress()
  if (me) startTelegraph(me, team, p)
  sendBombDrop(p.x, p.y, p.z)
}

function onBlast(attacker: string, team: Team, pos: Vector3, cells: number): void {
  endTelegraph(attacker.toLowerCase())
  showExplosion(pos, team)

  const mine = localTeam()
  if (mine === Team.None || mine === team) return
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const d = Vector3.distance(me, pos)
  if (d >= BOMB_KNOCKBACK_RADIUS) return
  if (isKnockbackImmune()) {
    console.log('[Bomb] in blast but respawn-immune')
    return
  }
  safePhysics('bomb knockback', () => {
    Physics.applyKnockbackToPlayer(pos, BOMB_KNOCKBACK, BOMB_KNOCKBACK_RADIUS, KnockbackFalloff.LINEAR)
    if (BOMB_KNOCKBACK_LIFT > 0) {
      Physics.applyImpulseToPlayer(Vector3.create(0, BOMB_KNOCKBACK_LIFT * (1 - d / BOMB_KNOCKBACK_RADIUS), 0))
    }
  })
  playDashHitSfx()
  console.log(`[Bomb] knocked back by ${attacker.slice(0, 8)} (d=${d.toFixed(1)} m, ${cells} cells painted)`)
}

export function initPaintBomb(): void {
  if (BOMB_MODE === 'off') return
  initKnockbackState()
  initPool()

  events.on('bomb:armed', ({ attacker, team, x, y, z }) => {
    startTelegraph(attacker.toLowerCase(), team, Vector3.create(x, y, z))
  })
  events.on('bomb:blast', ({ attacker, team, x, y, z, cells }) => {
    onBlast(attacker, team, Vector3.create(x, y, z), cells)
  })
  events.on('round:reset', () => {
    for (const a of Array.from(telegraphs.keys())) endTelegraph(a)
  })

  engine.addSystem((dt: number) => {
    if (cooldownLeft > 0) cooldownLeft -= dt
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) triggerBomb()

    for (const g of Array.from(telegraphs.values())) {
      g.t += dt
      if (g.t >= TELEGRAPH_TIMEOUT_S) { endTelegraph(g.attacker); continue }
      g.blinkT += dt
      if (g.bomb && g.blinkT >= BLINK_S) {
        g.blinkT = 0
        g.blinkRed = !g.blinkRed
        setBlink(g.bomb, g.blinkRed)
      }
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]
      f.t += dt
      if (f.t >= f.life) {
        engine.removeEntity(f.ent)
        fx.splice(i, 1)
        continue
      }
      f.step(f.ent, f.t / f.life)
    }
  })
}
