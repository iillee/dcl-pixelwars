/**
 * verify-star-pickup.ts — falling star orb spawn and pickup.
 * Pickup removes the orb and grants a normal upgrade. Nothing is held.
 * Run: npx tsx scripts/verify-star-pickup.ts
 */
import { readFileSync } from 'node:fs'
import { OverdriveBook } from '../src/server/overdriveBook'
import { canSpawnStar, nextStarSpawnAt, pickStarSpawn, starPickupWinner } from '../src/shared/overdrive'
import {
  STAR_FALL_HEIGHT, STAR_FALL_MS, STAR_PICKUP_MAX_DY, STAR_PICKUP_RADIUS,
  STAR_SPAWN_CLEAR_M, STAR_SPAWN_GRACE_MS, STAR_SPAWN_MAX_MS, STAR_SPAWN_MIN_MS, STAR_MAX_ACTIVE,
} from '../src/shared/pvp'

let fails = 0
function check(name: string, ok: boolean): void {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) fails++
}

const t0 = 1_000_000
check('next star waits a minute after pickup', STAR_SPAWN_MIN_MS === 60000 && STAR_SPAWN_MAX_MS === 60000)
check('at most one orb', STAR_MAX_ACTIVE === 1)
check('pickup radius is 1.2m', STAR_PICKUP_RADIUS === 1.2)
check('the star falls from the sky before it can be picked up', STAR_FALL_HEIGHT === 36 && STAR_FALL_MS === 2800)

check('no spawn during grace', !canSpawnStar({ now: t0 + STAR_SPAWN_GRACE_MS - 1, roundStartAt: t0, nextAt: t0, activeOrbs: 0 }))
check('spawn after grace when due', canSpawnStar({ now: t0 + STAR_SPAWN_GRACE_MS, roundStartAt: t0, nextAt: t0, activeOrbs: 0 }))
check('no second orb while one is out', !canSpawnStar({ now: t0 + STAR_SPAWN_GRACE_MS, roundStartAt: t0, nextAt: t0, activeOrbs: 1 }))
check('no spawn before nextAt', !canSpawnStar({ now: t0 + STAR_SPAWN_GRACE_MS, roundStartAt: t0, nextAt: t0 + STAR_SPAWN_GRACE_MS + 1000, activeOrbs: 0 }))

const n1 = nextStarSpawnAt(t0, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, () => 0)
const n2 = nextStarSpawnAt(t0, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, () => 0.999999)
check('next spawn honors the min interval', n1 === t0 + STAR_SPAWN_MIN_MS)
check('next spawn honors the max interval', n2 === t0 + STAR_SPAWN_MAX_MS)

const cells = [
  { id: 'near', x: 0, y: 1, z: 0 },
  { id: 'far', x: 20, y: 1, z: 0 },
]
check('spawn avoids a player inside the clear radius', pickStarSpawn(cells, [{ x: 0, z: 0 }], STAR_SPAWN_CLEAR_M, () => 0)?.id === 'far')
check('spawn returns null when every cell is crowded', pickStarSpawn(cells, [{ x: 0, z: 0 }, { x: 20, z: 0 }], STAR_SPAWN_CLEAR_M, () => 0) === null)

const touches = [
  { id: 'bot:1', isBot: true, distH: 0.2, distY: 0 },
  { id: 'far', isBot: false, distH: 1.0, distY: 0 },
  { id: 'near', isBot: false, distH: 0.4, distY: 0 },
  { id: 'high', isBot: false, distH: 0.1, distY: STAR_PICKUP_MAX_DY + 0.1 },
]
check('the closest human wins, and bots do not', starPickupWinner(touches) === 'near')
check('a bot standing on the star does not claim it', starPickupWinner([{ id: 'bot:4', isBot: true, distH: 0, distY: 0 }]) === null)

const book = new OverdriveBook()
const a = book.addOrb({ x: 1, y: 2, z: 3, cell: 'a' })
const b = book.addOrb({ x: 4, y: 5, z: 6, cell: 'b' })
check('orbs get stable ids', a.i === 1 && b.i === 2 && book.orbCount() === 2)
check('removing an orb drops only that one', book.removeOrb(a.i)?.cell === 'a' && book.orbCount() === 1 && book.liveOrbs()[0].i === b.i)
check('clearRound returns the leftovers and empties the book', book.clearRound().length === 1 && book.orbCount() === 0)

const serverSrc = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
const bookSrc = readFileSync(new URL('../src/server/overdriveBook.ts', import.meta.url), 'utf8')
check('server pickups remove the orb and grant an upgrade', serverSrc.includes('overdrive.removeOrb(orb.i)') && serverSrc.includes('upgrades.grantBonus(winner)'))
check('the star buff is gone', !serverSrc.includes('overdrive.claimOrb(') && !serverSrc.includes('sendStarHold(') && !bookSrc.includes('claimOrb') && !bookSrc.includes('starHold'))

if (fails) {
  console.error(`${fails} check(s) failed`)
  process.exit(1)
}
console.log('star pickup checks passed')
