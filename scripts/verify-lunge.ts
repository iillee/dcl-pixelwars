/**
 * verify-lunge.ts — offline checks for the Lunge logic (shared/lunge.ts).
 * Run: npx tsx scripts/verify-lunge.ts. Covers hit geometry, knockback
 * direction, server dedupe/cooldown/window and victim stale/dup gates.
 * Movement feel, ramps and real networking need Explorer playtests.
 */
import { boxHit as sweptHit, hitboxAt, knockDir, LungeLedger, ImpactGate } from '../src/shared/lunge'
import { rampSurfaceY, buildWalkableGraph } from '../src/shared/mazeGraph'
import { AnvilWorld } from '../src/shared/anvilSim'
import { Placed, CELL, MAZE_ORIGIN, STEP, generateWithRetry, getPlacedTilesInOrder, teleportPairs } from '../src/maze/generator'
import { LUNGE_DUMMY_COUNT, LUNGE_DUMMY_RESPAWN_S, ANVIL_PREDICT_CLOSE_M } from '../src/shared/pvp'
import { LUNGE_HITBOX_FORWARD, LUNGE_HITBOX_D, LUNGE_HITBOX_W, LUNGE_HITBOX_H, LUNGE_COOLDOWN_S, SERVER_MIN_LUNGE_GAP_S, SERVER_LUNGE_HIT_WINDOW_S, LUNGE_IMPACT_MAX_AGE_MS } from '../src/shared/pvp'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}
const P = (x: number, z: number, y = 0) => ({ x, y, z })
const O = P(0, 0)

// Geometry: lunge along +z from the origin.
check('stationary enemy 1 m ahead is hit', sweptHit(O, P(0, 0.1), P(0, 1), O, 0, 1))
check('enemy 4 m ahead, not reached this frame: no hit', !sweptHit(O, P(0, 0.5), P(0, 4), O, 0, 1))
check('fast frame (3 m in one step) still hits enemy mid-path (swept)', sweptHit(P(0, 0), P(0, 3), P(0.5, 1.5), O, 0, 1))
check('close-range miss: 1.5 m to the side', !sweptHit(O, P(0, 2), P(1.5, 1), O, 0, 1))
check(`standing lunge: target 1.6 m ahead hits (reach ${(LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D).toFixed(1)} m)`, sweptHit(O, O, P(0, 1.6), O, 0, 1))
check('standing lunge: target 1.9 m ahead misses', !sweptHit(O, O, P(0, 1.9), O, 0, 1))
check('point-blank target beside the attacker (0.5 m, 90°) still hits', sweptHit(O, O, P(0.5, 0), O, 0, 1))
check('target 1.0 m to the side at the attacker misses (hitbox is ahead)', !sweptHit(O, O, P(1.05, -0.2), O, 0, 1))
check(`hitbox edge: ${LUNGE_HITBOX_W / 2} m side offset hits`, sweptHit(O, P(0, 2), P(LUNGE_HITBOX_W / 2 - 0.01, 1), O, 0, 1))
check('just outside the box side misses', !sweptHit(O, O, P(LUNGE_HITBOX_W / 2 + 0.05, 1), O, 0, 1))
check('box far corner hits (a capsule would miss)', sweptHit(O, O, P(1.0, 1.65), O, 0, 1))
check('in the gap before the near face, past point-blank: miss', !sweptHit(O, O, P(0.8, 0.2), O, 0, 1))
check('diagonal lunge (+x+z): target ahead on the diagonal hits', sweptHit(O, O, P(0.8, 0.8), O, Math.SQRT1_2, Math.SQRT1_2))
check('diagonal lunge: target ahead on the other diagonal misses', !sweptHit(O, O, P(-1.2, 1.2), O, Math.SQRT1_2, Math.SQRT1_2))
check('box follows current position: 5 m into the lunge, 6.5 m target hits', sweptHit(P(0, 4.8), P(0, 5), P(0, 6.5), O, 0, 1))
check('box sweeps sideways motion too (strafe frame)', sweptHit(P(-3, 0), P(3, 0), P(0, 1), P(-3, 0), 0, 1))
check(`target ${LUNGE_HITBOX_H + 0.1} m above misses`, !sweptHit(O, O, P(0, 1, LUNGE_HITBOX_H + 0.1), O, 0, 1))
const hb = hitboxAt(P(2, 3, 1), 1, 0)
check('hitboxAt: centre FORWARD + D/2 ahead at mid height, yaw 90°', Math.abs(hb.c.x - (2 + LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D / 2)) < 1e-9 && hb.c.z === 3 && Math.abs(hb.c.y - (1 + LUNGE_HITBOX_H / 2)) < 1e-9 && Math.abs(hb.yaw - Math.PI / 2) < 1e-9)
check('enemy behind the attacker is never hit', !sweptHit(O, P(0, 0.2), P(0, -0.8), O, 0, 1))
check('overlapping enemy (0.2 m) is hit', sweptHit(O, O, P(0.2, 0.05), O, 0, 1))
check('enemy on the level above (dy 10.8) is not hit', !sweptHit(O, P(0, 1), P(0, 1, 10.8), O, 0, 1))
check('ramp: enemy 1 m higher on the ramp is hit', sweptHit(P(0, 0), P(0, 1, 0.4), P(0, 1.2, 1.2), O, 0, 1))
// Moving enemy: enemy crossing the path between frames (sampled at its new spot).
check('moving enemy now just inside the swept capsule is hit', sweptHit(P(0, 0.5), P(0, 1.0), P(1.0, 0.8), O, 0, 1))

