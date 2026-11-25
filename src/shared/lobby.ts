/**
 * Lobby layout and team-choice rules. Pure. The generator places these cells;
 * the server decides a zone from a player's feet, only while those feet
 * are standing on the tile. No engine imports.
 *
 * The built floor is the four-arm cross through the lobby hub: RED west,
 * BLUE east, YELLOW north, and GREEN south. Standing on a team tile chooses that side for the next Classic
 * Pixelwars round. Jumping or gliding over a tile does not.
 * Alternate modes stay in the registry, unplaced, so their code remains
 * reachable later. Bot Invasion, Color Garden, and Pot Hunt stay parked too.
 */

import { TEAM_HEX, emptyTeamCounts as emptyTeamTally, isPlayingTeam, smallestTeam, addTeamCount, type TeamCounts as SharedTeamCounts } from './team'

export type ModeId = 'pvp' | 'pvb' | 'bases' | 'prototype' | 'balloon' | 'garden' | 'pots'
export type TeamId = 'red' | 'blue' | 'green' | 'yellow'
export type TeamChoice = 1 | 2 | 3 | 4
export type TeamRule = 'balance' | 'humans-together'
export type LobbyPhase = 'match' | 'summary' | 'lobby' | 'idle'

export type ModeDef = {
  id: ModeId
  label: string
  /** Arm end that counts as a vote for this mode. */
  cell: { x: number; z: number }
  teamRule: TeamRule
  /** Only a live mode can win a vote. */
  live: boolean
  /** Built as an end tile against the center. Garden and pots are not, yet. */
  placed: boolean
  /** Paint tank, and later depots / territory respawn. Prototype only. */
  economy: boolean
  color: { r: number; g: number; b: number }
}

export const LOBBY_CROSS = { x: 2, z: 2 }

/** Alternate-mode cells stay on file. The live floor uses LOBBY_TEAMS instead.
 *  Flip EAST_SLOT_MODE to `'pvb'` if Bot Invasion is ever put back on the east tile. */
export const EAST_LOBBY_CELL = { x: 3, z: 2 }
export const EAST_PARK_CELL = { x: 3, z: 0 }
export const EAST_SLOT_MODE: 'pvb' | 'bases' = 'bases'
const eastCell = (id: 'pvb' | 'bases') => EAST_SLOT_MODE === id ? EAST_LOBBY_CELL : EAST_PARK_CELL
const eastLive = (id: 'pvb' | 'bases') => EAST_SLOT_MODE === id

