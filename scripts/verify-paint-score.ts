/**
 * verify-paint-score.ts — personal tiles-painted credit (server applyPaint).
 * Run: npx tsx scripts/verify-paint-score.ts
 *
 * Movement, dash trails, and burst footprints all credit through applyPaint
 * with the responsible painter id. A cell only scores when it actually
 * changes team, so repeated paintTicks / prediction retries cannot double-count.
 */
import { applyPaint, teamOfCell, clearAll } from '../src/server/paintState'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

const scores = new Map<string, number>()
function credit(painter: string, team: number, ids: string[]): number {
  let gained = 0
  for (const id of ids) if (applyPaint(id, team, painter)) gained++
  if (gained > 0) scores.set(painter, (scores.get(painter) ?? 0) + gained)
  return gained
}
function total(id: string): number { return scores.get(id) ?? 0 }

clearAll(); scores.clear()
check('neutral tile conversion gives +1', credit('p1', 1, ['n1']) === 1 && total('p1') === 1 && teamOfCell('n1') === 1)

clearAll(); scores.clear()
applyPaint('e1', 2, 'enemy')
check('enemy tile conversion gives +1 (not 2)', credit('p1', 1, ['e1']) === 1 && total('p1') === 1 && teamOfCell('e1') === 1)

clearAll(); scores.clear()
applyPaint('f1', 1, 'p1')
check('friendly tile gives 0', credit('p1', 1, ['f1']) === 0 && total('p1') === 0)

clearAll(); scores.clear()
// Dash / burst: a footprint of mixed cells, all attributed to the attacker.
applyPaint('own', 1, 'p1')
applyPaint('enemy', 2, 'p2')
const gained = credit('p1', 1, ['own', 'enemy', 'fresh-a', 'fresh-b', 'fresh-c'])
check('dash/burst footprint is attributed to the painter', gained === 4 && total('p1') === 4)
check('friendly cell in the footprint is skipped', teamOfCell('own') === 1 && total('p1') === 4)

clearAll(); scores.clear()
credit('p1', 1, ['d1', 'd2', 'd3'])
const again = credit('p1', 1, ['d1', 'd2', 'd3'])
check('repeated network messages do not double-count', again === 0 && total('p1') === 3)

clearAll(); scores.clear()
credit('p1', 1, ['a', 'b'])
credit('p2', 2, ['c'])
clearAll()
scores.clear()
check('round reset clears the personal total', total('p1') === 0 && total('p2') === 0 && teamOfCell('a') === 0)

if (fails) { console.log(`✗ ${fails} paint-score check(s) failed`); process.exit(1) }
console.log('✓ all paint-score checks passed')
