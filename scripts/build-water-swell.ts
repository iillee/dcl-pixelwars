/**
 * Geometric ocean swells plus the flat rim that hides the parcel edge.
 *
 * Several sine trains share one period. Each train is a pair of morph
 * targets (sin and cos of its phase); the clip's weights are cos(ωt) and
 * sin(ωt), so the sum is a smooth traveling interference pattern and the
 * loop closes. Rings share the same function, so crests cross the joins.
 * Displacement is in metres (swellAmplitudeM).
 *
 * The desktop swell is one mesh: a round disk through the mid radius, then a
 * skirt out to the far square so the rim's corners stay covered. It is cut
 * into near, mid, and far files after the normals are computed, so the shared
 * circles match on both sides. A square edge or a coarser ring cannot draw a line.
 *
 * Run: npx tsx scripts/build-water-swell.ts
 * Numbers live in src/shared/waterLook.ts.
 */
import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { SCENE_SIZE } from '../src/maze/generator'
import { LOOK, SURFACE, SWELL_48_AMPLITUDE_M, SWELL_48_PERIOD_S, WATER, WATER_FOG } from '../src/shared/waterLook'
import { SWELL_NORM, SWELL_NORM_48, SWELL_PARTS, SWELL_PARTS_48, swellPartY } from '../src/shared/swell'

let CLIP = WATER.swellClipS
let AMP = WATER.swellAmplitudeM
let TRAINS = SWELL_PARTS
let TARGETS = TRAINS.length * 2
let NORM = SWELL_NORM
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
  return swellPartY(x, z, train, kind)
}

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

/** One UV unit is `softNormalTileM` metres. The flat rim keeps its own fade UVs. */
function seaUv(x: number, z: number): [number, number] {
  const tile = LOOK.softNormalTileM
  return [x / tile, z / tile]
}

function squareGrid(half: number, step: number, envAt: (x: number, z: number) => number, name: string): Built {
  const m = new MeshBuilder()
  const n = Math.round((half * 2) / step)
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push(-half + i * step)
  const ids: number[][] = []
  for (let j = 0; j <= n; j++) {
    ids[j] = []
    for (let i = 0; i <= n; i++) {
      const [u, v] = seaUv(xs[i], xs[j])
      ids[j][i] = m.add(xs[i], xs[j], u, v)
    }
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
    across.map((a) => {
      const x = axis === 'x' ? sign * outward : a
      const z = axis === 'x' ? a : sign * outward
      const [u, v] = seaUv(x, z)
      return m.add(x, z, u, v)
    })
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
  const ids: number[][] = zs.map((z) => xs.map((x) => {
    const [u, v] = seaUv(x, z)
    return m.add(x, z, u, v)
  }))
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      m.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1])
      m.tri(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i])
    }
  }
}

/** Annulus inside the haze circle. Coarse, so the outer sea is one cheap draw. */
function diskRing(
  inner: number,
  outer: number,
  step: number,
  segs: number,
  envAt: (x: number, z: number) => number,
  name: string,
): Built {
  const radii: number[] = []
  for (let r = inner; r < outer - 0.5; r += step) radii.push(r)
  radii.push(outer)
  const m = new MeshBuilder()
  const rings: number[][] = []
  for (const R of radii) {
    const row: number[] = []
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const x = Math.cos(a) * R
      const z = Math.sin(a) * R
      const [u, v] = seaUv(x, z)
      row.push(m.add(x, z, u, v))
    }
    rings.push(row)
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs
      m.tri(rings[k][i], rings[k + 1][i], rings[k + 1][j])
      m.tri(rings[k][i], rings[k + 1][j], rings[k][j])
    }
  }
  const built = finish(m, envAt, name)
  for (let i = 1; i < built.pos.length; i += 3) built.pos[i] -= 0.2
  return built
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

