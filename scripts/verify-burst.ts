/**
 * verify-burst.ts — offline checks for Paint Burst logic (shared/burst.ts).
 * Run: npx tsx scripts/verify-burst.ts. Charge rules, 3D radius, outward
 * direction, server hit ledger, and the paint footprint on a real maze graph
 * (stays on walkable adjacency: no gaps, no other levels). Feel, LOS raycast
 * and networking need an Explorer playtest.
 */
import { BurstCharge, BurstLedger, inBurst, burstDir, burstFootprint } from '../src/shared/burst'
import { BURST_CHARGE_CELLS, BURST_RADIUS, BURST_PAINT_MAX_DY, BURST_PAINT_SHAPE, BURST_PAINT_RADIUS_CELLS, SERVER_BURST_HIT_WINDOW_S } from '../src/shared/pvp'
import { generateWithRetry, getPlacedTilesInOrder } from '../src/maze/generator'
import { buildWalkableGraph } from '../src/shared/mazeGraph'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}
const P = (x: number, z: number, y = 0) => ({ x, y, z })

// Charge.
const c = new BurstCharge()
c.add(BURST_CHARGE_CELLS - 1)
check(`${BURST_CHARGE_CELLS - 1} conversions: not charged`, !c.charged && c.progress === BURST_CHARGE_CELLS - 1)
c.add(3)
check(`reaching ${BURST_CHARGE_CELLS}: charged, progress 0, no reserve`, c.charged && c.progress === 0)
check('conversions while charged are ignored (max 1, no reserve)', !c.add(5) && c.progress === 0)
check('consume uses the charge and resets', c.consume() && !c.charged && c.progress === 0)
check('consume without a charge fails', !c.consume())
check('zero conversions (repaints) change nothing', !c.add(0) && c.progress === 0)

// Radius / direction.
check(`opponent ${BURST_RADIUS - 0.1} m away is hit`, inBurst(P(0, 0), P(BURST_RADIUS - 0.1, 0)))
check(`opponent ${BURST_RADIUS + 0.1} m away is not`, !inBurst(P(0, 0), P(BURST_RADIUS + 0.1, 0)))
check('stacked platform 10.8 m above is not hit (3D distance)', !inBurst(P(0, 0), P(0.5, 0.5, 10.8)))
check('3D: 3 m out and 3 m up is outside 4 m', !inBurst(P(0, 0), P(3, 0, 3)))
const d1 = burstDir(P(0, 0), P(2, 0), 0, 1)
check('knock direction is outward from the centre', Math.abs(d1.x - 1) < 1e-9 && Math.abs(d1.z) < 1e-9)
const d2 = burstDir(P(0, 0), P(0.05, 0.05), 0, 1)
check('target on top of us: falls back to facing', Math.abs(d2.z - 1) < 1e-9)

// Ledger.
const L = new BurstLedger()
L.start('a', 1, 0)
check('hit accepted', L.hit('a', 1, 'B', 100) === 'ok')
check('same target twice: dup', L.hit('a', 1, 'b', 120) === 'dup')
check('other target ok', L.hit('a', 1, 'c', 120) === 'ok')
check('unknown burst id rejected', L.hit('a', 2, 'd', 120) === 'unknown')
check('late hit rejected', L.hit('a', 1, 'e', SERVER_BURST_HIT_WINDOW_S * 1000 + 1) === 'stale')

// Footprint on a real maze graph.
let seed: number | null = null
for (let s1 = 1; s1 < 50 && seed === null; s1++) { try { seed = generateWithRetry(s1, 50) } catch { /* next */ } }
if (seed === null) { console.log('✗ maze generation failed'); process.exit(1) }
const g = buildWalkableGraph(getPlacedTilesInOrder())
let maxSq = 0, maxCross = 0, nine = 0, five = 0, bad = 0, total = 0
for (const id of g.nodes) {
  total++
  const sq = burstFootprint(g, id, 'square', 1)
  const cr = burstFootprint(g, id, 'cross', 1)
  maxSq = Math.max(maxSq, sq.length); maxCross = Math.max(maxCross, cr.length)
  if (sq.length === 9) nine++
  if (cr.length === 5) five++
  const c0 = g.worldPos.get(id)!
  for (const f of sq) {
    const p = g.worldPos.get(f)
    if (!p || !g.nodes.has(f) || Math.abs(p[1] - c0[1]) > BURST_PAINT_MAX_DY || Math.abs(p[0] - c0[0]) > 2.5 || Math.abs(p[2] - c0[2]) > 2.5) bad++
  }
  // Connectivity: every footprint cell reachable from the centre inside the footprint.
  const set = new Set(sq), seen = new Set([id]), q = [id]
  while (q.length) { const x = q.pop()!; for (const n of g.adj.get(x) ?? []) if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n) } }
  if (seen.size !== set.size) bad++
}
check(`square footprint ≤ 9 cells (max ${maxSq}), 9 in open floor (${nine}/${total})`, maxSq <= 9 && nine > total * 0.3)
check(`cross footprint ≤ 5 cells (max ${maxCross}), 5 in open floor (${five}/${total})`, maxCross <= 5 && five > total * 0.3)
check('footprints stay on walkable, connected cells of the same level (no gaps / other levels)', bad === 0)
{
  // Default config (BURST_PAINT_* in pvp.ts): 7×7 square, same restrictions.
  let mx = 0, full = 0, badD = 0
  for (const id of g.nodes) {
    const fp = burstFootprint(g, id)
    mx = Math.max(mx, fp.length)
    if (fp.length === 49) full++
    const c0 = g.worldPos.get(id)!
    const set = new Set(fp), seen = new Set([id]), q = [id]
    while (q.length) { const x = q.pop()!; for (const n of g.adj.get(x) ?? []) if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n) } }
    if (seen.size !== set.size) badD++
    for (const f of fp) {
      const p = g.worldPos.get(f)!
      if (Math.abs(p[1] - c0[1]) > BURST_PAINT_MAX_DY || Math.abs(p[0] - c0[0]) > 6.5 || Math.abs(p[2] - c0[2]) > 6.5) badD++
    }
  }
  check(`default footprint = ${BURST_PAINT_SHAPE} R=${BURST_PAINT_RADIUS_CELLS}: ≤ 49 cells (max ${mx}), full 7×7 somewhere (${full})`, mx <= 49 && full > 0)
  check('default footprint stays connected, same level, inside 7×7', badD === 0)
  check(`charge needs ${BURST_CHARGE_CELLS} captures`, BURST_CHARGE_CELLS === 100)
}
check('unknown centre paints nothing', burstFootprint(g, 'nope', 'square', 1).length === 0)

if (fails) { console.log(`✗ ${fails} burst check(s) failed`); process.exit(1) }
console.log('✓ all burst checks passed')
