/**
 * team.ts — shared Team enum and bot body color palette.
 *
 * Referenced by both client (paint colors, HUD, local team state, ghost
 * body tint) and server (roster assignment, paint state). Wire values
 * are stable:
 *   0 = None (unassigned / guest)
 *   1 = Red
 *   2 = Blue
 * These MUST match the integer values sent on the `teamAssigned` and
 * `paintDelta`/`snapshot` messages in shared/messages.ts.
 *
 * Body tints live here so a new team or a dark-mode theme is just a
 * palette entry. The client applies them with GltfNodeModifiers; this
 * file stays free of ECS so the server can import it safely.
 */
export enum Team {
  None = 0,
  Red  = 1,
  Blue = 2,
}

export type Rgb01 = { r: number; g: number; b: number }

/** Team palette as 0..1 RGB (pallet.jpeg: red #FF7577, blue #6A99FC).
 *  Plain numbers so the server runtime can import this file safely. */
export const TEAM_RGB: Record<number, Rgb01> = {
  1: { r: 255 / 255, g: 117 / 255, b: 119 / 255 },
  2: { r: 106 / 255, g: 153 / 255, b: 252 / 255 },
}

/** Same values as TEAM_RGB, as #RRGGBB. */
export const TEAM_HEX: Record<number, string> = {
  1: '#FF7577',
  2: '#6A99FC',
}

export const DEFAULT_BOT_BODY_THEME = 'default'

/**
 * Body color swatches by theme. Add a team or a dark-mode theme by adding
 * keys here, then call setBotBodyTheme('dark') (or setBotBodyColor with a
 * one-off hex).
 *
 * `balloon` is the Balloon Battle (FFA) body color — same as blue, matching
 * the existing neutral-light rule. `green` is an example extra swatch, not
 * a live Team enum value.
 */
export const BOT_BODY_PALETTE: Record<string, Record<string, string>> = {
  default: {
    red: '#FF7577',
    blue: '#6A99FC',
    balloon: '#6A99FC',
    green: '#4FD68C',
  },
}

/** Parse #RGB or #RRGGBB (with or without '#'). Falls back to team blue. */
export function hexToRgb01(hex: string): Rgb01 {
  const raw = hex.trim().replace(/^#/, '')
  const h = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { ...TEAM_RGB[Team.Blue] }
  const n = parseInt(h, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export function rgb01ToHex(c: Rgb01): string {
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0').toUpperCase()
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`
}

/** Look up a named swatch in a theme, falling back to the default theme, then blue. */
export function botBodySwatch(name: string, theme = DEFAULT_BOT_BODY_THEME): string {
  const pal = BOT_BODY_PALETTE[theme]
  const fallback = BOT_BODY_PALETTE[DEFAULT_BOT_BODY_THEME]
  return pal?.[name] ?? fallback?.[name] ?? fallback.blue
}

/** Team body color for the current (or given) theme. Balloon Battle passes balloonNeutral. */
export function botBodySwatchForTeam(
  team: number,
  opts?: { theme?: string; balloonNeutral?: boolean },
): string {
  const theme = opts?.theme ?? DEFAULT_BOT_BODY_THEME
  if (opts?.balloonNeutral) return botBodySwatch('balloon', theme)
  if (team === Team.Red) return botBodySwatch('red', theme)
  if (team === Team.Blue) return botBodySwatch('blue', theme)
  return botBodySwatch('blue', theme)
}
