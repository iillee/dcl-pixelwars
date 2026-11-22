/**
 * botBody.ts — runtime tint for the custom ghost body and arms.
 *
 * The body GLB (assets/models/bots/bot-custom-flat.glb) ships a neutral,
 * near-white albedo that keeps the mottling and shading. This module
 * overrides the BotBody, Arm_L, and Arm_R mesh materials with a matte PBR
 * whose albedoColor is the team (or theme) color and whose texture is that
 * neutral map. Final color ≈ albedoColor * texture.
 *
 * Paths are the mesh node names, not '' (which would tint every node on
 * the entity, including a later outline mesh). The face shell is a child
 * entity with its own GltfContainer, so these modifiers never touch it.
 * Animator clips on the same entity are unchanged.
 *
 * Official ghost-recover.glb (BOT_MODEL === 'ghost') is left alone; call
 * sites in botVisual skip this module in that mode.
 */
import {
  Entity, GltfNodeModifiers, Material, MaterialTransparencyMode,
} from '@dcl/sdk/ecs'
import { Color3, Color4 } from '@dcl/sdk/math'
import {
  BOT_BODY_PALETTE,
  DEFAULT_BOT_BODY_THEME,
  botBodySwatchForTeam,
  hexToRgb01,
  type Rgb01,
} from '../shared/team'

/** Neutral body albedo packed in the custom GLB and referenced at runtime. */
export const BOT_BODY_ALBEDO_SRC = 'assets/images/bots/body-neutral.png'
/** Normal map, reapplied so the material override does not drop it. */
export const BOT_BODY_NORMAL_SRC = 'assets/images/bots/body-normal.png'

/**
 * Mesh node paths on bot-custom-flat.glb (siblings under Armature).
 * Confirmed against the SDK7 docs: path must be a mesh node, not a vertex
 * node; several modifiers may target different nodes on one component.
 * https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/materials
 */
export const BOT_BODY_MESH_PATHS = ['BotBody', 'Arm_L', 'Arm_R'] as const
/** Outline meshes (BotBodyOutline, Arm_L_Outline, Arm_R_Outline) keep their
 *  own unlit navy material and must not be included here. */

export type BotBodyColor = Color3 | Color4 | Rgb01 | string

let currentTheme = DEFAULT_BOT_BODY_THEME
const themeListeners: Array<(theme: string) => void> = []

export function getBotBodyTheme(): string {
  return currentTheme
}

/**
 * Switch the active theme (a key of BOT_BODY_PALETTE). Missing swatches
 * fall back to the default theme. Live bots are recolored by listeners
 * registered in botVisual.
 */
export function setBotBodyTheme(theme: string): void {
  const next = theme in BOT_BODY_PALETTE ? theme : DEFAULT_BOT_BODY_THEME
  if (next === currentTheme) return
  currentTheme = next
  for (const fn of themeListeners) fn(currentTheme)
}

export function onBotBodyThemeChange(fn: (theme: string) => void): () => void {
  themeListeners.push(fn)
  return () => {
    const i = themeListeners.indexOf(fn)
    if (i >= 0) themeListeners.splice(i, 1)
  }
}

export function parseBotBodyColor(color: BotBodyColor): Color3 {
  if (typeof color === 'string') {
    const c = hexToRgb01(color)
    return Color3.create(c.r, c.g, c.b)
  }
  return Color3.create(color.r, color.g, color.b)
}

function bodyMaterial(color: Color3) {
  const tex = Material.Texture.Common({ src: BOT_BODY_ALBEDO_SRC })
  const bump = Material.Texture.Common({ src: BOT_BODY_NORMAL_SRC })
  return {
    texture: tex,
    bumpTexture: bump,
    albedoColor: Color4.create(color.r, color.g, color.b, 1),
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
  }
}

/** Override the body and arm materials with a matte tint. Accepts Color3, 0..1 RGB, or #RRGGBB. */
export function setBotBodyColor(entity: Entity, color: BotBodyColor): void {
  const c = parseBotBodyColor(color)
  const pbr = bodyMaterial(c)
  GltfNodeModifiers.createOrReplace(entity, {
    modifiers: BOT_BODY_MESH_PATHS.map(path => ({
      path,
      material: {
        material: {
          $case: 'pbr' as const,
          pbr,
        },
      },
    })),
  })
}

export function clearBotBodyColor(entity: Entity): void {
  GltfNodeModifiers.deleteFrom(entity)
}

/** Apply the palette color for a team. */
export function applyBotBodyForTeam(entity: Entity, team: number): void {
  setBotBodyColor(entity, botBodySwatchForTeam(team, { theme: currentTheme }))
}
