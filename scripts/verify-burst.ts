/**
 * verify-burst.ts — offline checks for Paint Burst logic (shared/burst.ts).
 * Run: npx tsx scripts/verify-burst.ts. Cooldown config, 3D radius, outward
 * direction, server hit ledger, and the paint footprint on a real maze graph
 * (stays on walkable adjacency: no gaps, no other levels), and the one-time
 * paint centre resolution (burstUse cell → footprint). The landing shockwave
 * uses the same radius, direction, and hit ledger as a ground Burst. Feel,
 * LOS raycast and networking need an Explorer playtest.
 */
import { BurstLedger, inBurst, inAirSpike, burstDir, burstFootprint, burstCentre, shockwaveHits } from '../src/shared/burst'
import { BURST_COOLDOWN_S, SERVER_MIN_BURST_GAP_S, BURST_RADIUS, BURST_HIT_MAX_DY, BURST_PAINT_MAX_DY, BURST_PAINT_SHAPE, BURST_PAINT_RADIUS_CELLS, SERVER_BURST_HIT_WINDOW_S, SERVER_BURST_LAND_WINDOW_S, AIR_SPIKE_RADIUS, AIR_SPIKE_DEPTH, AIR_SPIKE_MIN_ABOVE } from '../src/shared/pvp'
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
check(`cooldown ${BURST_COOLDOWN_S} s, server gap ${SERVER_MIN_BURST_GAP_S} s (slack, < cooldown)`, BURST_COOLDOWN_S === 8 && SERVER_MIN_BURST_GAP_S < BURST_COOLDOWN_S && SERVER_MIN_BURST_GAP_S > BURST_COOLDOWN_S - 1)

