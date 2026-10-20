/**
 * burstRipple.ts — Paint Burst tile ripple (BURST_TILE_RIPPLE), visual only.
 *
 * Adapted from dcl-canvas src/client/paint.ts "brush-lift overlays": there a
 * transient box per cell under the brush tweens up BRUSH_LIFT_METERS in 140 ms
 * and back down in 220 ms, then despawns. Here a pooled, cell-sized team-colour
 * slab per walkable cell within BURST_RADIUS pops up and settles, each one
 * delayed by its distance from the centre so the bumps ripple outward over
 * BURST_TILE_RIPPLE_S. Animated per frame (no Tween) so pooled entities can be
 * reused mid-flight.
 *
 * Cells come from shared/burst.ts burstFootprint (walkable adjacency, same
 * level ±BURST_PAINT_MAX_DY, no gaps) on a client copy of the walkable graph,
 * then clipped to the 3D radius. Works for local and remote bursts (centre =
 * nearest walkable cell to the broadcast position).
 */
import { engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Team, TEAM_RGB } from '../shared/team'
import {
  BURST_RADIUS, BURST_TILE_RIPPLE, BURST_TILE_RIPPLE_S, BURST_TILE_LIFT, BURST_TILE_UP_S, BURST_TILE_DOWN_S,
  BURST_TILE_SIZE, BURST_TILE_THICK, BURST_TILE_POOL, BURST_PAINT_MAX_DY,
} from '../shared/pvp'
import { burstFootprint, V3 } from '../shared/burst'
import { buildWalkableGraph, WalkableGraph } from '../shared/mazeGraph'
import { getPlacedTilesInOrder } from '../maze/generator'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'

const HIDDEN = Vector3.create(8, -60, 8)
const CELL_M = 2
type Slab = { ent: Entity; busy: boolean; t: number; delay: number; x: number; y: number; z: number; team: Team }
const pool: Slab[] = []
let graph: WalkableGraph | null = null
let graphSeed = -1

function ensureGraph(): WalkableGraph | null {
  const seed = getCurrentSeed()
  if (!isRebuilding() && seed !== graphSeed && getPlacedTilesInOrder().length > 0) {
    graph = buildWalkableGraph(getPlacedTilesInOrder())
    graphSeed = seed
  }
  return graph
}

function nearestCell(g: WalkableGraph, p: V3): string | null {
  let best: string | null = null, bd = CELL_M * 1.5
  for (const [id, c] of g.worldPos) {
    if (Math.abs(c[1] - p.y) > BURST_PAINT_MAX_DY) continue
    const d = Math.hypot(c[0] - p.x, c[2] - p.z)
    if (d < bd) { bd = d; best = id }
  }
  return best
}

function setColour(s: Slab): void {
  const c = TEAM_RGB[s.team] ?? { r: 1, g: 1, b: 1 }
  Material.setPbrMaterial(s.ent, {
    albedoColor: Color4.create(c.r, c.g, c.b, 0.95), emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 1.2, roughness: 1, metallic: 0, specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false,
  })
}

/** Start the ripple for a burst fired at feet position `p` by `team`. */
export function startRipple(p: V3, team: Team): void {
  if (!BURST_TILE_RIPPLE || pool.length === 0) return
  const g = ensureGraph()
  if (!g) return
  const centre = nearestCell(g, p)
  if (!centre) return
  const cells = burstFootprint(g, centre, 'square', Math.ceil(BURST_RADIUS / CELL_M))
  for (const id of cells) {
    const c = g.worldPos.get(id)!
    const d = Math.hypot(c[0] - p.x, c[2] - p.z)
    if (Math.hypot(d, c[1] - p.y) > BURST_RADIUS + CELL_M / 2) continue
    const s = pool.find(x => !x.busy)
    if (!s) break // cap reached
    s.busy = true; s.t = 0; s.delay = Math.min(1, d / BURST_RADIUS) * BURST_TILE_RIPPLE_S
    s.x = c[0]; s.y = c[1]; s.z = c[2]
    if (s.team !== team) { s.team = team; setColour(s) }
    // Hidden until the wave front reaches it (see the system).
  }
}

export function initBurstRipple(): void {
  if (!BURST_TILE_RIPPLE) return
  for (let i = 0; i < BURST_TILE_POOL; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN, scale: Vector3.Zero() })
    MeshRenderer.setBox(ent) // no collider: visual only
    const s: Slab = { ent, busy: false, t: 0, delay: 0, x: 0, y: 0, z: 0, team: Team.None }
    setColour(s)
    pool.push(s)
  }
  engine.addSystem((dt: number) => {
    for (const s of pool) {
      if (!s.busy) continue
      s.t += dt
      const u = s.t - s.delay
      let h = 0
      if (u < 0) continue // wave not here yet: stay hidden
      if (Transform.get(s.ent).scale.x === 0) Transform.getMutable(s.ent).scale = Vector3.create(BURST_TILE_SIZE, BURST_TILE_THICK, BURST_TILE_SIZE)
      if (u < BURST_TILE_UP_S) { const k = u / BURST_TILE_UP_S; h = 1 - (1 - k) * (1 - k) } // ease-out up
      else if (u < BURST_TILE_UP_S + BURST_TILE_DOWN_S) { const k = (u - BURST_TILE_UP_S) / BURST_TILE_DOWN_S; h = 1 - k * k } // ease-in settle
      else {
        s.busy = false
        const tr = Transform.getMutable(s.ent)
        tr.position = HIDDEN; tr.scale = Vector3.Zero()
        continue
      }
      // Top rests just under the floor surface, peaks BURST_TILE_LIFT above it.
      Transform.getMutable(s.ent).position = Vector3.create(s.x, s.y - BURST_TILE_THICK / 2 + 0.02 + h * BURST_TILE_LIFT, s.z)
    }
  })
}
