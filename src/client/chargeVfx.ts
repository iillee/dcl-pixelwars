/**
 * chargeVfx.ts — a small team-colored ring at the feet while Lunge or Burst
 * is being held to charge. Scale grows over the hold; a brief pulse marks
 * a full charge. Parent of the player, no motion writes.
 */
import { engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'

let ring: Entity | null = null
let fullPulse = 0
let ringRgb = { r: 1, g: 1, b: 1 }

function rgbOf(team: Team): { r: number; g: number; b: number } {
  return TEAM_RGB[team] ?? { r: 1, g: 1, b: 1 }
}

export function showChargeHold(team: Team): void {
  hideChargeHold()
  const rgb = rgbOf(team)
  ringRgb = rgb
  const e = engine.addEntity()
  Transform.create(e, {
    parent: engine.PlayerEntity,
    position: Vector3.create(0, 0.08, 0),
    scale: Vector3.create(0.35, 0.05, 0.35),
  })
  MeshRenderer.setCylinder(e)
  Material.setPbrMaterial(e, {
    albedoColor: Color4.create(rgb.r, rgb.g, rgb.b, 0.7),
    emissiveColor: Color4.create(rgb.r, rgb.g, rgb.b, 1),
    emissiveIntensity: 2.2,
    roughness: 1,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
  ring = e
  fullPulse = 0
}

/** `u` is 0–1 through the hold. `full` starts the one-shot pulse. */
export function setChargeFrac(u: number, full: boolean): void {
  if (!ring || !Transform.has(ring)) return
  const t = Math.max(0, Math.min(1, u))
  let s = 0.35 + 0.95 * t
  if (full) {
    fullPulse = Math.min(1, fullPulse + 0.08)
    s += 0.2 * Math.sin(fullPulse * Math.PI)
  }
  const tr = Transform.getMutable(ring)
  tr.scale = Vector3.create(s, 0.05, s)
  if (full) {
    Material.setPbrMaterial(ring, {
      albedoColor: Color4.create(ringRgb.r, ringRgb.g, ringRgb.b, 0.7),
      emissiveColor: Color4.create(ringRgb.r, ringRgb.g, ringRgb.b, 1),
      emissiveIntensity: 3.4,
      roughness: 1,
      metallic: 0,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false,
    })
  }
}

export function hideChargeHold(): void {
  if (!ring) return
  engine.removeEntity(ring)
  ring = null
  fullPulse = 0
}
