/**
 * verify-star-pickup.ts — star orb spawn, pickup, ties, bots, effects, reset.
 * Run: npx tsx scripts/verify-star-pickup.ts
 */
import { readFileSync } from 'node:fs'
import { OverdriveBook } from '../src/server/overdriveBook'
import {
  canSpawnStar, emptyStarHold, expireStarHold, grantStarHold, isStarActive,
  localStarEndAt, starHoldRemainingMs,
  nextStarSpawnAt, overdriveCanTouch, overdrivePaintRadiusCells, overdriveTouchDir,
  paintBrushOffsets, pickStarSpawn, starPickupWinner, PAINT_BRUSH_RADIUS_CELLS,
} from '../src/shared/overdrive'
import {
  OVERDRIVE_TOUCH_RADIUS, OVERDRIVE_TOUCH_MAX_DY, OVERDRIVE_HIT_WINDOW_MS,
  OVERDRIVE_PAINT_RADIUS_MULT, OVERDRIVE_KNOCK, OVERDRIVE_LIFT,
  ANVIL_HIT_KNOCK, ANVIL_HIT_LIFT,
  STAR_MS, STAR_SPAWN_GRACE_MS, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, STAR_MAX_ACTIVE,
  STAR_PICKUP_RADIUS, STAR_PICKUP_MAX_DY, STAR_SPAWN_CLEAR_M, STAR_SPEED_MULT, STAR_COOLDOWN_MULT,
} from '../src/shared/pvp'
import { overdriveKnock } from '../src/shared/knocks'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

const t0 = 1_000_000
let painted = 0

check('STAR_MS is 20 seconds', STAR_MS === 20000)
check('spawn window is 20-35s', STAR_SPAWN_MIN_MS === 20000 && STAR_SPAWN_MAX_MS === 35000)
check('at most one orb', STAR_MAX_ACTIVE === 1)
check('pickup radius is 1.2m', STAR_PICKUP_RADIUS === 1.2)
check('speed and cooldown tunables', STAR_SPEED_MULT === 1.4 && STAR_COOLDOWN_MULT === 0.5)

const start = t0
check('no spawn during grace', !canSpawnStar({ now: start + STAR_SPAWN_GRACE_MS - 1, roundStartAt: start, nextAt: start, activeOrbs: 0, holderActive: false }))
check('spawn after grace when due', canSpawnStar({ now: start + STAR_SPAWN_GRACE_MS, roundStartAt: start, nextAt: start, activeOrbs: 0, holderActive: false }))
check('no second orb while one is out', !canSpawnStar({ now: start + STAR_SPAWN_GRACE_MS, roundStartAt: start, nextAt: start, activeOrbs: 1, holderActive: false }))
check('no spawn while a star is held', !canSpawnStar({ now: start + STAR_SPAWN_GRACE_MS, roundStartAt: start, nextAt: start, activeOrbs: 0, holderActive: true }))
check('no spawn before nextAt', !canSpawnStar({ now: start + STAR_SPAWN_GRACE_MS, roundStartAt: start, nextAt: start + STAR_SPAWN_GRACE_MS + 1000, activeOrbs: 0, holderActive: false }))

const n1 = nextStarSpawnAt(t0, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, () => 0)
const n2 = nextStarSpawnAt(t0, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, () => 0.999999)
check('next spawn honors the min interval', n1 === t0 + STAR_SPAWN_MIN_MS)
check('next spawn honors the max interval', n2 === t0 + STAR_SPAWN_MAX_MS)

const cells = [
  { id: 'a', x: 0, y: 1, z: 0 },
  { id: 'b', x: 20, y: 1, z: 0 },
  { id: 'c', x: 40, y: 1, z: 0 },
]
check('spawn prefers a cell clear of players', pickStarSpawn(cells, [{ x: 0, z: 0 }, { x: 20, z: 0 }], STAR_SPAWN_CLEAR_M, () => 0)?.id === 'c')
check('spawn returns null when every cell is blocked', pickStarSpawn(cells, [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 40, z: 0 }], STAR_SPAWN_CLEAR_M) === null)

