/**
 * verify-burst.ts — offline checks for Paint Burst logic (shared/burst.ts).
 * Run: npx tsx scripts/verify-burst.ts. Cooldown config, 3D radius, outward
 * direction, server hit ledger, and the paint footprint on a real maze graph
 * (stays on walkable adjacency: no gaps, no other levels), and the one-time
 * paint centre resolution (burstUse cell → footprint). Feel, LOS raycast
 * and networking need an Explorer playtest.
 */
import { BurstLedger, inBurst, burstDir, burstFootprint, burstCentre } from '../src/shared/burst'
import { BURST_COOLDOWN_S, SERVER_MIN_BURST_GAP_S, BURST_RADIUS, BURST_PAINT_MAX_DY, BURST_PAINT_SHAPE, BURST_PAINT_RADIUS_CELLS, SERVER_BURST_HIT_WINDOW_S } from '../src/shared/pvp'
import { generateWithRetry, getPlacedTilesInOrder, CELL, STEP, MAZE_ORIGIN, lookupTile } from '../src/maze/generator'
import { buildWalkableGraph, rampSurfaceY } from '../src/shared/mazeGraph'
import { worldToCellId } from '../src/paint'
import { applyPaint, teamOfCell, drainDelta } from '../src/server/paintState'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}
const P = (x: number, z: number, y = 0) => ({ x, y, z })

