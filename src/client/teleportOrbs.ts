/**
 * teleportOrbs.ts — paired teleport portals on the maze.
 *
 * Adapted from the flagtag scene's teleport-orb system. Each rebuild
 * spawns ONE pair of orbs at two randomly-chosen non-ramp tile centers
 * (deterministic via the same seeded `rand()` used for items, so every
 * client agrees on placement). Walking into either orb's trigger
 * radius teleports the player to the paired orb.
 *
 * Visual: d20 model (from flagtag, blue geometry) + wireframe overlay,
 * spun and bobbed each frame, wrapped in a dark-purple point light for
 * the purple color scheme.
 *
 * Future: multiple pairs (color-coded), team-restricted teleports,
 * cooldown UI on the HUD, particle burst on trigger.
 */

import {
  engine, Entity, Transform, AudioSource, GltfContainer, LightSource,
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

import { Placed, CELL, MAZE_ORIGIN, GRID_W, GRID_H } from 'src/client/maze/generator'
import { rand } from 'src/client/maze/rng'

// ─── Tuning ─────────────────────────────────────────────────────────
const ORB_TRIGGER_RADIUS = 1.2   // meters
const ORB_LAND_OFFSET    = 2.5   // meters offset from dest orb to avoid re-trigger
const TELEPORT_COOLDOWN  = 1.0   // seconds
const ORB_SCALE          = 0.8
const ORB_SPIN_SPEED_Y   = 0.5   // rad/s equivalent (deg conversion applied inline)
const ORB_SPIN_SPEED_X   = 0.3
const ORB_BOB_SPEED      = 2.0
const ORB_BOB_RANGE      = 0.075 // meters
const ORB_HOVER_Y        = 1.2   // meters above walkable slab top
const GOLD               = Color3.create(1.0, 0.45, 0.0)   // flagtag gold-orb light color

// ─── Lifecycle state ────────────────────────────────────────────────
interface OrbPair {
  positions: Vector3[]        // world-space center of each orb
  baseYs: number[]            // resting Y (bob oscillates around this)
  orbEntities: Entity[]
  wireEntities: Entity[]
  lightEntities: Entity[]
  soundEntities: Entity[]
  wasInside: boolean[]
  cooldown: number
}

let currentPair: OrbPair | null = null
let clock = 0

/**
 * Rebuild the teleport pair for the current maze. Called from rebuildMaze()
 * AFTER generation completes, so the seeded RNG is in a deterministic state.
 */
export function spawnTeleportOrbsForMaze(tiles: Placed[]): void {
  // Teardown previous pair (if any).
  if (currentPair) {
    for (const e of currentPair.orbEntities)   engine.removeEntity(e)
    for (const e of currentPair.wireEntities)  engine.removeEntity(e)
    for (const e of currentPair.lightEntities) engine.removeEntity(e)
    for (const e of currentPair.soundEntities) engine.removeEntity(e)
    currentPair = null
  }

  // Candidates: non-ramp tiles so both endpoints are flat landings, AND
  // outside the 3×3 block around the center cross so players can't
  // trivially teleport in/out of the rally point. Y is ignored — a stack
  // above the center is also excluded so orbs never land in the shaft
  // directly above spawn.
  const CX = Math.floor(GRID_W / 2)
  const CZ = Math.floor(GRID_H / 2)
  const nearCenter = (p: Placed) =>
    Math.abs(p.x - CX) <= 1 && Math.abs(p.z - CZ) <= 1
  const candidates = tiles.filter(p => p.type !== 'ramp' && !nearCenter(p))
  if (candidates.length < 2) return

  // Pick two distinct tiles via seeded rand — deterministic per seed so
  // every client agrees. Rule: orbs must sit on DIFFERENT Y levels so a
  // teleport is always a vertical shortcut, not just horizontal reshuffle.
  const a = candidates[Math.floor(rand() * candidates.length)]
  const differentLevel = candidates.filter(p => p.y !== a.y)
  let b: Placed
  if (differentLevel.length > 0) {
    b = differentLevel[Math.floor(rand() * differentLevel.length)]
  } else {
    // Fallback: maze happens to be single-level this round. Draw any
    // distinct tile so the pair still spawns, and log so we can spot it.
    console.log('[Teleport] no cross-level tile available — falling back to same-level pair')
    b = candidates[Math.floor(rand() * candidates.length)]
    let guard = 0
    while (b === a && guard++ < 20) b = candidates[Math.floor(rand() * candidates.length)]
    if (b === a) return
  }

  currentPair = createOrbPair([a, b])
  console.log(`[Teleport] pair spawned at tiles (${a.x},${a.z},${a.y}) ↔ (${b.x},${b.z},${b.y})`)
}

function createOrbPair(tiles: Placed[]): OrbPair {
  const positions: Vector3[] = []
  const baseYs: number[] = []
  const orbEntities: Entity[] = []
  const wireEntities: Entity[] = []
  const lightEntities: Entity[] = []
  const soundEntities: Entity[] = []

  for (const p of tiles) {
    const wx = p.x * CELL + CELL / 2 + MAZE_ORIGIN
    const wz = p.z * CELL + CELL / 2 + MAZE_ORIGIN
    const baseY = p.y + 0.5 + ORB_HOVER_Y  // walkable slab top is +0.5m above tile base
    positions.push(Vector3.create(wx, baseY, wz))
    baseYs.push(baseY)

    // D20 body — parent for spin/bob animation. Uses the GLB's baked gold
    // material as-is (no override) to match flagtag's gold-orb look.
    const orb = engine.addEntity()
    Transform.create(orb, {
      position: Vector3.create(wx, baseY, wz),
      scale: Vector3.create(ORB_SCALE, ORB_SCALE, ORB_SCALE),
      rotation: Quaternion.Zero(),
    })
    GltfContainer.create(orb, { src: 'assets/models/d20-gold.glb' })
    orbEntities.push(orb)

    // Wireframe overlay — child of orb, spins with it.
    const wire = engine.addEntity()
    Transform.create(wire, {
      parent: orb,
      position: Vector3.Zero(),
      scale: Vector3.create(1.02, 1.02, 1.02),
    })
    GltfContainer.create(wire, { src: 'assets/models/d20-wire-gold.glb' })
    wireEntities.push(wire)

    // Point light for the purple aura.
    const light = engine.addEntity()
    Transform.create(light, { parent: orb, position: Vector3.Zero() })
    LightSource.create(light, {
      type: LightSource.Type.Point({}),
      color: GOLD,
      intensity: 150,
      range: 12,
    })
    lightEntities.push(light)

    // Teleport SFX — positional so it fires from the orb the player stepped into.
    const snd = engine.addEntity()
    Transform.create(snd, { position: Vector3.create(wx, baseY, wz) })
    AudioSource.create(snd, {
      audioClipUrl: 'assets/sounds/teleport.mp3',
      playing: false, loop: false, volume: 1, global: false,
    })
    soundEntities.push(snd)
  }

  return {
    positions, baseYs, orbEntities, wireEntities, lightEntities, soundEntities,
    wasInside: [false, false], cooldown: 0,
  }
}

// ─── Per-frame system: trigger detection + spin/bob animation ──────
engine.addSystem((dt: number) => {
  clock += dt
  const pair = currentPair
  if (!pair) return

  // Trigger detection.
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t) {
    if (pair.cooldown > 0) pair.cooldown -= dt
    for (let i = 0; i < pair.positions.length; i++) {
      const dist = Vector3.distance(t.position, pair.positions[i])
      const isInside = dist < ORB_TRIGGER_RADIUS
      if (isInside && !pair.wasInside[i] && pair.cooldown <= 0) {
        const destIdx = i === 0 ? 1 : 0
        const dest = pair.positions[destIdx]
        // Restart sound on both orbs (source + destination) so nearby
        // players hear the departure and arrival.
        for (const snd of pair.soundEntities) {
          AudioSource.createOrReplace(snd, {
            audioClipUrl: 'assets/sounds/teleport.mp3',
            playing: true, loop: false, volume: 1, global: false,
          })
        }
        pair.cooldown = TELEPORT_COOLDOWN
        // Land slightly offset from the destination orb so we don't
        // re-trigger it on arrival. Y = baseY - ORB_HOVER_Y so the
        // player lands on the walkable surface, not floating.
        void movePlayerTo({
          newRelativePosition: Vector3.create(
            dest.x + ORB_LAND_OFFSET,
            pair.baseYs[destIdx] - ORB_HOVER_Y,
            dest.z,
          ),
        })
      }
      pair.wasInside[i] = isInside
    }
  }

  // Spin + bob.
  for (let i = 0; i < pair.orbEntities.length; i++) {
    const orb = pair.orbEntities[i]
    if (!Transform.has(orb)) continue
    const tr = Transform.getMutable(orb)
    tr.position.y = pair.baseYs[i] + ORB_BOB_RANGE * Math.sin(clock * ORB_BOB_SPEED)
    tr.rotation = Quaternion.fromEulerDegrees(
      clock * ORB_SPIN_SPEED_X * 57.3,
      clock * ORB_SPIN_SPEED_Y * 57.3,
      0,
    )
  }
})
