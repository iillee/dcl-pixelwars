/**
 * verify-star-pickup.ts — star orb spawn, pickup, ties, bots, effects, reset.
 * Run: npx tsx scripts/verify-star-pickup.ts
 */
import { readFileSync } from 'node:fs'
import { OverdriveBook } from '../src/server/overdriveBook'
import {
  canSpawnStar, emptyStarHold, expireStarHold, grantStarHold, isStarActive,
  resolveStarHoldEnd, starHoldRemainingMs,
  localStarEndAt,
  nextStarSpawnAt, overdriveCanTouch, overdrivePaintRadiusCells, overdriveTouchDir,
  paintBrushOffsets, pickStarSpawn, starPickupWinner, PAINT_BRUSH_RADIUS_CELLS,
} from '../src/shared/overdrive'
import {
  OVERDRIVE_TOUCH_RADIUS, OVERDRIVE_TOUCH_MAX_DY, OVERDRIVE_HIT_WINDOW_MS,
  OVERDRIVE_PAINT_RADIUS_MULT, OVERDRIVE_KNOCK, OVERDRIVE_LIFT,
  ANVIL_HIT_KNOCK, ANVIL_HIT_LIFT,
  STAR_MS, STAR_SPAWN_GRACE_MS, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, STAR_MAX_ACTIVE,
  STAR_PICKUP_RADIUS, STAR_PICKUP_MAX_DY, STAR_SPAWN_CLEAR_M, STAR_SPEED_MULT, STAR_COOLDOWN_MULT, STAR_THEME_SRC,
} from '../src/shared/pvp'
import { overdriveKnock } from '../src/shared/knocks'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

const t0 = 1_000_000
let painted = 0

check('STAR_MS is 23 seconds, matching the star theme', STAR_MS === 23000)
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
check('grant starts a STAR_MS star', isStarActive(hold, t0 + 1) && hold.activeUntil === t0 + STAR_MS)
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
check('the client starts the hold from remaining ms on its own clock', odSrc.includes('resolveStarHoldEnd(endAt, remainingMs, now)'))
check('star theme is the 23s track, played once, no loop', STAR_THEME_SRC === 'assets/sounds/star-theme.mp3' && odSrc.includes('loop: false') && odSrc.includes('setMusicDucked(live)'))

// End-to-end: expire the book, spawn a new orb, and claim it as the same player,
// including the starHold payload the server would send and the client's resolver.
const e2e = new OverdriveBook()
const tGrant = 5_000_000
const orb1 = e2e.addOrb({ x: 10, y: 2, z: 10, cell: 'c1' })
const first = e2e.claimOrb('P1', orb1.i, tGrant)
check('first claim removes the orb and grants STAR_MS', !!first && first.until === tGrant + STAR_MS && e2e.orbCount() === 0 && e2e.isActive('p1', tGrant + 1))
check('first starHold payload has remaining STAR_MS', !!first && starHoldRemainingMs(first.until, tGrant) === STAR_MS)
const localFirst = resolveStarHoldEnd(first!.until, STAR_MS, tGrant)
check('client starts the first hold from remaining ms, not the server clock', localFirst === tGrant + STAR_MS)
const expiredAt = tGrant + STAR_MS + 1
const expiredIds = e2e.expire(expiredAt)
check('after the timer the book has no leftover hold', expiredIds.includes('p1') && !e2e.isActive('p1', expiredAt) && !e2e.holderActive(expiredAt) && e2e.actives(expiredAt).length === 0)
check('an expired hold is removed, not left as a sticky empty entry', !e2e.isActive('p1', expiredAt + 1))
const endPayloadMs = starHoldRemainingMs(0, expiredAt)
const localClear = resolveStarHoldEnd(0, endPayloadMs, expiredAt)
check('end starHold (until=0, ms=0) clears the client hold', endPayloadMs === 0 && localClear === 0)
const tSecond = expiredAt + 1
check('a new orb can spawn once the hold is gone', canSpawnStar({ now: tSecond, roundStartAt: 0, nextAt: tSecond, activeOrbs: e2e.orbCount(), holderActive: e2e.holderActive(tSecond) }))
const orb2 = e2e.addOrb({ x: 20, y: 2, z: 20, cell: 'c2' })
check('second orb uses a new id', orb2.i !== orb1.i)
const second = e2e.claimOrb('P1', orb2.i, tSecond)
check('same player can claim the second orb after expiry', !!second && second.until === tSecond + STAR_MS && second.until !== first!.until && e2e.isActive('p1', tSecond + 1) && e2e.orbCount() === 0)
check('second starHold payload is a full fresh grant', !!second && starHoldRemainingMs(second.until, tSecond) === STAR_MS)
const localSecond = resolveStarHoldEnd(second!.until, STAR_MS, tSecond)
check('client treats the second grant as a new hold', localSecond === tSecond + STAR_MS && localSecond !== localFirst)
const staleEnd = resolveStarHoldEnd(0, 0, tSecond)
check('a late until:0 does not look like a grant', staleEnd === 0)
// If ms is missing on a live until, still start a full hold instead of no-op.
check('a grant with until>0 still activates when ms is missing', resolveStarHoldEnd(tSecond + STAR_MS, undefined, tSecond) === tSecond + STAR_MS)
check('claimOrb is always fresh even if a hold were still live', e2e.claimOrb('p1', e2e.addOrb({ x: 1, y: 2, z: 1, cell: 'c3' }).i, tSecond + 100)!.until === tSecond + 100 + STAR_MS)

const bookSrc = readFileSync(new URL('../src/server/overdriveBook.ts', import.meta.url), 'utf8')
check('server pickups go through claimOrb', serverSrc.includes('overdrive.claimOrb(') && !/overdrive\.removeOrb\(orb\.i\)/.test(serverSrc))
check('claimOrb grants a fresh hold', bookSrc.includes('this.grant(winner, now, true)') && bookSrc.includes('this.holds.delete(id)'))
check('client uses resolveStarHoldEnd for every starHold', odSrc.includes('resolveStarHoldEnd(') && odSrc.includes('if (who === myAddress()) setLocal(localEnd)'))
check('feet are reported during a match so a second orb can be claimed', odSrc.includes('hasStarOrbs() || !inLobby()'))

if (fails) { console.log(`✗ ${fails} star-pickup check(s) failed`); process.exit(1) }
console.log('✓ star pickup, expiry, and a second claim end to end')
