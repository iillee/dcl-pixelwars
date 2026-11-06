/**
 * Geometric ocean swells plus the flat rim that hides the parcel edge.
 *
 * Several sine trains share one period. Each train is a pair of morph
 * targets (sin and cos of its phase); the clip's weights are cos(ωt) and
 * sin(ωt), so the sum is a smooth traveling interference pattern and the
 * loop closes. Rings share the same function, so crests cross the joins.
 * Displacement is in metres (swellAmplitudeM).
 *
 * Run: npx tsx scripts/build-water-swell.ts
 * Numbers live in src/shared/waterLook.ts.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { SCENE_SIZE } from '../src/maze/generator'
import { SWELL_TRAINS, WATER, WATER_FOG } from '../src/shared/waterLook'

const CLIP = WATER.swellClipS
const AMP = WATER.swellAmplitudeM
const TRAINS = SWELL_TRAINS.map((t) => {
  const rad = (t.dirDeg * Math.PI) / 180
  return {
    k: (Math.PI * 2) / t.wavelengthM,
    dx: Math.cos(rad),
    dz: Math.sin(rad),
    weight: t.weight,
    phase: t.phase,
  }
})
const TARGETS = TRAINS.length * 2
const SEA_HALF = (SCENE_SIZE - WATER.edgeInsetM * 2) / 2
const FLAT_OVERLAP = 4

type Rgb = { r: number; g: number; b: number }

const WATER_RGB: Rgb = { r: WATER.color.r, g: WATER.color.g, b: WATER.color.b }
const SKY_RGB: Rgb = { r: WATER_FOG.color.r, g: WATER_FOG.color.g, b: WATER_FOG.color.b }

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

function trainShape(x: number, z: number, train: (typeof TRAINS)[number], kind: 0 | 1): number {
  const theta = train.k * (x * train.dx + z * train.dz) + train.phase
  return train.weight * (kind === 0 ? Math.sin(theta) : Math.cos(theta))
}

function sumY(x: number, z: number, ang: number): number {
  let y = 0
  for (const train of TRAINS) {
    const theta = train.k * (x * train.dx + z * train.dz) + train.phase + ang
    y += train.weight * Math.sin(theta)
  }
  return y
}

let hi = -Infinity
let lo = Infinity
{
  const extent = 2200
  const step = 48
  for (let z = -extent; z <= extent; z += step) {
    for (let x = -extent; x <= extent; x += step) {
      for (let a = 0; a < 24; a++) {
        const y = sumY(x, z, (a / 24) * Math.PI * 2)
        hi = Math.max(hi, y)
        lo = Math.min(lo, y)
      }
    }
  }
}
/** Scale so neither crest nor trough of the sum exceeds swellAmplitudeM. */
const NORM = Math.max(hi, -lo, 1e-6)

function envelope(x: number, z: number, inner: number, outer: number): number {
  if (!(outer > inner)) return 1
  const d = Math.max(Math.abs(x), Math.abs(z))
  if (d <= inner) return 1
  if (d >= outer) return 0
  return 1 - smooth((d - inner) / (outer - inner))
}

type Built = {
  name: string
  pos: number[]
  nrm: number[]
  uv: number[]
  idx: number[]
  morphPos: number[][]
  morphNrm: number[][]
  tris: number
}

function triNormal(pos: number[], a: number, b: number, c: number): [number, number, number] {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2]
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2]
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx]
}

function faceUp(pos: number[], a: number, b: number, c: number): [number, number, number] {
  const n = triNormal(pos, a, b, c)
  return n[1] < 0 ? [a, c, b] : [a, b, c]
}

