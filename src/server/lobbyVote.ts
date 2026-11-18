/**
 * Feet samples for the lobby. The server names the zone. A client never
 * sends a team id. Standing on a team tile sets a sticky choice; walking
 * off or standing still does not drop it. Leaving the scene does.
 */
import { CELL, MAZE_ORIGIN, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import {
  LOBBY_AFK_MS, LOBBY_MOVE_M, LOBBY_SAMPLE_MS, LOBBY_TEAMS, LOBBY_VOTE_MS, cellAt,
  emptyCounts, emptyTeamCounts, everyPresentInZone, teamIdOf,
  toSceneFeet, type ModeId, type TeamChoice, type TeamCounts, type VoteCounts,
  voteModeAt, voteTeamAt,
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
const chosen = new Map<string, TeamChoice>()

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
  const team = voteTeamAt(scene.x, scene.z, MAZE_ORIGIN, CELL)
  if (team) chosen.set(key, team)
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
      const pick = countedTeam(id)
      out.push({
        id, rawX: NaN, rawZ: NaN, y: NaN, x: NaN, z: NaN, frame: 'scene', cell: 'none',
        zone: pick ? teamIdOf(pick) : 'no-sample', fresh: false, afk: false,
      })
      continue
    }
    const c = cellAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const standing = voteTeamAt(s.x, s.z, MAZE_ORIGIN, CELL)
    const pick = countedTeam(id)
    const named = LOBBY_TEAMS.find(t => c && t.cell.x === c.x && t.cell.z === c.z)
    const fresh = now - s.at <= LOBBY_SAMPLE_MS
    const afk = now - s.movedAt >= LOBBY_AFK_MS
    const zone = !fresh
      ? (pick ? teamIdOf(pick) : 'stale')
      : named
        ? named.id
        : (standing ? teamIdOf(standing) : (pick ? teamIdOf(pick) : (c ? 'abstain' : 'out')))
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
  chosen.delete(key)
}

export function clearLobbyVotes(): void {
  samples.clear()
  lastAt.clear()
  chosen.clear()
}

export function lobbySampleIds(): string[] {
  return [...samples.keys()]
}

function liveVote(id: string, now: number): ModeId | '' {
  const s = samples.get(keyOf(id))
  if (!s || now - s.at > LOBBY_SAMPLE_MS) return ''
  return voteModeAt(s.x, s.z, MAZE_ORIGIN, CELL)
}

/** The mode this player is currently counted for, or '' if they are not. Unused while modes are unplaced. */
export function countedMode(id: string, now: number): ModeId | '' {
  return liveVote(id, now)
}

/** Sticky team this player has chosen, or 0 if they have not picked yet. */
export function countedTeam(id: string, _now?: number): TeamChoice | 0 {
  return chosen.get(keyOf(id)) ?? 0
}

/** Snapshot of sticky picks, keyed in lowercase, for round-start assignment. */
export function snapshotLobbyChoices(): Map<string, TeamChoice> {
  return new Map(chosen)
}

/** Present ids plus anyone who has sent feet or already chosen a team. */
function voterIds(present: string[]): string[] {
  const ids = new Set<string>()
  for (const id of present) ids.add(keyOf(id))
  for (const id of samples.keys()) ids.add(id)
  for (const id of chosen.keys()) ids.add(id)
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

export function tallyTeams(present: string[], _now?: number): TeamCounts & { voted: Set<string> } {
  const counts = emptyTeamCounts()
  const voted = new Set<string>()
  for (const id of voterIds(present)) {
    const team = countedTeam(id)
    if (!team) continue
    if (team === 1) counts.red++; else counts.blue++
    voted.add(id)
  }
  return { ...counts, voted }
}

/** Why the stored sample does not add to the tally. `ok` when it does. */
export function lobbyVerdict(present: string[], now: number): { counts: VoteCounts; zone: string; why: string } {
  const teams = tallyTeams(present, now)
  const counts = tallyVotes(present, now).counts
  const sampleIds = lobbySampleIds()
  const presentNorm = new Set(present.map(keyOf))
  const id = sampleIds[0] ?? (present[0] ? keyOf(present[0]) : '')
  if (!id) {
    const first = present[0] ? keyOf(present[0]) : ''
    const pick = first ? countedTeam(first) : 0
    return { counts, zone: pick ? teamIdOf(pick) : 'none', why: pick ? 'ok' : 'no-sample' }
  }
  const s = samples.get(id)
  const pick = countedTeam(id)
  if (!s) return { counts, zone: pick ? teamIdOf(pick) : 'none', why: pick ? 'ok' : (sampleIds.length ? 'id-mismatch' : 'no-sample') }
  const c = cellAt(s.x, s.z, MAZE_ORIGIN, CELL)
  const named = LOBBY_TEAMS.find(t => c && t.cell.x === c.x && t.cell.z === c.z)
  const standing = voteTeamAt(s.x, s.z, MAZE_ORIGIN, CELL)
  const zone = named ? named.id : (standing ? teamIdOf(standing) : (pick ? teamIdOf(pick) : (c ? 'abstain' : 'out')))
  if (now - s.at > LOBBY_SAMPLE_MS) return { counts, zone: pick ? teamIdOf(pick) : zone, why: pick ? 'ok' : 'stale' }
  if (!presentNorm.has(id) && present.length > 0) {
    return { counts, zone, why: pick || standing ? 'ok-id' : zone }
  }
  if (standing || pick) return { counts, zone, why: 'ok' }
  if (!c) return { counts, zone: 'out', why: 'out' }
  return { counts, zone: 'abstain', why: 'abstain' }
}

export type LobbyClock = {
  wantFull: boolean
  countdownEnds: number
  hadVotes: boolean
  readyAt: number
  /** When the live tally last dropped to 0 during a countdown. */
  emptySince: number
}

/** One scoring tick. The countdown is LOBBY_VOTE_MS, started by the first team choice.
 *  Everyone being in a zone does not close it early. No choices leaves it idle. */
export function stepLobby(s: LobbyClock, present: string[], now: number): { next: LobbyClock; log: '' | 'close' | 'start' | 'resolve' } {
  const next: LobbyClock = { ...s }
  const voters = voterIds(present)
  if (voters.length === 0) {
    if (next.countdownEnds !== 0 || next.wantFull) {
      next.countdownEnds = 0
      next.hadVotes = false
      next.wantFull = false
      next.emptySince = 0
      return { next, log: 'close' }
    }
    return { next, log: '' }
  }
  const teams = tallyTeams(voters, now)
  const any = teams.red + teams.blue > 0
  if (next.countdownEnds > 0) {
    if (any) { next.hadVotes = true; next.emptySince = 0 }
    else if (next.hadVotes) {
      if (next.emptySince === 0) next.emptySince = now
      // One stale frame used to cancel the countdown immediately.
      if (now - next.emptySince >= 2000) {
        next.countdownEnds = 0
        next.hadVotes = false
        next.wantFull = false
        next.emptySince = 0
        return { next, log: 'close' }
      }
    }
    if (now >= next.countdownEnds) return { next, log: 'resolve' }
    return { next, log: '' }
  }
  if (any) {
    next.countdownEnds = now + LOBBY_VOTE_MS
    next.hadVotes = true
    next.emptySince = 0
    next.wantFull = false
    return { next, log: 'start' }
  }
  return { next, log: '' }
}

export function everyoneInZone(present: string[], now: number): boolean {
  return everyPresentInZone(present, tallyTeams(present, now).voted)
}