// Cooldown (timer, server-enforced; no paint quota).
check(`cooldown ${BURST_COOLDOWN_S} s, server gap ${SERVER_MIN_BURST_GAP_S} s (slack, < cooldown)`, BURST_COOLDOWN_S === 12 && SERVER_MIN_BURST_GAP_S < BURST_COOLDOWN_S && SERVER_MIN_BURST_GAP_S > BURST_COOLDOWN_S - 1)

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
  // Default config (BURST_PAINT_* in pvp.ts): circle R=3.5 cells, same restrictions.
  let mx = 0, full = 0, badD = 0
  const R_M = BURST_PAINT_RADIUS_CELLS * 2
  for (const id of g.nodes) {
    const fp = burstFootprint(g, id)
    mx = Math.max(mx, fp.length)
    if (fp.length === 37) full++
    const c0 = g.worldPos.get(id)!
    const set = new Set(fp), seen = new Set([id]), q = [id]
    while (q.length) { const x = q.pop()!; for (const n of g.adj.get(x) ?? []) if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n) } }
    if (seen.size !== set.size) badD++
    for (const f of fp) {
      const p = g.worldPos.get(f)!
      if (Math.hypot(p[0] - c0[0], p[2] - c0[2]) > R_M + 0.06) badD++
      // Every cell joins the footprint through a walk edge with a ≤ MAX_DY step (ramps climb, other levels don't).
      if (f !== id && !(g.adj.get(f) ?? []).some(n => set.has(n) && Math.abs(g.worldPos.get(n)![1] - p[1]) <= BURST_PAINT_MAX_DY)) badD++
    }
  }
  // Full disc on flat floor = cells whose centre is within R cells; ramp cells sit closer together
  // horizontally (slope), so a disc over a ramp can hold ~10% more.
  let disc = 0
  for (let a = -10; a <= 10; a++) for (let b = -10; b <= 10; b++) if (Math.hypot(a, b) * 2 <= R_M + 0.05) disc++
  full = [...g.nodes].filter(id => burstFootprint(g, id).length === disc).length
  check(`default footprint = ${BURST_PAINT_SHAPE} R=${BURST_PAINT_RADIUS_CELLS} cells: ${disc} on flat floor (${full} centres), ≤ ${Math.floor(disc * 1.1)} over ramps (max ${mx})`, BURST_PAINT_SHAPE === 'circle' && mx <= disc * 1.1 && full > 0)
  check(`default footprint: connected via ≤ ${BURST_PAINT_MAX_DY} m walk steps, every cell centre within ${R_M} m (circle)`, badD === 0)
  const sq = burstFootprint(g, [...g.nodes].find(id => burstFootprint(g, id).length === 37)!, 'square', BURST_PAINT_RADIUS_CELLS).length
  check(`square option still available (7×7 = ${sq} cells there)`, sq === 49)
}
{
  // One-time paint: burstUse resolves its centre once, the whole footprint is painted from it.
  const id0 = [...g.nodes].find(id => burstFootprint(g, id).length === 37)!
  const [x, y, z] = g.worldPos.get(id0)!
  const P0 = { x: x + 0.3, y, z: z - 0.3 }
  check('one-time paint: reported cell is used as the centre', burstCentre(g, id0, P0) === id0)
  check('one-time paint: no / bogus cell → nearest walkable cell under the player', burstCentre(g, '', P0) === id0 && burstCentre(g, 'nope', P0) === id0)
  check('one-time paint: reported cell far from the player is ignored', burstCentre(g, id0, { x: x + 20, y, z }) !== id0)
  check('one-time paint: nothing under the player (gap / mid-air) → no centre', burstCentre(g, '', { x: x, y: y + 40, z }) === null)
  check('one-time paint: full circle (37 cells) painted in one go from that centre', burstFootprint(g, burstCentre(g, id0, P0)!).length === 37)
}
{
  // Ramp: centre mid-incline. Every ramp cell inside the circle is painted (whole run, not just
  // ±1.5 m of the centre), and nothing outside the ramp's own base..top height range is.
  const tiles = getPlacedTilesInOrder()
  let ok = 0, tried = 0, leaks = 0, missing = 0
  for (const t of tiles.filter(t => t.type === 'ramp')) {
    const pre = `${t.x},${t.z},${t.y}:`
    const ids = [...g.nodes].filter(n => n.startsWith(pre))
    if (!ids.length) continue
    const ys = ids.map(n => g.worldPos.get(n)![1])
    const lo = Math.min(...ys), hi = Math.max(...ys)
    const mid = ids.reduce((b, n) => Math.abs(g.worldPos.get(n)![1] - (lo + hi) / 2) < Math.abs(g.worldPos.get(b)![1] - (lo + hi) / 2) ? n : b)
    const c0 = g.worldPos.get(mid)!
    const fp = new Set(burstFootprint(g, mid))
    tried++
    const R_M = BURST_PAINT_RADIUS_CELLS * 2
    const miss = ids.filter(n => { const p = g.worldPos.get(n)!; return Math.hypot(p[0] - c0[0], p[2] - c0[2]) <= R_M + 0.05 && !fp.has(n) })
    const leak = [...fp].filter(n => { const y = g.worldPos.get(n)![1]; return y < lo - 0.01 || y > hi + 0.01 })
    const spans = [...fp].filter(n => n.startsWith(pre)).map(n => g.worldPos.get(n)![1])
    if (!miss.length && !leak.length && Math.max(...spans) - Math.min(...spans) > BURST_PAINT_MAX_DY * 2) ok++
    missing += miss.length; leaks += leak.length
  }
  check(`ramp: burst mid-ramp paints the full ramp run inside the circle, > ${BURST_PAINT_MAX_DY * 2} m of climb, no other level (${ok}/${tried} ramps; missing ${missing}, leaks ${leaks})`, tried > 0 && ok === tried)
}
{
  // Server paint path (server.ts burstUse): burstCentre → burstFootprint → applyPaint, fired from
  // a player standing mid-ramp. Every ramp cell in the footprint must change owner and go out in
  // the paintDelta.
  let tried = 0, bad = 0
  for (const t of getPlacedTilesInOrder().filter(t => t.type === 'ramp')) {
    const pre = `${t.x},${t.z},${t.y}:`
    const mid = [...g.nodes].find(n => n === `${pre}8,8`)
    if (!mid) continue
    const [x, y, z] = g.worldPos.get(mid)!
    for (const cell of [mid, '']) { // reported cell, and the nearest-cell fallback
      const team = tried % 2 ? 1 : 2
      const centre = burstCentre(g, cell, { x, y: y - 0.55, z }) // player feet ≈ walkable top
      const fp = centre ? burstFootprint(g, centre) : []
      for (const id of fp) applyPaint(id, team)
      const sent = new Set(drainDelta().map(d => d.id))
      const rampFp = fp.filter(id => id.startsWith(pre))
      if (!centre || rampFp.length < 20 || rampFp.some(id => teamOfCell(id) !== team || !sent.has(id))) bad++
      tried++
    }
  }
  check(`server burst path paints ramp cells (${tried} bursts on ramps, ${bad} failed)`, tried > 0 && bad === 0)
}
{
  // Real player on every ramp, every rotation, across many Sky layouts: feet on the slope at
  // sampled points, cell = what the client reports (paint.ts worldToCellId, as getCurrentCellId),
  // then the server burst (burstCentre → burstFootprint → applyPaint). The cell under the player
  // and every ramp cell of that ramp inside the circle must change owner.
  const R_M = BURST_PAINT_RADIUS_CELLS * 2
  const per: Record<number, { n: number; bad: number }> = { 0: { n: 0, bad: 0 }, 1: { n: 0, bad: 0 }, 2: { n: 0, bad: 0 }, 3: { n: 0, bad: 0 } }
  let team = 1
  for (let s1 = 1; s1 < 25; s1++) {
    let sd: number | null = null
    try { sd = generateWithRetry(s1, 50) } catch { continue }
    if (sd === null) continue
    const gg = buildWalkableGraph(getPlacedTilesInOrder())
    for (const t of getPlacedTilesInOrder().filter(t => t.type === 'ramp')) {
      const pre = `${t.x},${t.z},${t.y}:`
      const ux = Math.sin(t.r * Math.PI / 2), uz = Math.cos(t.r * Math.PI / 2)
      const cx = t.x * CELL + MAZE_ORIGIN + CELL / 2, cz = t.z * CELL + MAZE_ORIGIN + CELL / 2
      for (let a = -15; a <= 15; a += 5) for (const side of [-3, 0, 3]) {
        const x = cx + ux * a + uz * side, z = cz + uz * a - ux * side
        const y = rampSurfaceY(t, x, z) - 0.05
        team = team === 1 ? 2 : 1
        per[t.r].n++
        const hit = worldToCellId(x, y, z, CELL, STEP, lookupTile)
        const centre = hit ? burstCentre(gg, hit.id, { x, y, z }) : null
        const fp = centre ? burstFootprint(gg, centre) : []
        for (const id of fp) applyPaint(id, team)
        drainDelta()
        const want = [...gg.nodes].filter(n => n.startsWith(pre) && (() => { const q = gg.worldPos.get(n)!, c = gg.worldPos.get(hit!.id)!; return Math.hypot(q[0] - c[0], q[2] - c[2]) <= R_M + 0.05 })())
        if (!hit || centre !== hit.id || teamOfCell(hit.id) !== team || want.some(n => teamOfCell(n) !== team)) per[t.r].bad++
      }
    }
  }
  for (const r of [0, 1, 2, 3]) check(`ramp r=${r}: player on the slope → reported cell + ramp cells in the circle painted (${per[r].n - per[r].bad}/${per[r].n})`, per[r].n > 0 && per[r].bad === 0)
}
check('unknown centre paints nothing', burstFootprint(g, 'nope', 'square', 1).length === 0)

if (fails) { console.log(`✗ ${fails} burst check(s) failed`); process.exit(1) }
console.log('✓ all burst checks passed')