function normalsOf(pos: number[], idx: number[]): number[] {
  const nrm = new Array(pos.length).fill(0)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2]
    const n = triNormal(pos, a, b, c)
    for (const v of [a, b, c]) {
      nrm[v * 3] += n[0]
      nrm[v * 3 + 1] += n[1]
      nrm[v * 3 + 2] += n[2]
    }
  }
  for (let v = 0; v < nrm.length; v += 3) {
    const x = nrm[v], y = nrm[v + 1], z = nrm[v + 2]
    const len = Math.hypot(x, y, z) || 1
    nrm[v] = x / len
    nrm[v + 1] = y / len
    nrm[v + 2] = z / len
  }
  return nrm
}

function displaceComponent(
  base: number[],
  idx: number[],
  train: (typeof TRAINS)[number],
  kind: 0 | 1,
  envAt: (x: number, z: number) => number,
): { delta: number[]; nrm: number[] } {
  const pos = base.slice()
  const delta = new Array(base.length).fill(0)
  for (let v = 0; v < base.length; v += 3) {
    const e = envAt(base[v], base[v + 2])
    const y = (trainShape(base[v], base[v + 2], train, kind) * e * AMP) / NORM
    delta[v + 1] = y
    pos[v + 1] = y
  }
  return { delta, nrm: normalsOf(pos, idx) }
}

class MeshBuilder {
  pos: number[] = []
  uv: number[] = []
  idx: number[] = []
  map = new Map<string, number>()
  add(x: number, z: number, u: number, v: number): number {
    const key = `${x.toFixed(3)},${z.toFixed(3)}`
    const hit = this.map.get(key)
    if (hit !== undefined) return hit
    const i = this.pos.length / 3
    this.pos.push(x, 0, z)
    this.uv.push(u, v)
    this.map.set(key, i)
    return i
  }
  tri(a: number, b: number, c: number) {
    const [i, j, k] = faceUp(this.pos, a, b, c)
    this.idx.push(i, j, k)
  }
}

function rangeAbs(from: number, to: number, step: number): number[] {
  const n = Math.round((to - from) / step)
  const out: number[] = []
  for (let i = 0; i <= n; i++) out.push(from + i * step)
  return out
}

function squareGrid(half: number, step: number, envAt: (x: number, z: number) => number, name: string): Built {
  const m = new MeshBuilder()
  const n = Math.round((half * 2) / step)
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push(-half + i * step)
  const ids: number[][] = []
  for (let j = 0; j <= n; j++) {
    ids[j] = []
    for (let i = 0; i <= n; i++) ids[j][i] = m.add(xs[i], xs[j], 0.5, 0.5)
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1]
      m.tri(a, b, d)
      m.tri(a, d, c)
    }
  }
  return finish(m, envAt, name)
}

function sidePanel(
  m: MeshBuilder,
  axis: 'x' | 'z',
  sign: 1 | -1,
  inner: number,
  outer: number,
  innerStep: number,
  outerStep: number,
) {
  if (outerStep !== innerStep * 2) throw new Error(`ring steps must double (${innerStep} → ${outerStep})`)
  const steps = Math.round((outer - inner) / outerStep)
  const absOut: number[] = []
  for (let i = 0; i <= steps; i++) absOut.push(inner + i * outerStep)
  const acrossFine = rangeAbs(-inner, inner, innerStep)
  const acrossCoarse = rangeAbs(-inner, inner, outerStep)
  const col = (outward: number, across: number[]): number[] =>
    across.map((a) => (axis === 'x' ? m.add(sign * outward, a, 0.5, 0.5) : m.add(a, sign * outward, 0.5, 0.5)))
  const fine = col(absOut[0], acrossFine)
  const coarseCols = absOut.slice(1).map((x) => col(x, acrossCoarse))
  const spans = acrossCoarse.length - 1
  for (let s = 0; s < spans; s++) {
    const a0 = fine[s * 2]
    const a1 = fine[s * 2 + 1]
    const a2 = fine[s * 2 + 2]
    const b0 = coarseCols[0][s]
    const b2 = coarseCols[0][s + 1]
    m.tri(a0, b0, a1)
    m.tri(a1, b0, b2)
    m.tri(a1, b2, a2)
  }
  for (let c = 0; c < coarseCols.length - 1; c++) {
    for (let s = 0; s < spans; s++) {
      const a = coarseCols[c][s], b = coarseCols[c][s + 1]
      const d = coarseCols[c + 1][s], e = coarseCols[c + 1][s + 1]
      m.tri(a, d, e)
      m.tri(a, e, b)
    }
  }
}

