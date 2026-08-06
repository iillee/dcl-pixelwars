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

/** Assign or look up the team for a userId. Returns 1 (Red) or 2 (Blue). */
export function assignTeam(userId: string): number {
  let idx = roster.indexOf(userId)
  if (idx === -1) {
    roster.push(userId)
    idx = roster.length - 1
  }
  // idx even = Red (1), odd = Blue (2). Matches Team enum in src/shared/team.ts.
  return (idx % 2 === 0) ? 1 : 2
}

/** For diagnostics / future admin tools. */
export function rosterSize(): number {
  return roster.length
}

/**
 * Look up a userId's team without side effects. Returns 1 (Red), 2 (Blue),
 * or null if the user has never called joinRoster. Used by the paintTick
 * handler to attribute paint to a team.
 */
export function getTeam(userId: string): number | null {
  const idx = roster.indexOf(userId)
  if (idx === -1) return null
  return (idx % 2 === 0) ? 1 : 2
}
