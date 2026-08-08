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

// Active-window tracking. Bots use activeHumanCount() to decide whether
// to spawn (solo-mode). We can't rely on rosterSize() because it grows
// monotonically — a leaver's slot is preserved for team-stability.
// activeAt is bumped on any signal the user is still present
// (joinRoster, paintTick). markInactive() clears it on leave-scene.
const activeAt = new Map<string, number>()
const ACTIVE_WINDOW_MS = 60_000


// MARK: assignTeam

/** Assign or look up the team for a userId. Returns 1 (Red) or 2 (Blue). */
export function assignTeam(userId: string): number {
	let idx = roster.indexOf(userId)
	if (idx === -1) {
		roster.push(userId)
		idx = roster.length - 1
	}
	return (idx % 2 === 0) ? 1 : 2
}


// MARK: rosterSize

/** Total historical joiners (never decreases). For diagnostics. */
export function rosterSize(): number {
	return roster.length
}


// MARK: getTeam

/**
 * Look up a userId's team without side effects. Returns 1 (Red),
 * 2 (Blue), or null if the user has never called joinRoster.
 */
export function getTeam(userId: string): number | null {
	const idx = roster.indexOf(userId)
	if (idx === -1) return null
	return (idx % 2 === 0) ? 1 : 2
}


// MARK: markActive

/** Bump the user's activity timestamp. Called on joinRoster + paintTick. */
export function markActive(userId: string): void {
	activeAt.set(userId, Date.now())
}


// MARK: markInactive

/** Clear the user's activity timestamp. Called on leave-scene so the
 *  bot manager can react within one tick instead of waiting for the
 *  60s window to expire. Roster slot is preserved. */
export function markInactive(userId: string): void {
	activeAt.delete(userId)
}


// MARK: activeHumanCount

/** Number of humans seen within ACTIVE_WINDOW_MS. */
export function activeHumanCount(): number {
	const cutoff = Date.now() - ACTIVE_WINDOW_MS
	let count = 0
	for (const t of activeAt.values()) {
		if (t >= cutoff) count++
	}
	return count
}


// MARK: activeSoloHumanTeam

/**
 * When exactly one human is active, return their team (1 or 2) so the
 * bot manager can spawn the ghost on the opposite team. Returns null
 * otherwise. Cheap: O(N_active) with N_active tiny in practice.
 */
export function activeSoloHumanTeam(): number | null {
	const cutoff = Date.now() - ACTIVE_WINDOW_MS
	let loneUser: string | null = null
	for (const [userId, t] of activeAt) {
		if (t < cutoff) continue
		if (loneUser !== null) return null // more than one active
		loneUser = userId
	}
	return loneUser === null ? null : getTeam(loneUser)
}
