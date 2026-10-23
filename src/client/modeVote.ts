/**
 * modeVote.ts — client-side mode-vote state for the shared splash UI.
 *
 * Driven by mode:voteOpen / voteTally / voteLocked events. Splash reads
 * this module every frame; casting a vote goes out via room.send.
 */

import { room } from '../shared/messages'
import { events } from '../shared/events'
import { GameMode, GameModeId, MODE_VOTE_MS } from '../shared/gameMode'
import { playUiClick } from './audio'

let voting = false
let endsAtMs = 0
let pixelwars = 0
let ooze = 0
let myVote: GameModeId | null = null
let lockedMode: GameModeId | null = null
let lockedFallback = false
let lockedWanted: GameModeId | null = null
let lockedAtMs = 0
/** Current authoritative mode for the live / next round. */
let currentMode: GameModeId = GameMode.Pixelwars

const LOCKED_BANNER_MS = 2500

export function initModeVoteNet(): void {
  events.on('mode:voteOpen', ({ remainingMs, pixelwars: p, ooze: o }) => {
    voting = true
    endsAtMs = Date.now() + Math.max(0, remainingMs)
    pixelwars = p
    ooze = o
    myVote = null
    lockedMode = null
    lockedFallback = false
    lockedWanted = null
    console.log(`[Client] mode vote open ${Math.round(remainingMs / 1000)}s (pw=${p} ooze=${o})`)
  })
  events.on('mode:voteTally', ({ pixelwars: p, ooze: o }) => {
    pixelwars = p
    ooze = o
  })
  events.on('mode:voteLocked', ({ mode, wanted, fallback }) => {
    voting = false
    lockedMode = mode as GameModeId
    lockedWanted = wanted as GameModeId
    lockedFallback = fallback
    lockedAtMs = Date.now()
    currentMode = mode as GameModeId
    console.log(
      `[Client] mode locked → ${mode === GameMode.Ooze ? 'OOZE' : 'PIXELWARS'}` +
      (fallback ? ` (fallback; wanted ${wanted === GameMode.Ooze ? 'OOZE' : 'PIXELWARS'})` : ''),
    )
  })
}

export function isModeVoting(): boolean {
  return voting && Date.now() < endsAtMs
}

/** Splash should show mode buttons / lock banner. */
export function shouldShowModePick(): boolean {
  if (isModeVoting()) return true
  if (lockedMode !== null && Date.now() - lockedAtMs < LOCKED_BANNER_MS) return true
  return false
}

export function modeVoteSecondsLeft(): number {
  if (!voting) return 0
  return Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000))
}

export function modeVoteTally(): { pixelwars: number; ooze: number } {
  return { pixelwars, ooze }
}

export function myModeVote(): GameModeId | null {
  return myVote
}

export function modeLockInfo(): { mode: GameModeId; wanted: GameModeId; fallback: boolean } | null {
  if (lockedMode === null || Date.now() - lockedAtMs >= LOCKED_BANNER_MS) return null
  return { mode: lockedMode, wanted: lockedWanted ?? lockedMode, fallback: lockedFallback }
}

export function getCurrentGameMode(): GameModeId {
  return currentMode
}

export function setCurrentGameMode(mode: GameModeId): void {
  currentMode = mode
}

export function castModeVote(mode: GameModeId): void {
  if (!isModeVoting()) return
  if (myVote === mode) return
  playUiClick()
  myVote = mode
  room.send('modeVote', { mode })
  console.log(`[Client] → modeVote ${mode === GameMode.Ooze ? 'OOZE' : 'PIXELWARS'}`)
}

/** Confirm-step Back: drop our ballot so early-lock waits and they can re-pick. */
export function clearModeVote(): void {
  if (!isModeVoting()) return
  if (myVote === null) return
  playUiClick()
  myVote = null
  room.send('modeVote', { mode: -1 })
  console.log('[Client] → modeVote CLEARED')
}

/** For splash auto-fade: treat an active vote (or brief lock banner) as "not ready to hide". */
export function modePickBlocksSplashFade(): boolean {
  return shouldShowModePick()
}

export { MODE_VOTE_MS, GameMode }
