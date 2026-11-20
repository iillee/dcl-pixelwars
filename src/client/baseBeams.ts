/**
 * BASES visuals: Flagtag-style team beacons at each base (inner/outer
 * Y-billboard planes, gradient + alpha textures), a muted look for
 * disconnected paint, and a victory shockwave. No collision.
 */
import { Billboard, BillboardMode, engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { events } from '../shared/events'
import { adoptConnected, basesOn, connectedCells, GROWTH_PER_CELL_PER_SEC, VICTORY_PROGRESS } from '../shared/bases'
import { baseSpawn, baseTeamOfCellId, getPlacedTilesInOrder } from '../maze/generator'
import { buildWalkableGraph, type WalkableGraph } from '../shared/mazeGraph'
import { isLobbyLayout } from '../maze/rebuild'
import { paintTeamOf, retintAllPaint, retintCell, setPaintConnect, setPaintMute } from '../paint'
import { Team, TEAM_RGB } from '../shared/team'

type Charge = {
  redConnected: number
  blueConnected: number
  redProgress: number
  blueProgress: number
  threshold: number
  redGrowing: boolean
  blueGrowing: boolean
}

const emptyCharge = (): Charge => ({
  redConnected: 0, blueConnected: 0, redProgress: 0, blueProgress: 0,
  threshold: VICTORY_PROGRESS, redGrowing: false, blueGrowing: false,
})

let charge = emptyCharge()
let live = false
let graph: WalkableGraph | null = null
type Beacon = { inner: Entity; outer: Entity; shown: number }
const beams: { 1: Beacon | null; 2: Beacon | null } = { 1: null, 2: null }
let wave: { ent: Entity; t: number; team: 1 | 2 } | null = null
let pulseTime = 0
const WAVE_S = 1.2
const WAVE_R = 420
/** Height eases from a short stub to Flagtag's 110 m pillar as charge fills. */
const MIN_H = 8
const MAX_H = 110
const INNER_WIDTH = 0.5
const OUTER_WIDTH = 2.0
const MIN_SIZE = 0.75
const MAX_SIZE = 1.0
const INNER_ALPHA = 0.7
const OUTER_ALPHA = 0.35
/** Low emission, same idea as depot posts, so TEAM_RGB (#FF7577 / #6A99FC) is not washed toward pink or purple. */
const EMISSIVE_INNER = 0.35
const EMISSIVE_OUTER = 0.18
const PULSE_SPEED = 2.5
const PULSE_RANGE = 0.15
const SIZE_EASE_S = 0.28
const GRADIENT_TEX = 'assets/images/beacon-gradient.png'
const ALPHA_TEX = 'assets/images/beacon-alpha.png'

export function baseCharge(): Charge { return charge }
const cached: { 1: Set<string>; 2: Set<string> } = { 1: new Set(), 2: new Set() }

function muteOf(id: string, team: number): boolean {
  if (!live || (team !== 1 && team !== 2)) return false
  return !cached[team as 1 | 2].has(id)
}

/**
 * Optimistic local / incoming paint: if the new cell touches connected
 * territory, mark it (and anything it relinks) connected immediately so
 * the leading edge of a run does not flash as cut off. A cut recomputes
 * that team from the origins. The server remains authoritative for
 * counts and charge; a later refresh uses the same fill, so colors do
 * not flicker when the tick arrives.
 */
function noteBasePaint(id: string, team: number): void {
  if (!live || !graph) return
  const teamOf = (cell: string) => paintTeamOf(cell) as number
  if (team === 1 || team === 2) {
    const added = adoptConnected(id, team, teamOf, graph.adj, cached[team])
    for (const n of added) if (n !== id) retintCell(n)
  }
  for (const t of [1, 2] as const) {
    if (t === team || !cached[t].has(id)) continue
    const prev = cached[t]
    const next = connectedCells(t, origins(t), teamOf, graph.adj)
    cached[t] = next
    for (const n of prev) if (!next.has(n)) retintCell(n)
    for (const n of next) if (!prev.has(n)) retintCell(n)
  }
}

function rebuildGraph(): void {
  const tiles = getPlacedTilesInOrder()
  graph = tiles.length ? buildWalkableGraph(tiles) : null
  refreshConnected()
}

function origins(team: 1 | 2): string[] {
  if (!graph) return []
  const out: string[] = []
  for (const id of graph.nodes) if (baseTeamOfCellId(id) === team) out.push(id)
  return out
}

function refreshConnected(): void {
  if (!live || !graph) {
    cached[1] = new Set()
    cached[2] = new Set()
    return
  }
  cached[1] = connectedCells(1, origins(1), id => paintTeamOf(id) as number, graph.adj)
  cached[2] = connectedCells(2, origins(2), id => paintTeamOf(id) as number, graph.adj)
  retintAllPaint()
}

function applyState(next: Partial<Charge>): void {
  if (typeof next.redConnected === 'number') charge.redConnected = next.redConnected
  if (typeof next.blueConnected === 'number') charge.blueConnected = next.blueConnected
  if (typeof next.threshold === 'number') charge.threshold = next.threshold
  if (typeof next.redGrowing === 'boolean') charge.redGrowing = next.redGrowing
  if (typeof next.blueGrowing === 'boolean') charge.blueGrowing = next.blueGrowing
  if (typeof next.redProgress === 'number') charge.redProgress = next.redProgress
  if (typeof next.blueProgress === 'number') charge.blueProgress = next.blueProgress
}

function dropBeams(): void {
  for (const team of [1, 2] as const) {
    const rec = beams[team]
    if (!rec) continue
    engine.removeEntity(rec.inner)
    engine.removeEntity(rec.outer)
    beams[team] = null
  }
}

function beaconMat(team: 1 | 2, inner: boolean) {
  // Same TEAM_RGB as floor paint and nametag plates. The white gradient only
  // masks the pillar; roughness 1 and a low emissive keep the hue from drifting.
  const c = TEAM_RGB[team]
  const a = inner ? INNER_ALPHA : OUTER_ALPHA
  return {
    texture: Material.Texture.Common({ src: GRADIENT_TEX }),
    alphaTexture: Material.Texture.Common({ src: ALPHA_TEX }),
    albedoColor: Color4.create(c.r, c.g, c.b, a),
    emissiveColor: Color3.create(c.r, c.g, c.b),
    emissiveIntensity: inner ? EMISSIVE_INNER : EMISSIVE_OUTER,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  }
}

function makePlane(team: 1 | 2, inner: boolean): Entity {
  const ent = engine.addEntity()
  const spawn = baseSpawn(team)
  Transform.create(ent, {
    position: Vector3.create(spawn.pos.x, spawn.pos.y + MIN_H / 2, spawn.pos.z),
    scale: Vector3.create(inner ? INNER_WIDTH : OUTER_WIDTH, MIN_H, 1),
  })
  MeshRenderer.setPlane(ent)
  Billboard.create(ent, { billboardMode: BillboardMode.BM_Y })
  Material.setPbrMaterial(ent, beaconMat(team, inner))
  return ent
}

function ensureBeam(team: 1 | 2): Beacon {
  if (beams[team]) return beams[team]!
  const rec: Beacon = { inner: makePlane(team, true), outer: makePlane(team, false), shown: 0 }
  beams[team] = rec
  return rec
}

function placeBeam(team: 1 | 2, progress: number, dt: number): void {
  const rec = ensureBeam(team)
  const u = charge.threshold > 0 ? Math.max(0, Math.min(1, progress / charge.threshold)) : 0
  const k = 1 - Math.exp(-dt / SIZE_EASE_S)
  rec.shown += (u - rec.shown) * k
  const h = MIN_H + (MAX_H - MIN_H) * rec.shown
  const size = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * rec.shown
  const pulse = 1 + PULSE_RANGE * Math.sin(pulseTime * PULSE_SPEED)
  const spawn = baseSpawn(team)
  const y = spawn.pos.y + h / 2
  const innerT = Transform.getMutable(rec.inner)
  innerT.position.x = spawn.pos.x
  innerT.position.y = y
  innerT.position.z = spawn.pos.z
  innerT.scale.x = INNER_WIDTH * size * pulse
  innerT.scale.y = h
  innerT.scale.z = 1
  const outerT = Transform.getMutable(rec.outer)
  outerT.position.x = spawn.pos.x
  outerT.position.y = y
  outerT.position.z = spawn.pos.z
  outerT.scale.x = OUTER_WIDTH * size * (2 - pulse)
  outerT.scale.y = h
  outerT.scale.z = 1
}

function dropWave(): void {
  if (!wave) return
  engine.removeEntity(wave.ent)
  wave = null
}

const waved = new Set<string>()

function startWave(team: 1 | 2): void {
  dropWave()
  waved.clear()
  const ent = engine.addEntity()
  const spawn = baseSpawn(team)
  Transform.create(ent, {
    position: Vector3.create(spawn.pos.x, spawn.pos.y + 8, spawn.pos.z),
    scale: Vector3.create(2, 16, 2),
    rotation: Quaternion.Identity(),
  })
  MeshRenderer.setCylinder(ent)
  const c = TEAM_RGB[team]
  Material.setPbrMaterial(ent, {
    albedoColor: Color4.create(c.r, c.g, c.b, 0.7),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 1.4,
    roughness: 1,
    metallic: 0,
  })
  wave = { ent, t: 0, team }
}

function tickWave(dt: number): void {
  if (!wave) return
  wave.t += dt
  const u = Math.min(1, wave.t / WAVE_S)
  const r = 2 + (WAVE_R - 2) * u
  const tf = Transform.getMutableOrNull(wave.ent)
  if (tf) {
    tf.scale.x = r
    tf.scale.z = r
    tf.scale.y = 16 + 10 * u
  }
  const c = TEAM_RGB[wave.team]
  Material.setPbrMaterial(wave.ent, {
    albedoColor: Color4.create(c.r, c.g, c.b, 0.7 * (1 - u)),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 1.4 * (1 - u),
    roughness: 1,
    metallic: 0,
  })
  if (graph) {
    const spawn = baseSpawn(wave.team)
    const reach = r * 0.5
    for (const id of graph.nodes) {
      const p = graph.worldPos.get(id)
      if (!p) continue
      if (waved.has(id)) continue
      if (Math.hypot(p[0] - spawn.pos.x, p[2] - spawn.pos.z) <= reach) {
        waved.add(id)
        retintCell(id, wave.team as Team, true)
      }
    }
  }
  if (u >= 1) dropWave()
}

function setLive(on: boolean): void {
  if (live === on) return
  live = on
  if (!on) {
    dropBeams()
    charge = emptyCharge()
    cached[1] = new Set()
    cached[2] = new Set()
    retintAllPaint()
  } else {
    rebuildGraph()
  }
}

export function initBaseBeams(): void {
  setPaintMute(muteOf)
  setPaintConnect(noteBasePaint)
  events.on('base:state', (msg) => {
    applyState(msg)
    if (live) refreshConnected()
  })
  events.on('base:win', ({ team }) => {
    if (team === 1 || team === 2) startWave(team)
  })
  events.on('round:clock', ({ format, active }) => {
    setLive(active && basesOn(format) && !isLobbyLayout())
  })
  events.on('round:reset', ({ format, layout }) => {
    dropWave()
    setLive(layout !== 'lobby' && basesOn(format))
  })
  events.on('lobby:floor', () => { dropWave(); setLive(false) })
  events.on('paint:delta', () => { if (live) refreshConnected() })
  events.on('paint:snapshot', () => { if (live) { rebuildGraph(); refreshConnected() } })
  engine.addSystem((dt: number) => {
    if (live) {
      if (charge.redGrowing) charge.redProgress = Math.min(charge.threshold, charge.redProgress + charge.redConnected * GROWTH_PER_CELL_PER_SEC * dt)
      if (charge.blueGrowing) charge.blueProgress = Math.min(charge.threshold, charge.blueProgress + charge.blueConnected * GROWTH_PER_CELL_PER_SEC * dt)
      pulseTime += dt
      if (!isLobbyLayout()) {
        placeBeam(1, charge.redProgress, dt)
        placeBeam(2, charge.blueProgress, dt)
      }
    }
    tickWave(dt)
  })
}