/** Parse #RRGGBB to 0–1 sRGB channels. Color4.fromHexString does the same /255; it does not convert to linear. */
export function rgbFromHex(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/** Billboard pill colours, used as unlit BasicMaterial so they render at the true hex.
 *  Classic and Base Charge are Luke's swatches. Paint Limit is a brighter, purer
 *  yellow so it does not read brown; Balloon Battle is a matching saturated green. */
export const MODE_PILL_HEX: Record<'pvp' | 'pvb' | 'bases' | 'prototype' | 'balloon', string> = {
  pvp: '#FF7577',
  pvb: '#6A99FC',
  bases: '#6A99FC',
  prototype: '#FFE04A',
  balloon: '#4FD68C',
}

/** Title and subtitle ink. White on every sign, including Paint Limit. */
export const MODE_PILL_TEXT_HEX: Record<'pvp' | 'pvb' | 'bases' | 'prototype' | 'balloon', string> = {
  pvp: '#FFFFFF',
  pvb: '#FFFFFF',
  bases: '#FFFFFF',
  prototype: '#FFFFFF',
  balloon: '#FFFFFF',
}

export const LOBBY_MODES: ModeDef[] = [
  { id: 'pvp', label: 'PIXELWARS', cell: { x: 1, z: 2 }, teamRule: 'balance', live: true, placed: false, economy: false, color: rgbFromHex(MODE_PILL_HEX.pvp) },
  { id: 'pvb', label: 'BOT INVASION', cell: eastCell('pvb'), teamRule: 'humans-together', live: eastLive('pvb'), placed: false, economy: false, color: rgbFromHex(MODE_PILL_HEX.pvb) },
  { id: 'bases', label: 'BASE CHARGE', cell: eastCell('bases'), teamRule: 'balance', live: eastLive('bases'), placed: false, economy: false, color: rgbFromHex(MODE_PILL_HEX.bases) },
  { id: 'prototype', label: 'PAINT LIMIT', cell: { x: 2, z: 3 }, teamRule: 'balance', live: true, placed: false, economy: true, color: rgbFromHex(MODE_PILL_HEX.prototype) },
  { id: 'balloon', label: 'BALLOON BATTLE', cell: { x: 2, z: 1 }, teamRule: 'balance', live: true, placed: false, economy: false, color: rgbFromHex(MODE_PILL_HEX.balloon) },
  { id: 'garden', label: 'COLOR GARDEN', cell: { x: 0, z: 2 }, teamRule: 'balance', live: false, placed: false, economy: false, color: { r: 0.35, g: 0.75, b: 0.4 } },
  { id: 'pots', label: 'POT HUNT', cell: { x: 2, z: 0 }, teamRule: 'balance', live: false, placed: false, economy: false, color: { r: 0.92, g: 0.72, b: 0.25 } },
]

/** West RED, east BLUE, north YELLOW, south GREEN. Exact TEAM_HEX colours. */
export type TeamDef = {
  id: TeamId
  team: TeamChoice
  label: string
  cell: { x: number; z: number }
  color: { r: number; g: number; b: number }
  hex: string
}

export const LOBBY_TEAMS: TeamDef[] = [
  { id: 'red', team: 1, label: 'RED', cell: { x: 1, z: 2 }, color: rgbFromHex(TEAM_HEX[1]), hex: TEAM_HEX[1] },
  { id: 'blue', team: 2, label: 'BLUE', cell: { x: 3, z: 2 }, color: rgbFromHex(TEAM_HEX[2]), hex: TEAM_HEX[2] },
  { id: 'yellow', team: 4, label: 'YELLOW', cell: { x: 2, z: 3 }, color: rgbFromHex(TEAM_HEX[4]), hex: TEAM_HEX[4] },
  { id: 'green', team: 3, label: 'GREEN', cell: { x: 2, z: 1 }, color: rgbFromHex(TEAM_HEX[3]), hex: TEAM_HEX[3] },
]

export function lobbyTeamById(id: string): TeamDef | undefined {
  return LOBBY_TEAMS.find(t => t.id === id)
}

export function teamTitle(id: string): string {
  return LOBBY_TEAMS.find(t => t.id === id)?.label ?? ''
}

export function teamIdOf(team: number): TeamId | '' {
  return (LOBBY_TEAMS.find(t => t.team === team)?.id ?? '') as TeamId | ''
}

export function teamFromId(id: string): TeamChoice | 0 {
  return LOBBY_TEAMS.find(t => t.id === id)?.team ?? 0
}

/** End tiles actually built on the lobby floor. */
export function placedLobbyEnds(): TeamDef[] {
  return LOBBY_TEAMS
}


/** Full start window, in one place. Starts when the first team is chosen.
 *  An empty lobby does not start it. If every non-AFK present player is
 *  standing in a team zone, the remaining time drops to LOBBY_READY_MS
 *  (it never extends). Walking off every zone still cancels. */
export const LOBBY_VOTE_MS = 15_000
/** Remaining time when everyone present (and not AFK) is already in a zone. */
export const LOBBY_READY_MS = 5_000
/** End-tile walkable floor, matching the paint mask: a 20/32 corridor with a 6/32 closed cap.
 *  The vote tint and the trigger both use this rectangle, pulled in by VOTE_TINT_INSET_M. */
export const VOTE_FLOOR_WIDTH = 20 / 32
export const VOTE_FLOOR_CLOSED = 6 / 32
export const VOTE_TINT_INSET_M = 0.15
/** How far past the cell edge the team sign sits, on the outer side.
 *  Kept short so the pills sit a little closer in toward the lobby cross. */
export const SIGN_CLEAR_M = 6
/** World Y of a sign root, metres above the tile floor. */
export const SIGN_LIFT_M = 17
/** Reference width used only to keep the short 58×8.6 pill height after the earlier shrink. */
export const SIGN_REF_W_M = 32
/** Shared height of every team pill. Width now follows the word, not this height's old aspect. */
export const SIGN_H_M = 8.6 * (SIGN_REF_W_M / 58)
/** SDK TextShape: fontSize 10 is 1 m tall. Titles fill most of the pill height. */
export const SIGN_TITLE_FONT = 38
/** Lilita One caps are fairly wide; this is the estimated width of one letter as a fraction of cap height. */
const SIGN_TITLE_CHAR = 0.72
/**
 * Side padding from the pill edge to YELLOW's glyphs, in metres. Set past the
 * rounded cap radius (SIGN_H_M / 2) so the longest word sits in the straight
 * section with a little breathing room. All four pills share SIGN_W_M, and
 * every title uses the same typographic scale, so shorter words stay centered
 * at the same letter height with more side space.
 */
export const SIGN_TITLE_PAD_M = SIGN_H_M * 0.5 + 0.4
/** Plate width for one team word, tight around the letters plus side padding. */
export function signPlateWidth(label: string): number {
  const fontM = SIGN_TITLE_FONT / 10
  const textW = Math.max(1, label.length) * fontM * SIGN_TITLE_CHAR
  return textW + SIGN_TITLE_PAD_M * 2
}
/** Shared plate width: the longest team word (YELLOW) plus the same modest padding. */
export const SIGN_W_M = signPlateWidth('YELLOW')
/** Unlit title plates, baked in Lilita One so the letters stay crisp white with no outline. */
export type SignTitlePlane = { src: string; w: number; h: number }
/** Pixel size of each baked title and of the opaque glyph box inside it. */
const SIGN_TITLE_TEX: Record<string, { src: string; pxW: number; pxH: number; glyphW: number; glyphH: number }> = {
  RED: { src: 'assets/textures/sign-title-red.png', pxW: 2645, pxH: 1196, glyphW: 2364, glyphH: 1032 },
  BLUE: { src: 'assets/textures/sign-title-blue.png', pxW: 3303, pxH: 1205, glyphW: 2996, glyphH: 1041 },
  GREEN: { src: 'assets/textures/sign-title-green.png', pxW: 4318, pxH: 1214, glyphW: 4037, glyphH: 1050 },
  YELLOW: { src: 'assets/textures/sign-title-yellow.png', pxW: 5481, pxH: 1214, glyphW: 5282, glyphH: 1050 },
}
/** Metres per texture pixel, sized so YELLOW's glyphs fit inside the pill with SIGN_TITLE_PAD_M on each side. All four titles share this scale. */
export function signTitleScale(): number {
  return (SIGN_W_M - SIGN_TITLE_PAD_M * 2) / SIGN_TITLE_TEX.YELLOW.glyphW
}
export function signTitlePlane(label: string): SignTitlePlane {
  const t = SIGN_TITLE_TEX[label] ?? SIGN_TITLE_TEX.YELLOW
  const s = signTitleScale()
  return { src: t.src, w: t.pxW * s, h: t.pxH * s }
}
/** Overview `viewScale` at the desktop default framing (a 60° camera at this many metres). */
export const SIGN_ZOOM_REF = 29
/** World scale at that default framing. The wider pill stays about a quarter of the overview. */
export const SIGN_ORTHO_AT_REF = 0.25
export const SIGN_ZOOM_MIN = 0.05
export const SIGN_ZOOM_MAX = 1
/**
 * SDK7 Billboard, in scene metres, points local −Z at the camera.
 * The explorer aims its own +Z at the target, and scene Z is flipped on the way in,
 * so the face a player sees is the entity's −Z face. Text on +Z sits behind the plate.
 */
export const SIGN_CAMERA_AXIS = -1
export const SIGN_PLATE_DEPTH_M = 0.7
/** Darker lip, shifted behind the plate so only a rim shows.
 *  The lip is a full solid pill, slightly larger than the plate. If it sits
 *  toward the camera (negative Z), it covers the plate and the sign renders
 *  at the lip's 55% color — which is why Paint Limit looked mustard. */
export const SIGN_LIP_Z = 0.18
export const SIGN_LIP_DEPTH_M = 0.55
/** Extra width and height of the dark rim vs the colored plate. 1.5× the first rim (0.7 / 0.55). */
export const SIGN_LIP_PAD_W = 1.05 * (SIGN_REF_W_M / 58)
export const SIGN_LIP_PAD_H = 0.825 * (SIGN_REF_W_M / 58)
/** Vote-count chip, sized so a two-digit number fills most of it. */
export const SIGN_BADGE_W_M = 4.6
export const SIGN_BADGE_H_M = 2.4
export const SIGN_BADGE_GAP_M = 0.5 * (SIGN_REF_W_M / 58)
export const SIGN_COUNT_FONT = 18

/** Player-facing name. Internal ids stay `pvp` / `pvb` / `bases`. */
export function modeTitle(id: string): string {
  if (id === 'pvb') return 'BOT INVASION'
  if (id === 'pvp') return 'PIXELWARS'
  if (id === 'bases') return 'BASE CHARGE'
  if (id === 'prototype') return 'PAINT LIMIT'
  if (id === 'balloon') return 'BALLOON BATTLE'
  return ''
}

export function modeSubtitle(id: string): string {
  if (id === 'pvb') return 'vs Bots'
  if (id === 'pvp') return 'Classic'
  if (id === 'bases') return 'Prototype'
  if (id === 'prototype') return 'Prototype'
  if (id === 'balloon') return 'Prototype'
  return ''
}

/** World scale so a sign keeps about the same slice of the overview.
 *  `viewScale` is the eased framing distance, not a half-height. The framed world
 *  grows with it, so the sign must too. 0.3 at the default 29 is ~24% of screen width. */
export function signZoomScale(viewScale: number): number {
  const raw = SIGN_ORTHO_AT_REF * (viewScale / SIGN_ZOOM_REF)
  return Math.min(SIGN_ZOOM_MAX, Math.max(SIGN_ZOOM_MIN, raw))
}

/** Local Z of sign text: past the camera-facing slab by 0.2 m. */
export function signFaceZ(): number {
  const plateNear = SIGN_CAMERA_AXIS * (SIGN_PLATE_DEPTH_M / 2)
  const lipNear = SIGN_LIP_Z + SIGN_CAMERA_AXIS * (SIGN_LIP_DEPTH_M / 2)
  const near = SIGN_CAMERA_AXIS < 0 ? Math.min(plateNear, lipNear) : Math.max(plateNear, lipNear)
  return near + SIGN_CAMERA_AXIS * 0.2
}
/** Standing still this long is reported as AFK. A team choice is sticky and is not dropped. */
export const LOBBY_AFK_MS = 60_000
/** A position sample older than this is not a vote.
 *  1.5 s was short enough that a stored sample (feet still 1) was already
 *  stale at the next scoring tick, so the tally stayed 0 and the phase
 *  stayed idle. Hold for the same window as presence. */
export const LOBBY_SAMPLE_MS = 15_000
/** Metres of movement that refresh the AFK timer. */
export const LOBBY_MOVE_M = 0.75

/** Walkable top of a flat lobby tile, metres above the tile origin. Same as the paint slab. */
export const LOBBY_SLAB_TOP = 0.5
/**
 * Metres above the slab that still count as standing on the tile.
 * Covers a mobile bob and the usual 0.2–0.3 m of pose noise, and stays
 * clearly under a 1 m standing jump so a hop deactivates the tile.
 */
export const LOBBY_STAND_SLACK_M = 0.6
/** Metres below the slab still accepted (feet slightly in the mesh). */
export const LOBBY_STAND_SINK_M = 0.35
/**
 * After leaving the floor, the countdown still treats the last grounded
 * team tile as occupied for this long. Assignment at match start always
 * uses that last grounded pick (the sticky choice), even after the grace
 * ends — so a player mid-jump when the timer hits 0 keeps their team.
 * A glide or hang longer than this drops out of the countdown the same
 * way walking off the tile does. Sign counts and the local tint do not
 * use this grace: they clear as soon as the feet leave the stand band.
 */
export const LOBBY_AIR_GRACE_MS = 1_250

export function lobbySlabY(tileY: number): number {
  return tileY + LOBBY_SLAB_TOP
}

/** True when feet sit in the stand band of a flat lobby tile at `tileY`. */
export function isStandingOnLobbyFloor(feetY: number, tileY: number): boolean {
  if (!Number.isFinite(feetY) || !Number.isFinite(tileY)) return false
  const top = lobbySlabY(tileY)
  return feetY >= top - LOBBY_STAND_SINK_M && feetY <= top + LOBBY_STAND_SLACK_M
}

/** Team whose tint contains this point only while the player is standing on the floor. */
export function voteTeamAtStanding(
  worldX: number, worldY: number, worldZ: number, origin: number, cell: number, tileY: number,
): TeamChoice | 0 {
  if (!isStandingOnLobbyFloor(worldY, tileY)) return 0
  return voteTeamAt(worldX, worldZ, origin, cell)
}

export function modeById(id: string): ModeDef | null {
  return LOBBY_MODES.find(m => m.id === id) ?? null
}

export function liveModes(): ModeDef[] {
  return LOBBY_MODES.filter(m => m.live)
}

/** Alternate modes currently built as lobby ends. Empty while the floor is a team picker. */
export function placedModes(): ModeDef[] {
  return LOBBY_MODES.filter(m => m.placed)
}

/**
 * Player feet may arrive in scene metres (SW corner of the scene is 0,0) or in
 * world metres (parcel 0,0 is 0,0). Tiles are placed in scene metres. On a scene
 * whose base is not 0,0 those frames differ by `baseMeters` (base parcel × 16).
 * Pick the frame that lands inside the scene and closest to the lobby cross.
 */
export function toSceneFeet(
  x: number,
  z: number,
  sceneM: number,
  origin: number,
  cell: number,
  baseMeters: number,
): { x: number; z: number; frame: 'scene' | 'world' } {
  const crossX = LOBBY_CROSS.x * cell + cell / 2 + origin
  const crossZ = LOBBY_CROSS.z * cell + cell / 2 + origin
  const options = [
    { x, z, frame: 'scene' as const },
    { x: x - baseMeters, z: z - baseMeters, frame: 'world' as const },
  ]
  const inside = (p: { x: number; z: number }) =>
    p.x >= -cell && p.z >= -cell && p.x <= sceneM + cell && p.z <= sceneM + cell
  let best = options[0]
  let bestD = Infinity
  let found = false
  for (const p of options) {
    if (!inside(p)) continue
    found = true
    const d = Math.hypot(p.x - crossX, p.z - crossZ)
    // Equal distance keeps the scene frame (listed first).
    if (d < bestD - 0.5) { best = p; bestD = d }
  }
  if (!found) {
    for (const p of options) {
      const d = Math.hypot(p.x - crossX, p.z - crossZ)
      if (d < bestD - 0.5) { best = p; bestD = d }
    }
  }
  return best
}

/** Grid cell under a scene-local XZ, or null if it falls outside the tile grid. */
export function cellAt(worldX: number, worldZ: number, origin: number, cell: number): { x: number; z: number } | null {
  if (!(cell > 0)) return null
  const x = Math.floor((worldX - origin) / cell)
  const z = Math.floor((worldZ - origin) / cell)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { x, z }
}

/** Quarter-turns clockwise. Same rule the lobby layout uses for an end tile. */
export function endYawQuarter(cell: { x: number; z: number }): number {
  if (cell.x < LOBBY_CROSS.x) return 1
  if (cell.x > LOBBY_CROSS.x) return 3
  if (cell.z > LOBBY_CROSS.z) return 2
  return 0
}

/** Canonical floor rectangle of an end tile, in metres from the cell's SW corner.
 *  Local +Z is the opening. Inset so a box of this size sits inside the floor. */
export function voteZoneLocal(cell: number, inset = VOTE_TINT_INSET_M): { x0: number; z0: number; x1: number; z1: number; width: number; length: number } {
  const width = cell * VOTE_FLOOR_WIDTH
  const x0 = (cell - width) / 2 + inset
  const x1 = (cell + width) / 2 - inset
  const z0 = cell * VOTE_FLOOR_CLOSED + inset
  const z1 = cell - inset
  return { x0, z0, x1, z1, width: x1 - x0, length: z1 - z0 }
}

/** Canonical local metres → scene metres, rotated with the end tile. */
export function voteLocalToWorld(
  lx: number, lz: number, modeCell: { x: number; z: number }, origin: number, cell: number,
): { x: number; z: number } {
  const rad = endYawQuarter(modeCell) * Math.PI / 2
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = lx - cell / 2
  const cz = lz - cell / 2
  return {
    x: modeCell.x * cell + cell / 2 + origin + cx * cos + cz * sin,
    z: modeCell.z * cell + cell / 2 + origin - cx * sin + cz * cos,
  }
}

/** Center of the vote tint, and the yaw that lays the rectangle along the floor. */
export function voteTintPose(
  modeCell: { x: number; z: number }, origin: number, cell: number,
): { x: number; z: number; yawDeg: number; width: number; length: number } {
  const zone = voteZoneLocal(cell)
  const c = voteLocalToWorld((zone.x0 + zone.x1) / 2, (zone.z0 + zone.z1) / 2, modeCell, origin, cell)
  return { x: c.x, z: c.z, yawDeg: endYawQuarter(modeCell) * 90, width: zone.width, length: zone.length }
}

/** Downward caret under the pill. Width is 12% of the pill; height is a short triangle. */
/** Local Y of the vote-count chip, tucked just under the pill's bottom lip. */
export function signBadgeY(): number {
  const lipBottom = -(SIGN_H_M + SIGN_LIP_PAD_H) / 2
  return lipBottom - SIGN_BADGE_GAP_M - SIGN_BADGE_H_M / 2
}

/** Unused mode-vote helper. The live lobby no longer elects a mode. */
export function voteLead(counts: VoteCounts): ModeId | 'tie' | '' {
  const tied = leadingModes(counts)
  if (tied.length === 0) return ''
  if (tied.length > 1) return 'tie'
  return tied[0]
}

/** Top HUD line. Idle stays CHOOSE A TEAM; the countdown is just STARTING IN N.
 *  After the last second, hudClockText shows STARTING... until the match clock, so
 *  a 0-second leftover does not fall back to CHOOSE A TEAM. */
export const LOBBY_STATUS_IDLE = 'CHOOSE A TEAM'
export const LOBBY_STATUS_COUNTDOWN = 'STARTING IN'
export const LOBBY_STATUS_STARTING = 'STARTING...'
export function hudVoteHeadline(leftSecs = 0, _lead?: unknown): string {
  const n = Math.max(0, Math.ceil(leftSecs))
  if (n <= 0) return LOBBY_STATUS_IDLE
  return `${LOBBY_STATUS_COUNTDOWN} ${n}`
}

/** Big center line shown to every lobby player during the countdown. */
export function hudRoundStartsLine(leftSecs = 0): string {
  const n = Math.max(0, Math.ceil(leftSecs))
  if (n <= 0) return ''
  return `ROUND STARTS IN ${n}`
}


/** Sign root, on the outer side of the end, facing back toward the cross. */
export function billboardAnchor(
  modeCell: { x: number; z: number }, origin: number, cell: number, baseY: number,
): { x: number; y: number; z: number; yawDeg: number } {
  const dx = Math.sign(modeCell.x - LOBBY_CROSS.x)
  const dz = Math.sign(modeCell.z - LOBBY_CROSS.z)
  const out = cell / 2 + SIGN_CLEAR_M
  return {
    x: modeCell.x * cell + cell / 2 + origin + dx * out,
    y: baseY + SIGN_LIFT_M,
    z: modeCell.z * cell + cell / 2 + origin + dz * out,
    yawDeg: endYawQuarter(modeCell) * 90,
  }
}

/** True when a point sits on an end-tile activation rectangle. */
export function inEndZone(
  worldX: number, worldZ: number, modeCell: { x: number; z: number }, origin: number, cell: number,
): boolean {
  if (!(cell > 0)) return false
  const zone = voteZoneLocal(cell)
  const rad = endYawQuarter(modeCell) * Math.PI / 2
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const midX = modeCell.x * cell + cell / 2 + origin
  const midZ = modeCell.z * cell + cell / 2 + origin
  const wx = worldX - midX
  const wz = worldZ - midZ
  const lx = wx * cos - wz * sin + cell / 2
  const lz = wx * sin + wz * cos + cell / 2
  return lx >= zone.x0 && lx <= zone.x1 && lz >= zone.z0 && lz <= zone.z1
}

/** Live *and placed* mode whose tint rectangle contains this point. Unused while modes are unplaced. */
export function voteModeAt(worldX: number, worldZ: number, origin: number, cell: number): ModeId | '' {
  if (!(cell > 0)) return ''
  for (const m of LOBBY_MODES) {
    if (!m.live || !m.placed) continue
    const zone = voteZoneLocal(cell)
    const rad = endYawQuarter(m.cell) * Math.PI / 2
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const midX = m.cell.x * cell + cell / 2 + origin
    const midZ = m.cell.z * cell + cell / 2 + origin
    const wx = worldX - midX
    const wz = worldZ - midZ
    const lx = wx * cos - wz * sin + cell / 2
    const lz = wx * sin + wz * cos + cell / 2
    if (lx >= zone.x0 && lx <= zone.x1 && lz >= zone.z0 && lz <= zone.z1) return m.id
  }
  return ''
}

/** Team whose tint rectangle contains this point, or 0 if the player is not on a team tile. */
export function voteTeamAt(worldX: number, worldZ: number, origin: number, cell: number): TeamChoice | 0 {
  if (!(cell > 0)) return 0
  for (const t of LOBBY_TEAMS) {
    if (inEndZone(worldX, worldZ, t.cell, origin, cell)) return t.team
  }
  return 0
}

export function voteTeamIdAt(worldX: number, worldZ: number, origin: number, cell: number): TeamId | '' {
  return teamIdOf(voteTeamAt(worldX, worldZ, origin, cell))
}

export function lobbyFeet(cell: number, origin: number, baseY: number): { x: number; y: number; z: number } {
  return {
    x: LOBBY_CROSS.x * cell + cell / 2 + origin,
    y: baseY + 1.5,
    z: LOBBY_CROSS.z * cell + cell / 2 + origin,
  }
}

/** Thin physics box. `feetY` is the stand height; the top of the box is the slab, 1 m below. */
export type SpawnPad = { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number }

export function spawnPadAt(x: number, feetY: number, z: number, sx = 16, sz = 16, yaw = 0): SpawnPad {
  return { x, y: feetY - 1.1, z, sx, sy: 0.2, sz, yaw }
}

/**
 * Invisible floors under the places a joiner is put down before the tile mesh
 * can hold them. Team bases and the lobby hub match the original pads. The
 * RED and BLUE floors also get a pad, including the doorway off the hub,
 * because those ends still grow in after the corridor appears.
 */
export function earlySpawnPads(
  origin: number,
  cell: number,
  baseY: number,
  bases: Array<{ x: number; y?: number; z: number }>,
): SpawnPad[] {
  const feetY = baseY + 1.5
  const pads = bases.map(b => spawnPadAt(b.x, b.y ?? feetY, b.z))
  const cross = lobbyFeet(cell, origin, baseY)
  pads.push(spawnPadAt(cross.x, cross.y, cross.z))
  for (const team of LOBBY_TEAMS) {
    const pose = voteTintPose(team.cell, origin, cell)
    pads.push(spawnPadAt(pose.x, feetY, pose.z, pose.width, pose.length, pose.yawDeg))
  }
  return pads
}

/** True when a point lies on the pad's horizontal footprint. Yaw matches the entity. */
export function padContains(pad: SpawnPad, x: number, z: number): boolean {
  const dx = x - pad.x
  const dz = z - pad.z
  const rad = pad.yaw * Math.PI / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= pad.sx / 2 + 1e-4 && Math.abs(lz) <= pad.sz / 2 + 1e-4
}

export type VoteCounts = Record<ModeId, number>

export function emptyCounts(): VoteCounts {
  return { pvp: 0, pvb: 0, bases: 0, prototype: 0, balloon: 0, garden: 0, pots: 0 }
}

/** Live modes sharing the highest count, in registry order. Empty when nobody voted. */
export function leadingModes(counts: VoteCounts): ModeId[] {
  const live = liveModes()
  let best = 0
  for (const m of live) best = Math.max(best, counts[m.id] ?? 0)
  if (best <= 0) return []
  return live.filter(m => (counts[m.id] ?? 0) === best).map(m => m.id)
}

/**
 * Highest live count wins. A tie is broken with the world-sync `seq` so the
 * server and every client pick the same mode from the tied set. No live votes
 * returns null.
 */
export function pickWinner(counts: VoteCounts, seq: number): ModeId | null {
  const tied = leadingModes(counts)
  if (tied.length === 0) return null
  if (tied.length === 1) return tied[0]
  const i = Math.abs(Math.trunc(seq)) % tied.length
  return tied[i]
}

export function stillAfk(movedAt: number, now: number): boolean {
  return now - movedAt >= LOBBY_AFK_MS
}

/** True when every id in `present` currently holds a live-zone vote. */
export function everyPresentInZone(present: string[], voted: Set<string>): boolean {
  if (present.length === 0) return false
  return present.every(id => voted.has(id))
}

export type TeamCounts = SharedTeamCounts

export function emptyTeamCounts(): TeamCounts {
  return emptyTeamTally()
}

/**
 * Apply lobby team picks at round start. Chosen players keep their colour.
 * Anyone who did not pick goes to the current smallest team; a tie prefers
 * the lower team id (red, then blue, green, yellow). All-one-side is allowed.
 */
export function assignLobbyTeams(
  present: string[],
  chosen: ReadonlyMap<string, number>,
): Array<{ userId: string; team: TeamChoice }> {
  const pick = new Map<string, TeamChoice>()
  for (const [id, team] of chosen) {
    if (isPlayingTeam(team)) pick.set(id.toLowerCase(), team)
  }
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of present) {
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }
  const counts = emptyTeamCounts()
  const assigned = new Map<string, TeamChoice>()
  for (const id of ids) {
    const team = pick.get(id.toLowerCase())
    if (!team) continue
    assigned.set(id, team)
    addTeamCount(counts, team)
  }
  for (const id of ids) {
    if (assigned.has(id)) continue
    const team = smallestTeam(counts) as TeamChoice
    assigned.set(id, team)
    addTeamCount(counts, team)
  }
  return ids.map(userId => ({ userId, team: assigned.get(userId)! }))
}
