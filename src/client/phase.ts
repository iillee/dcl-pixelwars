/**
 * Client mirror of the server phase. Combat and paint read this.
 * The lobby floor (voting cross) is up for both 'lobby' and 'idle'.
 */
import type { LobbyPhase, ModeId } from '../shared/lobby'

export type VoteRow = { id: string; n: number }

// Boot in the lobby. A match clock is what leaves it. Starting on 'match'
// showed a round timer and blocked feet reports until the first clock.
let phase: LobbyPhase = 'idle'
let voteMs = 0
let votes: VoteRow[] = []
let winner = ''
let serverPresent = 0
let serverFeet = 0
let clocks = 0

export function gamePhase(): LobbyPhase {
  return phase
}

export function paintOpen(): boolean {
  return phase === 'match'
}

/** Hits and knockback. Dash, Burst, and Lunge may still play their own movement and VFX. */
export function hitsOpen(): boolean {
  return phase === 'match'
}

export function inLobby(): boolean {
  return phase === 'lobby' || phase === 'idle'
}

export function voteRemainingMs(): number {
  return voteMs
}

export function voteRows(): VoteRow[] {
  return votes
}

export function voteCount(id: ModeId): number {
  return votes.find(v => v.id === id)?.n ?? 0
}

export function setGamePhase(next: LobbyPhase, nextVoteMs: number, nextVotes: VoteRow[], nextWinner: string): void {
  phase = next
  voteMs = nextVoteMs
  votes = nextVotes
  winner = nextWinner
  clocks++
}

/** present = players the server is scoring. feet = stored lobby samples. */
export function setServerLobbyCounts(present: number, feet: number): void {
  serverPresent = present
  serverFeet = feet
}

export function serverLobbyCounts(): { present: number; feet: number; clocks: number } {
  return { present: serverPresent, feet: serverFeet, clocks }
}

export function voteWinner(): string {
  return winner
}
