/**
 * teleportOrbs.ts — paired teleport portals on the maze.
 *
 * Adapted from the flagtag scene's teleport-orb system: d20 gold model +
 * wireframe overlay, spun and bobbed each frame, gold point light, and a
 * positional teleport.mp3 that plays at both ends. Walking into an orb's
 * trigger radius moves the player to its partner.
 *
 * Sky mode (bases + woven net): pairs come from teleportPairs() in
 * generator.ts — a pure function of the round's layout, so every client
 * agrees without network sync. Exactly one pair per round, A <-> its 180°
 * mirror, on a remote turn/fork/cross tile (never a straight, ramp or end).
 * Classic mode keeps the old single random cross-level pair.
 *
 * Arrival: on corridor floor 4 m out from the destination orb (outside its
 * trigger), facing along that tile's opening toward the scene centre.
 * Overview camera is turned off first. A shared cooldown + "must leave the
 * trigger first" edge detection stop bounce-backs.
 */

import {
  engine, Entity, Transform, AudioSource, GltfContainer, LightSource,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

import { Placed, CELL, MAZE_ORIGIN, GRID_W, GRID_H, baseTeamOfTile, teleportPairs } from './maze/generator'
import { rand } from './maze/rng'
import { IS_SKY } from './maze/level'
import { exitOverview } from './client/overviewCamera'

// ─── Tuning ─────────────────────────────────────────────────────────
const ORB_TRIGGER_RADIUS = 1.2   // meters
const TELEPORT_COOLDOWN  = 2.0   // seconds (was 1.0; sky arrivals can be a level apart)
const ORB_SCALE          = 0.8
const ORB_SPIN_SPEED_Y   = 0.5
const ORB_SPIN_SPEED_X   = 0.3
const ORB_BOB_SPEED      = 2.0
const ORB_BOB_RANGE      = 0.075 // meters
const ORB_HOVER_Y        = 1.2   // meters above walkable slab top
const GOLD               = Color3.create(1.0, 0.45, 0.0)

type V = { x: number; y: number; z: number }
interface Orb { pos: Vector3; baseY: number; land: V; look: V | null; orb: Entity; parts: Entity[]; snd: Entity; wasInside: boolean; partner: number }

let orbs: Orb[] = []
let cooldown = 0
let clock = 0

function teardown(): void {
  for (const o of orbs) {
    engine.removeEntity(o.orb); engine.removeEntity(o.snd)
    for (const e of o.parts) engine.removeEntity(e)
  }
  orbs = []
}

/** Rebuild the teleporters for the current maze. Called from rebuildMaze()
 *  right after generation, while the generator grid is the new layout. */
export function spawnTeleportOrbsForMaze(tiles: Placed[]): void {
  teardown()
  const ends: Array<[{ tile: Placed; land: V; look: V | null }, { tile: Placed; land: V; look: V | null }]> = []
  if (IS_SKY) {
    for (const [a, b] of teleportPairs()) ends.push([a, b])
  } else {
    const pair = classicPair(tiles)
    if (pair) ends.push(pair)
  }
  for (const [a, b] of ends) {
    const i = orbs.length
    orbs.push(makeOrb(a.tile, b.land, b.look, i + 1))
    orbs.push(makeOrb(b.tile, a.land, a.look, i))
    console.log(`[Teleport] pair (${a.tile.x},${a.tile.z},${a.tile.y}) <-> (${b.tile.x},${b.tile.z},${b.tile.y})`)
  }
}

/** Old classic rule: two random non-ramp tiles on different levels, away from centre/bases. */
function classicPair(tiles: Placed[]): [{ tile: Placed; land: V; look: null }, { tile: Placed; land: V; look: null }] | null {
  const CX = Math.floor(GRID_W / 2), CZ = Math.floor(GRID_H / 2)
  const ok = (p: Placed) => {
    if (p.type === 'ramp' || (Math.abs(p.x - CX) <= 1 && Math.abs(p.z - CZ) <= 1)) return false
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) if (baseTeamOfTile(p.x + dx, p.z + dz, p.y) !== 0) return false
    return true
  }
  const c = tiles.filter(ok)
  if (c.length < 2) return null
  const a = c[Math.floor(rand() * c.length)]
  const other = c.filter(p => p.y !== a.y)
  const b = other.length ? other[Math.floor(rand() * other.length)] : c.find(p => p !== a)
  if (!b) return null
  const land = (p: Placed): V => ({ x: p.x * CELL + CELL / 2 + MAZE_ORIGIN + 2.5, y: p.y + 0.5, z: p.z * CELL + CELL / 2 + MAZE_ORIGIN })
  return [{ tile: a, land: land(a), look: null }, { tile: b, land: land(b), look: null }]
}

function makeOrb(p: Placed, land: V, look: V | null, partner: number): Orb {
  const wx = p.x * CELL + CELL / 2 + MAZE_ORIGIN
  const wz = p.z * CELL + CELL / 2 + MAZE_ORIGIN
  const baseY = p.y + 0.5 + ORB_HOVER_Y
  const orb = engine.addEntity()
  Transform.create(orb, { position: Vector3.create(wx, baseY, wz), scale: Vector3.create(ORB_SCALE, ORB_SCALE, ORB_SCALE), rotation: Quaternion.Zero() })
  GltfContainer.create(orb, { src: 'assets/models/d20-gold.glb' })
  const wire = engine.addEntity()
  Transform.create(wire, { parent: orb, position: Vector3.Zero(), scale: Vector3.create(1.02, 1.02, 1.02) })
  GltfContainer.create(wire, { src: 'assets/models/d20-wire-gold.glb' })
  const light = engine.addEntity()
  Transform.create(light, { parent: orb, position: Vector3.Zero() })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: GOLD, intensity: 150, range: 12 })
  const snd = engine.addEntity()
  Transform.create(snd, { position: Vector3.create(wx, baseY, wz) })
  AudioSource.create(snd, { audioClipUrl: 'assets/sounds/teleport.mp3', playing: false, loop: false, volume: 1, global: false })
  return { pos: Vector3.create(wx, baseY, wz), baseY, land, look, orb, parts: [wire, light], snd, wasInside: false, partner }
}

// ─── Per-frame: trigger detection + spin/bob ────────────────────────
engine.addSystem((dt: number) => {
  clock += dt
  if (!orbs.length) return
  if (cooldown > 0) cooldown -= dt
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t) {
    for (const o of orbs) {
      const inside = Vector3.distance(t.position, o.pos) < ORB_TRIGGER_RADIUS
      if (inside && !o.wasInside && cooldown <= 0) {
        const dest = orbs[o.partner]
        for (const s of [o.snd, dest.snd]) {
          AudioSource.createOrReplace(s, { audioClipUrl: 'assets/sounds/teleport.mp3', playing: true, loop: false, volume: 1, global: false })
        }
        cooldown = TELEPORT_COOLDOWN
        dest.wasInside = true // must walk out of the arrival orb before it can fire
        exitOverview()
        void movePlayerTo(o.look
          ? { newRelativePosition: o.land, cameraTarget: o.look, avatarTarget: o.look }
          : { newRelativePosition: o.land })
      }
      o.wasInside = inside
    }
  }
  for (const o of orbs) {
    if (!Transform.has(o.orb)) continue
    const tr = Transform.getMutable(o.orb)
    tr.position.y = o.baseY + ORB_BOB_RANGE * Math.sin(clock * ORB_BOB_SPEED)
    tr.rotation = Quaternion.fromEulerDegrees(clock * ORB_SPIN_SPEED_X * 57.3, clock * ORB_SPIN_SPEED_Y * 57.3, 0)
  }
})
