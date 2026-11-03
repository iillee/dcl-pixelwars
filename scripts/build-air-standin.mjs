/**
 * Original low-poly rigged mannequin for the airborne bot stand-in.
 * Authored for this repo (no third-party mesh, not the old ghost).
 * Run: node scripts/build-air-standin.mjs
 *
 * Feet at y=0, head near 1.8 m, facing +Z (the same forward the bot yaw uses).
 * Skin is rigid: each limb is weighted to one bone. Clips are poses on those
 * bones. The glider is a mesh on the chest, shown only by the glide clip.
 * No node is named Armature_Prop.
 */
import { writeFileSync } from 'node:fs'

const OUT = new URL('../assets/models/bots/air-standin.glb', import.meta.url)

const qx = (deg) => {
  const h = deg * Math.PI / 360
  return [Math.sin(h), 0, 0, Math.cos(h)]
}
const qy = (deg) => {
  const h = deg * Math.PI / 360
  return [0, Math.sin(h), 0, Math.cos(h)]
}
const qz = (deg) => {
  const h = deg * Math.PI / 360
  return [0, 0, Math.sin(h), Math.cos(h)]
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const ID = [0, 0, 0, 1]

const nodes = []
function addNode(name, parent, translation, extras = {}) {
  const i = nodes.length
  nodes.push({ name, parent, translation, children: [], ...extras })
  if (parent >= 0) nodes[parent].children.push(i)
  return i
}

const rig = addNode('Rig', -1, [0, 0, 0])
const hips = addNode('Hips', rig, [0, 0.95, 0])
const spine = addNode('Spine', hips, [0, 0.18, 0])
const chest = addNode('Chest', spine, [0, 0.2, 0])
const head = addNode('Head', chest, [0, 0.24, 0])
const armL = addNode('ArmL', chest, [-0.24, 0.06, 0])
const foreL = addNode('ForeArmL', armL, [0, -0.28, 0])
const armR = addNode('ArmR', chest, [0.24, 0.06, 0])
const foreR = addNode('ForeArmR', armR, [0, -0.28, 0])
const upL = addNode('UpLegL', hips, [-0.1, -0.08, 0])
const legL = addNode('LegL', upL, [0, -0.44, 0])
const upR = addNode('UpLegR', hips, [0.1, -0.08, 0])
const legR = addNode('LegR', upR, [0, -0.44, 0])
const glider = addNode('Glider', chest, [0, 0.52, 0.22], { scale: [0, 0, 0] })

const joints = [hips, spine, chest, head, armL, foreL, armR, foreR, upL, legL, upR, legR]
const world = new Map()
function worldOf(i) {
  if (world.has(i)) return world.get(i)
  const n = nodes[i]
  const p = n.parent >= 0 ? worldOf(n.parent) : [0, 0, 0]
  const t = n.translation
  const w = [p[0] + t[0], p[1] + t[1], p[2] + t[2]]
  world.set(i, w)
  return w
}

const body = { pos: [], nrm: [], joints: [], weights: [], idx: [] }
function appendBox(jointSlot, cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ]
  for (const f of faces) {
    const base = body.pos.length / 3
    for (const v of f.v) {
      body.pos.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz)
      body.nrm.push(f.n[0], f.n[1], f.n[2])
      body.joints.push(jointSlot, 0, 0, 0)
      body.weights.push(1, 0, 0, 0)
    }
    body.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}
