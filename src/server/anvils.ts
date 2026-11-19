/**
 * anvils.ts — server owner of the shared anvil dummies (shared/anvilSim.ts).
 * Runs the slide sim, falls and respawns; broadcasts anvilState at ANVIL_SYNC_HZ while anything
 * moves (plus one final frame when it stops), on every spawn change, and a keep-alive every
 * ANVIL_KEEPALIVE_S so late joiners get the positions. Hits arrive via server.ts (anvilHit, after
 * the lunge / burst ledgers accept them); key 2 → anvilRespawn (rate-limited per player).
 */
import { engine } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { AnvilWorld } from '../shared/anvilSim'
import { anvilKnock } from '../shared/knocks'
import { anvilStrikeAccepted, anvilStrikeDir } from '../shared/anvilHit'
import {
  LUNGE_TEST_DUMMY, ANVIL_PUSH_SPEED, ANVIL_PUSH_RUN_MULT, ANVIL_PUSH_REACH, ANVIL_PUSH_SEND_HZ,
  ANVIL_HIT_RADIUS, ANVIL_HIT_MAX_DY, ANVIL_HIT_REPORT_SLACK,
} from '../shared/pvp'
import { getPlacedTilesInOrder, teleportPairs } from '../maze/generator'
import { IS_SKY } from '../maze/level'
import { getBotHitPoints, getWalkableGraph, hitBot } from './bots/manager'

const ANVIL_SYNC_HZ = 10
const ANVIL_KEEPALIVE_S = 2
const RESPAWN_REQ_GAP_MS = 1000

const world = new AnvilWorld()
world.log = s => console.log(`[Server] ${s}`)
let dirty = true
let wasMoving = false
let clock = 0
let keepAlive = 0
const lastRespawnReq = new Map<string, number>()

/** One launch per accepted lunge/burst hit on an anvil (keyed by anvil index + slide). */
type Launch = { at: number; by: string; slide: number; hit: Set<string> }
const launches = new Map<number, Launch>()

function launchOf(i: number): Launch | null {
  const a = world.anvils[i]
  const L = launches.get(i)
  if (!a || !a.alive || !L || L.slide !== a.slide) return null
  return L
}

function launchVel(i: number): { x: number; y: number; z: number; speed: number } | null {
  const a = world.anvils[i]
  if (!a) return null
  const pv = world.pushVel(a)
  const x = a.vel.x + pv.x, z = a.vel.z + pv.z
  return { x, y: a.vel.y, z, speed: Math.hypot(x, z) }
}

function tryStrike(i: number, victim: string, x: number, y: number, z: number, radius: number): { attacker: string; dx: number; dz: number } | null {
  const a = world.anvils[i]
  const L = launchOf(i)
  const v = launchVel(i)
  if (!a || !L || !v) return null
  const now = Date.now()
  const ok = anvilStrikeAccepted({
    alive: a.alive,
    heldMs: now - L.at,
    speed: v.speed,
    distH: Math.hypot(x - a.pos.x, z - a.pos.z),
    distY: y - a.pos.y,
    radius,
    victim,
    hitter: L.by,
    alreadyHit: L.hit.has(victim),
  })
  if (!ok) return null
  const dir = anvilStrikeDir(v.x, v.z, x - a.pos.x, z - a.pos.z)
  L.hit.add(victim)
  return { attacker: L.by, dx: dir.x, dz: dir.z }
}

/** Client-reported contact: the reporter is the victim. Slack covers snapshot / RTT lag. */
export function tryAnvilPlayerStrike(from: string, i: number, x: number, y: number, z: number): { attacker: string; dx: number; dz: number } | null {
  if (!from || ![x, y, z].every(isFinite) || !world.anvils[i]) return null
  return tryStrike(i, from.toLowerCase(), x, y, z, ANVIL_HIT_RADIUS + ANVIL_HIT_REPORT_SLACK)
}

function tickBotStrikes(): void {
  const bots = getBotHitPoints()
  if (bots.length === 0) return
  for (let i = 0; i < world.anvils.length; i++) {
    const a = world.anvils[i]
    if (!a || !launchOf(i)) continue
    for (const b of bots) {
      const hit = tryStrike(i, `bot:${b.id}`, b.x, b.y, b.z, ANVIL_HIT_RADIUS)
      if (!hit) continue
      const ok = hitBot(b.id, a.pos.x, a.pos.y, a.pos.z, ANVIL_HIT_RADIUS + 0.05, ANVIL_HIT_MAX_DY, () => anvilKnock(hit.dx, hit.dz))
      if (!ok) {
        // Range or immunity rejected the body knock; let a later tick retry.
        launchOf(i)?.hit.delete(`bot:${b.id}`)
        continue
      }
      room.send('anvilImpact', { i, attacker: hit.attacker, target: `bot:${b.id}`, dx: hit.dx, dz: hit.dz })
      console.log(`[Server] anvil ${i} launched bot:${b.id} by ${hit.attacker.slice(0, 8)}`)
    }
  }
}


