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

/** False when the sample was inside the 2 Hz cap. */
export function noteLobbyPos(id: string, x: number, y: number, z: number, now: number): boolean {
  if (![x, y, z].every(Number.isFinite)) return false
  const prev = lastAt.get(id) ?? 0
  if (now - prev < 400) return false
  lastAt.set(id, now)
  const scene = toSceneFeet(x, z, SCENE_SIZE, MAZE_ORIGIN, CELL, BASE_METERS)
  const cur = samples.get(id)
  let movedAt = cur?.movedAt ?? now
  if (!cur || Math.hypot(scene.x - cur.x, scene.z - cur.z) >= LOBBY_MOVE_M) movedAt = now
  samples.set(id, { x: scene.x, z: scene.z, y, rawX: x, rawZ: z, frame: scene.frame, at: now, movedAt })
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
    const s = samples.get(id)
    if (!s) {
      out.push({ id, rawX: NaN, rawZ: NaN, y: NaN, x: NaN, z: NaN, frame: 'scene', cell: 'none', zone: 'no-sample', fresh: false, afk: false })
      continue
    }
    const c = cellAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const mode = voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const named = LOBBY_MODES.find(m => c && m.cell.x === c.x && m.cell.z === c.z)
    const fresh = now - s.at <= LOBBY_SAMPLE_MS
    const afk = now - s.movedAt >= LOBBY_AFK_MS
    out.push({
      id, rawX: s.rawX, rawZ: s.rawZ, y: s.y, x: s.x, z: s.z, frame: s.frame,
      cell: c ? `${c.x},${c.z}` : 'out',
      zone: !fresh ? 'stale' : afk ? 'afk' : named ? (named.live ? named.id : `${named.id}-soon`) : (mode || 'abstain'),
      fresh, afk,
    })
  }
  return out
}

export function forgetLobbyPlayer(id: string): void {
  samples.delete(id)
  lastAt.delete(id)
}

export function clearLobbyVotes(): void {
  samples.clear()
  lastAt.clear()
}

export function lobbySampleIds(): string[] {
  return [...samples.keys()]
}

function liveVote(id: string, now: number): ModeId | '' {
  const s = samples.get(id)
  if (!s || now - s.at > LOBBY_SAMPLE_MS) return ''
  if (now - s.movedAt >= LOBBY_AFK_MS) return ''
  return voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
}

export function tallyVotes(present: string[], now: number): { counts: VoteCounts; voted: Set<string> } {
  const counts = emptyCounts()
  const voted = new Set<string>()
  for (const id of present) {
    const mode = liveVote(id, now)
    if (!mode) continue
    counts[mode]++
    voted.add(id)
  }
  return { counts, voted }
}

export function everyoneInZone(present: string[], now: number): boolean {
  return everyPresentInZone(present, tallyVotes(present, now).voted)
}
