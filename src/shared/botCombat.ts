/**
 * Shared combat-target picker for bots.
 *
 * Bots may lunge, burst, or spike enemy-team humans and enemy-team bots.
 * Humans are preferred when one is comparably close: a bot is chosen only
 * when no human is in engage range, or that bot is much closer (see
 * BOT_HUMAN_BIAS). Teammates are never chosen.
 */
import { BOT_ENGAGE_RANGE, BOT_SAME_LEVEL_DY } from './pvp'

/** Prefer a human unless an enemy bot is closer by more than this factor. */
export const BOT_HUMAN_BIAS = 1.6

export type CombatKind = 'human' | 'bot'

export type CombatCandidate = {
  id: string
  team: number
  x: number
  y: number
  z: number
  kind: CombatKind
}

export function planarDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function isFoe(
  from: { id?: string; x: number; y: number; z: number; team: number },
  c: CombatCandidate,
  engageRange: number,
  sameLevelDy: number,
): boolean {
  if (from.id && c.id === from.id) return false
  if (c.team === from.team) return false
  if (Math.abs(c.y - from.y) > sameLevelDy) return false
  return planarDist(from, c) <= engageRange
}

function nearestOfKind(
  from: { x: number; z: number },
  list: readonly CombatCandidate[],
  kind: CombatKind,
): { target: CombatCandidate; dist: number } | null {
  let best: CombatCandidate | null = null
  let bestDist = Infinity
  for (const c of list) {
    if (c.kind !== kind) continue
    const d = planarDist(from, c)
    if (d < bestDist) { best = c; bestDist = d }
  }
  return best ? { target: best, dist: bestDist } : null
}

/**
 * Pick who a bot should swing at.
 * If `avoid` is set, those ids are skipped first; if that leaves no one,
 * the pick is retried against the full foe list (same as the old human hunter).
 */
export function pickCombatTarget(
  from: { id?: string; x: number; y: number; z: number; team: number },
  candidates: readonly CombatCandidate[],
  opts: {
    engageRange?: number
    sameLevelDy?: number
    humanBias?: number
    avoid?: ReadonlySet<string>
  } = {},
): CombatCandidate | null {
  const engageRange = opts.engageRange ?? BOT_ENGAGE_RANGE
  const sameLevelDy = opts.sameLevelDy ?? BOT_SAME_LEVEL_DY
  const humanBias = opts.humanBias ?? BOT_HUMAN_BIAS
  const foes = candidates.filter(c => isFoe(from, c, engageRange, sameLevelDy))
  const choose = (list: readonly CombatCandidate[]): CombatCandidate | null => {
    const human = nearestOfKind(from, list, 'human')
    const bot = nearestOfKind(from, list, 'bot')
    if (human && bot) return human.dist <= bot.dist * humanBias ? human.target : bot.target
    return human?.target ?? bot?.target ?? null
  }
  if (opts.avoid && opts.avoid.size > 0) {
    const first = choose(foes.filter(c => !opts.avoid!.has(c.id)))
    if (first) return first
  }
  return choose(foes)
}
