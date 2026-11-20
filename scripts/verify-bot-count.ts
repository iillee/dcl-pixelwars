/**
 * verify-bot-count.ts — one active human is one bot, including across a round.
 * Run: npx tsx scripts/verify-bot-count.ts
 *
 * PvP fill evens all four teams to the largest human side (1 red human → one
 * bot each on blue, green, and yellow). A round rebuild reseats those bots; it must not spawn extras. PvB with one human is also
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

function teamsOf(got: Array<{ team: number }>): string {
  return got.map(b => b.team).sort((a, b) => a - b).join(',')
}
const solo = expect(3, 'PvP 1 red human')
if (teamsOf(solo) !== '2,3,4') {
  console.error(`✗ PvP 1 red should fill blue/green/yellow, got ${teamsOf(solo)}`)
  process.exit(1)
}
rebuildBotGraph(43)
const afterRound = expect(3, 'next round, still 1 human')
const soloIds = solo.map(b => b.id).sort((a, b) => a - b).join()
const afterIds = afterRound.map(b => b.id).sort((a, b) => a - b).join()
if (afterIds !== soloIds) {
  console.error(`✗ round rebuild changed bot ids ${soloIds} → ${afterIds}`)
  process.exit(1)
}
console.log(`✓ round rebuild kept bots #${soloIds}`)

counts = { red: 1, blue: 1, green: 0, yellow: 0 }
const split = expect(2, 'humans on red and blue')
if (teamsOf(split) !== '3,4') {
  console.error(`✗ two human teams should fill the other two, got ${teamsOf(split)}`)
  process.exit(1)
}
counts = { red: 1, blue: 0, green: 0, yellow: 0 }
expect(3, 'back to 1 human')

setPopulation({ kind: 'pvb', humanTeam: 1 })
expect(2, 'PvB 1 human', 2)
counts = { red: 2, blue: 0 }
expect(4, 'PvB a second human joins', 2)
counts = { red: 1, blue: 0 }
setPopulation({ kind: 'pvb', humanTeam: 1 })
expect(2, 'PvB fresh round trims back to 2x', 2)

setPopulation({ kind: 'pvp' })
counts = { red: 0, blue: 1, green: 0, yellow: 0 }
const flipped = expect(3, 'PvP one blue human')
if (teamsOf(flipped) !== '1,3,4') {
  console.error(`✗ PvP 1 blue should fill red/green/yellow, got ${teamsOf(flipped)}`)
  process.exit(1)
}
console.log('✓ bot count evens the four teams')