/**
 * Square rings. Each ring is one chebyshev radius, so the fade UV is constant
 * along it and a long tangential edge cannot streak. Radial steps stay short
 * once the horizon gradient starts (u > 0.28) and get coarser inside that,
 * where the mask is still the water colour.
 */
function flatRing(inner: number, outer: number, gradStep: number, name: string): Built {
  const span = Math.max(1, outer - inner)
  const gradAt = inner + span * 0.28
  const radii = [inner]
  const push = (r: number) => {
    const prev = radii[radii.length - 1]
    if (r <= prev + 0.5 || r > outer - 0.5) return
    radii.push(r)
  }
  // Coarse while the mask is still the water colour. The ring just before
  // the gradient sits one step back, so the first fading triangle is short.
  const solidEnd = gradAt - gradStep
  const solidStep = Math.max(gradStep * 3, (solidEnd - inner) / 3)
  for (let r = inner + solidStep; r < solidEnd; r += solidStep) push(r)
  push(solidEnd)
  push(gradAt)
  for (let r = gradAt + gradStep; r < outer - 0.5; r += gradStep) push(r)
  radii.push(outer)
  const n = Math.max(12, Math.ceil((outer * 2) / 128))
  const m = new MeshBuilder()
  const rings: number[][] = []
  for (const R of radii) {
    const u = Math.min(1, Math.max(0, (R - inner) / span))
    const ids: number[] = []
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < n; i++) {
        const t = -R + (2 * R * i) / n
        const x = s === 0 ? t : s === 1 ? R : s === 2 ? -t : -R
        const z = s === 0 ? R : s === 1 ? -t : s === 2 ? -R : t
        ids.push(m.add(x, z, u, 0.5))
      }
    }
    rings.push(ids)
  }
  const count = rings[0].length
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k]
    const b = rings[k + 1]
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count
      m.tri(a[i], b[i], b[j])
      m.tri(a[i], b[j], a[j])
    }
  }
  return finish(m, () => 0, name)
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
  // Bind-pose Y is 0. Include the crest so a bounds check does not throw the deformed mesh away.
  if (mesh.morphPos.length) {
    pMin[1] = Math.min(pMin[1], -AMP)
    pMax[1] = Math.max(pMax[1], AMP)
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
  const albedo = Buffer.alloc(W * H * 4)
  const glow = Buffer.alloc(W * H * 4)
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1)
    const t = smooth(Math.max(0, (u - 0.28) / 0.72))
    const water = 1 - t
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4
      albedo[o] = albedo[o + 1] = albedo[o + 2] = byte(water)
      albedo[o + 3] = 255
      glow[o] = glow[o + 1] = glow[o + 2] = byte(t)
      glow[o + 3] = 255
    }
  }
  writeFileSync(new URL('../' + WATER_FOG.horizonSrc, import.meta.url), png(W, H, albedo))
  writeFileSync(new URL('../' + WATER_FOG.horizonGlowSrc, import.meta.url), png(W, H, glow))

  const white = Buffer.alloc(2 * 2 * 4, 255)
  writeFileSync(new URL('../' + SURFACE.albedoSrc, import.meta.url), png(2, 2, white))
  writeRippleNormal()
  writeFoam()

  // glTF v=0 is the top of the image. The ring's bottom (waterline) uses v=0.
  const vw = 4
  const vh = 128
  const veil = Buffer.alloc(vw * vh * 4)
  for (let y = 0; y < vh; y++) {
    const v = y / (vh - 1)
    const rise = smooth(Math.min(1, v / 0.07))
    const fall = 1 - smooth(Math.max(0, (v - 0.28) / 0.5))
    const k = rise * fall
    for (let x = 0; x < vw; x++) {
      const o = (y * vw + x) * 4
      veil[o] = veil[o + 1] = veil[o + 2] = byte(k)
      veil[o + 3] = byte(k)
    }
  }
  writeFileSync(new URL('../' + WATER_FOG.hazeMask, import.meta.url), png(vw, vh, veil))
}

