/**
 * Lobby layout and vote rules. Pure. The generator places these cells;
 * the server decides a zone from a player's feet. No engine imports.
 *
 * The built floor is three tiles: a straight center opening east and west,
 * PvP on the west end, PvB on the east end. Color Garden and Pot Hunt stay
 * in the registry so they can be placed again later. They are not on the floor.
 */

export type ModeId = 'pvp' | 'pvb' | 'garden' | 'pots'
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
  color: { r: number; g: number; b: number }
}

export const LOBBY_CROSS = { x: 2, z: 2 }

/** West PvP and east PvB share an edge with the center. Garden and pots
 *  keep their cells for a later layout. They are not placed and cannot win. */
export const LOBBY_MODES: ModeDef[] = [
  { id: 'pvp', label: 'PIXEL WARS', cell: { x: 1, z: 2 }, teamRule: 'balance', live: true, placed: true, color: { r: 0.95, g: 0.28, b: 0.27 } },
  { id: 'pvb', label: 'BOT INVASION', cell: { x: 3, z: 2 }, teamRule: 'humans-together', live: true, placed: true, color: { r: 0.29, g: 0.48, b: 0.95 } },
  { id: 'garden', label: 'COLOR GARDEN', cell: { x: 2, z: 3 }, teamRule: 'balance', live: false, placed: false, color: { r: 0.35, g: 0.75, b: 0.4 } },
  { id: 'pots', label: 'POT HUNT', cell: { x: 2, z: 1 }, teamRule: 'balance', live: false, placed: false, color: { r: 0.92, g: 0.72, b: 0.25 } },
]

export const LOBBY_VOTE_MS = 15_000
export const LOBBY_FIRST_VOTE_MS = 5_000
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

/** End tiles actually built. PvP west, PvB east. */
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

/** Live mode whose end tile contains this point. Anything else abstains. */
export function voteModeAt(worldX: number, worldZ: number, origin: number, cell: number): ModeId | '' {
  const c = cellAt(worldX, worldZ, origin, cell)
  if (!c) return ''
  const hit = LOBBY_MODES.find(m => m.live && m.cell.x === c.x && m.cell.z === c.z)
  return hit ? hit.id : ''
}

export function lobbyFeet(cell: number, origin: number, baseY: number): { x: number; y: number; z: number } {
  return {
    x: LOBBY_CROSS.x * cell + cell / 2 + origin,
    y: baseY + 1.5,
    z: LOBBY_CROSS.z * cell + cell / 2 + origin,
  }
}

export type VoteCounts = Record<ModeId, number>

export function emptyCounts(): VoteCounts {
  return { pvp: 0, pvb: 0, garden: 0, pots: 0 }
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
