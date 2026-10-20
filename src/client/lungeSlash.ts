/**
 * lungeSlash.ts — slash VFX that shows the Lunge hit area.
 *
 * A flat, horizontal crescent (assets/images/lunge_slash.png: white alpha
 * half-ring, tinted with the attacker's team colour, emissive) lying at
 * LUNGE_SLASH_HEIGHT above the attacker's feet. The plane is
 * LUNGE_SLASH_WIDTH wide (= LUNGE_HITBOX_W) and half as deep, centred
 * LUNGE_SLASH_FORWARD ahead, so the arc's outer edge sits on the hitbox's
 * far face (LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D). It follows the attacker for the
 * active window, then shrinks + fades over LUNGE_SLASH_FADE_S. A hit flashes
 * it brighter/whiter (jumping straight to full size if it lands during the intro).
 * Intro (LUNGE_SLASH_INTRO): grows from a right-hand fist point and/or fades
 * in over LUNGE_SLASH_GROW_S — visual only, the hitbox is live from frame 0. Remote lunges (lungeStarted broadcast) get the same
 * slash following that avatar. Pool of LUNGE_SLASH_POOL entities, reused.
 */
import { engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  LUNGE_SLASH, LUNGE_SLASH_WIDTH, LUNGE_SLASH_HEIGHT, LUNGE_SLASH_FORWARD, LUNGE_SLASH_FADE_S,
  LUNGE_SLASH_ALPHA, LUNGE_SLASH_FLIP, LUNGE_ACTIVE_S,
  LUNGE_SLASH_INTRO, LUNGE_SLASH_GROW_S, LUNGE_SLASH_START_SCALE, LUNGE_SLASH_FIST_OFFSET,
} from '../shared/pvp'

const TEX = 'assets/images/lunge_slash.png'
const POOL = 4
const HIDDEN = Vector3.create(8, -50, 8)

type Slash = {
  ent: Entity
  who: string // '' = local player
  dx: number; dz: number
  rgb: { r: number; g: number; b: number }
  t: number
  flash: number // 0..1 hit flash, decays
  live: boolean
  introDone: boolean
  alpha: number // last alpha written (skip redundant material writes)
  lastPos: Vector3 | null
}
const pool: Slash[] = []
let next = 0
let getPos: (who: string) => Vector3 | null = () => null
let frameLocal: Vector3 | null = null // this frame's local PlayerEntity position (lunge.ts)