function rippleHeight(u: number, v: number): number {
  const tau = Math.PI * 2
  return (
    Math.sin(tau * (3 * u + 0.15 * Math.sin(tau * 2 * v))) * 0.5 +
    Math.sin(tau * (5 * v + 0.2)) * 0.28 +
    Math.sin(tau * (4 * u + 4 * v)) * 0.18 +
    Math.sin(tau * (2 * u - 3 * v)) * 0.16
  )
}

function writeRippleNormal() {
  const N = 128
  const rgba = Buffer.alloc(N * N * 4)
  const e = 1 / N
  const strength = 2.4
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      const hx = rippleHeight(u + e, v) - rippleHeight(u - e, v)
      const hy = rippleHeight(u, v + e) - rippleHeight(u, v - e)
      let nx = -hx * strength
      let ny = -hy * strength
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len
      const o = (y * N + x) * 4
      rgba[o] = byte(nx * 0.5 + 0.5)
      rgba[o + 1] = byte(ny * 0.5 + 0.5)
      rgba[o + 2] = byte(nz * 0.5 + 0.5)
      rgba[o + 3] = 255
    }
  }
  writeFileSync(new URL('../' + SURFACE.rippleSrc, import.meta.url), png(N, N, rgba))
}

function hash2(ix: number, iy: number, px: number, py: number): number {
  const x = ((ix % px) + px) % px
  const y = ((iy % py) + py) % py
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  n = Math.imul(n ^ (n >> 13), 1274126177)
  return ((n ^ (n >> 16)) >>> 0) / 4294967296
}

function vnoise(x: number, y: number, px: number, py: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0, px, py)
  const b = hash2(x0 + 1, y0, px, py)
  const c = hash2(x0, y0 + 1, px, py)
  const d = hash2(x0 + 1, y0 + 1, px, py)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function writeFoam() {
  const N = 128
  const rgba = Buffer.alloc(N * N * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N
      const v = y / N
      const n = vnoise(u * 3, v * 7, 3, 7) * 0.62 + vnoise(u * 6, v * 14, 6, 14) * 0.38
      const k = smooth(Math.min(1, Math.max(0, (n - 0.42) / 0.36)))
      const o = (y * N + x) * 4
      rgba[o] = rgba[o + 1] = rgba[o + 2] = 255
      rgba[o + 3] = byte(k)
    }
  }
  writeFileSync(new URL('../' + SURFACE.foamSrc, import.meta.url), png(N, N, rgba))
}

