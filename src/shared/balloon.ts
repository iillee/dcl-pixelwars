/**
 * Balloon Battle rules. Pure. The server is the authority for counts
 * and elimination; the client only renders what it is told.
 *
 * A match starts every participant (humans and bots) at 3 balloons.
 * Falling off and respawning pops one. At 0 the player is out.
 * Last living participant wins. Paint never changes in this mode.
 */

export const BALLOON_START = 3

/**
 * How the balloons follow the avatar. Flip this to compare styles.
 *  'attached' - follows the avatar root (no walk-cycle bob), smoothed yaw, floaty jiggle.
 *  'trail'    - the original world-space spring follow, with lag.
 */
export type BalloonStyle = 'attached' | 'trail'
export const BALLOON_STYLE: BalloonStyle = 'attached'

/** Visible balloon rigs exist only during a live Balloon Battle match, not in summary or the lobby. */
export function balloonsLive(phase: string, format: string): boolean {
  return format === 'balloon' && phase === 'match'
}

export type BalloonCounts = Record<string, number>

export type BalloonVerdict =
  | { kind: 'continue' }
  | { kind: 'winner'; id: string }
  | { kind: 'tie' }

export function paintAllowed(format: string): boolean {
  return format !== 'balloon'
}

export function emptyBalloons(): BalloonCounts {
  return {}
}

export function startingBalloons(ids: string[]): BalloonCounts {
  const counts: BalloonCounts = {}
  for (const raw of ids) {
    const id = raw.toLowerCase()
    if (!id) continue
    counts[id] = BALLOON_START
  }
  return counts
}

export function balloonOf(counts: BalloonCounts, id: string): number {
  return counts[id.toLowerCase()] ?? 0
}

export function livingIds(counts: BalloonCounts): string[] {
  return Object.keys(counts).filter(id => (counts[id] ?? 0) > 0)
}

/** Pop one balloon after a fall/respawn. Already-eliminated players are ignored. */
export function popBalloon(counts: BalloonCounts, id: string): {
  counts: BalloonCounts
  popped: boolean
  eliminated: boolean
  before: number
  after: number
} {
  const key = id.toLowerCase()
  const before = counts[key] ?? 0
  if (before <= 0) {
    return { counts, popped: false, eliminated: false, before, after: before }
  }
  const after = before - 1
  return {
    counts: { ...counts, [key]: after },
    popped: true,
    eliminated: after === 0,
    before,
    after,
  }
}

/**
 * Last standing, used after a pop or a leave. `started` is how many
 * participants the book began with: a solo match is not an instant win.
 */
export function lastStanding(counts: BalloonCounts, started: number): BalloonVerdict {
  const living = livingIds(counts)
  if (living.length > 1) return { kind: 'continue' }
  if (living.length === 0) return { kind: 'tie' }
  if (started <= 1) return { kind: 'continue' }
  return { kind: 'winner', id: living[0] }
}

/** Clock ran out: most balloons left wins, or a tie if that count is shared. */
export function balloonTimeout(counts: BalloonCounts): BalloonVerdict {
  const ids = Object.keys(counts)
  if (ids.length === 0) return { kind: 'tie' }
  let best = 0
  for (const id of ids) best = Math.max(best, counts[id] ?? 0)
  const tied = ids.filter(id => (counts[id] ?? 0) === best)
  if (best <= 0 || tied.length !== 1) return { kind: 'tie' }
  return { kind: 'winner', id: tied[0] }
}

/** Drop a participant who left mid-match, then re-check last standing. */
export function dropParticipant(counts: BalloonCounts, id: string): BalloonCounts {
  const key = id.toLowerCase()
  if (!(key in counts)) return counts
  const next = { ...counts }
  next[key] = 0
  return next
}