function setMat(s: Slash, alpha: number): void {
  const f = s.flash
  const r = s.rgb.r + (1 - s.rgb.r) * f, g = s.rgb.g + (1 - s.rgb.g) * f, b = s.rgb.b + (1 - s.rgb.b) * f
  Material.setPbrMaterial(s.ent, {
    texture: Material.Texture.Common({ src: TEX }),
    emissiveTexture: Material.Texture.Common({ src: TEX }),
    albedoColor: Color4.create(r, g, b, alpha),
    emissiveColor: Color4.create(r, g, b, 1),
    emissiveIntensity: 2.5 + 4 * f,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

/** Start a slash for `who` ('' = us) along unit (dx, dz). */
export function startSlash(who: string, dx: number, dz: number, team: Team): void {
  if (!LUNGE_SLASH || pool.length === 0) return
  // Reuse this avatar's slash if one is live, else the next pool slot.
  let s = pool.find(p => p.live && p.who === who)
  if (!s) { s = pool[next % POOL]; next++ }
  s.who = who; s.dx = dx; s.dz = dz
  s.rgb = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  s.t = 0; s.flash = 0; s.live = true; s.lastPos = null; s.introDone = false
  s.alpha = -1
  intro(s)
}

/** Hit: flash `who`'s live slash brighter. */
export function flashSlash(who: string): void {
  const s = pool.find(p => p.live && p.who === who)
  if (!s) return
  s.flash = 1
  s.introDone = true // hit during the grow-in: jump to full
  if (s.t <= LUNGE_ACTIVE_S) { setMat(s, LUNGE_SLASH_ALPHA); place(s, 1, 1) }
}

const GROW = LUNGE_SLASH_INTRO !== 'fade'
const FADE = LUNGE_SLASH_INTRO !== 'grow'

/** Intro step: ease-out from the fist point / small / transparent to the normal slash. */
function intro(s: Slash): void {
  const u = s.introDone ? 1 : Math.min(1, s.t / Math.max(1e-3, LUNGE_SLASH_GROW_S))
  if (u >= 1) s.introDone = true
  const e = 1 - (1 - u) * (1 - u) // ease-out quad
  const a = FADE ? LUNGE_SLASH_ALPHA * e : LUNGE_SLASH_ALPHA
  if (Math.abs(a - s.alpha) > 0.02 || u >= 1) { setMat(s, a); s.alpha = a }
  place(s, GROW ? LUNGE_SLASH_START_SCALE + (1 - LUNGE_SLASH_START_SCALE) * e : 1, GROW ? e : 1)
}

/** k = scale factor; m = 0 at the fist point → 1 at the normal slash position. */
function place(s: Slash, k: number, m = 1): void {
  const p = (s.who === '' ? frameLocal : null) ?? getPos(s.who) ?? s.lastPos
  const tr = Transform.getMutable(s.ent)
  if (!p) { tr.position = HIDDEN; return }
  s.lastPos = Vector3.create(p.x, p.y, p.z) // copy, not the live Transform object
  const yaw = Math.atan2(s.dx, s.dz) * 180 / Math.PI + (LUNGE_SLASH_FLIP ? 180 : 0)
  // Right of facing (dx, dz) is (dz, -dx).
  const f = LUNGE_SLASH_FIST_OFFSET
  const fist = { x: f.z * s.dx + f.x * s.dz, y: f.y, z: f.z * s.dz - f.x * s.dx }
  const norm = { x: s.dx * LUNGE_SLASH_FORWARD, y: LUNGE_SLASH_HEIGHT, z: s.dz * LUNGE_SLASH_FORWARD }
  tr.position = Vector3.create(
    p.x + fist.x + (norm.x - fist.x) * m,
    p.y + fist.y + (norm.y - fist.y) * m,
    p.z + fist.z + (norm.z - fist.z) * m)
  // Plane lies flat (X 90°, texture top → forward), then yaws to the lunge direction.
  tr.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(90, 0, 0))
  tr.scale = Vector3.create(LUNGE_SLASH_WIDTH * k, LUNGE_SLASH_WIDTH / 2 * k, 1)
}

export function initLungeSlash(positionOf: (who: string) => Vector3 | null): void {
  if (!LUNGE_SLASH) return
  getPos = positionOf
  for (let i = 0; i < POOL; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN, scale: Vector3.Zero() })
    MeshRenderer.setPlane(ent)
    pool.push({ ent, who: '', dx: 0, dz: 1, rgb: { r: 1, g: 1, b: 1 }, t: 0, flash: 0, live: false, introDone: false, alpha: -1, lastPos: null })
  }
}

/** Per-frame update, called from lunge.ts's system right where the hitbox box is
 *  placed, so the local slash uses the exact same PlayerEntity position that frame
 *  (`localPos`); remote slashes read that avatar's Transform here. */
export function tickSlash(dt: number, localPos: Vector3 | null): void {
  if (!LUNGE_SLASH) return
  frameLocal = localPos
  {
    for (const s of pool) {
      if (!s.live) continue
      s.t += dt
      if (s.t <= LUNGE_ACTIVE_S) { if (s.introDone) place(s, 1); else intro(s); continue }
      const f = (s.t - LUNGE_ACTIVE_S) / LUNGE_SLASH_FADE_S
      if (f >= 1) {
        s.live = false
        const tr = Transform.getMutable(s.ent)
        tr.position = HIDDEN; tr.scale = Vector3.Zero()
        continue
      }
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 6)
      setMat(s, LUNGE_SLASH_ALPHA * (1 - f))
      place(s, 1 - 0.35 * f)
    }
  }
}
