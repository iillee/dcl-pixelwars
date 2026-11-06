/**
 * Bake swell UVs as metres / 60 so the soft normal repeats broadly, and
 * write that normal. Morph buffers are left alone. The flat rim is not
 * touched, so its horizon fade stays put.
 *
 * Run: node scripts/patch-swell-foam-uv.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

const TILE_M = 60

function patch(path) {
  const buf = readFileSync(path)
  const jlen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.slice(20, 20 + jlen).toString())
  const binOff = 20 + jlen
  const binLen = buf.readUInt32LE(binOff)
  const bin = Buffer.from(buf.slice(binOff + 8, binOff + 8 + binLen))
  const prim = json.meshes[0].primitives[0]
  const posA = json.accessors[prim.attributes.POSITION]
  const uvA = json.accessors[prim.attributes.TEXCOORD_0]
  const posV = json.bufferViews[posA.bufferView]
  const uvV = json.bufferViews[uvA.bufferView]
  const posStart = (posV.byteOffset || 0) + (posA.byteOffset || 0)
  const uvStart = (uvV.byteOffset || 0) + (uvA.byteOffset || 0)
  for (let i = 0; i < posA.count; i++) {
    const x = bin.readFloatLE(posStart + i * 12)
    const z = bin.readFloatLE(posStart + i * 12 + 8)
    bin.writeFloatLE(x / TILE_M, uvStart + i * 8)
    bin.writeFloatLE(z / TILE_M, uvStart + i * 8 + 4)
  }
  bin.copy(buf, binOff + 8)
  writeFileSync(path, buf)
  console.log('uv', path, posA.count, `tile ${TILE_M}m`)
}

for (const name of ['near', 'mid', 'far', 'lite']) patch(`assets/models/water-swell-48-${name}.glb`)

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[(w * 4 + 1) * y] = 0
    rgba.copy(raw, (w * 4 + 1) * y + 1, y * w * 4, (y + 1) * w * 4)
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([t, data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE((crc32(body) >>> 0))
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

function hash(ix, iy) {
  let n = ix * 374761393 + iy * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  return ((n ^ (n >> 16)) >>> 0) / 4294967296
}

function noise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1)
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

const W = 128
const cap = Buffer.alloc(W * W * 4)
function blob(u, v, cx, cy, rx, ry) {
  const dx = (u - cx) / rx
  const dy = (v - cy) / ry
  return dx * dx + dy * dy < 1 ? 1 : 0
}
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W
    const v = (y + 0.5) / W
    let k = Math.max(
      blob(u, v, 0.42, 0.55, 0.28, 0.22),
      blob(u, v, 0.68, 0.42, 0.2, 0.18),
      blob(u, v, 0.5, 0.28, 0.16, 0.14),
    )
    if (k && noise(u * 5, v * 5) < 0.22) k = 0
    const o = (y * W + x) * 4
    cap[o] = cap[o + 1] = cap[o + 2] = 255
    cap[o + 3] = k ? 255 : 0
  }
}
writeFileSync('assets/textures/water-whitecap.png', png(W, W, cap))

const R = 128
const ring = Buffer.alloc(R * R * 4)
for (let y = 0; y < R; y++) {
  for (let x = 0; x < R; x++) {
    const u = x / (R - 1) - 0.5
    const v = y / (R - 1) - 0.5
    const d = Math.hypot(u, v) * 2
    const ang = Math.atan2(v, u)
    const wobble = 0.06 * Math.sin(ang * 5) + 0.04 * Math.sin(ang * 9 + 1.3)
    const edge = 0.96 + wobble
    const inner = 0.46
    let k = d > inner && d < edge ? 1 : 0
    if (k && noise(Math.cos(ang) * 2 + 4, Math.sin(ang) * 2 + 2) < 0.18) k = 0
    const o = (y * R + x) * 4
    ring[o] = ring[o + 1] = ring[o + 2] = 255
    ring[o + 3] = k ? 255 : 0
  }
}
writeFileSync('assets/textures/water-foam-ring.png', png(R, R, ring))
console.log('foam textures')

function softHeight(u, v) {
  const tau = Math.PI * 2
  return Math.sin(tau * u) * 0.55 + Math.sin(tau * v) * 0.35 + Math.sin(tau * (u + v)) * 0.22
}

const N = 128
const soft = Buffer.alloc(N * N * 4)
const e = 1 / N
const strength = 0.45
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const u = x / N
    const v = y / N
    const hx = softHeight(u + e, v) - softHeight(u - e, v)
    const hy = softHeight(u, v + e) - softHeight(u, v - e)
    let nx = -hx * strength
    let ny = -hy * strength
    let nz = 1
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const o = (y * N + x) * 4
    soft[o] = Math.round((nx * 0.5 + 0.5) * 255)
    soft[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
    soft[o + 2] = Math.round((nz * 0.5 + 0.5) * 255)
    soft[o + 3] = 255
  }
}
writeFileSync('assets/textures/water-soft-normal.png', png(N, N, soft))
console.log('soft normal')