function part(node, slot, boxes) {
  const w = worldOf(node)
  for (const b of boxes) appendBox(slot, w[0] + b[0], w[1] + b[1], w[2] + b[2], b[3], b[4], b[5])
}
part(hips, 0, [[0, 0, 0, 0.34, 0.18, 0.18]])
part(spine, 1, [[0, 0.02, 0, 0.28, 0.2, 0.16]])
part(chest, 2, [[0, 0.02, 0, 0.4, 0.24, 0.18]])
part(head, 3, [[0, 0.02, 0, 0.1, 0.1, 0.1], [0, 0.14, 0, 0.22, 0.22, 0.2]])
part(armL, 4, [[0, -0.14, 0, 0.1, 0.28, 0.1]])
part(foreL, 5, [[0, -0.13, 0, 0.08, 0.26, 0.08]])
part(armR, 6, [[0, -0.14, 0, 0.1, 0.28, 0.1]])
part(foreR, 7, [[0, -0.13, 0, 0.08, 0.26, 0.08]])
part(upL, 8, [[0, -0.22, 0, 0.13, 0.44, 0.13]])
part(legL, 9, [[0, -0.2, 0, 0.11, 0.4, 0.11], [0, -0.4, 0.05, 0.12, 0.06, 0.2]])
part(upR, 10, [[0, -0.22, 0, 0.13, 0.44, 0.13]])
part(legR, 11, [[0, -0.2, 0, 0.11, 0.4, 0.11], [0, -0.4, 0.05, 0.12, 0.06, 0.2]])

const wing = { pos: [], nrm: [], idx: [] }
function appendPlain(dst, cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ]
  for (const f of faces) {
    const base = dst.pos.length / 3
    for (const v of f.v) {
      dst.pos.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz)
      dst.nrm.push(f.n[0], f.n[1], f.n[2])
    }
    dst.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}
// Wing in the local XZ plane, nose toward +Z, bar below it for the hands.
appendPlain(wing, 0, 0, 0.05, 1.7, 0.045, 0.5)
appendPlain(wing, 0, -0.14, 0.16, 0.72, 0.04, 0.05)

let minY = Infinity, maxY = -Infinity
for (let i = 1; i < body.pos.length; i += 3) {
  minY = Math.min(minY, body.pos[i])
  maxY = Math.max(maxY, body.pos[i])
}
if (minY < -0.02 || minY > 0.02 || maxY < 1.65 || maxY > 1.95) {
  throw new Error(`mannequin height out of range y ${minY.toFixed(3)}..${maxY.toFixed(3)}`)
}

const hold = (node, rot, scale) => ({ node, rot, scale })
const TUCK = [
  hold(upL, qx(-78)), hold(upR, qx(-78)),
  hold(legL, qx(72)), hold(legR, qx(72)),
  hold(spine, qx(22)), hold(chest, qx(8)),
  hold(armL, qx(-36)), hold(armR, qx(-36)),
  hold(glider, ID, [0, 0, 0]),
]
const DOUBLE = [
  hold(upL, qx(-105)), hold(upR, qx(-105)),
  hold(legL, qx(95)), hold(legR, qx(95)),
  hold(spine, qx(38)), hold(chest, qx(16)),
  hold(armL, qmul(qz(18), qx(-24))), hold(armR, qmul(qz(-18), qx(-24))),
  hold(foreL, qx(40)), hold(foreR, qx(40)),
  hold(glider, ID, [0, 0, 0]),
]
const FALL = [
  hold(armL, qmul(qz(28), qx(-18))), hold(armR, qmul(qz(-28), qx(-18))),
  hold(spine, qx(6)),
  hold(glider, ID, [0, 0, 0]),
]
const GLIDE = [
  hold(armL, qmul(qz(10), qx(-148))), hold(armR, qmul(qz(-10), qx(-148))),
  hold(foreL, qx(22)), hold(foreR, qx(22)),
  hold(spine, qx(16)), hold(chest, qx(8)),
  hold(upL, qx(-12)), hold(upR, qx(-12)),
  hold(glider, ID, [1, 1, 1]),
]

function keys(duration, frames) {
  // frames: array of { t, poses: hold[] } with t in 0..1
  const ch = new Map()
  for (const f of frames) {
    const t = f.t * duration
    for (const p of f.poses) {
      let row = ch.get(p.node)
      if (!row) { row = { rot: [], scale: [] }; ch.set(p.node, row) }
      if (p.rot) row.rot.push([t, p.rot])
      if (p.scale) row.scale.push([t, p.scale])
    }
  }
  return { duration, channels: ch }
}