// Knockback direction.
const k1 = knockDir(O, P(0, 1), 0, 1)
check('knock dir straight ahead = lunge dir', Math.abs(k1.x) < 1e-6 && Math.abs(k1.z - 1) < 1e-6)
const k2 = knockDir(O, P(1, 1), 0, 1)
check('knock dir off-centre target: away from attacker, biased forward', k2.x > 0 && k2.z > k2.x)
const k3 = knockDir(O, P(0.05, 0.05), 1, 0)
check('knock dir overlapping target falls back to lunge dir', Math.abs(k3.x - 1) < 1e-6)
check('knock dir is unit length', Math.abs(Math.hypot(k2.x, k2.z) - 1) < 1e-9)

// Server ledger.
const L = new LungeLedger()
check('first lunge accepted', L.start('a', 1, 0))
check('lunge during cooldown rejected', !L.start('a', 2, (SERVER_MIN_LUNGE_GAP_S - 0.1) * 1000))
check('hit accepted', L.hit('a', 1, 'B', 100) === 'ok')
check('same target twice in one lunge: dup', L.hit('a', 1, 'b', 150) === 'dup')
check('second target in same lunge ok', L.hit('a', 1, 'c', 150) === 'ok')
check('hit for an old/unknown lunge id rejected', L.hit('a', 7, 'd', 150) === 'unknown')
check('late hit rejected (stale)', L.hit('a', 1, 'e', SERVER_LUNGE_HIT_WINDOW_S * 1000 + 50) === 'stale')
check('next lunge after cooldown accepted', L.start('a', 2, LUNGE_COOLDOWN_S * 1000))
check('target can be hit again by the NEXT lunge', L.hit('a', 2, 'b', LUNGE_COOLDOWN_S * 1000 + 50) === 'ok')
check('mutual lunges: both players own separate ledgers', L.start('b', 1, 10) && L.hit('b', 1, 'a', 60) === 'ok')

// Victim gate.
const G = new ImpactGate(LUNGE_IMPACT_MAX_AGE_MS)
G.sawStart('A', 1, 1000)
check('fresh impact applied', G.accept('a', 1, 1200) === 'ok')
check('duplicate impact dropped', G.accept('a', 1, 1210) === 'dup')
G.sawStart('a', 2, 2000)
check(`impact > ${LUNGE_IMPACT_MAX_AGE_MS} ms after start dropped`, G.accept('a', 2, 2000 + LUNGE_IMPACT_MAX_AGE_MS + 1) === 'stale')
check('impact whose start was never seen is still applied', G.accept('a', 3, 5000) === 'ok')

// Ramp surface (dummy slides): continuous slope height for every rotation.
for (let r = 0; r < 4; r++) {
  const t: Placed = { type: 'ramp', r, x: 1, z: 1, y: 0, order: 0 }
  const c = { x: CELL * 1.5 + MAZE_ORIGIN, z: CELL * 1.5 + MAZE_ORIGIN }
  // canonical +lz in world = (sin r, cos r)
  const ux = Math.sin(r * Math.PI / 2), uz = Math.cos(r * Math.PI / 2)
  const ys: number[] = []
  for (let s = -CELL / 2 + 0.01; s <= CELL / 2 - 0.01; s += 0.1) ys.push(rampSurfaceY(t, c.x + ux * s, c.z + uz * s))
  const maxRise = Math.max(...ys.slice(1).map((y, i) => y - ys[i]))
  check(`ramp r=${r}: rises ${STEP.toFixed(2)} m bottom→top, monotonic, ≤ ${maxRise.toFixed(3)} m per 0.1 m (no step a slide can't climb)`,
    Math.abs(ys[ys.length - 1] - ys[0] - STEP) < 1e-6 && ys.every((y, i) => i === 0 || y >= ys[i - 1] - 1e-9) && maxRise < 0.1)
}

