/**
 * [Sink] probe, logs only. Flags avatars standing lower than normal on an arena
 * tile, so the next playtest shows whether the tile's collider is in the wrong
 * place. Normal: Transform y sits about 1.0 m above the deck (see spawnPadAt).
 */
import {
  engine, Entity, Transform, GltfContainer, GltfContainerLoadingState, Tween,
  PlayerIdentityData, raycastSystem, RaycastQueryType, ColliderLayer,
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isLobbyLayout, sinkProbeTiles } from '../maze/rebuild'
import { room } from '../shared/messages'

const SAMPLE_S = 0.5
const LOG_GAP_MS = 3000
const LOW_MAX = 0.75 // Transform y above deck below this = sunk (normal ~1.0)
const LOW_MIN = -0.6
const STILL_Y = 0.03 // y change per sample that counts as grounded

let clock = 0
const lastY = new Map<string, number>()
const lastLog = new Map<string, number>()
const baselined = new Set<string>()
const SINK_SEND_GAP_MS = 1000
let lastSinkSend = 0

function reportSink(line: string): void {
  console.log(line)
  const now = Date.now()
  if (now - lastSinkSend < SINK_SEND_GAP_MS) return
  lastSinkSend = now
  const text = line.length > 300 ? line.slice(0, 300) : line
  try { room.send('sinkLog', { line: text }) } catch { /* room not up yet */ }
}

function tileUnder(x: number, y: number, z: number): { e: Entity; deck: number; d: number } | null {
  let best: { e: Entity; deck: number; d: number } | null = null
  for (const e of sinkProbeTiles()) {
    const tr = Transform.getOrNull(e)
    if (!tr) continue
    const d = Math.hypot(tr.position.x - x, tr.position.z - z)
    if (d > 20) continue
    const deck = tr.position.y + 0.25 * tr.scale.y
    if (deck > y + 0.5) continue
    if (!best || deck > best.deck || (deck === best.deck && d < best.d)) best = { e, deck, d }
  }
  return best
}

function tileInfo(e: Entity): string {
  const tr = Transform.getOrNull(e)
  const g = GltfContainer.getOrNull(e)
  const st = GltfContainerLoadingState.getOrNull(e)?.currentState
  const src = (g?.src ?? '?').split('/').pop()
  return `tile=${e} src=${src} y=${tr?.position.y.toFixed(2)} scale=${tr?.scale.y.toFixed(3)} mask=${g?.visibleMeshesCollisionMask ?? 'none'} state=${st ?? 'none'} tween=${Tween.has(e)}`
}

function rayDown(id: string, x: number, y: number, z: number, deck: number, tile: Entity): void {
  const ent = engine.addEntity()
  Transform.create(ent, { position: Vector3.create(x, y + 0.5, z) })
  raycastSystem.registerGlobalDirectionRaycast({
    entity: ent,
    opts: { direction: Vector3.Down(), maxDistance: 4, queryType: RaycastQueryType.RQT_QUERY_ALL, collisionMask: ColliderLayer.CL_PHYSICS, continuous: false },
  }, res => {
    const hits = res.hits.map(h => `${h.entityId ?? '?'}@${h.position ? (h.position.y - deck).toFixed(2) : '?'}`).join(' ')
    reportSink(`[Sink] ray ${id} tile=${tile} hits(entity@yAboveDeck)=${hits || 'none'}`)
    raycastSystem.removeRaycasterEntity(ent)
    engine.removeEntity(ent)
  })
}

function sinkProbeSystem(dt: number): void {
  clock += dt
  if (clock < SAMPLE_S) return
  clock = 0
  if (isLobbyLayout()) return
  const now = Date.now()
  for (const [entity, pid, tr] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    const id = entity === engine.PlayerEntity ? 'self' : pid.address.slice(0, 8)
    const p = tr.position
    const prev = lastY.get(id)
    lastY.set(id, p.y)
    if (prev === undefined || Math.abs(p.y - prev) > STILL_Y) continue
    const t = tileUnder(p.x, p.y, p.z)
    if (!t) continue
    const above = p.y - t.deck
    if (!baselined.has(id) && above > LOW_MAX && above < 1.6) {
      baselined.add(id)
      reportSink(`[Sink] baseline ${id} yAboveDeck=${above.toFixed(2)} ${tileInfo(t.e)}`)
    }
    if (above >= LOW_MAX || above < LOW_MIN) continue
    if (now - (lastLog.get(id) ?? 0) < LOG_GAP_MS) continue
    lastLog.set(id, now)
    reportSink(`[Sink] LOW ${id} yAboveDeck=${above.toFixed(2)} at ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)} dist=${t.d.toFixed(1)} ${tileInfo(t.e)}`)
    if (entity === engine.PlayerEntity) rayDown(id, p.x, p.y, p.z, t.deck, t.e)
  }
}

export function initSinkProbe(): void {
  engine.addSystem(sinkProbeSystem)
}