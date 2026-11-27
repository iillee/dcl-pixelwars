/**
 * Client mirror of the server phase. Combat and paint read this.
 * The lobby floor (voting cross) is up for both 'lobby' and 'idle'.
 */
import type { LobbyPhase, ModeId, TeamId } from '../shared/lobby'

export type VoteRow = { id: string; n: number }

// Boot in the lobby. A match clock is what leaves it. Starting on 'match'
// showed a round timer and blocked feet reports until the first clock.
let phase: LobbyPhase = 'idle'
let voteMs = 0
let voteEndsAt = 0
let sawCountdown = false
let starting = false
/** Highest whole second this countdown may show (15 or 5). Keeps the +1s offset from flashing 16/6. */
let displayCapSec = 0
let votes: VoteRow[] = []
let winner = ''
let serverPresent = 0
let serverFeet = 0
let clocks = 0
let serverZone = 'none'
let serverWhy = 'no-clock'
let mine: ModeId | TeamId | '' = ''

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
  if (voteEndsAt <= 0) return 0
  return Math.max(0, voteEndsAt - Date.now())
}

/** Visible countdown stays up this long after the server timer so 0 lands when the level appears. */
export const LOBBY_COUNTDOWN_DISPLAY_MS = 1_000

export function voteDisplayRemainingMs(): number {
  if (voteEndsAt <= 0) return 0
  const raw = Math.max(0, voteEndsAt + LOBBY_COUNTDOWN_DISPLAY_MS - Date.now())
  if (displayCapSec <= 0) return raw
  return Math.min(raw, displayCapSec * 1000)
}

/** True in the gap after the lobby countdown hits 0 and before the match clock.
 *  A mid-countdown cancel (votes left) is not starting — that goes back to CHOOSE A TEAM. */
export function isLobbyStarting(): boolean {
  if (phase === 'match' || phase === 'summary') return false
  if (starting) return true
  return voteEndsAt > 0 && Date.now() >= voteEndsAt
}

export function voteRows(): VoteRow[] {
  return votes
}

export function voteCount(id: string): number {
  return votes.find(v => v.id === id)?.n ?? 0
}

export function setGamePhase(next: LobbyPhase, nextVoteMs: number, nextVotes: VoteRow[], nextWinner: string): void {
  if (next === 'match' || next === 'summary') {
    sawCountdown = false
    starting = false
    displayCapSec = 0
  } else if (nextVoteMs > 0) {
    const nextSec = Math.ceil(nextVoteMs / 1000)
    if (!sawCountdown || displayCapSec <= 0 || nextSec > displayCapSec) {
      displayCapSec = nextSec
    } else if (voteRemainingMs() - nextVoteMs > 400) {
      displayCapSec = nextSec
    }
    sawCountdown = true
    starting = false
  } else if (sawCountdown) {
    // A clock with voteMs=0 while time was still clearly left is a cancel.
    // An expiry (timer already at/near 0) stays in STARTING... until match.
    if (voteEndsAt > Date.now() + 400) {
      sawCountdown = false
      starting = false
      displayCapSec = 0
    } else {
      starting = true
    }
  }
  phase = next
  voteMs = nextVoteMs
  if (nextVoteMs > 0) {
    voteEndsAt = Date.now() + nextVoteMs
  } else if (!starting) {
    voteEndsAt = 0
  }
  votes = nextVotes
  winner = nextWinner
  if (next === 'match' || next === 'summary') mine = ''
  clocks++
}

/** Team (or leftover mode id) the server is counting for us. Empty until that clock says so. */
export function myVote(): ModeId | TeamId | '' {
  return mine
}

export function setMyVote(next: string): void {
  mine = next === 'red' || next === 'blue' || next === 'green' || next === 'yellow' || next === 'pvp' || next === 'pvb' || next === 'bases' || next === 'prototype' || next === 'balloon' ? next : ''
}

/** present = players the server is scoring. feet = stored lobby samples. */
export function setServerLobbyCounts(present: number, feet: number, zone: string, why: string): void {
  serverPresent = present
  serverFeet = feet
  serverZone = zone
  serverWhy = why
}

export function serverLobbyCounts(): { present: number; feet: number; clocks: number; zone: string; why: string } {
  return { present: serverPresent, feet: serverFeet, clocks, zone: serverZone, why: serverWhy }
}

export function voteWinner(): string {
  return winner
}
