/**
 * verify-bot-count.ts — one active human is one bot, including across a round.
 * Run: npx tsx scripts/verify-bot-count.ts
 *
 * PvP fill is the short-team gap (1 red human → 1 blue bot). A round rebuild
 * reseats that bot; it must not spawn a second. PvB with one human is also
 * one bot, and a fresh population trims a pool that grew.
 */
import { initBots, rebuildBotGraph, tickBots, getBotPositions, setPopulation } from '../src/server/bots/manager'

let counts = { red: 1, blue: 0 }
initBots({ applyPaint: () => false, paint: { teamOf: () => 0 }, activeHumans: () => counts })
rebuildBotGraph(42)

function snap(): Array<{ id: number; team: number }> {
  return getBotPositions().map(b => ({ id: b.id, team: b.team })).sort((a, b) => a.id - b.id)
}
function expect(n: number, label: string, team?: number): Array<{ id: number; team: number }> {
  tickBots(0)
  const got = snap()
  const unique = new Set(got.map(b => b.id))
  const teamOk = team === undefined || got.every(b => b.team === team)
  if (got.length !== n || unique.size !== got.length || !teamOk) {
    console.error(`✗ ${label}: expected ${n} unique${team ? ` team ${team}` : ''} bots, got ${JSON.stringify(got)}`)
    process.exit(1)
  }
  console.log(`✓ ${label}: ${n} [${got.map(b => `${b.id}@${b.team}`).join(',')}]`)
  return got
}

const solo = expect(1, 'PvP 1 red human', 2)
rebuildBotGraph(43)
const afterRound = expect(1, 'next round, still 1 human', 2)
if (afterRound[0].id !== solo[0].id) {
  console.error(`✗ round rebuild spawned bot #${afterRound[0].id} beside #${solo[0].id} instead of reseating`)
  process.exit(1)
}
console.log(`✓ round rebuild kept bot #${solo[0].id}`)

counts = { red: 1, blue: 1 }
expect(0, 'second human on the other team')
counts = { red: 1, blue: 0 }
expect(1, 'back to 1 human', 2)

setPopulation({ kind: 'pvb', humanTeam: 1 })
expect(1, 'PvB 1 human', 2)
counts = { red: 2, blue: 0 }
expect(2, 'PvB a second human joins', 2)
counts = { red: 1, blue: 0 }
setPopulation({ kind: 'pvb', humanTeam: 1 })
expect(1, 'PvB fresh round trims back to 1', 2)

setPopulation({ kind: 'pvp' })
counts = { red: 0, blue: 1 }
expect(1, 'PvP short side flipped', 1)
console.log('✓ bot count matches the active-human gap')