function hazeRing(): Built {
  const seg = 96
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const at = (i: number, j: number) => j * (seg + 1) + i
  for (let j = 0; j <= 1; j++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const s = Math.sin(a)
      const c = Math.cos(a)
      pos.push(s, j, c)
      nrm.push(-s, 0, -c)
      uv.push(i / seg, j === 0 ? 0 : 1)
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = at(i, 0)
    const b = at(i + 1, 0)
    const c = at(i, 1)
    const d = at(i + 1, 1)
    const abx = pos[b * 3] - pos[a * 3]
    const aby = pos[b * 3 + 1] - pos[a * 3 + 1]
    const abz = pos[b * 3 + 2] - pos[a * 3 + 2]
    const acx = pos[c * 3] - pos[a * 3]
    const acy = pos[c * 3 + 1] - pos[a * 3 + 1]
    const acz = pos[c * 3 + 2] - pos[a * 3 + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const inward = nx * nrm[a * 3] + ny * nrm[a * 3 + 1] + nz * nrm[a * 3 + 2]
    if (inward >= 0) idx.push(a, b, c, b, d, c)
    else idx.push(a, c, b, b, c, d)
  }
  return { name: 'Haze', pos, nrm, uv, idx, morphPos: [], morphNrm: [], tris: seg * 2 }
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

/** Angular slices. The same count on every ring keeps the shared circle welded. */
const SWELL_SEGS = 96

function radialEnvelope(x: number, z: number, inner: number, outer: number): number {
  if (!(outer > inner)) return 1
  const d = Math.hypot(x, z)
  if (d <= inner) return 1
  if (d >= outer) return 0
  return 1 - smooth((d - inner) / (outer - inner))
}

function linkRings(m: MeshBuilder, inner: number[], outer: number[]) {
  const n = inner.length
  for (let s = 0; s < n; s++) {
    const s2 = (s + 1) % n
    m.tri(inner[s], outer[s], outer[s2])
    m.tri(inner[s], outer[s2], inner[s2])
  }
}

/**
 * Round disk out to `diskOuter`, then a skirt to the square of half `squareHalf`
 * so the corners between the circle and the flat rim stay covered. Skirt rays
 * share the disk's outer ring, and the whole thing is one mesh so those
 * normals are computed from both sides.
 */
function swellSurface(diskOuter: number, squareHalf: number, step: number, segs: number): MeshBuilder {
  const m = new MeshBuilder()
  const nRings = Math.round(diskOuter / step)
  const radii: number[] = []
  for (let i = 0; i <= nRings; i++) radii.push(i * step)
  if (Math.abs(radii[radii.length - 1] - diskOuter) > 0.01) radii.push(diskOuter)
  const rings: number[][] = []
  for (const r of radii) {
    if (r === 0) {
      const [u, v] = seaUv(0, 0)
      rings.push([m.add(0, 0, u, v)])
      continue
    }
    const ring: number[] = []
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2
      const x = r * Math.cos(a)
      const z = r * Math.sin(a)
      const [u, v] = seaUv(x, z)
      ring.push(m.add(x, z, u, v))
    }
    rings.push(ring)
  }
  const center = rings[0][0]
  const first = rings[1]
  for (let s = 0; s < segs; s++) m.tri(center, first[s], first[(s + 1) % segs])
  for (let ri = 1; ri < rings.length - 1; ri++) linkRings(m, rings[ri], rings[ri + 1])
  if (squareHalf > diskOuter + 0.5) {
    const gap = squareHalf * Math.SQRT2 - diskOuter
    const nSteps = Math.max(1, Math.ceil(gap / step))
    let prev = rings[rings.length - 1]
    for (let i = 1; i <= nSteps; i++) {
      const t = i / nSteps
      const ring: number[] = []
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2
        const c = Math.cos(a)
        const sn = Math.sin(a)
        const reach = squareHalf / Math.max(Math.abs(c), Math.abs(sn))
        const r = diskOuter + (reach - diskOuter) * t
        const [u, v] = seaUv(c * r, sn * r)
        ring.push(m.add(c * r, sn * r, u, v))
      }
      linkRings(m, prev, ring)
      prev = ring
    }
  }
  return m
}

function takeTriangles(full: Built, corners: number[], name: string): Built {
  const map = new Map<number, number>()
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const morphPos = full.morphPos.map(() => [] as number[])
  const morphNrm = full.morphNrm.map(() => [] as number[])
  const use = (old: number): number => {
    const hit = map.get(old)
    if (hit !== undefined) return hit
    const n = pos.length / 3
    map.set(old, n)
    for (let k = 0; k < 3; k++) {
      pos.push(full.pos[old * 3 + k])
      nrm.push(full.nrm[old * 3 + k])
    }
    uv.push(full.uv[old * 2], full.uv[old * 2 + 1])
    for (let t = 0; t < full.morphPos.length; t++) {
      for (let k = 0; k < 3; k++) {
        morphPos[t].push(full.morphPos[t][old * 3 + k])
        morphNrm[t].push(full.morphNrm[t][old * 3 + k])
      }
    }
    return n
  }
  for (const old of corners) idx.push(use(old))
  return { name, pos, nrm, uv, idx, morphPos, morphNrm, tris: idx.length / 3 }
}