const close = { id: 'p-close', isBot: false, distH: 0.4, distY: 0.2 }
const far = { id: 'p-far', isBot: false, distH: 1.0, distY: 0.2 }
const bot = { id: 'bot:1', isBot: true, distH: 0.1, distY: 0 }
check('closest contestant wins, even if it is a bot', starPickupWinner([far, close, bot]) === 'bot:1')
check('a closer human still beats a farther bot', starPickupWinner([close, { ...bot, distH: 1.1 }]) === 'p-close')
const tieA = { id: 'aaa', isBot: false, distH: 0.5, distY: 0 }
const tieB = { id: 'bbb', isBot: false, distH: 0.5, distY: 0 }
check('ties break by lower id', starPickupWinner([tieB, tieA]) === 'aaa')
check('bots can win a pickup', starPickupWinner([bot]) === 'bot:1')
check('equal distance still breaks by lower id across bot and human', starPickupWinner([bot, { id: 'p-same', isBot: false, distH: 0.1, distY: 0 }]) === 'bot:1')
check('out of range is ignored', starPickupWinner([{ id: 'p', isBot: false, distH: STAR_PICKUP_RADIUS + 0.01, distY: 0 }]) === null)
check('too high is ignored', starPickupWinner([{ id: 'p', isBot: false, distH: 0.2, distY: STAR_PICKUP_MAX_DY + 0.01 }]) === null)

let hold = emptyStarHold()
painted = 40
hold = grantStarHold(t0, STAR_MS)
check('grant starts a 20s star', isStarActive(hold, t0 + 1) && hold.activeUntil === t0 + STAR_MS)
check('star expires after STAR_MS', !isStarActive(expireStarHold(hold, t0 + STAR_MS + 1), t0 + STAR_MS + 1))
check('painted total is unchanged by grant or expire', painted === 40)

const book = new OverdriveBook()
const botUntil = book.grant('bot:3', t0)
check('book grants a bot the star', botUntil === t0 + STAR_MS && book.isActive('bot:3', t0 + 1))
check('bot death ends the star', book.onDeath('bot:3', t0 + 20) && !book.isActive('bot:3', t0 + 20))
const until = book.grant('p1', t0)
check('book grants a human the star', until === t0 + STAR_MS && book.isActive('p1', t0 + 1))
check('book will not grant a second star to the same holder while the first is still active', book.grant('p1', t0 + 10) === until)
painted = 99
check('death ends the star', book.onDeath('p1', t0 + 20) && !book.isActive('p1', t0 + 20))
check('death does not clear the painted total', painted === 99)

const again = new OverdriveBook()
const firstUntil = again.grant('p1', t0)
check('first of two pickups is granted', firstUntil === t0 + STAR_MS && again.isActive('p1', t0 + 1))
check('no second grant while the first hold is live', again.grant('p1', t0 + STAR_MS - 1) === firstUntil)
const ended = again.expire(t0 + STAR_MS + 1)
check('expire clears the first hold', ended.includes('p1') && !again.isActive('p1', t0 + STAR_MS + 1) && !again.holderActive(t0 + STAR_MS + 1))
const t2 = t0 + STAR_MS + 1
const secondUntil = again.grant('p1', t2)
check('same player can pick up a second star after the first expires', secondUntil === t2 + STAR_MS && secondUntil !== firstUntil && again.isActive('p1', t2 + 1))
check('the second hold also lasts STAR_MS', again.isActive('p1', t2 + STAR_MS - 1) && !again.isActive('p1', t2 + STAR_MS + 1))

book.grant('p1', t0)
const orb = book.addOrb({ x: 1, y: 2, z: 3, cell: 'c1' })
check('book tracks a live orb', book.orbCount() === 1 && book.getOrb(orb.i)?.cell === 'c1')
book.clearRound()
check('round reset clears holds and orbs', !book.isActive('p1', t0) && book.orbCount() === 0)
check('painted total is unchanged by a round clear of the star book', painted === 99)

