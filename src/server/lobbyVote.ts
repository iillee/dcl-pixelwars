/**
 * Feet samples for the lobby. The server names the zone. A client never
 * sends a mode id. Stillness of LOBBY_AFK_MS drops the vote.
 */
import { CELL, MAZE_ORIGIN, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import {
  LOBBY_AFK_MS, LOBBY_MODES, LOBBY_MOVE_M, LOBBY_SAMPLE_MS, cellAt, emptyCounts, everyPresentInZone,
  toSceneFeet, type ModeId, type VoteCounts, voteModeAt,
} from '../shared/lobby'

const BASE_METERS = sceneOriginParcel(SKY_PARCELS) * 16

type Sample = {
  x: number; z: number; y: number
  rawX: number; rawZ: number
  frame: 'scene' | 'world'
  at: number
  movedAt: number
}

const samples = new Map<string, Sample>()
const lastAt = new Map<string, number>()

const keyOf = (id: string) => id.toLowerCase()

/** False when the sample was inside the 2 Hz cap. */
export function noteLobbyPos(id: string, x: number, y: number, z: number, now: number): boolean {
  if (![x, y, z].every(Number.isFinite)) return false
  const key = keyOf(id)
  const prev = lastAt.get(key) ?? 0
  if (now - prev < 400) return false
  lastAt.set(key, now)
  const scene = toSceneFeet(x, z, SCENE_SIZE, MAZE_ORIGIN, CELL, BASE_METERS)
  const cur = samples.get(key)
  let movedAt = cur?.movedAt ?? now
  if (!cur || Math.hypot(scene.x - cur.x, scene.z - cur.z) >= LOBBY_MOVE_M) movedAt = now
  samples.set(key, { x: scene.x, z: scene.z, y, rawX: x, rawZ: z, frame: scene.frame, at: now, movedAt })
  return true
}

export type LobbyWho = {
  id: string
  rawX: number; rawZ: number; y: number
  x: number; z: number
  frame: 'scene' | 'world'
  cell: string
  zone: string
  fresh: boolean
  afk: boolean
}

/** One line per player who has sent feet, for the throttled server log. */
export function lobbyWho(ids: string[], now: number): LobbyWho[] {
  const out: LobbyWho[] = []
  for (const id of ids) {
    const s = samples.get(keyOf(id))
    if (!s) {
      out.push({ id, rawX: NaN, rawZ: NaN, y: NaN, x: NaN, z: NaN, frame: 'scene', cell: 'none', zone: 'no-sample', fresh: false, afk: false })
      continue
    }
    const c = cellAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const mode = voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const named = LOBBY_MODES.find(m => c && m.cell.x === c.x && m.cell.z === c.z)
    const fresh = now - s.at <= LOBBY_SAMPLE_MS
    const afk = now - s.movedAt >= LOBBY_AFK_MS
    // Standing still on a tile is the vote. AFK is reported, not a reject.
    const zone = !fresh ? 'stale' : named ? (named.live ? named.id : `${named.id}-soon`) : (mode || 'abstain')
    out.push({
      id, rawX: s.rawX, rawZ: s.rawZ, y: s.y, x: s.x, z: s.z, frame: s.frame,
      cell: c ? `${c.x},${c.z}` : 'out',
      zone, fresh, afk,
    })
  }
  return out
}

export function forgetLobbyPlayer(id: string): void {
  const key = keyOf(id)
  samples.delete(key)
  lastAt.delete(key)
}

export function clearLobbyVotes(): void {
  samples.clear()
  lastAt.clear()
}

export function lobbySampleIds(): string[] {
  return [...samples.keys()]
}

function liveVote(id: string, now: number): ModeId | '' {
  const s = samples.get(keyOf(id))
  if (!s || now - s.at > LOBBY_SAMPLE_MS) return ''
  return voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
}

/** The mode this player is currently counted for, or '' if they are not. */
export function countedMode(id: string, now: number): ModeId | '' {
  return liveVote(id, now)
}

/** Present ids plus anyone who has sent feet. A case-different key used to
 *  leave feet=1 and present=1 while every lookup missed. */
function voterIds(present: string[]): string[] {
  const ids = new Set<string>()
  for (const id of present) ids.add(keyOf(id))
  for (const id of samples.keys()) ids.add(id)
  return [...ids]
}

export function tallyVotes(present: string[], now: number): { counts: VoteCounts; voted: Set<string> } {
  const counts = emptyCounts()
  const voted = new Set<string>()
  for (const id of voterIds(present)) {
    const mode = liveVote(id, now)
    if (!mode) continue
    counts[mode]++
    voted.add(id)
  }
  return { counts, voted }
}

/** Why the stored sample does not add to the tally. `ok` when it does. */
export function lobbyVerdict(present: string[], now: number): { counts: VoteCounts; zone: string; why: string } {
  const counts = tallyVotes(present, now).counts
  const sampleIds = lobbySampleIds()
  const presentNorm = new Set(present.map(keyOf))
  const id = sampleIds[0] ?? (present[0] ? keyOf(present[0]) : '')
  if (!id) return { counts, zone: 'none', why: 'no-sample' }
  const s = samples.get(id)
  if (!s) return { counts, zone: 'none', why: sampleIds.length ? 'id-mismatch' : 'no-sample' }
  const c = cellAt(s.x, s.z, MAZE_ORIGIN, CELL)
  const named = LOBBY_MODES.find(m => c && m.cell.x === c.x && m.cell.z === c.z)
  const zone = named ? (named.live ? named.id : `${named.id}-soon`) : (c ? 'abstain' : 'out')
  if (now - s.at > LOBBY_SAMPLE_MS) return { counts, zone, why: 'stale' }
  if (!presentNorm.has(id) && present.length > 0) {
    // Counted via the sample key anyway. Say so.
    const mode = voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
    return { counts, zone: mode || zone, why: mode ? 'ok-id' : zone }
  }
  const mode = voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
  if (mode) return { counts, zone: mode, why: 'ok' }
  if (named && !named.live) return { counts, zone, why: 'soon' }
  if (!c) return { counts, zone: 'out', why: 'out' }
  return { counts, zone: 'abstain', why: 'abstain' }
}

export type LobbyClock = {
  wantFull: boolean
  countdownEnds: number
  shortCountdown: boolean
  hadVotes: boolean
  readyAt: number
  /** When the live tally last dropped to 0 during a countdown. */
  emptySince: number
}

/** One scoring tick. `start-5s` is the cold-lobby countdown. */
export function stepLobby(s: LobbyClock, present: string[], now: number): { next: LobbyClock; log: '' | 'close' | 'start-15s' | 'start-5s' | 'resolve' | 'resolve-early' } {
  const next: LobbyClock = { ...s }
  const voters = voterIds(present)
  if (voters.length === 0) {
    if (next.countdownEnds !== 0 || next.wantFull) {
      next.countdownEnds = 0
      next.shortCountdown = false
      next.hadVotes = false
      next.wantFull = false
      next.emptySince = 0
      return { next, log: 'close' }
    }
    return { next, log: '' }
  }
  if (next.wantFull && next.countdownEnds === 0 && now - next.readyAt >= 2000) {
    next.countdownEnds = now + 15_000
    next.wantFull = false
    next.shortCountdown = false
    return { next, log: 'start-15s' }
  }
  const any = tallyVotes(voters, now).counts.pvp + tallyVotes(voters, now).counts.pvb > 0
  if (next.countdownEnds > 0) {
    if (any) { next.hadVotes = true; next.emptySince = 0 }
    else if (next.hadVotes) {
      if (next.emptySince === 0) next.emptySince = now
      // One stale frame used to cancel the 5 s countdown immediately.
      if (now - next.emptySince >= 2000) {
        next.countdownEnds = 0
        next.shortCountdown = false
        next.hadVotes = false
        next.wantFull = false
        next.emptySince = 0
        return { next, log: 'close' }
      }
    }
    const early = !next.shortCountdown && everyoneInZone(voters, now)
    if (early || now >= next.countdownEnds) return { next, log: early ? 'resolve-early' : 'resolve' }
    return { next, log: '' }
  }
  if (!next.wantFull && any) {
    next.countdownEnds = now + 5_000
    next.shortCountdown = true
    next.hadVotes = true
    next.emptySince = 0
    return { next, log: 'start-5s' }
  }
  return { next, log: '' }
}

export function everyoneInZone(present: string[], now: number): boolean {
  return everyPresentInZone(present, tallyVotes(present, now).voted)
}
