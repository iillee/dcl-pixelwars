/**
 * lungeHitbox.ts — visible Lunge hit volume.
 *
 * Two modes, same mesh (emissive, no collider), geometry from shared/lunge.ts
 * hitboxAt() — the same function boxHit() uses. The local box is placed by
 * lunge.ts with the position it just hit-tested that frame.
 *   - LUNGE_HITBOX_FLASH_S > 0: short press telegraph. Fades out. On in play.
 *   - LUNGE_HITBOX_VISIBLE: stays up for the active window + grace (debug).
 * LUNGE_HITBOX_PARENT = true makes the local box a child of engine.PlayerEntity
 * instead (local offset recomputed each frame) in case the world Transform
 * trails the rendered avatar in the Explorer. Remote lunges get the same box.
 * A hit flashes it brighter while it is still up.
 */
import { engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  LUNGE_HITBOX_VISIBLE, LUNGE_HITBOX_ALPHA, LUNGE_HITBOX_PARENT, LUNGE_ACTIVE_S, LUNGE_HIT_GRACE_S,
  LUNGE_HITBOX_FLASH_S, LUNGE_HITBOX_FLASH_ALPHA,
} from '../shared/pvp'
import { hitboxAt, V3 } from '../shared/lunge'

const hitboxOn = () => LUNGE_HITBOX_VISIBLE || LUNGE_HITBOX_FLASH_S > 0

type Box = {
  ent: Entity; dx: number; dz: number; rgb: { r: number; g: number; b: number }
  left: number; dur: number; fade: boolean; flash: number; matFlash: number
}
const boxes = new Map<string, Box>() // '' = local player
let getPos: (who: string) => V3 | null = () => null

function setMat(b: Box): void {
  const f = b.flash
  b.matFlash = f
  const life = b.fade ? Math.max(0, b.left / Math.max(1e-3, b.dur)) : 1
  const r = b.rgb.r + (1 - b.rgb.r) * f * 0.6, g = b.rgb.g + (1 - b.rgb.g) * f * 0.6, bl = b.rgb.b + (1 - b.rgb.b) * f * 0.6
  const base = b.fade ? LUNGE_HITBOX_FLASH_ALPHA * life : LUNGE_HITBOX_ALPHA
  Material.setPbrMaterial(b.ent, {
    albedoColor: Color4.create(r, g, bl, Math.min(0.85, base + 0.35 * f)),
    emissiveColor: Color4.create(r, g, bl, 1),
    emissiveIntensity: (b.fade ? 3.2 : 1.5) + 4 * f,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
}

/** Place `who`'s box for an attacker standing at `a` (feet). */
export function placeHitbox(who: string, a: V3): void {
  const b = boxes.get(who)
  if (!b) return
  const hb = hitboxAt(a, b.dx, b.dz)
  const rot = Quaternion.fromEulerDegrees(0, hb.yaw * 180 / Math.PI, 0)
  const scale = Vector3.create(hb.w, hb.h, hb.d)
  const p = who === '' && LUNGE_HITBOX_PARENT ? Transform.getOrNull(engine.PlayerEntity) : null
  if (p) {
    // Child of the player: express the same world box in the player's local frame.
    const inv = Quaternion.create(-p.rotation.x, -p.rotation.y, -p.rotation.z, p.rotation.w)
    const off = Vector3.create(hb.c.x - a.x, hb.c.y - a.y, hb.c.z - a.z)
    Transform.createOrReplace(b.ent, {
      parent: engine.PlayerEntity,
      position: Vector3.rotate(off, inv),
      rotation: Quaternion.multiply(inv, rot),
      scale,
    })
    return
  }
  const tr = Transform.getMutable(b.ent)
  tr.position = Vector3.create(hb.c.x, hb.c.y, hb.c.z)
  tr.rotation = rot
  tr.scale = scale
}

export function startHitbox(who: string, dx: number, dz: number, team: Team): void {
  if (!hitboxOn()) return
  let b = boxes.get(who)
  if (!b) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: Vector3.create(8, -50, 8), scale: Vector3.Zero() })
    b = { ent, dx, dz, rgb: { r: 1, g: 1, b: 1 }, left: 0, dur: 0, fade: false, flash: 0, matFlash: -1 }
    boxes.set(who, b)
  }
  b.dx = dx; b.dz = dz
  b.rgb = TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
  // Debug box wins when both are on: it already covers the press.
  b.fade = !LUNGE_HITBOX_VISIBLE && LUNGE_HITBOX_FLASH_S > 0
  b.dur = b.fade ? LUNGE_HITBOX_FLASH_S : LUNGE_ACTIVE_S + LUNGE_HIT_GRACE_S
  b.left = b.dur
  b.flash = 0
  MeshRenderer.setBox(b.ent) // no MeshCollider: purely visual
  setMat(b)
  const a = getPos(who)
  if (a) placeHitbox(who, a)
}

export function flashHitbox(who: string): void {
  const b = boxes.get(who)
  if (b && b.left > 0) b.flash = 1
}

function hide(who: string, b: Box): void {
  if (MeshRenderer.has(b.ent)) MeshRenderer.deleteFrom(b.ent)
  engine.removeEntity(b.ent)
  boxes.delete(who)
}

export function initLungeHitbox(positionOf: (who: string) => V3 | null): void {
  if (!hitboxOn()) return
  getPos = positionOf
  engine.addSystem((dt: number) => {
    for (const [who, b] of boxes) {
      b.left -= dt
      if (b.left <= 0) { hide(who, b); continue }
      if (who !== '') { const a = getPos(who); if (a) placeHitbox(who, a) } // local: lunge.ts places it
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 6)
      // Fade mode rewrites alpha every frame; the debug box only when the hit flash moves.
      if (b.fade || Math.abs(b.flash - b.matFlash) > 0.05 || (b.flash === 0 && b.matFlash !== 0)) setMat(b)
    }
  })
}
