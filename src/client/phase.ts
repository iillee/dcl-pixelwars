/**
 * Client mirror of the server phase. Combat and paint read this.
 * The lobby floor (voting cross) is up for both 'lobby' and 'idle'.
 */
import type { LobbyPhase, ModeId } from '../shared/lobby'

export type VoteRow = { id: string; n: number }

let phase: LobbyPhase = 'match'
let voteMs = 0
let votes: VoteRow[] = []
let winner = ''

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
}

export function voteWinner(): string {
  return winner
}
