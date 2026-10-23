/**
 * burstRipple.ts — Paint Burst tile ripple (BURST_TILE_RIPPLE), visual only.
 *
 * Adapted from dcl-canvas src/client/paint.ts "brush-lift overlays": there a
 * transient box per cell under the brush tweens up BRUSH_LIFT_METERS in 140 ms
 * and back down in 220 ms, then despawns. Here a pooled, cell-sized team-colour
 * slab (floor paint material) per cell of the burst paint footprint (circle) pops up and settles, each
 * one delayed by its distance from the centre so the bumps ripple outward
 * over BURST_TILE_RIPPLE_S. Animated per frame (no Tween) so pooled entities can be
 * reused mid-flight.
 *
 * Cells come from shared/burst.ts burstFootprint (walkable adjacency, same
 * level ±BURST_PAINT_MAX_DY, no gaps) on a client copy of the walkable graph
 * (the same cells the server paints). Works for local and remote bursts (centre =
 * nearest walkable cell to the broadcast position).
 */
import { engine, Entity, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { Team } from '../shared/team'
import { cellMaterial } from '../paint'
import {
  BURST_TILE_RIPPLE, BURST_TILE_RIPPLE_S, BURST_TILE_LIFT, BURST_TILE_UP_S, BURST_TILE_DOWN_S,
  BURST_TILE_SIZE, BURST_TILE_THICK, BURST_TILE_POOL,
  SLAB_OUTLINE, SLAB_OUTLINE_M, DASH_TILE_POP, DASH_TILE_LIFT_FRAC, DASH_TILE_UP_S, DASH_TILE_DOWN_S, DASH_TILE_DELAY_S, DASH_TILE_MAX, DASH_TILE_INNER_LAG_S,
  DASH_TILE_AHEAD, DASH_TILE_AHEAD_DELAY_S, DASH_TILE_AHEAD_STEP_S,
} from '../shared/pvp'
import { burstFootprint, burstCentre, V3 } from '../shared/burst'
import { buildWalkableGraph, WalkableGraph, rampSurfaceY } from '../shared/mazeGraph'
import { getPlacedTilesInOrder, Placed } from '../maze/generator'
import { TILES } from '../maze/tiles'
import { getCurrentSeed, isRebuilding } from '../maze/rebuild'

const HIDDEN = Vector3.create(8, -60, 8)
const CELL_M = 2
type Slab = { ent: Entity; busy: boolean; t: number; delay: number; x: number; y: number; z: number; team: Team; rot: Quaternion; lift: number; up: number; down: number; dash: boolean }
const pool: Slab[] = []
let graph: WalkableGraph | null = null
let graphSeed = -1
const FLAT = Quaternion.Identity()

/** Ramp cells: tilt the slab to the slope under it (pitch from rampSurfaceY along the ramp's
 *  canonical +z, yaw = ramp rotation) and sit it on the sloped surface. Flat cells: unchanged. */
function cellPose(id: string, c: [number, number, number]): { y: number; rot: Quaternion } {
  const [tx, tz, ty] = id.split(':')[0].split(',').map(Number)
  const t: Placed | undefined = getPlacedTilesInOrder().find(p => p.x === tx && p.z === tz && p.y === ty)
  if (!t || !TILES[t.type].isRamp) return { y: c[1], rot: FLAT }
  const ux = Math.sin(t.r * Math.PI / 2), uz = Math.cos(t.r * Math.PI / 2), h = 0.5
  const rise = rampSurfaceY(t, c[0] + ux * h, c[2] + uz * h) - rampSurfaceY(t, c[0] - ux * h, c[2] - uz * h)
  const pitch = -Math.atan2(rise, 2 * h) * 180 / Math.PI // +z up the slope
  return { y: rampSurfaceY(t, c[0], c[2]), rot: Quaternion.fromEulerDegrees(pitch, t.r * 90, 0) }
}

function ensureGraph(): WalkableGraph | null {
  const seed = getCurrentSeed()
  if (!isRebuilding() && seed !== graphSeed && getPlacedTilesInOrder().length > 0) {
    graph = buildWalkableGraph(getPlacedTilesInOrder())
    graphSeed = seed
  }
  return graph
}

function setColour(s: Slab): void {
  // Exactly the painted floor's material (paint.ts cellMaterial: TEAM_COLORS albedo,
  // matte, opaque, no emissive) so the raised tiles read as the floor's paint colour.
  Material.setPbrMaterial(s.ent, cellMaterial(s.team))
}

/** Start the ripple for a burst fired at feet position `p` by `team`. */
export function startRipple(p: V3, team: Team, cell = ''): void {
  if (!BURST_TILE_RIPPLE || pool.length === 0) return
  const g = ensureGraph()
  if (!g) return
  const centre = burstCentre(g, cell, p)
  if (!centre) return
  // Same cells the server paints (default shape/size), so the ripple covers the whole 7×7.
  const cells = burstFootprint(g, centre)
  const c0 = g.worldPos.get(centre)!
  let maxD = CELL_M
  for (const id of cells) { const c = g.worldPos.get(id)!; maxD = Math.max(maxD, Math.hypot(c[0] - c0[0], c[2] - c0[2])) }
  for (const id of cells) {
    const c = g.worldPos.get(id)!
    const d = Math.hypot(c[0] - c0[0], c[2] - c0[2])
    const s = pool.find(x => !x.busy)
    if (!s) break // cap reached
    s.busy = true; s.t = 0; s.delay = (d / maxD) * BURST_TILE_RIPPLE_S
    s.lift = BURST_TILE_LIFT; s.up = BURST_TILE_UP_S; s.down = BURST_TILE_DOWN_S; s.dash = false
    const pose = cellPose(id, c)
    s.x = c[0]; s.y = pose.y; s.z = c[2]; s.rot = pose.rot
    if (s.team !== team) { s.team = team; setColour(s) }
    // Hidden until the wave front reaches it (see the system).
  }
}

/** Dash (lunge) trail pop: the cell under a dashing avatar pops once (smaller/quicker than Burst), in the order
 *  the avatar crosses cells, so it trails the player. Visual only; capped at DASH_TILE_MAX live slabs. */
const dashLastCell = new Map<string, { id: string; x: number; z: number }>()
const dashPopped = new Map<string, Set<string>>()
/** Nearest walkable cell within `r` m horizontally (same level ±1.5 m). */
function cellNear(g: WalkableGraph, x: number, y: number, z: number, r: number): string | null {
  let best: string | null = null, bd = r
  for (const [id, q] of g.worldPos) {
    if (Math.abs(q[1] - y) > 1.5) continue
    const d = Math.hypot(q[0] - x, q[2] - z)
    if (d < bd) { bd = d; best = id }
  }
  return best
}
/** Dash pop over the 3×3 the player paints, plus DASH_TILE_AHEAD cells straight ahead so the bump
 *  reaches the front paint the lunge leaves in front of the entered cell. Side columns first, the
 *  centre column DASH_TILE_INNER_LAG_S later; the forward row uses DASH_TILE_AHEAD_DELAY_S so it
 *  leads. Visual only; capped at DASH_TILE_MAX live slabs. */
export function dashPop(who: string, p: V3, team: Team): void {
  if (!DASH_TILE_POP || pool.length === 0 || team === Team.None) return
  const g = ensureGraph()
  if (!g) return
  const centre = cellNear(g, p.x, p.y, p.z, CELL_M)
  if (!centre) return
  const last = dashLastCell.get(who)
  if (last && last.id === centre) return
  const c0 = g.worldPos.get(centre)!
  // Movement direction (from the previous centre; first cell: no lateral info → all treated as edge).
  let dx = 0, dz = 0
  if (last) { const l = Math.hypot(c0[0] - last.x, c0[2] - last.z); if (l > 0.01) { dx = (c0[0] - last.x) / l; dz = (c0[2] - last.z) / l } }
  dashLastCell.set(who, { id: centre, x: c0[0], z: c0[2] })
  let popped = dashPopped.get(who)
  if (!popped) { popped = new Set(); dashPopped.set(who, popped) }
  const seen = popped
  let live = pool.filter(x => x.busy && x.dash).length
  const queue = (x: number, z: number, delay: number, reach: number) => {
    if (live >= DASH_TILE_MAX) return
    const id = cellNear(g, x, c0[1], z, reach)
    if (!id || seen.has(id)) return
    const s = pool.find(sl => !sl.busy)
    if (!s) return
    seen.add(id)
    const c = g.worldPos.get(id)!
    const pose = cellPose(id, c)
    s.busy = true; s.t = 0; s.dash = true
    s.delay = delay
    s.lift = BURST_TILE_LIFT * DASH_TILE_LIFT_FRAC; s.up = DASH_TILE_UP_S; s.down = DASH_TILE_DOWN_S
    s.x = c[0]; s.y = pose.y; s.z = c[2]; s.rot = pose.rot
    if (s.team !== team) { s.team = team; setColour(s) }
    live++
  }
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
    const x = c0[0] + ox * CELL_M, z = c0[2] + oz * CELL_M
    const along = (x - c0[0]) * dx + (z - c0[2]) * dz
    const lateral = Math.abs((x - c0[0]) * dz - (z - c0[2]) * dx)
    const edge = (dx === 0 && dz === 0) || lateral > CELL_M * 0.5
    // Front row leads. Side columns next. The column under / behind the avatar lags.
    const delay = along > CELL_M * 0.5 ? DASH_TILE_AHEAD_DELAY_S
      : DASH_TILE_DELAY_S + (edge ? 0 : DASH_TILE_INNER_LAG_S)
    queue(x, z, delay, CELL_M * 0.55)
  }
  // One extra cell past the 3×3, along travel, so the bump covers the paint in front.
  if (dx !== 0 || dz !== 0) {
    for (let step = 2; step <= DASH_TILE_AHEAD; step++) {
      queue(c0[0] + dx * step * CELL_M, c0[2] + dz * step * CELL_M,
        DASH_TILE_AHEAD_DELAY_S + (step - 1) * DASH_TILE_AHEAD_STEP_S, CELL_M * 0.9)
    }
  }
}
/** Forget the dasher's trail when a dash ends, so the next dash pops its swath again. */
export function dashPopEnd(who: string): void { dashLastCell.delete(who); dashPopped.delete(who) }

