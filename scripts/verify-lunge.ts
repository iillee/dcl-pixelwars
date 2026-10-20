/**
 * verify-lunge.ts — offline checks for the Lunge logic (shared/lunge.ts).
 * Run: npx tsx scripts/verify-lunge.ts. Covers hit geometry, knockback
 * direction, server dedupe/cooldown/window and victim stale/dup gates.
 * Movement feel, ramps and real networking need Explorer playtests.
 */
import { sweptHit, knockDir, LungeLedger, ImpactGate } from '../src/shared/lunge'
import { LUNGE_HIT_FORWARD, LUNGE_COOLDOWN_S, SERVER_MIN_LUNGE_GAP_S, SERVER_LUNGE_HIT_WINDOW_S, LUNGE_IMPACT_MAX_AGE_MS, LUNGE_HIT_RADIUS } from '../src/shared/pvp'

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
check(`standing lunge: target 1.6 m ahead hits (reach ${(LUNGE_HIT_FORWARD + LUNGE_HIT_RADIUS).toFixed(1)} m)`, sweptHit(O, O, P(0, 1.6), O, 0, 1))
check('standing lunge: target 1.9 m ahead misses', !sweptHit(O, O, P(0, 1.9), O, 0, 1))
check('point-blank target beside the attacker (0.5 m, 90°) still hits', sweptHit(O, O, P(0.5, 0), O, 0, 1))
check('target 1.0 m to the side at the attacker misses (hitbox is ahead)', !sweptHit(O, O, P(1.05, -0.2), O, 0, 1))
check(`hitbox edge: ${LUNGE_HIT_RADIUS} m side offset hits`, sweptHit(O, P(0, 2), P(LUNGE_HIT_RADIUS - 0.01, 1), O, 0, 1))
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

if (fails) { console.log(`✗ ${fails} lunge check(s) failed`); process.exit(1) }
console.log('✓ all lunge checks passed')