function corner(m: MeshBuilder, x0: number, x1: number, z0: number, z1: number, step: number) {
  const xs = rangeAbs(Math.min(x0, x1), Math.max(x0, x1), step)
  const zs = rangeAbs(Math.min(z0, z1), Math.max(z0, z1), step)
  const ids: number[][] = zs.map((z) => xs.map((x) => m.add(x, z, 0.5, 0.5)))
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      m.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1])
      m.tri(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i])
    }
  }
}

function frameGrid(
  inner: number,
  outer: number,
  innerStep: number,
  outerStep: number,
  envAt: (x: number, z: number) => number,
  name: string,
): Built {
  const m = new MeshBuilder()
  sidePanel(m, 'x', 1, inner, outer, innerStep, outerStep)
  sidePanel(m, 'x', -1, inner, outer, innerStep, outerStep)
  sidePanel(m, 'z', 1, inner, outer, innerStep, outerStep)
  sidePanel(m, 'z', -1, inner, outer, innerStep, outerStep)
  corner(m, inner, outer, inner, outer, outerStep)
  corner(m, -outer, -inner, inner, outer, outerStep)
  corner(m, inner, outer, -outer, -inner, outerStep)
  corner(m, -outer, -inner, -outer, -inner, outerStep)
  return finish(m, envAt, name)
}

function finish(m: MeshBuilder, envAt: (x: number, z: number) => number, name: string): Built {
  const morphPos: number[][] = []
  const morphNrm: number[][] = []
  const baseNrm = new Array(m.pos.length)
  for (let v = 0; v < m.pos.length; v += 3) {
    baseNrm[v] = 0
    baseNrm[v + 1] = 1
    baseNrm[v + 2] = 0
  }
  for (const train of TRAINS) {
    for (const kind of [0, 1] as const) {
      const posed = displaceComponent(m.pos, m.idx, train, kind, envAt)
      morphPos.push(posed.delta)
      const nd = new Array(baseNrm.length)
      for (let i = 0; i < nd.length; i++) nd[i] = posed.nrm[i] - baseNrm[i]
      morphNrm.push(nd)
    }
  }
  return {
    name,
    pos: m.pos,
    nrm: baseNrm,
    uv: m.uv,
    idx: m.idx,
    morphPos,
    morphNrm,
    tris: m.idx.length / 3,
  }
}

function flatRing(inner: number, outer: number, step: number, name: string): Built {
  const must = [inner, outer]
  const xsSet = new Set<number>()
  const n = Math.ceil(outer / step)
  for (let i = -n; i <= n; i++) {
    const v = i * step
    if (Math.abs(v) <= outer + 1e-3) xsSet.add(Math.max(-outer, Math.min(outer, v)))
  }
  for (const v of must) {
    xsSet.add(v)
    xsSet.add(-v)
  }
  const xs = [...xsSet].sort((a, b) => a - b)
  const m = new MeshBuilder()
  const span = Math.max(1, outer - inner)
  const idAt = new Map<string, number>()
  /** Distance outside the swell square. Zero on the whole inner edge, so the
   *  fade starts at the water colour and does not ray out from the origin. */
  const fadeU = (x: number, z: number) => {
    const ox = Math.max(0, Math.abs(x) - inner)
    const oz = Math.max(0, Math.abs(z) - inner)
    return Math.min(1, Math.hypot(ox, oz) / span)
  }
  const add = (i: number, j: number) => {
    const key = `${i},${j}`
    const hit = idAt.get(key)
    if (hit !== undefined) return hit
    const x = xs[i]
    const z = xs[j]
    const id = m.add(x, z, fadeU(x, z), 0.5)
    idAt.set(key, id)
    return id
  }
  for (let j = 0; j < xs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const corners = [
        [xs[i], xs[j]],
        [xs[i + 1], xs[j]],
        [xs[i], xs[j + 1]],
        [xs[i + 1], xs[j + 1]],
      ]
      const outside = corners.some(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) >= inner - 1e-3)
      if (!outside) continue
      const a = add(i, j)
      const b = add(i + 1, j)
      const c = add(i, j + 1)
      const d = add(i + 1, j + 1)
      m.tri(a, b, d)
      m.tri(a, d, c)
    }
  }
  const flatEnv = () => 0
  return finish(m, flatEnv, name)
}

