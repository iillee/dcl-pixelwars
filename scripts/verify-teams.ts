/**
 * verify-teams.ts — four-team assignment, coverage, scoring, and bot fill.
 * Run: npx tsx scripts/verify-teams.ts
 */
import { readFileSync } from 'node:fs'
import { assignLobbyTeams, LOBBY_TEAMS, teamTitle } from '../src/shared/lobby'
import {
  Team, TEAM_HEX, PLAYING_TEAMS, coverageFromTeams, coveragePct, leadingTeams,
  rankedTeams, winnerHeadline, smallestTeam, pvpBotFill, teamCountsTotal,
  emptyTeamCounts, botBodySwatchForTeam,
} from '../src/shared/team'
import { placeLobbyLayout, getPlacedTilesInOrder, spawnAnchor, GRID_W, GRID_H } from '../src/maze/generator'

let failed = 0
function fail(msg: string): void { console.error("✗ " + msg); failed++ }
function ok(msg: string): void { console.log("✓ " + msg) }
function expect(got: unknown, want: unknown, label: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a !== b) fail(`${label}: got ${a}, want ${b}`)
  else ok(label)
}

// Colours: the four pre-19620a2 lobby pills, yellow kept bright.
expect(TEAM_HEX[Team.Red], '#FF7577', 'red #FF7577')
expect(TEAM_HEX[Team.Blue], '#6A99FC', 'blue #6A99FC')
expect(TEAM_HEX[Team.Green], '#4FD68C', 'green #4FD68C')
expect(TEAM_HEX[Team.Yellow], '#FFE04A', 'yellow #FFE04A')
expect(LOBBY_TEAMS.map(t => `${t.id}:${t.cell.x},${t.cell.z}`).join('|'),
  'red:1,2|blue:3,2|yellow:2,3|green:2,1', 'lobby arms W/E/N/S')
expect(teamTitle('yellow'), 'YELLOW', 'yellow title')
expect(botBodySwatchForTeam(Team.Green), '#4FD68C', 'green body swatch')
expect(botBodySwatchForTeam(Team.Yellow), '#FFE04A', 'yellow body swatch')

// Assignment: keep picks; unpicked go to the smallest team; ties prefer lower id.
const keep = assignLobbyTeams(['a', 'b', 'c'], new Map([['a', 3], ['b', 3]]))
expect(keep.map(x => `${x.userId}:${x.team}`).join(), 'a:3,b:3,c:1', 'unpicked joins smallest (red)')
const spread = assignLobbyTeams(['a', 'b', 'c', 'd'], new Map())
expect(spread.map(x => x.team).join(), '1,2,3,4', 'four unpicked fill all four teams')
const tie = smallestTeam({ red: 1, blue: 1, green: 1, yellow: 1 })
expect(tie, Team.Red, 'tie for smallest prefers red')

// Coverage / scoring
const cov = coverageFromTeams([1, 1, 1, 2, 2, 3, 4], 10)
expect(cov, { red: 3, blue: 2, green: 1, yellow: 1, total: 10 }, 'coverage tally')
expect(coveragePct(cov, Team.Red), 30, 'red 30%')
expect(leadingTeams(cov), [Team.Red], 'red leads')
expect(rankedTeams(cov), [Team.Red, Team.Blue, Team.Green, Team.Yellow], 'ranked by count then id')
expect(winnerHeadline(cov), 'RED WINS!', 'headline one winner')
expect(winnerHeadline({ red: 5, blue: 5, green: 1, yellow: 0 }), 'RED & BLUE TIE!', 'two-way tie named')
expect(winnerHeadline({ red: 2, blue: 2, green: 2, yellow: 1 }), "IT'S A TIE!", 'three-way generic tie')
expect(winnerHeadline({ red: 0, blue: 0, green: 0, yellow: 0 }), "IT'S A TIE!", 'empty board is a tie')

