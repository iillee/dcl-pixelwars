// Day/night on the round clock: day even rounds, continuous at boundaries, ~linear within a round.
import { skySecondsAt, DAY_FROM_SEC, DAY_TO_SEC, SKYBOX_DAY_SEC } from '../src/shared/dayNight'
import { ROUND_INTERVAL_MS } from '../src/shared/roundTiming'
let fails = 0
const check = (m: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${m}`); if (!ok) fails++ }
const arc = (a: number, b: number) => { const f = ((b - a) % SKYBOX_DAY_SEC + SKYBOX_DAY_SEC) % SKYBOX_DAY_SEC; return Math.min(f, SKYBOX_DAY_SEC - f) }
const R = ROUND_INTERVAL_MS, base = 1000 * R // even round
check('even round starts at dawn', arc(skySecondsAt(base), DAY_FROM_SEC) < 1)
check('even round mid = around midday', Math.abs(skySecondsAt(base + R / 2) - (DAY_FROM_SEC + DAY_TO_SEC) / 2) < 1)
check('odd round starts at sunset', arc(skySecondsAt(base + R), DAY_TO_SEC) < 1)
check('odd round mid wraps past midnight', skySecondsAt(base + R * 1.5) < 6 * 3600)
let maxStep = 0
for (let t = base; t < base + 4 * R; t += 100) maxStep = Math.max(maxStep, arc(skySecondsAt(t), skySecondsAt(t + 100)))
check(`no jumps over 2 cycles incl. boundaries (max ${maxStep.toFixed(1)} sky-s per 100 ms)`, maxStep < 60)
console.log(fails ? `✗ ${fails} day/night check(s) failed` : '✓ all day/night checks passed')
if (fails) process.exit(1)
