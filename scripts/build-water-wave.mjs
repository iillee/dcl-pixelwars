/**
 * Low-poly sea swell. Two morph targets a quarter-cycle apart, weights
 * driven as sin/cos so the crest travels. Peak displacement is 1 m at
 * scale Y = 1; the scene scales Y by waveAmplitudeM.
 *
 * Run: node scripts/build-water-wave.mjs
 * Original mesh. The ripple normal is a separate file.
 */
import { writeFileSync } from 'node:fs'

const OUT = new URL('../assets/models/water-wave.glb', import.meta.url)
const N = 40
const CYCLES = 2.5
const CHOP = 6

function disp(x, z, phase) {
  const k = Math.PI * 2 * CYCLES
  const c = Math.PI * 2 * CHOP
  return 0.75 * Math.sin(k * x + phase) * Math.cos(k * z * 0.65)
    + 0.25 * Math.sin(c * z - phase * 1.4 + x * 2)
}

let peak = 0
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const x = i / N - 0.5
    const z = j / N - 0.5
    peak = Math.max(peak, Math.abs(disp(x, z, 0)), Math.abs(disp(x, z, Math.PI / 2)))
  }
}

const pos = []
const nrm = []
const a = []
const b = []
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const x = i / N - 0.5
    const z = j / N - 0.5
    pos.push(x, 0, z)
    nrm.push(0, 1, 0)
    a.push(0, disp(x, z, 0) / peak, 0)
    b.push(0, disp(x, z, Math.PI / 2) / peak, 0)
  }
}
const idx = []
const row = N + 1
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const v = j * row + i
    idx.push(v, v + row, v + 1, v + 1, v + row, v + row + 1)
  }
}

const KEYS = 24
const times = []
const weights = []
for (let i = 0; i <= KEYS; i++) {
  const u = i / KEYS
  times.push(u * 8)
  const ang = u * Math.PI * 2
  weights.push(Math.sin(ang), Math.cos(ang))
}

class Buf {
  constructor() { this.parts = []; this.len = 0 }
  align(n) { while (this.len % n) { this.parts.push(Buffer.from([0])); this.len++ } }
  f32(arr) {
    this.align(4)
    const b = Buffer.alloc(arr.length * 4)
    for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4)
    this.parts.push(b)
    const o = this.len
    this.len += b.length
    return o
  }
  u16(arr) {
    this.align(2)
    const b = Buffer.alloc(arr.length * 2)
    for (let i = 0; i < arr.length; i++) b.writeUInt16LE(arr[i], i * 2)
    this.parts.push(b)
    const o = this.len
    this.len += b.length
    return o
  }
  concat() { return Buffer.concat(this.parts) }
}

const buf = new Buf()
const views = []
const acc = []
function view(off, len, target) {
  const v = { buffer: 0, byteOffset: off, byteLength: len }
  if (target) v.target = target
  views.push(v)
  return views.length - 1
}
function accessor(viewIndex, count, type, ctype, min, max) {
  const a = { bufferView: viewIndex, componentType: ctype, count, type }
  if (min) a.min = min
  if (max) a.max = max
  acc.push(a)
  return acc.length - 1
}
const F32 = 5126
const U16 = 5123
function putF32(arr, type, min, max) {
  const off = buf.f32(arr)
  const comps = type === 'VEC3' ? 3 : 1
  return accessor(view(off, arr.length * 4), arr.length / comps, type, F32, min, max)
}
const pMin = [-0.5, 0, -0.5]
const pMax = [0.5, 0, 0.5]
const posA = putF32(pos, 'VEC3', pMin, pMax)
const nrmA = putF32(nrm, 'VEC3')
const iOff = buf.u16(idx)
const iA = accessor(view(iOff, idx.length * 2, 34963), idx.length, 'SCALAR', U16)
const aA = putF32(a, 'VEC3', [-0, -1, -0], [0, 1, 0])
const bA = putF32(b, 'VEC3', [-0, -1, -0], [0, 1, 0])
const tA = putF32(times, 'SCALAR', [times[0]], [times[times.length - 1]])
const wA = putF32(weights, 'SCALAR', [-1], [1])

const gltf = {
  asset: { version: '2.0', generator: 'pixelwars build-water-wave' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Sea', mesh: 0 }],
  meshes: [{
    name: 'Sea',
    weights: [0, 0],
    primitives: [{
      attributes: { POSITION: posA, NORMAL: nrmA },
      indices: iA,
      targets: [{ POSITION: aA }, { POSITION: bA }],
      material: 0,
    }],
  }],
  materials: [{
    name: 'Sea',
    alphaMode: 'BLEND',
    pbrMetallicRoughness: {
      baseColorFactor: [0.02, 0.22, 0.72, 0.96],
      metallicFactor: 0.45,
      roughnessFactor: 0.12,
    },
  }],
  animations: [{
    name: 'wave',
    samplers: [{ input: tA, output: wA, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }],
  }],
  accessors: acc,
  bufferViews: views,
  buffers: [{ byteLength: 0 }],
}

let json = Buffer.from(JSON.stringify(gltf))
const bin = buf.concat()
gltf.buffers[0].byteLength = bin.length
json = Buffer.from(JSON.stringify(gltf))
while (json.length % 4) json = Buffer.concat([json, Buffer.from(' ')])
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4)
const total = 12 + 8 + json.length + 8 + bin.length + binPad.length
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
console.log(`water-wave.glb ${out.length} bytes  verts ${(N + 1) ** 2}  peak normalised to 1 m`)