/** Split one finished disk so each file keeps the full-mesh normals on the shared circle. */
function splitDisk(full: Built, nearR: number, midR: number): { near: Built; mid: Built; far: Built } {
  const count = full.pos.length / 3
  const rad: number[] = []
  for (let i = 0; i < count; i++) rad.push(Math.hypot(full.pos[i * 3], full.pos[i * 3 + 2]))
  const buckets = { near: [] as number[], mid: [] as number[], far: [] as number[] }
  for (let t = 0; t < full.idx.length; t += 3) {
    const a = full.idx[t], b = full.idx[t + 1], c = full.idx[t + 2]
    const rm = Math.max(rad[a], rad[b], rad[c])
    const key = rm <= nearR + 0.05 ? 'near' : rm <= midR + 0.05 ? 'mid' : 'far'
    buckets[key].push(a, b, c)
  }
  return {
    near: takeTriangles(full, buckets.near, 'SwellNear'),
    mid: takeTriangles(full, buckets.mid, 'SwellMid'),
    far: takeTriangles(full, buckets.far, 'SwellFar'),
  }
}

function vertIndex(mesh: Built, x: number, z: number): number {
  for (let i = 0; i < mesh.pos.length; i += 3) {
    if (Math.abs(mesh.pos[i] - x) < 0.01 && Math.abs(mesh.pos[i + 2] - z) < 0.01) return i
  }
  return -1
}

function coversXZ(mesh: Built, x: number, z: number): boolean {
  const p = mesh.pos
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = mesh.idx[t], b = mesh.idx[t + 1], c = mesh.idx[t + 2]
    const ax = p[a * 3], az = p[a * 3 + 2]
    const bx = p[b * 3] - ax, bz = p[b * 3 + 2] - az
    const cx = p[c * 3] - ax, cz = p[c * 3 + 2] - az
    const px = x - ax, pz = z - az
    const d00 = bx * bx + bz * bz
    const d01 = bx * cx + bz * cz
    const d11 = cx * cx + cz * cz
    const d20 = px * bx + pz * bz
    const d21 = px * cx + pz * cz
    const denom = d00 * d11 - d01 * d01
    if (Math.abs(denom) < 1e-8) continue
    const v = (d11 * d20 - d01 * d21) / denom
    const w = (d00 * d21 - d01 * d20) / denom
    const u = 1 - v - w
    if (u >= -0.001 && v >= -0.001 && w >= -0.001) return true
  }
  return false
}

