/**
 * lungeSlash.ts — slash VFX that shows the Lunge hit area.
 *
 * A flat, horizontal crescent (assets/images/lunge_slash.png: white alpha
 * half-ring, tinted with the attacker's team colour, emissive) lying at
 * LUNGE_SLASH_HEIGHT above the attacker's feet. The plane is
 * LUNGE_SLASH_WIDTH wide (= hitbox diameter, 2 × LUNGE_HIT_RADIUS) and half
 * as deep, centred LUNGE_SLASH_FORWARD ahead, so the arc's outer edge traces
 * the front of the 1.1 m hit capsule. It follows the attacker for the
 * active window, then shrinks + fades over LUNGE_SLASH_FADE_S. A hit flashes
 * it brighter/whiter. Remote lunges (lungeStarted broadcast) get the same
 * slash following that avatar. Pool of LUNGE_SLASH_POOL entities, reused.
 */
import { engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  LUNGE_SLASH, LUNGE_SLASH_WIDTH, LUNGE_SLASH_HEIGHT, LUNGE_SLASH_FORWARD, LUNGE_SLASH_FADE_S,
  LUNGE_SLASH_ALPHA, LUNGE_SLASH_FLIP, LUNGE_ACTIVE_S,
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
  lastPos: Vector3 | null
}
const pool: Slash[] = []
let next = 0
let getPos: (who: string) => Vector3 | null = () => null

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
  s.t = 0; s.flash = 0; s.live = true; s.lastPos = null
  setMat(s, LUNGE_SLASH_ALPHA)
  place(s, 1)
}

/** Hit: flash `who`'s live slash brighter. */
export function flashSlash(who: string): void {
  const s = pool.find(p => p.live && p.who === who)
  if (!s) return
  s.flash = 1
  setMat(s, LUNGE_SLASH_ALPHA)
}

function place(s: Slash, k: number): void {
  const p = getPos(s.who) ?? s.lastPos
  const tr = Transform.getMutable(s.ent)
  if (!p) { tr.position = HIDDEN; return }
  s.lastPos = p
  const yaw = Math.atan2(s.dx, s.dz) * 180 / Math.PI + (LUNGE_SLASH_FLIP ? 180 : 0)
  tr.position = Vector3.create(p.x + s.dx * LUNGE_SLASH_FORWARD, p.y + LUNGE_SLASH_HEIGHT, p.z + s.dz * LUNGE_SLASH_FORWARD)
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
    pool.push({ ent, who: '', dx: 0, dz: 1, rgb: { r: 1, g: 1, b: 1 }, t: 0, flash: 0, live: false, lastPos: null })
  }
  engine.addSystem((dt: number) => {
    for (const s of pool) {
      if (!s.live) continue
      s.t += dt
      if (s.t <= LUNGE_ACTIVE_S) { place(s, 1); continue }
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
  })
}
