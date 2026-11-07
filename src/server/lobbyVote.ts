/**
 * Feet samples for the lobby. The server names the zone. A client never
 * sends a mode id. Stillness of LOBBY_AFK_MS drops the vote.
 */
import { CELL, MAZE_ORIGIN } from '../maze/generator'
import {
  LOBBY_AFK_MS, LOBBY_MOVE_M, LOBBY_SAMPLE_MS, emptyCounts, everyPresentInZone,
  type ModeId, type VoteCounts, voteModeAt,
} from '../shared/lobby'

type Sample = { x: number; z: number; at: number; movedAt: number }

const samples = new Map<string, Sample>()
const lastAt = new Map<string, number>()

/** False when the sample was inside the 2 Hz cap. */
export function noteLobbyPos(id: string, x: number, _y: number, z: number, now: number): boolean {
  if (![x, z].every(Number.isFinite)) return false
  const prev = lastAt.get(id) ?? 0
  if (now - prev < 400) return false
  lastAt.set(id, now)
  const cur = samples.get(id)
  let movedAt = cur?.movedAt ?? now
  if (!cur || Math.hypot(x - cur.x, z - cur.z) >= LOBBY_MOVE_M) movedAt = now
  samples.set(id, { x, z, at: now, movedAt })
  return true
}

export function forgetLobbyPlayer(id: string): void {
  samples.delete(id)
  lastAt.delete(id)
}

export function clearLobbyVotes(): void {
  samples.clear()
  lastAt.clear()
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
