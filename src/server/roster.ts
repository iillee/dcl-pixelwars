/**
 * roster.ts — authoritative team assignment.
 *
 * The roster is an ordered list of userIds in join order. A player's team
 * is `roster.indexOf(userId) % 2` (1 = Red, 2 = Blue, matching the client
 * Team enum). Consequences:
 *
 *   - Guaranteed alternation. First joiner is Red, second Blue, third Red...
 *     Fixes the Phase-3 client-hash approach that could put 2 blue players
 *     in a row by coincidence.
 *   - Stable across rejoin. A returning userId gets its original team.
 *   - No compaction on leave. If player #3 leaves, the roster keeps their
 *     slot; the next new joiner becomes player #5. Compacting would flip
 *     everyone's team when someone leaves \u2014 disastrous mid-round.
 *
 * The roster lives in RAM. Rounds don't persist it, and a server restart
 * resets it. That's fine for Phase 4; leaderboard persistence lands later.
 */

const roster: string[] = []

// Coin-flip chosen ONCE at server startup. 0 = first joiner is Red
// (roster idx 0 -> team 1), 1 = first joiner is Blue (roster idx 0 ->
// team 2). Applied identically to every team lookup so alternation and
// rejoin-stability are preserved — all we're doing is randomising which
// team lands on the even slots. Kept in RAM: a server restart re-rolls,
// which is fine (the roster is also RAM-only).
const teamParityFlip: 0 | 1 = Math.random() < 0.5 ? 0 : 1
console.log(`[Roster] team parity: first joiner will be ${teamParityFlip === 0 ? 'RED' : 'BLUE'}`)

function teamFromIndex(idx: number): number {
  return ((idx + teamParityFlip) % 2 === 0) ? 1 : 2
}

// Last-activity timestamps per userId. Populated by markActive() from
// paintTick + joinRoster handlers. Used by activeCount / activeSoloTeam
// to filter out invisible scraper bots that connect but never paint.
const lastActiveAt = new Map<string, number>()

/** 60s of no paint activity = considered idle/scraper. Real players
 *  paint constantly while moving; even AFK players usually resume
 *  within a minute. Tuneable if we see too many false-idle boots. */
const ACTIVE_WINDOW_MS = 60000

/** Assign or look up the team for a userId. Returns 1 (Red) or 2 (Blue). */
export function assignTeam(userId: string): number {
  let idx = roster.indexOf(userId)
  if (idx === -1) {
    roster.push(userId)
    idx = roster.length - 1
  }
  // Parity + one-time random flip: matches Team enum in src/paint.ts
  // (1 = Red, 2 = Blue). See teamParityFlip declaration above.
  return teamFromIndex(idx)
}

/** For diagnostics / future admin tools. */
export function rosterSize(): number {
  return roster.length
}

/** Mark a userId as having done something "player-like" (painted, joined).
 *  Called from server.ts on paintTick and joinRoster. */
export function markActive(userId: string): void {
  lastActiveAt.set(userId, Date.now())
}

/** Mark a userId as gone. Called from server.ts on onLeaveScene so the
 *  active-human count drops immediately instead of waiting for the 60s
 *  activity window to expire. Roster slot is preserved (rejoin stability);
 *  only the activity timestamp is cleared. */
export function markInactive(userId: string): void {
  lastActiveAt.delete(userId)
}

/** Count roster members who've been active in the last ACTIVE_WINDOW_MS.
 *  Filters out invisible/scraper accounts that connect but never paint. */
export function activeHumanCount(): number {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS
  let n = 0
  for (const uid of roster) {
    const last = lastActiveAt.get(uid) ?? 0
    if (last >= cutoff) n++
  }
  return n
}

/** Team of the single active human, or null if the active count isn't
 *  exactly 1. Used by the bot manager to pick the opposite colour. */
export function activeSoloHumanTeam(): number | null {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS
  let found: string | null = null
  for (const uid of roster) {
    const last = lastActiveAt.get(uid) ?? 0
    if (last < cutoff) continue
    if (found !== null) return null // more than one active
    found = uid
  }
  if (!found) return null
  return getTeam(found)
}

/**
 * Team of the Nth roster slot (0 = first joiner). Returns null if the
 * roster is shorter than that. Used by the bot manager to pick the
 * opposite colour of the sole human player when spawning a solo-mode bot.
 */
export function getTeamAt(index: number): number | null {
  if (index < 0 || index >= roster.length) return null
  return teamFromIndex(index)
}

/**
 * Look up a userId's team without side effects. Returns 1 (Red), 2 (Blue),
 * or null if the user has never called joinRoster. Used by the paintTick
 * handler to attribute paint to a team.
 */
export function getTeam(userId: string): number | null {
  const idx = roster.indexOf(userId)
  if (idx === -1) return null
  return teamFromIndex(idx)
}