class Buf {
  parts: Buffer[] = []
  len = 0
  align(n: number) {
    while (this.len % n) {
      this.parts.push(Buffer.from([0]))
      this.len++
    }
  }
  f32(arr: number[]): number {
    this.align(4)
    const b = Buffer.alloc(arr.length * 4)
    for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4)
    this.parts.push(b)
    const o = this.len
    this.len += b.length
    return o
  }
  u32(arr: number[]): number {
    this.align(4)
    const b = Buffer.alloc(arr.length * 4)
    for (let i = 0; i < arr.length; i++) b.writeUInt32LE(arr[i], i * 4)
    this.parts.push(b)
    const o = this.len
    this.len += b.length
    return o
  }
  concat() {
    return Buffer.concat(this.parts)
  }
}

function writeGlb(mesh: Built, file: string) {
  const buf = new Buf()
  const views: object[] = []
  const acc: object[] = []
  const view = (off: number, len: number, target?: number) => {
    const v: { buffer: number; byteOffset: number; byteLength: number; target?: number } = {
      buffer: 0,
      byteOffset: off,
      byteLength: len,
    }
    if (target) v.target = target
    views.push(v)
    return views.length - 1
  }
  const accessor = (
    viewIndex: number,
    count: number,
    type: string,
    ctype: number,
    min?: number[],
    max?: number[],
  ) => {
    const a: {
      bufferView: number
      componentType: number
      count: number
      type: string
      min?: number[]
      max?: number[]
    } = { bufferView: viewIndex, componentType: ctype, count, type }
    if (min) a.min = min
    if (max) a.max = max
    acc.push(a)
    return acc.length - 1
  }
  const F32 = 5126
  const U32 = 5125
  const putF32 = (arr: number[], type: string, min?: number[], max?: number[]) => {
    const off = buf.f32(arr)
    const comps = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1
    return accessor(view(off, arr.length * 4), arr.length / comps, type, F32, min, max)
  }
  let pMin = [Infinity, Infinity, Infinity]
  let pMax = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      pMin[k] = Math.min(pMin[k], mesh.pos[i + k])
      pMax[k] = Math.max(pMax[k], mesh.pos[i + k])
    }
  }
  const posA = putF32(mesh.pos, 'VEC3', pMin, pMax)
  const nrmA = putF32(mesh.nrm, 'VEC3')
  const uvA = putF32(mesh.uv, 'VEC2')
  const iOff = buf.u32(mesh.idx)
  const iA = accessor(view(iOff, mesh.idx.length * 4, 34963), mesh.idx.length, 'SCALAR', U32)
  const animate = mesh.morphPos.length > 0 && mesh.morphPos.some((p) => p.some((v) => Math.abs(v) > 1e-6))
  const morphTargets = animate
    ? mesh.morphPos.map((p, t) => ({
      POSITION: putF32(p, 'VEC3'),
      NORMAL: putF32(mesh.morphNrm[t], 'VEC3'),
    }))
    : []
  const keys = 24
  const times: number[] = []
  const weights: number[] = []
  if (animate) {
    for (let i = 0; i <= keys; i++) {
      const ang = (i / keys) * Math.PI * 2
      times.push((i / keys) * CLIP)
      for (let n = 0; n < TRAINS.length; n++) weights.push(Math.cos(ang), Math.sin(ang))
    }
  }
  const tA = animate ? putF32(times, 'SCALAR', [times[0]], [times[times.length - 1]]) : 0
  const wA = animate ? putF32(weights, 'SCALAR', [0], [1]) : 0
  const primitive: {
    attributes: { POSITION: number; NORMAL: number; TEXCOORD_0: number }
    indices: number
    material: number
    targets?: object[]
  } = {
    attributes: { POSITION: posA, NORMAL: nrmA, TEXCOORD_0: uvA },
    indices: iA,
    material: 0,
  }
  if (animate) primitive.targets = morphTargets
  const gltf: {
    asset: { version: string; generator: string }
    scene: number
    scenes: object[]
    nodes: object[]
    meshes: object[]
    materials: object[]
    animations?: object[]
    accessors: object[]
    bufferViews: object[]
    buffers: Array<{ byteLength: number }>
  } = {
    asset: { version: '2.0', generator: 'pixelwars build-water-swell' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: mesh.name, mesh: 0 }],
    meshes: [{
      name: mesh.name,
      weights: animate ? new Array(TARGETS).fill(0) : undefined,
      primitives: [primitive],
    }],
    materials: [{
      name: 'Sea',
      doubleSided: false,
      pbrMetallicRoughness: {
        baseColorFactor: [WATER.color.r, WATER.color.g, WATER.color.b, 1],
        metallicFactor: WATER.metallic,
        roughnessFactor: WATER.roughness,
      },
    }],
    accessors: acc,
    bufferViews: views,
    buffers: [{ byteLength: 0 }],
  }
  if (animate) {
    gltf.animations = [{
      name: 'wave',
      samplers: [{ input: tA, output: wA, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }],
    }]
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
  writeFileSync(file, out)
  return out.length
}

