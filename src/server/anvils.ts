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
import { LUNGE_TEST_DUMMY, ANVIL_PUSH_SPEED, ANVIL_PUSH_RUN_MULT, ANVIL_PUSH_REACH, ANVIL_PUSH_SEND_HZ } from '../shared/pvp'
import { getPlacedTilesInOrder, teleportPairs } from '../maze/generator'
import { IS_SKY } from '../maze/level'
import { getWalkableGraph } from './bots/manager'

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

function send(): void {
  room.send('anvilState', {
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

/** Accepted hit from server.ts. */
export function anvilsHit(i: number, dx: number, dz: number, mult: number): void {
  if (world.hit(i, dx, dz, mult)) { dirty = true; console.log(`[Server] anvil ${i} hit ×${mult.toFixed(2)}`) }
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

export function initAnvils(): void {
  if (!LUNGE_TEST_DUMMY) return
  engine.addSystem((dt: number) => {
    const before = world.anvils.map(a => a.alive)
    world.tick(dt)
    if (world.anvils.some((a, i) => a.alive !== before[i])) dirty = true // fell / respawned
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
