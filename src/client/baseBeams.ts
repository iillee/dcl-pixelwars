/**
 * BASES visuals: a team-colored charge beam at each base, a muted look
 * for disconnected paint, and a victory shockwave. No collision.
 */
import { engine, Entity, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
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
const beams: { 1: Entity | null; 2: Entity | null } = { 1: null, 2: null }
let wave: { ent: Entity; t: number; team: 1 | 2 } | null = null
const WAVE_S = 1.2
const WAVE_R = 420
const MIN_H = 8
const MAX_H = 70
const MIN_W = 1.8
const MAX_W = 3.4

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
    if (beams[team]) { engine.removeEntity(beams[team]!); beams[team] = null }
  }
}

function beamMat(team: 1 | 2, pulse: number) {
  const c = TEAM_RGB[team]
  const glow = 0.35 + 0.3 * pulse
  return {
    albedoColor: Color4.create(c.r, c.g, c.b, 0.55),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: glow,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
  }
}

function ensureBeam(team: 1 | 2): Entity {
  if (beams[team]) return beams[team]!
  const ent = engine.addEntity()
  const spawn = baseSpawn(team)
  Transform.create(ent, {
    position: Vector3.create(spawn.pos.x, spawn.pos.y, spawn.pos.z),
    scale: Vector3.create(MIN_W, MIN_H, MIN_W),
  })
  MeshRenderer.setCylinder(ent)
  Material.setPbrMaterial(ent, beamMat(team, 0))
  beams[team] = ent
  return ent
}

function placeBeam(team: 1 | 2, progress: number, growing: boolean, now: number): void {
  const ent = ensureBeam(team)
  const tf = Transform.getMutable(ent)
  const u = charge.threshold > 0 ? Math.max(0, Math.min(1, progress / charge.threshold)) : 0
  const h = MIN_H + (MAX_H - MIN_H) * u
  const w = MIN_W + (MAX_W - MIN_W) * u
  const spawn = baseSpawn(team)
  tf.position.x = spawn.pos.x
  tf.position.y = spawn.pos.y + h / 2
  tf.position.z = spawn.pos.z
  tf.scale.x = w
  tf.scale.y = h
  tf.scale.z = w
  const pulse = growing ? 0.5 + 0.5 * Math.sin(now / 180) : 0
  Material.setPbrMaterial(ent, beamMat(team, pulse))
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
      const now = Date.now()
      if (!isLobbyLayout()) {
        placeBeam(1, charge.redProgress, charge.redGrowing, now)
        placeBeam(2, charge.blueProgress, charge.blueGrowing, now)
      }
    }
    tickWave(dt)
  })
}

