/**
 * roster.ts — authoritative team assignment.
 *
 * V1 balance rules (PO Week 1):
 *   - A NEW joiner goes to the team with fewer ACTIVE humans (see
 *     ACTIVE_WINDOW_MS). Ties go to a coin flip.
 *   - A RETURNING userId keeps the team it already holds this round.
 *   - A live player's team is never changed mid-round.
 *   - At a round boundary, players who are no longer active lose their
 *     assignment (pruneForNewRound) so a later rejoin gets re-balanced.
 *     Active players keep their colour across rounds.
 *
 * Lives in RAM; a server restart resets it.
 */

const teamOf = new Map<string, number>() // userId → 1 (Red) | 2 (Blue)

// Last-activity timestamps per userId. Populated by markActive() from
// paintTick + joinRoster handlers. Used to filter out invisible scraper
// bots that connect but never paint, and as the balance headcount.
const lastActiveAt = new Map<string, number>()

// Users currently connected (joined and not yet onLeaveScene). Drives the
// teamRoster broadcast (name tags) and round-boundary pruning, so an idle
// but connected player keeps both their tag and their team.
const connected = new Set<string>()

/** 60s of no paint activity = considered idle/scraper. */
const ACTIVE_WINDOW_MS = 60000

function isActive(uid: string, now = Date.now()): boolean {
  return (lastActiveAt.get(uid) ?? 0) >= now - ACTIVE_WINDOW_MS
}

/** Active human count per team, optionally excluding one userId. */
export function activeTeamCounts(exclude?: string): { red: number; blue: number } {
  const now = Date.now()
  let red = 0, blue = 0
  for (const [uid, t] of teamOf) {
    if (uid === exclude || !isActive(uid, now)) continue
    if (t === 1) red++
    else if (t === 2) blue++
  }
  return { red, blue }
}

/** Assign or look up the team for a userId. Returns 1 (Red) or 2 (Blue). */
export function assignTeam(userId: string): number {
  const existing = teamOf.get(userId)
  if (existing !== undefined) return existing
  const { red, blue } = activeTeamCounts(userId)
  const team = red < blue ? 1 : blue < red ? 2 : (Math.random() < 0.5 ? 1 : 2)
  teamOf.set(userId, team)
  console.log(`[Roster] new ${userId} → ${team === 1 ? 'RED' : 'BLUE'} (active red=${red} blue=${blue})`)
  return team
}

/**
 * Round boundary: drop assignments of players who have disconnected so a
 * later rejoin is balanced against the current lobby. Connected players
 * (even idle ones) keep their team. Returns how many were pruned.
 */
export function pruneForNewRound(): number {
  let n = 0
  for (const uid of Array.from(teamOf.keys())) {
    if (!connected.has(uid)) { teamOf.delete(uid); lastActiveAt.delete(uid); n++ }
  }
  return n
}

/**
 * Round boundary: randomly reassign every connected roster player to RED/BLUE, sizes differing by at most 1.
 * With >= 3 players, re-rolls (up to 20x) to avoid the exact same grouping as last round (colours swapped
 * still counts as the same grouping). Returns the new assignments.
 */
let lastSplit = ''
export function shuffleTeams(): Array<{ userId: string; team: number }> {
  const ids = Array.from(teamOf.keys()).filter(uid => connected.has(uid))
  const keyOf = (red: string[]): string => {
    const r = red.slice().sort().join(','), b = ids.filter(u => !red.includes(u)).sort().join(',')
    return r < b ? r + '|' + b : b + '|' + r
  }
  let red: string[] = []
  for (let tries = 0; tries < 20; tries++) {
    const a = ids.slice()
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t }
    // Odd count: which side gets the extra player is random too.
    const nRed = a.length % 2 === 0 ? a.length / 2 : (Math.random() < 0.5 ? Math.floor(a.length / 2) : Math.ceil(a.length / 2))
    red = a.slice(0, nRed)
    if (ids.length < 3 || keyOf(red) !== lastSplit) break
  }
  lastSplit = keyOf(red)
  const out: Array<{ userId: string; team: number }> = []
  for (const uid of ids) { const team = red.includes(uid) ? 1 : 2; teamOf.set(uid, team); out.push({ userId: uid, team }) }
  return out
}

/** Force a player's team (1v1 join fix). */
export function setTeam(userId: string, team: number): void {
  teamOf.set(userId, team)
}

/** Corruption PvE: every connected player on the same team (default Red). */
export function assignAllToTeam(team: number = 1): Array<{ userId: string; team: number }> {
  const out: Array<{ userId: string; team: number }> = []
  for (const uid of Array.from(teamOf.keys()).filter(u => connected.has(u))) {
    teamOf.set(uid, team)
    out.push({ userId: uid, team })
  }
  return out
}

/** For diagnostics. */
export function rosterSize(): number {
  return teamOf.size
}

/** Mark a userId as having done something "player-like" (painted, joined). */
export function markActive(userId: string): void {
  lastActiveAt.set(userId, Date.now())
  connected.add(userId)
}

/** Mark a userId as gone (onLeaveScene). Team kept for this round so a
 *  quick rejoin returns to the same colour. */
export function markInactive(userId: string): void {
  lastActiveAt.delete(userId)
  connected.delete(userId)
}

/** Players currently connected (joined, not left). */
export function connectedCount(): number {
  return connected.size
}

/** Count roster members active in the last ACTIVE_WINDOW_MS. */
export function activeHumanCount(): number {
  const c = activeTeamCounts()
  return c.red + c.blue
}

/** Team of the single active human, or null if the active count isn't
 *  exactly 1. Used by the bot manager to pick the opposite colour. */
export function activeSoloHumanTeam(exclude?: string): number | null {
  const now = Date.now()
  let found: number | null = null
  for (const [uid, t] of teamOf) {
    if (uid === exclude || !isActive(uid, now)) continue
    if (found !== null) return null
    found = t
  }
  return found
}

/** Look up a userId's team without side effects (null if never joined). */
export function getTeam(userId: string): number | null {
  return teamOf.get(userId) ?? null
}

/** Connected players (idle included) and their teams, for the teamRoster
 *  broadcast. Players who left (markInactive) are omitted so their tag clears. */
export function rosterEntries(): Array<{ userId: string; team: number }> {
  const out: Array<{ userId: string; team: number }> = []
  for (const [userId, team] of teamOf) if (connected.has(userId)) out.push({ userId, team })
  return out
}
