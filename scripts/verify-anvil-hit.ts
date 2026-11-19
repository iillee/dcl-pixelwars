/**
 * verify-anvil-hit.ts — offline checks for launched-anvil strike rules.
 * Run: npx tsx scripts/verify-anvil-hit.ts
 */
import { anvilLaunchActive, anvilStrikeAccepted, anvilStrikeDir } from '../src/shared/anvilHit'
import {
  ANVIL_HIT_MIN_SPEED, ANVIL_HIT_RADIUS, ANVIL_HIT_MAX_DY, ANVIL_HIT_WINDOW_MS, ANVIL_HITTER_IMMUNE_MS,
  ANVIL_HIT_KNOCK, ANVIL_HIT_LIFT, LUNGE_KNOCKBACK, ANVIL_PUSH_RUN_MULT, ANVIL_PUSH_SPEED,
} from '../src/shared/pvp'
import { anvilKnock } from '../src/shared/knocks'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

check(`min speed ${ANVIL_HIT_MIN_SPEED} m/s is above a run-push (${ANVIL_PUSH_SPEED * ANVIL_PUSH_RUN_MULT} m/s)`,
  ANVIL_HIT_MIN_SPEED > ANVIL_PUSH_SPEED * ANVIL_PUSH_RUN_MULT)
check('resting anvil is not launching', !anvilLaunchActive(100, 0))
check('slow slide is not launching', !anvilLaunchActive(200, ANVIL_HIT_MIN_SPEED - 0.1))
check('fast anvil inside the window is launching', anvilLaunchActive(500, ANVIL_HIT_MIN_SPEED))
check('fast anvil after the window is not', !anvilLaunchActive(ANVIL_HIT_WINDOW_MS + 1, 20))
check(`knock ${ANVIL_HIT_KNOCK} / lift ${ANVIL_HIT_LIFT} is stronger than a lunge`,
  ANVIL_HIT_KNOCK > LUNGE_KNOCKBACK && ANVIL_HIT_LIFT > 12)

const base = {
  alive: true, heldMs: 200, speed: 10, distH: 0.5, distY: 0.2,
  radius: ANVIL_HIT_RADIUS, victim: 'b', hitter: 'a', alreadyHit: false,
}
check('clean strike is accepted', anvilStrikeAccepted(base))
check('dead anvil is not', !anvilStrikeAccepted({ ...base, alive: false }))
check('second hit on the same victim is not', !anvilStrikeAccepted({ ...base, alreadyHit: true }))
check('too far horizontally is not', !anvilStrikeAccepted({ ...base, distH: ANVIL_HIT_RADIUS + 0.1 }))
check('at the radius edge is', anvilStrikeAccepted({ ...base, distH: ANVIL_HIT_RADIUS }))
check('too high is not', !anvilStrikeAccepted({ ...base, distY: ANVIL_HIT_MAX_DY + 0.1 }))
check('hitter is immune just after their own hit',
  !anvilStrikeAccepted({ ...base, victim: 'a', heldMs: ANVIL_HITTER_IMMUNE_MS - 1, speed: 20 }))
check('hitter can be hit after the immunity window',
  anvilStrikeAccepted({ ...base, victim: 'a', heldMs: ANVIL_HITTER_IMMUNE_MS, speed: 20 }))
check('another player can be hit during the hitter immunity window',
  anvilStrikeAccepted({ ...base, heldMs: 50, speed: 20 }))

const along = anvilStrikeDir(3, 0, 0, 1)
check('knock follows the anvil velocity', Math.abs(along.x - 1) < 1e-9 && Math.abs(along.z) < 1e-9)
const fallback = anvilStrikeDir(0, 0, 0, 4)
check('still anvil falls back to the offset toward the victim', Math.abs(fallback.z - 1) < 1e-9)

const spec = anvilKnock(1, 0)
check('anvil knock uses the tunables along +X',
  spec.kind === 'anvil' && spec.impulse.x === ANVIL_HIT_KNOCK && spec.impulse.y === ANVIL_HIT_LIFT && spec.impulse.z === 0)

if (fails) { console.log(`✗ ${fails} anvil-hit check(s) failed`); process.exit(1) }
console.log('✓ all anvil-hit checks passed')
