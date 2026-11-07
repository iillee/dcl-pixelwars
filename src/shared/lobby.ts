/**
 * Lobby layout and vote rules. Pure. The generator places these cells;
 * the server decides a zone from a player's feet. No engine imports.
 *
 * 5×5 grid. The cross is the center. An end tile sits on each side of it.
 * That end tile is the only voting cell. West is PvP, east is PvB.
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
  /** Phase A: only PvP and PvB can win. The other ends are still built and labeled. */
  live: boolean
  color: { r: number; g: number; b: number }
}

export const LOBBY_CROSS = { x: 2, z: 2 }

/** Ends share an edge with the cross. Openings face back toward it.
 *  West PvP, east PvB, north and south are visible and cannot win yet. */
export const LOBBY_MODES: ModeDef[] = [
  { id: 'pvp', label: 'PIXEL WARS', cell: { x: 1, z: 2 }, teamRule: 'balance', live: true, color: { r: 0.95, g: 0.28, b: 0.27 } },
  { id: 'pvb', label: 'BOT INVASION', cell: { x: 3, z: 2 }, teamRule: 'humans-together', live: true, color: { r: 0.29, g: 0.48, b: 0.95 } },
  { id: 'garden', label: 'COLOR GARDEN', cell: { x: 2, z: 3 }, teamRule: 'balance', live: false, color: { r: 0.35, g: 0.75, b: 0.4 } },
  { id: 'pots', label: 'POT HUNT', cell: { x: 2, z: 1 }, teamRule: 'balance', live: false, color: { r: 0.92, g: 0.72, b: 0.25 } },
]

export const LOBBY_VOTE_MS = 15_000
export const LOBBY_FIRST_VOTE_MS = 5_000
/** Standing still this long drops the vote. */
export const LOBBY_AFK_MS = 60_000
/** A position sample older than this is not a vote. */
export const LOBBY_SAMPLE_MS = 1_500
/** Metres of movement that refresh the AFK timer. */
export const LOBBY_MOVE_M = 0.75

export function modeById(id: string): ModeDef | null {
  return LOBBY_MODES.find(m => m.id === id) ?? null
}

export function liveModes(): ModeDef[] {
  return LOBBY_MODES.filter(m => m.live)
}

/** Grid cell under a world XZ, or null if it falls outside the tile grid. */
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