/** dcl-canvas paint.ts updateEdges, thin: 4 black strips on the slab's top edges as children of the slab (local
 *  unit-box space, so thickness is divided by the slab's scale to stay SLAB_OUTLINE_M in world metres). */
const OUTLINE_MAT = { albedoColor: Color4.Black(), metallic: 0, roughness: 1 }
function addOutline(slab: Entity): void {
  const ex = SLAB_OUTLINE_M / BURST_TILE_SIZE, ey = SLAB_OUTLINE_M / BURST_TILE_THICK
  const y = 0.5 - ey / 2 + 0.002 / BURST_TILE_THICK // flush with the top face, a hair proud to avoid z-fighting
  const edges: Array<[number, number, number, number]> = [ // x, z, sx, sz (local)
    [0, 0.5 - ex / 2 + 0.002, 1.002, ex], [0, -0.5 + ex / 2 - 0.002, 1.002, ex],
    [0.5 - ex / 2 + 0.002, 0, ex, 1.002], [-0.5 + ex / 2 - 0.002, 0, ex, 1.002],
  ]
  for (const [x, z, sx, sz] of edges) {
    const e = engine.addEntity()
    Transform.create(e, { parent: slab, position: Vector3.create(x, y, z), scale: Vector3.create(sx, ey, sz) })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, OUTLINE_MAT)
  }
}

