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
import { LUNGE_TEST_DUMMY } from '../shared/pvp'
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
      x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x, vy: a.vel.y, vz: a.vel.z,
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