// Bot fill: even to max(1, largest human side), cap 3/team and 9 total.
expect(pvpBotFill({ red: 1 }), { red: 0, blue: 1, green: 1, yellow: 1 }, '1 human → 3 bots')
expect(pvpBotFill({ red: 2 }), { red: 0, blue: 2, green: 2, yellow: 2 }, '2 humans on one team → 6 bots')
expect(pvpBotFill({ red: 3 }), { red: 0, blue: 3, green: 3, yellow: 3 }, '3 humans → 9 bots (cap)')
expect(pvpBotFill({ red: 4 }), { red: 0, blue: 3, green: 3, yellow: 3 }, '4 humans still cap at 3/team')
expect(pvpBotFill({ red: 1, blue: 1, green: 1, yellow: 1 }), emptyTeamCounts(), 'even lobby, no bots')
expect(teamCountsTotal(pvpBotFill({ red: 2, blue: 1 })), 5, '2+1 humans → 5 bots')
expect(pvpBotFill({}), emptyTeamCounts(), 'zero humans → no bots')

// Lobby floor: cross + four ends. Spawns: four corners of the 5×5 grid.
const tiles = placeLobbyLayout()
expect(tiles.length, 5, 'lobby is 5 tiles')
expect(tiles[0].type, 'cross', 'center is a cross')
expect(spawnAnchor(1), [0, 0], 'red SW')
expect(spawnAnchor(2), [GRID_W - 1, GRID_H - 1], 'blue NE')
expect(spawnAnchor(3), [GRID_W - 1, 0], 'green SE')
expect(spawnAnchor(4), [0, GRID_H - 1], 'yellow NW')

// UI / wire: no leftover red-vs-blue-only scoreboard.
const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (ui.includes('RED WINS') || ui.includes('BLUE WINS') || ui.includes("b.winner === 'RED' ? 'RED TEAM'")) fail('ui.tsx still has hardcoded RED/BLUE WINS layout')
else ok('ui.tsx has no hardcoded RED WINS / BLUE WINS layout')
if (!ui.includes('TeamScorePill') || !ui.includes('TeamCardGrid') || !ui.includes('HeadlineRow')) fail('ui.tsx is missing the four-team scoreboard components')
else ok('ui.tsx four-team scoreboard components are present')
const pill = ui.slice(ui.indexOf('function TeamScorePill'), ui.indexOf('function TeamCardGrid'))
if (!pill.includes("overflow: 'hidden'") || !pill.includes('borderRadius: innerR')) fail('TeamScorePill should clip segments inside a rounded overflow-hidden track')
else ok('TeamScorePill clips segments inside a rounded overflow-hidden track')
if (pill.includes('borderColor: Color4.create(1, 0.92, 0.4, 1)')) fail('scoreboard should not highlight the leader with a gold lip')
else ok('scoreboard has no gold leader highlight')
if (!ui.includes('showUnpainted={true}')) fail('live scoreboard should show the unpainted remainder')
else ok('live scoreboard keeps the unpainted remainder')
const livePill = ui.split(/\n/).find(line => line.includes('showUnpainted={true}')) ?? ''
if (!livePill || livePill.includes('showLabels={true}')) fail('small live scoreboard should not show percentages')
else ok('small live scoreboard has no percentage labels')
const roundSrc = readFileSync(new URL('../src/round.ts', import.meta.url), 'utf8')
if (roundSrc.includes('Vote with your feet') || /Next round: ${modeTitle/.test(roundSrc)) fail('round.ts still has leftover mode-vote next-round copy')
else ok('next-round copy is not leftover mode-vote wording')
if (!roundSrc.includes("return 'Next round: Pick your team'")) fail('nextRoundBlurb should tell players to pick their team')
else ok('nextRoundBlurb says Next round: Pick your team')
const msg = readFileSync(new URL('../src/shared/messages.ts', import.meta.url), 'utf8')
if (!msg.includes('green: Schemas.Int') || !msg.includes('finalGreen: Schemas.Int') || !msg.includes('finalYellow: Schemas.Int')) fail('messages.ts is missing green/yellow coverage fields')
else ok('paintDelta / snapshot / roundEnded carry green and yellow')

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\n✓ four-team assignment, paint scoring, bot fill, and HUD wiring')