function send(): void {
  room.send('anvilState', {
    st: Date.now(),
    a: world.anvils.map(a => ({
      x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x + world.pushVel(a).x, vy: a.vel.y, vz: a.vel.z + world.pushVel(a).z,
      yaw: a.yaw, alive: a.alive ? 1 : 0, moving: world.isMoving(a) ? 1 : 0, slide: a.slide,
    })),
  })
}

/** Call after the server's walkable graph is rebuilt for a new maze. */
export function anvilsMazeChanged(): void {
  if (!LUNGE_TEST_DUMMY) return
  // Sky teleporters are a pure function of the layout (same tiles the clients get).
  const tp = IS_SKY ? teleportPairs().flatMap(([a, b]) => [a.tile, b.tile]) : []
  world.setMaze(getWalkableGraph(), getPlacedTilesInOrder(), tp)
  dirty = true
}

/** Accepted hit from server.ts. Starts a launch window credited to `from`. */
export function anvilsHit(i: number, dx: number, dz: number, mult: number, from = ''): void {
  if (!world.hit(i, dx, dz, mult)) return
  const a = world.anvils[i]
  launches.set(i, { at: Date.now(), by: from.toLowerCase(), slide: a.slide, hit: new Set() })
  dirty = true
  console.log(`[Server] anvil ${i} hit ×${mult.toFixed(2)} by ${from.slice(0, 8) || '?'}`)
}

/** Slow push intent from a player at (x, z). Validated: near the anvil, rate-limited; speed is server-side. */
const lastPush = new Map<string, number>()
let pushRejectLogAt = 0
export function anvilsPush(from: string, i: number, dx: number, dz: number, x: number, z: number, run: boolean): void {
  const now = Date.now()
  if (now - (lastPush.get(from) ?? 0) < 1000 / ANVIL_PUSH_SEND_HZ * 0.5) return
  const a = world.anvils[i]
  const len = Math.hypot(dx, dz)
  if (!a || ![dx, dz, x, z].every(isFinite) || len < 1e-3) return
  if (Math.hypot(a.pos.x - x, a.pos.z - z) > ANVIL_PUSH_REACH + 0.5) {
    if (now - pushRejectLogAt > 5000) { pushRejectLogAt = now; console.log(`[Server] anvilPush ${from.slice(0, 10)} anvil ${i} rejected: too far`) }
    return
  }
  lastPush.set(from, now)
  const v = ANVIL_PUSH_SPEED * (run ? ANVIL_PUSH_RUN_MULT : 1) / len
  world.push(i, dx * v, dz * v)
}

export function anvilsRespawnRequest(from: string): void {
  const now = Date.now()
  if (now - (lastRespawnReq.get(from) ?? 0) < RESPAWN_REQ_GAP_MS) return
  lastRespawnReq.set(from, now)
  world.respawnAll()
  dirty = true
}

let awake = true

/** Lobby: stop the sim and hide the dummies. The next maze reseat turns them back on. */
export function anvilsAwake(on: boolean): void {
  awake = on
  if (on) return
  for (const a of world.anvils) {
    a.alive = false
    a.vel.x = 0
    a.vel.y = 0
    a.vel.z = 0
  }
  launches.clear()
  dirty = true
  send()
}

export function initAnvils(): void {
  if (!LUNGE_TEST_DUMMY) return
  engine.addSystem((dt: number) => {
    if (!awake) return
    const before = world.anvils.map(a => a.alive)
    world.tick(dt)
    if (world.anvils.some((a, i) => a.alive !== before[i])) dirty = true // fell / respawned
    tickBotStrikes()
    const moving = world.anvils.some(a => world.isMoving(a))
    clock += dt; keepAlive += dt
    if (clock < 1 / ANVIL_SYNC_HZ) return
    clock = 0
    if (dirty || moving || wasMoving || keepAlive >= ANVIL_KEEPALIVE_S) {
      send()
      dirty = false; keepAlive = 0
    }
    wasMoving = moving
  })
}