// Shared anvils (server sim, shared/anvilSim.ts) on a real Sky maze.
{
  let sd: number | null = null
  for (let s1 = 1; s1 < 50 && sd === null; s1++) { try { sd = generateWithRetry(s1, 50) } catch { /* next */ } }
  const tiles = getPlacedTilesInOrder()
  const tp = teleportPairs().flatMap(([a, b]) => [a.tile, b.tile])
  const w = new AnvilWorld()
  w.setMaze(buildWalkableGraph(tiles), tiles, tp)
  const tpSq = new Set(tp.map(t => `${t.x},${t.z}`))
  const sq = (a: { pos: { x: number; z: number } }) => `${Math.floor((a.pos.x - MAZE_ORIGIN) / CELL)},${Math.floor((a.pos.z - MAZE_ORIGIN) / CELL)}`
  check(`anvils: ${LUNGE_DUMMY_COUNT} spawned, distinct tiles, none on a teleporter`, w.anvils.length === LUNGE_DUMMY_COUNT && w.anvils.every(a => a.alive) &&
    new Set(w.anvils.map(sq)).size === w.anvils.length && w.anvils.every(a => !tpSq.has(sq(a))))
  const a0 = { ...w.anvils[0].pos }, s0 = w.anvils[0].slide
  w.hit(0, 1, 0)
  check('anvil hit starts a new slide and moves it', w.anvils[0].slide === s0 + 1 && w.isMoving(w.anvils[0]))
  for (let t = 0; t < 10 && w.isMoving(w.anvils[0]); t += 0.1) w.tick(0.1)
  const moved = Math.hypot(w.anvils[0].pos.x - a0.x, w.anvils[0].pos.z - a0.z)
  check(`anvil slides then stops or falls (moved ${moved.toFixed(2)} m, alive ${w.anvils[0].alive})`, moved > 0.5 && !w.isMoving(w.anvils[0]))
  {
    // Prediction vs server: a client copy (setMaze respawn=false) seeded with the rendered state and
    // given the same knock tracks the server sim closely despite different frame rates.
    const srv = new AnvilWorld(), cli = new AnvilWorld()
    srv.setMaze(buildWalkableGraph(tiles), tiles, tp)
    cli.setMaze(buildWalkableGraph(tiles), tiles, [], false)
    check('client prediction copy does not spawn anvils itself', cli.anvils.every(a => !a.alive))
    Object.assign(cli.anvils[0], { pos: { ...srv.anvils[0].pos }, vel: { x: 0, y: 0, z: 0 }, alive: true, tracking: false })
    srv.hit(0, 0.6, 0.8); cli.hit(0, 0.6, 0.8)
    let maxErr = 0
    for (let t = 0; t < 0.6; t += 1 / 30) {
      srv.tick(1 / 60); srv.tick(1 / 60) // server 60 Hz, client 30 Hz
      cli.tick(1 / 30)
      if (srv.anvils[0].alive && cli.anvils[0].alive) maxErr = Math.max(maxErr, Math.hypot(srv.anvils[0].pos.x - cli.anvils[0].pos.x, srv.anvils[0].pos.z - cli.anvils[0].pos.z))
    }
    check(`prediction stays within ANVIL_PREDICT_CLOSE_M of the server over the timeout (max ${maxErr.toFixed(3)} m)`, maxErr <= ANVIL_PREDICT_CLOSE_M)
  }
  w.anvils[1].pos.y = -1000; w.anvils[1].tracking = true; w.tick(0.05)
  check('fallen anvil hides', !w.anvils[1].alive && w.anvils[1].respawnIn > 0)
  w.tick(LUNGE_DUMMY_RESPAWN_S + 0.1)
  check('…and auto-respawns after LUNGE_DUMMY_RESPAWN_S', w.anvils[1].alive)
}

if (fails) { console.log(`✗ ${fails} lunge check(s) failed`); process.exit(1) }
console.log('✓ all lunge checks passed')