export function initBurstRipple(): void {
  if (!BURST_TILE_RIPPLE) return
  for (let i = 0; i < BURST_TILE_POOL; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, { position: HIDDEN, scale: Vector3.Zero() })
    MeshRenderer.setBox(ent) // no collider: visual only
    if (SLAB_OUTLINE) addOutline(ent)
    const s: Slab = { ent, busy: false, t: 0, delay: 0, x: 0, y: 0, z: 0, team: Team.None, rot: FLAT, lift: BURST_TILE_LIFT, up: BURST_TILE_UP_S, down: BURST_TILE_DOWN_S, dash: false }
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
      if (u < s.up) { const k = u / s.up; h = 1 - (1 - k) * (1 - k) } // ease-out up
      else if (u < s.up + s.down) { const k = (u - s.up) / s.down; h = 1 - k * k } // ease-in settle
      else {
        s.busy = false
        const tr = Transform.getMutable(s.ent)
        tr.position = HIDDEN; tr.scale = Vector3.Zero()
        continue
      }
      // Top rests just under the floor surface, peaks BURST_TILE_LIFT above it.
      const tr = Transform.getMutable(s.ent)
      tr.position = Vector3.create(s.x, s.y - BURST_TILE_THICK / 2 + 0.02 + h * s.lift, s.z)
      tr.rotation = s.rot
    }
  })
}