function png(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[(w * 4 + 1) * y] = 0
    rgba.copy(raw, (w * 4 + 1) * y + 1, y * w * 4, (y + 1) * w * 4)
  }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([t, data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

function writeTextures() {
  const solid = Buffer.alloc(4 * 4 * 4)
  for (let i = 0; i < 16; i++) {
    solid[i * 4] = byte(WATER_RGB.r)
    solid[i * 4 + 1] = byte(WATER_RGB.g)
    solid[i * 4 + 2] = byte(WATER_RGB.b)
    solid[i * 4 + 3] = 255
  }
  writeFileSync(new URL('../' + WATER.colorSrc, import.meta.url), png(4, 4, solid))

  const W = 256
  const H = 4
  const grad = Buffer.alloc(W * H * 4)
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1)
    const t = smooth(Math.max(0, (u - 0.28) / 0.72))
    const r = WATER_RGB.r + (SKY_RGB.r - WATER_RGB.r) * t
    const g = WATER_RGB.g + (SKY_RGB.g - WATER_RGB.g) * t
    const b = WATER_RGB.b + (SKY_RGB.b - WATER_RGB.b) * t
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4
      grad[o] = byte(r)
      grad[o + 1] = byte(g)
      grad[o + 2] = byte(b)
      grad[o + 3] = 255
    }
  }
  writeFileSync(new URL('../' + WATER_FOG.horizonSrc, import.meta.url), png(W, H, grad))

  const vw = 4
  const vh = 128
  const veil = Buffer.alloc(vw * vh * 4)
  const hc = WATER_FOG.horizonColor
  for (let y = 0; y < vh; y++) {
    const v = y / (vh - 1)
    const rise = smooth(Math.max(0, (v - 0.08) / 0.32))
    const fall = 1 - smooth(Math.max(0, (v - 0.42) / 0.45))
    const a = hc.a * rise * fall
    for (let x = 0; x < vw; x++) {
      const o = (y * vw + x) * 4
      veil[o] = byte(hc.r)
      veil[o + 1] = byte(hc.g)
      veil[o + 2] = byte(hc.b)
      veil[o + 3] = byte(a)
    }
  }
  writeFileSync(new URL('../' + WATER_FOG.horizonSrcVeil, import.meta.url), png(vw, vh, veil))
}