// Radius / direction.
check(`opponent ${BURST_RADIUS - 0.1} m away is hit`, inBurst(P(0, 0), P(BURST_RADIUS - 0.1, 0)))
check(`opponent ${BURST_RADIUS + 0.1} m away is not`, !inBurst(P(0, 0), P(BURST_RADIUS + 0.1, 0)))
check('stacked platform 10.8 m above is not hit (height limit)', !inBurst(P(0, 0), P(0.5, 0.5, 10.8)))
check(`hit radius ${BURST_RADIUS} m = paint footprint edge (R=${BURST_PAINT_RADIUS_CELLS} cells × 2 m + half a cell)`, BURST_RADIUS === BURST_PAINT_RADIUS_CELLS * 2 + 1)
check('outermost painted cell centre (R cells out, diagonal too) is hit', inBurst(P(0, 0), P(BURST_PAINT_RADIUS_CELLS * 2, 0)) && inBurst(P(0, 0), P(7, 7)))
check('up a ramp run (3 m higher, 8 m out) is hit; next level (5.4 m up) is not', inBurst(P(0, 0), P(8, 0, 3)) && !inBurst(P(0, 0), P(2, 0, 5.4)))
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
{
  // Aerial spike: cylinder under the attacker, not the radial shockwave.
  const up = P(0, 0, 6)
  check('air spike: player 2 m below and 1 m aside is inside the cylinder', inAirSpike(up, P(1, 0, 4)))
  check('air spike: same height beside the attacker is not a hit', !inAirSpike(up, P(1.2, 0, 6)))
  check('air spike: just under the above-gate is not a hit', !inAirSpike(up, P(0, 0, 6 - AIR_SPIKE_MIN_ABOVE + 0.05)))
  check('air spike: clearly below the gate is a hit', inAirSpike(up, P(0, 0, 6 - AIR_SPIKE_MIN_ABOVE - 0.05)))
  check('air spike: outside the horizontal radius is not a hit', !inAirSpike(up, P(AIR_SPIKE_RADIUS + 0.2, 0, 3)))
  check('air spike: deeper than the cylinder is not a hit', !inAirSpike(up, P(0, 0, 6 - AIR_SPIKE_DEPTH - 0.3)))
  // A miss that lands paints once, through claimPaint. A second call and a grounded burst do not.
  const led = new BurstLedger()
  led.start('a', 7, 0, 1)
  check('air and ground share one ledger; spike mode is remembered', led.mode('a', 7) === 1 && led.hit('a', 7, 'b', 10) === 'ok')
  check('landing paint claimed once for the air burst', led.claimPaint('a', 7, 100, 2))
  check('landing paint is not applied twice', !led.claimPaint('a', 7, 200, 2))
  led.start('a', 8, 20, 0)
  check('a later grounded burst is radial mode on the same attacker', led.mode('a', 8) === 0 && led.mode('a', 7) === 0)
  check('a grounded burst does not take a landing paint', !led.claimPaint('a', 8, 30, 2))
  const late = new BurstLedger()
  late.start('a', 1, 0, 1)
  check('landing paint outside the window is rejected', !late.claimPaint('a', 1, 2100, 2))
  // A shockwave retry is the same id. Empty is not consumed; a second commit is.
  const again = new BurstLedger()
  again.start('a', 3, 0, 0)
  check('same id is the live ground burst', again.matches('a', 3) && !again.matches('a', 4) && !again.hasPaint('a', 3))
  check('ground paint commits once', again.commitPaint('a', 3) && again.hasPaint('a', 3) && !again.commitPaint('a', 3))
  const dive = new BurstLedger()
  dive.start('a', 4, 0, 1)
  check('landing stays ready until the footprint commits', dive.paintReady('a', 4, 100, 2) && dive.paintReady('a', 4, 200, 2))
  check('committing the landing ends it', dive.commitPaint('a', 4) && !dive.paintReady('a', 4, 300, 2) && dive.hasPaint('a', 4))
}
{
  // Landing shockwave knockback. Same geometry as a ground Burst (shockwaveHits →
  // inBurst + burstDir). The press cylinder does not hit someone standing beside
  // the landing spot; the landing shockwave does, and pushes them outward.
  const press = P(0, 0, 6)
  const feet = P(0, 0, 0)
  const beside = { id: 'near', ...P(3, 0, 0) }
  const far = { id: 'far', ...P(BURST_RADIUS + 0.3, 0, 0) }
  const above = { id: 'up', ...P(1, 0, BURST_HIT_MAX_DY + 0.3) }
  const spiked = { id: 'spike', ...P(0.4, 0, 4) }
  check('player beside the landing is outside the air-spike cylinder', !inAirSpike(press, beside))
  check('a direct spike under the attacker is inside the cylinder', inAirSpike(press, spiked))
  const hits = shockwaveHits(feet, [beside, far, above, spiked], 0, 1)
  const near = hits.find(h => h.id === 'near')
  check('landing shockwave hits the nearby player inside the ground radius', !!near && hits.every(h => h.id !== 'far'))
  check('landing knock direction is outward from the feet', !!near && Math.abs(near.x - 1) < 1e-6 && Math.abs(near.z) < 1e-6)
  check('landing shockwave uses the ground height limit', !hits.some(h => h.id === 'up') && !hits.some(h => h.id === 'spike'))
  const stacked = shockwaveHits(feet, [{ id: 'on', x: feet.x, y: feet.y, z: feet.z + 0.05 }], 0, 1)
  check('landing overlap falls back to facing, same as a ground burst', stacked.length === 1 && Math.abs(stacked[0].z - 1) < 1e-9)
  // Ledger: landing opens the ground hit window without spending the paint or
  // flipping the press mode (an air paint retry must not look like a ground replay).
  // burstHit → noteHit runs only when hit() is ok, so a dup is not a second KO.
  const knock = new BurstLedger()
  knock.start('a', 9, 0, 1, 0, 1)
  check('spike impact before the landing, press facing kept', knock.impactAir('a', 9) === 1 && knock.mode('a', 9) === 1 && knock.facing('a', 9).z === 1)
  check('spike victim accepted inside the press window', knock.hit('a', 9, 'spike', 400) === 'ok')
  check('press window rejects a hit before the landing opens', knock.hit('a', 9, 'early', SERVER_BURST_HIT_WINDOW_S * 1000 + 1) === 'stale')
  const landAt = 1500
  check('landing knock opens once inside the land window', knock.openLanding('a', 9, landAt, SERVER_BURST_LAND_WINDOW_S) && knock.landed('a', 9))
  check('landing knock does not open twice', !knock.openLanding('a', 9, landAt + 50, SERVER_BURST_LAND_WINDOW_S))
  check('landing impact is the ground radial; press mode stays airborne', knock.impactAir('a', 9) === 0 && knock.mode('a', 9) === 1)
  check('the spiked victim is not accepted again (no second knock, no second KO)', knock.hasHit('a', 9, 'spike') && knock.hit('a', 9, 'spike', landAt + 20) === 'dup')
  check('a nearby player is accepted on the landing window', knock.hit('a', 9, 'near', landAt + 20) === 'ok')
  check('same nearby player is not credited twice', knock.hit('a', 9, 'near', landAt + 40) === 'dup')
  check('landing hit window is the ground window, measured from the landing', knock.hit('a', 9, 'slow', landAt + SERVER_BURST_HIT_WINDOW_S * 1000 + 1) === 'stale')
  check('opening the landing does not spend the paint', knock.paintReady('a', 9, landAt + 100, SERVER_BURST_LAND_WINDOW_S))
  const gnd = new BurstLedger()
  gnd.start('g', 1, 0, 0, 1, 0)
  check('a grounded burst does not open a landing knock', !gnd.openLanding('g', 1, 10, SERVER_BURST_LAND_WINDOW_S) && gnd.impactAir('g', 1) === 0 && !gnd.landed('g', 1))
  const late = new BurstLedger()
  late.start('a', 2, 0, 1)
  check('landing knock outside the land window is rejected', !late.openLanding('a', 2, SERVER_BURST_LAND_WINDOW_S * 1000 + 1, SERVER_BURST_LAND_WINDOW_S) && late.impactAir('a', 2) === 1)
  check('a connect that never lands stays a downward spike', late.hit('a', 2, 'victim', 100) === 'ok' && late.impactAir('a', 2) === 1)
}

if (fails) { console.log(`✗ ${fails} burst check(s) failed`); process.exit(1) }
console.log('✓ all burst checks passed')
