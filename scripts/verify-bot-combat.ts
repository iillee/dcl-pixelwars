/**
 * verify-bot-combat.ts — target selection for bot lunge/burst/knock.
 * Run: npx tsx scripts/verify-bot-combat.ts
 *
 * Bots may attack enemy-team bots as well as humans, with a bias toward
 * humans. Teammates are never chosen.
 */
import { BOT_ENGAGE_RANGE } from '../src/shared/pvp'
import { BOT_HUMAN_BIAS, pickCombatTarget, type CombatCandidate } from '../src/shared/botCombat'

let failed = 0
function ok(name: string): void { console.log(`✓ ${name}`) }
function fail(name: string, detail: string): void {
  failed++
  console.error(`✗ ${name}: ${detail}`)
}

const self = { id: 'bot:1', team: 1, x: 0, y: 10, z: 0 }

function cand(partial: Partial<CombatCandidate> & Pick<CombatCandidate, 'id' | 'kind' | 'team'>): CombatCandidate {
  return { x: 0, y: 10, z: 0, ...partial }
}

function pick(list: CombatCandidate[], extra?: { avoid?: Set<string>; engageRange?: number }) {
  return pickCombatTarget(self, list, extra)
}

function expectId(name: string, got: CombatCandidate | null, id: string): void {
  if (!got) { fail(name, 'expected ' + id + ', got none'); return }
  if (got.id !== id) { fail(name, 'expected ' + id + ', got ' + got.id); return }
  ok(name)
}

function expectNone(name: string, got: CombatCandidate | null): void {
  if (got) { fail(name, 'expected none, got ' + got.id); return }
  ok(name)
}

const humanNear = cand({ id: 'player-a', kind: 'human', team: 2, z: 8 })
const humanFar = cand({ id: 'player-b', kind: 'human', team: 2, z: 10 })
const enemyBotNear = cand({ id: 'bot:2', kind: 'bot', team: 2, z: 8 })
const enemyBotCloser = cand({ id: 'bot:3', kind: 'bot', team: 2, z: 4 })
const enemyBotMid = cand({ id: 'bot:4', kind: 'bot', team: 2, z: 6 })
const teammateHuman = cand({ id: 'player-friend', kind: 'human', team: 1, z: 3 })
const teammateBot = cand({ id: 'bot:9', kind: 'bot', team: 1, z: 2 })
const otherLevel = cand({ id: 'player-up', kind: 'human', team: 2, y: 14, z: 4 })
const outOfRange = cand({ id: 'player-far', kind: 'human', team: 2, z: BOT_ENGAGE_RANGE + 2 })

expectId('prefers a comparably close human over an enemy bot', pick([humanNear, enemyBotNear]), 'player-a')
expectId('prefers a human at 8m over an enemy bot at 6m', pick([humanNear, enemyBotMid]), 'player-a')
// 10 > 4 * 1.6 = 6.4, so the much-closer bot wins.
expectId('picks a much closer enemy bot over a farther human', pick([humanFar, enemyBotCloser]), 'bot:3')
expectId('picks an enemy bot when no human is in range', pick([enemyBotNear, teammateHuman, outOfRange]), 'bot:2')
expectNone('never picks a teammate human or teammate bot', pick([teammateHuman, teammateBot]))
expectNone('ignores a human on another level', pick([otherLevel]))
expectNone('ignores everyone outside engage range', pick([outOfRange, cand({ id: 'bot:8', kind: 'bot', team: 2, z: BOT_ENGAGE_RANGE + 1 })]))
expectNone('never picks itself', pick([cand({ id: 'bot:1', kind: 'bot', team: 2, z: 3 })]))

const taken = new Set(['player-a'])
expectId('skips an already-taken human when another foe is free', pick([humanNear, enemyBotNear], { avoid: taken }), 'bot:2')
expectId('retries a taken human when they are the only foe', pick([humanNear], { avoid: taken }), 'player-a')

if (BOT_HUMAN_BIAS <= 1) fail('BOT_HUMAN_BIAS should prefer humans', String(BOT_HUMAN_BIAS))
else ok('BOT_HUMAN_BIAS is ' + BOT_HUMAN_BIAS)

if (failed > 0) { console.error('\n' + failed + ' check(s) failed'); process.exit(1) }
console.log('\n✓ bot combat target selection')