const flail = (t) => {
  const s = Math.sin(t * Math.PI * 2)
  const k = Math.sin(t * Math.PI * 4)
  return [
    hold(armL, qmul(qy(18 * s), qx(-40 - 35 * k))),
    hold(armR, qmul(qy(-18 * s), qx(-40 + 35 * k))),
    hold(foreL, qx(25 + 20 * k)), hold(foreR, qx(25 - 20 * k)),
    hold(upL, qx(-18 - 22 * s)), hold(upR, qx(-18 + 22 * s)),
    hold(legL, qx(20 * s)), hold(legR, qx(-20 * s)),
    hold(spine, qy(16 * s)),
    hold(glider, ID, [0, 0, 0]),
  ]
}
const tumbleFrames = [0, 0.25, 0.5, 0.75, 1].map(t => ({ t, poses: flail(t) }))

const clips = [
  ['tumble', keys(0.8, tumbleFrames)],
  ['jump', keys(0.55, [{ t: 0, poses: TUCK }, { t: 1, poses: TUCK }])],
  ['double', keys(0.45, [{ t: 0, poses: DOUBLE }, { t: 1, poses: DOUBLE }])],
  ['fall', keys(1, [{ t: 0, poses: FALL }, { t: 1, poses: FALL }])],
  ['glide', keys(1.2, [{ t: 0, poses: GLIDE }, { t: 1, poses: GLIDE }])],
]

class Buf {
  constructor() { this.parts = []; this.len = 0 }
  align(n) { while (this.len % n) { this.parts.push(Buffer.from([0])); this.len++ } }
  f32(a) { this.align(4); const b = Buffer.alloc(a.length * 4); for (let i = 0; i < a.length; i++) b.writeFloatLE(a[i], i * 4); this.parts.push(b); const o = this.len; this.len += b.length; return o }
  u16(a) { this.align(2); const b = Buffer.alloc(a.length * 2); for (let i = 0; i < a.length; i++) b.writeUInt16LE(a[i], i * 2); this.parts.push(b); const o = this.len; this.len += b.length; return o }
  u8(a) { const b = Buffer.from(a); this.parts.push(b); const o = this.len; this.len += b.length; return o }
  concat() { return Buffer.concat(this.parts) }
}
const buf = new Buf()
const accessors = []
const bufferViews = []
function view(byteOffset, byteLength, target) {
  const v = { buffer: 0, byteOffset, byteLength }
  if (target) v.target = target
  bufferViews.push(v)
  return bufferViews.length - 1
}
function accessor(viewIndex, count, type, ctype, min, max) {
  const a = { bufferView: viewIndex, componentType: ctype, count, type }
  if (min) a.min = min
  if (max) a.max = max
  accessors.push(a)
  return accessors.length - 1
}
const F32 = 5126, U16 = 5123, U8 = 5121
function putF32(arr, type, min, max) {
  const off = buf.f32(arr)
  const bytes = arr.length * 4
  return accessor(view(off, bytes), arr.length / (type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : type === 'MAT4' ? 16 : 1), type, F32, min, max)
}
function bounds3(arr) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], arr[i + k]); max[k] = Math.max(max[k], arr[i + k])
  }
  return [min, max]
}

const [pmin, pmax] = bounds3(body.pos)
const posA = putF32(body.pos, 'VEC3', pmin, pmax)
const nrmA = putF32(body.nrm, 'VEC3')
const jOff = buf.u8(body.joints)
const jA = accessor(view(jOff, body.joints.length), body.joints.length / 4, 'VEC4', U8)
const wA = putF32(body.weights, 'VEC4')
const iOff = buf.u16(body.idx)
const iA = accessor(view(iOff, body.idx.length * 2, 34963), body.idx.length, 'SCALAR', U16)

const ibms = []
for (const node of joints) {
  const w = worldOf(node)
  ibms.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1)
}
const ibmA = putF32(ibms, 'MAT4')

const [wmin, wmax] = bounds3(wing.pos)
const wPos = putF32(wing.pos, 'VEC3', wmin, wmax)
const wNrm = putF32(wing.nrm, 'VEC3')
const wiOff = buf.u16(wing.idx)
const wIdx = accessor(view(wiOff, wing.idx.length * 2, 34963), wing.idx.length, 'SCALAR', U16)

