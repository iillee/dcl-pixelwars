/**
 * botFaceState.ts — headless resolver for a bot's 2D face.
 *
 * Priority is hit > glide > fall > burst > dash > idle. Short actions
 * (hit, burst, dash) are latched so they stay visible even though the
 * client only sees botPositions at about 2 Hz, and a lunge or dash is
 * only ~0.2 s on the wire.
 *
 * Continuous poses (glide, fall) come from the pose code, the playing
 * clip, or the wire state (st 4 = gliding). Own-lunge is locomotion on
 * the wire (animCode keeps BOT_ANIM_LOCO), so it does not look like a
 * fall; the dash face is event-latched from lunge:started instead.
 */
import { BOT_ANIM_FALL, BOT_ANIM_GLIDE, type GhostClip } from './botAnim'

export type BotFaceExpr = 'idle' | 'dash' | 'burst' | 'hit' | 'fall' | 'glide' | 'star'

export const FACE_PRIORITY: Record<BotFaceExpr, number> = {
  star: 6,
  hit: 5,
  glide: 4,
  fall: 3,
  burst: 2,
  dash: 1,
  idle: 0,
}

/** Minimum display time (s). Event-driven faces are longer than a 2 Hz gap. */
export const FACE_MIN_S: Record<BotFaceExpr, number> = {
  star: 0,
  hit: 0.6,
  glide: 0.3,
  fall: 0.3,
  burst: 0.55,
  dash: 0.55,
  idle: 0,
}

/** Until-ms for each latched expression. */
export type FaceLatches = Partial<Record<BotFaceExpr, number>>

export function latchFace(
  latches: FaceLatches,
  expr: BotFaceExpr,
  nowMs: number,
  minS = FACE_MIN_S[expr],
): FaceLatches {
  if (minS <= 0) return { ...latches }
  const until = nowMs + minS * 1000
  const prev = latches[expr] ?? 0
  return { ...latches, [expr]: prev > until ? prev : until }
}

/** Continuous face from pose / clip / wire state, or null if none. */
export function faceFromMotion(pose: number, st: number, clip: GhostClip | null): BotFaceExpr | null {
  if (clip === 'glide' || pose === BOT_ANIM_GLIDE || st === 4) return 'glide'
  if (clip === 'fall' || pose === BOT_ANIM_FALL) return 'fall'
  return null
}

export function pruneLatches(latches: FaceLatches, nowMs: number): FaceLatches {
  const next: FaceLatches = {}
  for (const key of Object.keys(latches) as BotFaceExpr[]) {
    const until = latches[key]
    if (until !== undefined && until > nowMs) next[key] = until
  }
  return next
}

export function resolveBotFace(args: {
  nowMs: number
  pose: number
  st: number
  clip: GhostClip | null
  latches: FaceLatches
  starred?: boolean
}): { expr: BotFaceExpr; latches: FaceLatches } {
  let latches = pruneLatches(args.latches, args.nowMs)
  const motion = faceFromMotion(args.pose, args.st, args.clip)
  if (motion) latches = latchFace(latches, motion, args.nowMs)
  let expr: BotFaceExpr = 'idle'
  let best = FACE_PRIORITY.idle
  const consider = (e: BotFaceExpr) => {
    const p = FACE_PRIORITY[e]
    if (p > best) {
      best = p
      expr = e
    }
  }
  for (const key of Object.keys(latches) as BotFaceExpr[]) consider(key)
  if (motion) consider(motion)
  if (args.starred) consider('star')
  return { expr, latches }
}

/** Parse a `bot:N` id from an attacker or impact target. */
export function botIdFromActor(actor: string): number | null {
  const s = actor.toLowerCase()
  if (!s.startsWith('bot:')) return null
  const n = parseInt(s.slice(4), 10)
  return Number.isFinite(n) ? n : null
}