const touchBase = {
  attacker: 'a', victim: 'b', attackerTeam: 1, victimTeam: 2,
  distH: 1, distY: 0.2, lastHitAt: 0, now: t0, attackerActive: true, victimImmune: false,
}
check('touch in range is accepted', overdriveCanTouch(touchBase))
check('touch out of range is not', !overdriveCanTouch({ ...touchBase, distH: OVERDRIVE_TOUCH_RADIUS + 0.1 }))
check('touch too high is not', !overdriveCanTouch({ ...touchBase, distY: OVERDRIVE_TOUCH_MAX_DY + 0.1 }))
check('teammates are not launched', !overdriveCanTouch({ ...touchBase, victimTeam: 1 }))
check('self is not launched', !overdriveCanTouch({ ...touchBase, victim: 'a' }))
check('inactive star does not launch', !overdriveCanTouch({ ...touchBase, attackerActive: false }))
check('a starred bot can launch a human', overdriveCanTouch({ ...touchBase, attacker: 'bot:3' }))
check('a starred human can launch a human', overdriveCanTouch(touchBase))
check('a starred human can launch a bot', overdriveCanTouch({ ...touchBase, victim: 'bot:7', victimTeam: 2 }))
check('immune victim is not launched', !overdriveCanTouch({ ...touchBase, victimImmune: true }))
check('same victim is not relaunched inside the window', !overdriveCanTouch({ ...touchBase, lastHitAt: t0 - OVERDRIVE_HIT_WINDOW_MS + 1 }))
check('same victim can be launched after the window', overdriveCanTouch({ ...touchBase, lastHitAt: t0 - OVERDRIVE_HIT_WINDOW_MS }))
const dir = overdriveTouchDir(0, 0, 4, 0)
check('knock direction is away from the star', Math.abs(dir.x - 1) < 1e-9 && Math.abs(dir.z) < 1e-9)
const kn = overdriveKnock(1, 0)
check('star knock reuses anvil tunables along +X', kn.kind === 'overdrive' && kn.impulse.x === OVERDRIVE_KNOCK && kn.impulse.y === OVERDRIVE_LIFT && OVERDRIVE_KNOCK === ANVIL_HIT_KNOCK && OVERDRIVE_LIFT === ANVIL_HIT_LIFT)
check('default brush is 3x3', paintBrushOffsets(2, PAINT_BRUSH_RADIUS_CELLS).length === 9)
check('star brush uses OVERDRIVE_PAINT_RADIUS_MULT', overdrivePaintRadiusCells(true) === PAINT_BRUSH_RADIUS_CELLS * OVERDRIVE_PAINT_RADIUS_MULT)
const wide = paintBrushOffsets(2, overdrivePaintRadiusCells(true))
check('active brush is wider than the default 3x3', wide.length === 25 && paintBrushOffsets(2, overdrivePaintRadiusCells(false)).length === 9)

check('remaining ms is until minus now', starHoldRemainingMs(t0 + STAR_MS, t0) === STAR_MS && starHoldRemainingMs(0, t0) === 0)
check('a client 36s behind the server would have shown ~48s on a 12s hold', starHoldRemainingMs(t0 + 12000, t0 - 36000) === 48000)
check('local end is remaining ms on the client clock, not the server timestamp', localStarEndAt(t0, STAR_MS) === t0 + STAR_MS && localStarEndAt(t0, 0) === 0)

const serverSrc = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
const odSrc = readFileSync(new URL('../src/client/overdrive.ts', import.meta.url), 'utf8')
check('the server touch loop looks up bot teams, not only the human roster', serverSrc.includes('overdriveTeamOf') && serverSrc.includes('botTeams.get(id)'))
check('the server touch loop tests human victims and bot victims', serverSrc.includes('for (const e of rosterEntries())') && serverSrc.includes('for (const b of getBotHitPoints())') && serverSrc.includes("room.send('overdriveImpact'"))
check('the client applies overdrive knock to the local player and to bots', odSrc.includes('applyKnock(overdriveKnock(dx, dz)') && odSrc.includes("playBotKnock(bid, dx, dz, 'overdrive')"))
check('the STAR seconds chip is gone', !uiSrc.includes('starHudSeconds') && !/STAR \$\{/.test(uiSrc) && !uiSrc.includes('starLabel'))
check('star particles rise and fade and do not orbit', odSrc.includes('SPARK_LIFE') && odSrc.includes('SPARK_GOLD') && !odSrc.includes('SPARK_ORBIT') && odSrc.includes('fade = 1 - t'))
check('the client starts the hold from remaining ms on its own clock', odSrc.includes('localStarEndAt(now, ms)'))

if (fails) { console.log(`✗ ${fails} star-pickup check(s) failed`); process.exit(1) }
console.log('✓ all star-pickup checks passed')