function makeSwells() {
  TARGETS = TRAINS.length * 2
  const step = WATER.swellNearStepM
  const disk = finish(
    swellSurface(WATER.swellMidM, WATER.swellFarM, step, SWELL_SEGS),
    (x, z) => radialEnvelope(x, z, WATER.swellNearM, WATER.swellFarM),
    'Swell',
  )
  const { near, mid, far } = splitDisk(disk, WATER.swellNearM, WATER.swellMidM)
  const lite = finish(
    swellSurface(WATER.swellNearM, WATER.swellNearM, WATER.swellMobileStepM, SWELL_SEGS),
    (x, z) => radialEnvelope(x, z, WATER.swellNearM - WATER.swellMobileFadeM, WATER.swellNearM),
    'SwellLite',
  )
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
  const weld = (a: Built, b: Built, x: number, z: number, label: string) => {
    const ia = vertIndex(a, x, z)
    const ib = vertIndex(b, x, z)
    if (ia < 0 || ib < 0) throw new Error(`${label} weld vertex missing`)
    for (let t = 0; t < a.morphNrm.length; t++) {
      for (let k = 0; k < 3; k++) {
        if (Math.abs(a.morphNrm[t][ia + k] - b.morphNrm[t][ib + k]) > 1e-4) {
          throw new Error(`${label} normals differ`)
        }
      }
    }
  }
  weld(near, mid, WATER.swellNearM, 0, 'near/mid')
  weld(mid, far, WATER.swellMidM, 0, 'mid/far')
  const corner = WATER.swellFarM * 0.78
  if (!coversXZ(far, corner, corner)) throw new Error('far skirt misses the square corner')
  if (!coversXZ(near, 40, 40)) throw new Error('near disk misses the centre')
  return { near, mid, far, lite }
}
writeTextures()
let deskTris = 0
let deskVerts = 0
let mobTris = 0
let mobVerts = 0
function emit(mesh: Built, rel: string): void {
  const bytes = writeGlb(mesh, new URL('../' + rel, import.meta.url))
  const s = report(mesh, bytes)
  if (rel === WATER.swellNearSrc || rel === WATER.swellMidSrc || rel === WATER.swellFarSrc || rel === WATER.swell48NearSrc || rel === WATER.swell48MidSrc || rel === WATER.swell48FarSrc) {
    deskTris += s.tris
    deskVerts += s.verts
  }
  if (rel === WATER.flatSrc) deskTris += s.tris
  if (rel === WATER.swellLiteSrc || rel === WATER.swell48LiteSrc) {
    mobTris += s.tris
    mobVerts += s.verts
  }
  if (rel === WATER.flatLiteSrc) mobTris += s.tris
}
const swells110 = makeSwells()
emit(swells110.near, WATER.swellNearSrc)
emit(swells110.mid, WATER.swellMidSrc)
emit(swells110.far, WATER.swellFarSrc)
emit(swells110.lite, WATER.swellLiteSrc)
TRAINS = SWELL_PARTS_48
AMP = SWELL_48_AMPLITUDE_M
CLIP = SWELL_48_PERIOD_S
NORM = SWELL_NORM_48
const swells48 = makeSwells()
emit(swells48.near, WATER.swell48NearSrc)
emit(swells48.mid, WATER.swell48MidSrc)
emit(swells48.far, WATER.swell48FarSrc)
emit(swells48.lite, WATER.swell48LiteSrc)
// Short rims (the 20×20 sea) need a finer step or one triangle jumps the fade.
const rimStep = (inner: number) => Math.max(1, Math.min(8, Math.floor((SEA_HALF - inner) * 0.06)))
const flat = flatRing(WATER.swellFarM - FLAT_OVERLAP, SEA_HALF, rimStep(WATER.swellFarM - FLAT_OVERLAP), 'FlatSea')
const flatLite = flatRing(WATER.swellNearM - FLAT_OVERLAP, SEA_HALF, rimStep(WATER.swellNearM - FLAT_OVERLAP), 'FlatLite')
const haze = hazeRing()
emit(flat, WATER.flatSrc)
emit(flatLite, WATER.flatLiteSrc)
emit(haze, WATER_FOG.hazeSrc)
function gradientSpan(mesh: Built): number {
  let worst = 0
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const us = [0, 1, 2].map((k) => mesh.uv[mesh.idx[t + k] * 2])
    const maxU = Math.max(...us)
    const minU = Math.min(...us)
    if (maxU >= 0.28) worst = Math.max(worst, maxU - minU)
  }
  return worst
}
for (const mesh of [flat, flatLite]) {
  const du = gradientSpan(mesh)
  if (du > 0.1) throw new Error(`${mesh.name} gradient jumps ${du.toFixed(3)} of the fade in one triangle`)
  console.log(`${mesh.name} gradient step ${du.toFixed(3)}`)
}

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

console.log(`swell norm ${NORM.toFixed(3)}  trains ${TRAINS.length}  clip ${CLIP}s`)
console.log(`desktop swell+flat tris ${deskTris}  morph verts ${deskVerts}`)
console.log(`mobile swell+flat tris ${mobTris}  morph verts ${mobVerts}`)
console.log(`sea half ${SEA_HALF.toFixed(0)}m  far ring ${WATER.swellFarM}m`)
