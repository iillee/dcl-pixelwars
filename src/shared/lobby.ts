/**
 * Lobby layout and vote rules. Pure. The generator places these cells;
 * the server decides a zone from a player's feet. No engine imports.
 *
 * The built floor is four tiles: a fork center opening north, east, and west,
 * Team Fight on the west end, Bot Fight on the east end, Prototype on the north end.
 * Color Garden and Pot Hunt stay in the registry so they can be placed again later.
 * They are not on the floor.
 */

export type ModeId = 'pvp' | 'pvb' | 'prototype' | 'garden' | 'pots'
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

/** West Team Fight, east Bot Fight, and north Prototype share an edge with the center.
 *  Garden and pots keep cells that are not built. They cannot win a vote. */
export const LOBBY_MODES: ModeDef[] = [
  { id: 'pvp', label: 'TEAM FIGHT', cell: { x: 1, z: 2 }, teamRule: 'balance', live: true, placed: true, economy: false, color: { r: 0.95, g: 0.28, b: 0.27 } },
  { id: 'pvb', label: 'BOT FIGHT', cell: { x: 3, z: 2 }, teamRule: 'humans-together', live: true, placed: true, economy: false, color: { r: 0.29, g: 0.48, b: 0.95 } },
  { id: 'prototype', label: 'PROTOTYPE', cell: { x: 2, z: 3 }, teamRule: 'balance', live: true, placed: true, economy: true, color: { r: 0.98, g: 0.78, b: 0.22 } },
  { id: 'garden', label: 'COLOR GARDEN', cell: { x: 0, z: 2 }, teamRule: 'balance', live: false, placed: false, economy: false, color: { r: 0.35, g: 0.75, b: 0.4 } },
  { id: 'pots', label: 'POT HUNT', cell: { x: 2, z: 1 }, teamRule: 'balance', live: false, placed: false, economy: false, color: { r: 0.92, g: 0.72, b: 0.25 } },
]

/** Full vote window, in one place. Starts when the first live vote is counted.
 *  Standing in a zone does not end it early, and an empty lobby does not start it. */
export const LOBBY_VOTE_MS = 15_000
/** End-tile walkable floor, matching the paint mask: a 20/32 corridor with a 6/32 closed cap.
 *  The vote tint and the trigger both use this rectangle, pulled in by VOTE_TINT_INSET_M. */
export const VOTE_FLOOR_WIDTH = 20 / 32
export const VOTE_FLOOR_CLOSED = 6 / 32
export const VOTE_TINT_INSET_M = 0.15
/** How far past the cell edge the mode sign sits, on the outer side.
 *  Far enough that a sign at the default overview scale stays off the three lobby tiles. */
export const SIGN_CLEAR_M = 10
/** One 4.5 m line of "TEAM FIGHT", with side margins inside the pill, plus the subtitle. */
export const SIGN_W_M = 48
export const SIGN_H_M = 8.6
/** Overview `viewScale` at the desktop default framing (a 60° camera at this many metres). */
export const SIGN_ZOOM_REF = 29
/** World scale at that default framing. A 48 m plate is then ~24% of a 16:9 overview. */
export const SIGN_ORTHO_AT_REF = 0.3
export const SIGN_ZOOM_MIN = 0.05
export const SIGN_ZOOM_MAX = 1
/**
 * SDK7 Billboard, in scene metres, points local −Z at the camera.
 * The explorer aims its own +Z at the target, and scene Z is flipped on the way in,
 * so the face a player sees is the entity's −Z face. Text on +Z sits behind the plate.
 */
export const SIGN_CAMERA_AXIS = -1
export const SIGN_PLATE_DEPTH_M = 0.7
/** Darker lip, shifted toward the camera so it reads as a rim. */
export const SIGN_LIP_Z = -0.18
export const SIGN_LIP_DEPTH_M = 0.55

/** Player-facing name. Internal ids stay `pvp` / `pvb`. */
export function modeTitle(id: string): string {
  if (id === 'pvb') return 'BOT FIGHT'
  if (id === 'pvp') return 'TEAM FIGHT'
  if (id === 'prototype') return 'PROTOTYPE'
  return ''
}