function report(mesh: Built, bytes: number) {
  const verts = mesh.pos.length / 3
  console.log(
    `${mesh.name.padEnd(12)} tris ${String(mesh.tris).padStart(7)}  verts ${String(verts).padStart(7)}  ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  )
  return { tris: mesh.tris, verts }
}

function edgeDelta(mesh: Built, x: number, z: number, phaseIndex: number): number | null {
  for (let i = 0; i < mesh.pos.length; i += 3) {
    if (Math.abs(mesh.pos[i] - x) < 0.01 && Math.abs(mesh.pos[i + 2] - z) < 0.01) {
      return mesh.morphPos[phaseIndex][i + 1]
    }
  }
  return null
}

const one = () => 1
const near = squareGrid(WATER.swellNearM, WATER.swellNearStepM, one, 'SwellNear')
const mid = frameGrid(WATER.swellNearM, WATER.swellMidM, WATER.swellNearStepM, WATER.swellMidStepM, one, 'SwellMid')
const far = frameGrid(
  WATER.swellMidM,
  WATER.swellFarM,
  WATER.swellMidStepM,
  WATER.swellFarStepM,
  (x, z) => envelope(x, z, WATER.swellMidM, WATER.swellFarM),
  'SwellFar',
)
const lite = squareGrid(
  WATER.swellNearM,
  WATER.swellMobileStepM,
  (x, z) => envelope(x, z, WATER.swellNearM - WATER.swellMobileFadeM, WATER.swellNearM),
  'SwellLite',
)
const flat = flatRing(WATER.swellFarM - FLAT_OVERLAP, SEA_HALF, 24, 'FlatSea')
const flatLite = flatRing(WATER.swellNearM - FLAT_OVERLAP, SEA_HALF, 40, 'FlatLite')

const join = edgeDelta(near, WATER.swellNearM, 0, 0)
const joinMid = edgeDelta(mid, WATER.swellNearM, 0, 0)
const farOuter = edgeDelta(far, WATER.swellFarM, 0, 0)
const farInner = edgeDelta(far, WATER.swellMidM, 0, 0)
const midOuter = edgeDelta(mid, WATER.swellMidM, 0, 0)
if (join === null || joinMid === null || Math.abs(join - joinMid) > 1e-4) {
  throw new Error(`near/mid join mismatch ${join} vs ${joinMid}`)
}
if (farInner === null || midOuter === null || Math.abs(farInner - midOuter) > 1e-4) {
  throw new Error(`mid/far join mismatch ${midOuter} vs ${farInner}`)
}
if (farOuter === null || Math.abs(farOuter) > 1e-4) {
  throw new Error(`far edge is still displaced (${farOuter})`)
}

writeTextures()
const files: Array<[Built, string]> = [
  [near, WATER.swellNearSrc],
  [mid, WATER.swellMidSrc],
  [far, WATER.swellFarSrc],
  [lite, WATER.swellLiteSrc],
  [flat, WATER.flatSrc],
  [flatLite, WATER.flatLiteSrc],
]
let deskTris = 0
let deskVerts = 0
let mobTris = 0
let mobVerts = 0
for (const [mesh, rel] of files) {
  const bytes = writeGlb(mesh, new URL('../' + rel, import.meta.url))
  const s = report(mesh, bytes)
  if (rel === WATER.swellNearSrc || rel === WATER.swellMidSrc || rel === WATER.swellFarSrc) {
    deskTris += s.tris
    deskVerts += s.verts
  }
  if (rel === WATER.flatSrc) deskTris += s.tris
  if (rel === WATER.swellLiteSrc) {
    mobTris += s.tris
    mobVerts += s.verts
  }
  if (rel === WATER.flatLiteSrc) mobTris += s.tris
}
function longestEdge(mesh: Built): number {
  let max = 0
  for (let t = 0; t < mesh.idx.length; t += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
      const ia = mesh.idx[t + a] * 3
      const ib = mesh.idx[t + b] * 3
      max = Math.max(max, Math.hypot(mesh.pos[ia] - mesh.pos[ib], mesh.pos[ia + 2] - mesh.pos[ib + 2]))
    }
  }
  return max
}
const rimEdge = longestEdge(flat)
if (rimEdge > 48) throw new Error(`flat rim triangles are too long (${rimEdge.toFixed(1)} m) and will streak`)

function rasterRim(mesh: Built, file: string) {
  const N = 640
  const rgba = Buffer.alloc(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    rgba[i * 4] = byte(WATER_RGB.r)
    rgba[i * 4 + 1] = byte(WATER_RGB.g)
    rgba[i * 4 + 2] = byte(WATER_RGB.b)
    rgba[i * 4 + 3] = 255
  }
  const pix = (x: number) => (x / SEA_HALF) * 0.5 + 0.5
  const col = (u: number) => {
    const t = smooth(Math.max(0, (u - 0.28) / 0.72))
    return [
      WATER_RGB.r + (SKY_RGB.r - WATER_RGB.r) * t,
      WATER_RGB.g + (SKY_RGB.g - WATER_RGB.g) * t,
      WATER_RGB.b + (SKY_RGB.b - WATER_RGB.b) * t,
    ]
  }
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const id = [mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]]
    const xy = id.map((v) => [pix(mesh.pos[v * 3]) * (N - 1), pix(mesh.pos[v * 3 + 2]) * (N - 1)])
    const rgb = id.map((v) => col(mesh.uv[v * 2]))
    let minx = N, miny = N, maxx = 0, maxy = 0
    for (const [x, y] of xy) {
      minx = Math.min(minx, Math.floor(x))
      miny = Math.min(miny, Math.floor(y))
      maxx = Math.max(maxx, Math.ceil(x))
      maxy = Math.max(maxy, Math.ceil(y))
    }
    minx = Math.max(0, minx)
    miny = Math.max(0, miny)
    maxx = Math.min(N - 1, maxx)
    maxy = Math.min(N - 1, maxy)
    const area = (xy[1][0] - xy[0][0]) * (xy[2][1] - xy[0][1]) - (xy[2][0] - xy[0][0]) * (xy[1][1] - xy[0][1])
    if (Math.abs(area) < 1e-6) continue
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const w0 = ((xy[1][0] - x) * (xy[2][1] - y) - (xy[2][0] - x) * (xy[1][1] - y)) / area
        const w1 = ((xy[2][0] - x) * (xy[0][1] - y) - (xy[0][0] - x) * (xy[2][1] - y)) / area
        const w2 = 1 - w0 - w1
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue
        const o = (y * N + x) * 4
        rgba[o] = byte(w0 * rgb[0][0] + w1 * rgb[1][0] + w2 * rgb[2][0])
        rgba[o + 1] = byte(w0 * rgb[0][1] + w1 * rgb[1][1] + w2 * rgb[2][1])
        rgba[o + 2] = byte(w0 * rgb[0][2] + w1 * rgb[1][2] + w2 * rgb[2][2])
      }
    }
  }
  writeFileSync(file, png(N, N, rgba))
}
rasterRim(flat, '/tmp/water-rim.png')

console.log(`sum range ${lo.toFixed(3)}..${hi.toFixed(3)}  scale ${NORM.toFixed(3)}  trains ${TRAINS.length}  clip ${CLIP}s`)
console.log(`desktop swell+flat tris ${deskTris}  morph verts ${deskVerts}`)
console.log(`mobile swell+flat tris ${mobTris}  morph verts ${mobVerts}`)
console.log(`sea half ${SEA_HALF.toFixed(0)}m  far ring ${WATER.swellFarM}m`)