const animations = []
for (const [name, clip] of clips) {
  const samplers = []
  const channels = []
  for (const [node, row] of clip.channels) {
    if (row.rot.length) {
      const times = row.rot.map(k => k[0])
      const vals = row.rot.flatMap(k => k[1])
      const i = putF32(times, 'SCALAR', [times[0]], [times[times.length - 1]])
      const o = putF32(vals, 'VEC4')
      samplers.push({ input: i, output: o, interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'rotation' } })
    }
    if (row.scale.length) {
      const times = row.scale.map(k => k[0])
      const vals = row.scale.flatMap(k => k[1])
      const i = putF32(times, 'SCALAR', [times[0]], [times[times.length - 1]])
      const o = putF32(vals, 'VEC3')
      samplers.push({ input: i, output: o, interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node, path: 'scale' } })
    }
  }
  animations.push({ name, samplers, channels })
}

const bin = buf.concat()
const gltf = {
  asset: { version: '2.0', generator: 'pixelwars build-air-standin' },
  scene: 0,
  scenes: [{ nodes: [rig, nodes.length] }],
  nodes: [
    ...nodes.map(n => {
      const o = { name: n.name }
      if (n.children.length) o.children = n.children
      if (n.translation && (n.translation[0] || n.translation[1] || n.translation[2])) o.translation = n.translation
      if (n.scale) o.scale = n.scale
      return o
    }),
    { name: 'Mannequin', mesh: 0, skin: 0 },
  ],
  skins: [{ joints, inverseBindMatrices: ibmA, skeleton: rig }],
  meshes: [
    { name: 'Body', primitives: [{ attributes: { POSITION: posA, NORMAL: nrmA, JOINTS_0: jA, WEIGHTS_0: wA }, indices: iA, material: 0 }] },
    { name: 'Wing', primitives: [{ attributes: { POSITION: wPos, NORMAL: wNrm }, indices: wIdx, material: 1 }] },
  ],
  materials: [
    { name: 'Cloth', pbrMetallicRoughness: { baseColorFactor: [0.86, 0.84, 0.8, 1], metallicFactor: 0.02, roughnessFactor: 0.72 } },
    { name: 'Sail', pbrMetallicRoughness: { baseColorFactor: [0.93, 0.94, 0.96, 1], metallicFactor: 0, roughnessFactor: 0.4 } },
  ],
  animations,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }],
}
// Glider node needs its mesh. nodes[] extras didn't carry mesh; patch by name.
const gliderJson = gltf.nodes[glider]
gliderJson.mesh = 1

const names = gltf.nodes.map(n => n.name)
if (names.includes('Armature_Prop')) throw new Error('Armature_Prop slipped in')
const clipNames = animations.map(a => a.name)
for (const need of ['tumble', 'jump', 'double', 'fall', 'glide']) {
  if (!clipNames.includes(need)) throw new Error('missing clip ' + need)
}

let json = Buffer.from(JSON.stringify(gltf))
while (json.length % 4) json = Buffer.concat([json, Buffer.from(' ')])
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4)
const chunk0 = json.length + 8
const chunk1 = bin.length + binPad.length + 8
const total = 12 + chunk0 + chunk1
const out = Buffer.alloc(total)
out.writeUInt32LE(0x46546c67, 0)
out.writeUInt32LE(2, 4)
out.writeUInt32LE(total, 8)
out.writeUInt32LE(json.length, 12)
out.writeUInt32LE(0x4e4f534a, 16)
json.copy(out, 20)
const b0 = 20 + json.length
out.writeUInt32LE(bin.length + binPad.length, b0)
out.writeUInt32LE(0x004e4942, b0 + 4)
bin.copy(out, b0 + 8)
writeFileSync(OUT, out)
console.log(`air-standin.glb ${out.length} bytes  y ${minY.toFixed(3)}..${maxY.toFixed(3)}  clips ${clipNames.join(',')}`)