export function modeSubtitle(id: string): string {
  if (id === 'pvb') return 'vs Bots'
  if (id === 'pvp') return 'vs Humans'
  if (id === 'prototype') return 'Paint Economy'
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
/** Standing still this long drops the vote. */
export const LOBBY_AFK_MS = 60_000
/** A position sample older than this is not a vote.
 *  1.5 s was short enough that a stored sample (feet still 1) was already
 *  stale at the next scoring tick, so the tally stayed 0 and the phase
 *  stayed idle. Hold for the same window as presence. */
export const LOBBY_SAMPLE_MS = 15_000
/** Metres of movement that refresh the AFK timer. */
export const LOBBY_MOVE_M = 0.75

export function modeById(id: string): ModeDef | null {
  return LOBBY_MODES.find(m => m.id === id) ?? null
}

export function liveModes(): ModeDef[] {
  return LOBBY_MODES.filter(m => m.live)
}

/** End tiles actually built. Team Fight west, Bot Fight east, Prototype north. */
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

/** Sign root, on the outer side of the end, facing back toward the cross. */
export function billboardAnchor(
  modeCell: { x: number; z: number }, origin: number, cell: number, baseY: number,
): { x: number; y: number; z: number; yawDeg: number } {
  const dx = Math.sign(modeCell.x - LOBBY_CROSS.x)
  const dz = Math.sign(modeCell.z - LOBBY_CROSS.z)
  const out = cell / 2 + SIGN_CLEAR_M
  return {
    x: modeCell.x * cell + cell / 2 + origin + dx * out,
    y: baseY + 22,
    z: modeCell.z * cell + cell / 2 + origin + dz * out,
    yawDeg: endYawQuarter(modeCell) * 90,
  }
}

/** Live mode whose tint rectangle contains this point. The rest of the cell abstains. */
export function voteModeAt(worldX: number, worldZ: number, origin: number, cell: number): ModeId | '' {
  if (!(cell > 0)) return ''
  for (const m of LOBBY_MODES) {
    if (!m.live) continue
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
 * can hold them. Team bases and the fork center match the original pads.
 * Prototype also covers its north vote floor, including the doorway off the fork.
 * Bot Fight and Team Fight vote tiles are not given an extra pad.
 */
export function earlySpawnPads(
  origin: number,
  cell: number,
  baseY: number,
  bases: Array<{ x: number; z: number }>,
): SpawnPad[] {
  const feetY = baseY + 1.5
  const pads = bases.map(b => spawnPadAt(b.x, feetY, b.z))
  const cross = lobbyFeet(cell, origin, baseY)
  pads.push(spawnPadAt(cross.x, cross.y, cross.z))
  const proto = LOBBY_MODES.find(m => m.id === 'prototype' && m.placed)
  if (proto) {
    const pose = voteTintPose(proto.cell, origin, cell)
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
  return { pvp: 0, pvb: 0, prototype: 0, garden: 0, pots: 0 }
}

/**
 * Highest live count wins. A tie keeps `previous` when that mode is part of
 * the tie, otherwise PvP. No live votes returns null.
 */
export function pickWinner(counts: VoteCounts, previous: string): ModeId | null {
  const live = liveModes()
  let best = 0
  for (const m of live) best = Math.max(best, counts[m.id] ?? 0)
  if (best <= 0) return null
  const tied = live.filter(m => (counts[m.id] ?? 0) === best)
  if (tied.length === 1) return tied[0].id
  if (tied.some(m => m.id === previous)) return previous as ModeId
  return 'pvp'
}

export function stillAfk(movedAt: number, now: number): boolean {
  return now - movedAt >= LOBBY_AFK_MS
}

/** True when every id in `present` currently holds a live-zone vote. */
export function everyPresentInZone(present: string[], voted: Set<string>): boolean {
  if (present.length === 0) return false
  return present.every(id => voted.has(id))
}
