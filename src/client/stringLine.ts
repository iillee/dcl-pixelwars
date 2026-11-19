/**
 * Segmented catenary string. Balloon Battle and the rescue-cloud line
 * share this so both stay a few short cylinders with a slight sag.
 */
import {
  engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

export type StringVec = { x: number; y: number; z: number }

export type StringLine = {
  segs: Entity[]
  lagMid: StringVec
  lagReady: boolean
  radius: number
}

export type StringLineStyle = {
  radius: number
  color: Color4
  segs?: number
}

export type StringLinePlace = {
  sag: number
  lagTau?: number
}

const _from = { x: 0, y: 0, z: 0 }
const _to = { x: 0, y: 0, z: 0 }
const _dir = Vector3.create(0, 1, 0)

export function stringLineMat(color: Color4) {
  return {
    albedoColor: color,
    roughness: 1,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false,
  }
}

export function makeStringLine(parent: Entity | null, style: StringLineStyle): StringLine {
  const n = style.segs ?? 4
  const segs: Entity[] = []
  for (let i = 0; i < n; i++) {
    const ent = engine.addEntity()
    Transform.create(ent, {
      position: Vector3.Zero(),
      scale: Vector3.create(style.radius, 0.4, style.radius),
      ...(parent ? { parent } : {}),
    })
    MeshRenderer.setCylinder(ent)
    Material.setPbrMaterial(ent, stringLineMat(style.color))
    segs.push(ent)
  }
  return { segs, lagMid: { x: 0, y: 0, z: 0 }, lagReady: false, radius: style.radius }
}

function aimString(ent: Entity, from: StringVec, to: StringVec, radius: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const tf = Transform.getMutable(ent)
  if (len < 0.04) {
    tf.position.x = from.x
    tf.position.y = from.y
    tf.position.z = from.z
    tf.scale.x = radius
    tf.scale.y = 0.04
    tf.scale.z = radius
    tf.rotation = Quaternion.Identity()
    return
  }
  tf.position.x = from.x + dx * 0.5
  tf.position.y = from.y + dy * 0.5
  tf.position.z = from.z + dz * 0.5
  tf.scale.x = radius
  tf.scale.y = len
  tf.scale.z = radius
  _dir.x = dx / len
  _dir.y = dy / len
  _dir.z = dz / len
  tf.rotation = Quaternion.fromToRotation(Vector3.Up(), _dir)
}

/** Quadratic bezier from `from` through a lagged, sagged mid to `to`. */
export function placeStringLine(line: StringLine, from: StringVec, to: StringVec, dt: number, style: StringLinePlace): void {
  const midX = (from.x + to.x) * 0.5
  const midZ = (from.z + to.z) * 0.5
  const midY = (from.y + to.y) * 0.5 - style.sag
  const lagTau = style.lagTau
  if (!line.lagReady || lagTau === undefined || lagTau <= 0) {
    line.lagMid.x = midX
    line.lagMid.y = midY
    line.lagMid.z = midZ
    line.lagReady = true
  } else {
    const k = 1 - Math.exp(-Math.max(0, dt) / lagTau)
    line.lagMid.x += (midX - line.lagMid.x) * k
    line.lagMid.y += (midY - line.lagMid.y) * k
    line.lagMid.z += (midZ - line.lagMid.z) * k
  }
  _from.x = from.x
  _from.y = from.y
  _from.z = from.z
  const n = line.segs.length
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    _to.x = u * u * from.x + 2 * u * t * line.lagMid.x + t * t * to.x
    _to.y = u * u * from.y + 2 * u * t * line.lagMid.y + t * t * to.y
    _to.z = u * u * from.z + 2 * u * t * line.lagMid.z + t * t * to.z
    aimString(line.segs[i - 1], _from, _to, line.radius)
    _from.x = _to.x
    _from.y = _to.y
    _from.z = _to.z
  }
}

export function dropStringLine(line: StringLine): void {
  for (let i = 0; i < line.segs.length; i++) engine.removeEntity(line.segs[i])
  line.segs.length = 0
  line.lagReady = false
}
