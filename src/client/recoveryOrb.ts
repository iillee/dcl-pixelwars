/**
 * recoveryOrb.ts — gold d20 recovery orb under a tile-seam arch.
 *
 * Visuals follow the old teleport orb (gold d20 + wire, bob, spin, gold
 * point light, positional teleport.mp3). Pickup is server-authoritative:
 * the client only reports a touch and waits for recovery:home.
 *
 * If a Lakitu carry has already attached, the local player ignores the orb
 * (the rescue is already in progress). A fall that has sent playerFell but
 * has not been caught yet can still be saved. The orb itself never credits
 * a KO.
 */
import {
  engine, Entity, Transform, AudioSource, GltfContainer, LightSource,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import { RECOVERY_ORB_RADIUS, RECOVERY_ORB_SCALE } from '../shared/recoveryOrb'
import { fallRescueCarryAttached } from './fallRescue'

const ORB_SPIN_SPEED_Y = 0.5
const ORB_SPIN_SPEED_X = 0.3
const ORB_BOB_SPEED = 2.0
const ORB_BOB_RANGE = 0.075
const GOLD = Color3.create(1.0, 0.45, 0.0)
const TOUCH_RETRY_S = 0.25

type Rec = {
  root: Entity
  parts: Entity[]
  snd: Entity
  x: number
  baseY: number
  z: number
  clock: number
}

let rec: Rec | null = null
let wired = false
let wasInside = false
let touchRetry = 0

function teardown(): void {
  if (!rec) return
  console.log('[Orb] client remove')
  try { engine.removeEntity(rec.root) } catch { /* already gone */ }
  try { engine.removeEntity(rec.snd) } catch { /* already gone */ }
  for (const e of rec.parts) {
    try { engine.removeEntity(e) } catch { /* already gone */ }
  }
  rec = null
  wasInside = false
}

let sfx: Entity | null = null

function playTeleportAt(x: number, y: number, z: number): void {
  if (!sfx) sfx = engine.addEntity()
  Transform.createOrReplace(sfx, { position: Vector3.create(x, y, z) })
  AudioSource.createOrReplace(sfx, {
    audioClipUrl: 'assets/sounds/teleport.mp3',
    playing: true,
    loop: false,
    volume: 1,
    global: false,
  })
}

function showOrb(x: number, y: number, z: number): void {
  const moved = rec !== null
  const prev = rec ? { x: rec.x, y: rec.baseY, z: rec.z } : null
  teardown()
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(x, y, z),
    scale: Vector3.create(RECOVERY_ORB_SCALE, RECOVERY_ORB_SCALE, RECOVERY_ORB_SCALE),
    rotation: Quaternion.Zero(),
  })
  GltfContainer.create(root, { src: 'assets/models/d20-gold.glb' })
  const wire = engine.addEntity()
  Transform.create(wire, { parent: root, position: Vector3.Zero(), scale: Vector3.create(1.02, 1.02, 1.02) })
  GltfContainer.create(wire, { src: 'assets/models/d20-wire-gold.glb' })
  const light = engine.addEntity()
  Transform.create(light, { parent: root, position: Vector3.Zero() })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: GOLD, intensity: 400, range: 28 })
  const snd = engine.addEntity()
  Transform.create(snd, { position: Vector3.create(x, y, z) })
  AudioSource.create(snd, { audioClipUrl: 'assets/sounds/teleport.mp3', playing: false, loop: false, volume: 1, global: false })
  rec = { root, parts: [wire, light], snd, x, baseY: y, z, clock: 0 }
  wasInside = false
  console.log(`[Orb] client spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} src=assets/models/d20-gold.glb`)
  if (moved && prev) playTeleportAt(prev.x, prev.y, prev.z)
}

export function initRecoveryOrb(): void {
  if (wired) return
  wired = true
  events.on('recovery:orb', ({ x, y, z }) => {
    if (![x, y, z].every(n => typeof n === 'number' && isFinite(n))) return
    showOrb(x, y, z)
  })
  events.on('recovery:clear', () => { teardown() })
  events.on('recovery:home', () => {
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (p) playTeleportAt(p.x, p.y, p.z)
    else if (rec) playTeleportAt(rec.x, rec.baseY, rec.z)
    console.log('[Orb] home')
  })
  // Do not teardown on round:reset. The server sends recoveryOrb after
  // roundReset at match start, but a later reset without a new spawn
  // would hide the orb for the rest of the match. recoveryOrbClear and
  // lobby:floor still take it down when the arena goes away.
  events.on('lobby:floor', () => { teardown() })
  engine.addSystem((dt) => {
    if (rec) {
      rec.clock += dt
      const tr = Transform.getMutableOrNull(rec.root)
      if (tr) {
        tr.position = Vector3.create(rec.x, rec.baseY + ORB_BOB_RANGE * Math.sin(rec.clock * ORB_BOB_SPEED), rec.z)
        tr.rotation = Quaternion.fromEulerDegrees(rec.clock * ORB_SPIN_SPEED_X * 57.3, rec.clock * ORB_SPIN_SPEED_Y * 57.3, 0)
      }
    }
    if (!rec) { wasInside = false; return }
    if (fallRescueCarryAttached()) { wasInside = false; return }
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    const inside = Vector3.distance(p, Vector3.create(rec.x, rec.baseY, rec.z)) < RECOVERY_ORB_RADIUS
    if (inside) {
      touchRetry -= dt
      if (!wasInside || touchRetry <= 0) {
        touchRetry = TOUCH_RETRY_S
        try { room.send('recoveryTouch', {}) } catch { /* room not up yet */ }
      }
    } else {
      touchRetry = 0
    }
    wasInside = inside
  })
}