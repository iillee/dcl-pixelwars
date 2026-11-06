/**
 * Point the live 48 m swell UVs along the primary train, and write the
 * foam textures. Morph buffers are left alone, so the meshes stay small.
 *
 * Run: node scripts/patch-swell-foam-uv.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

const WL = 720
const RAD = (15 * Math.PI) / 180
const DX = Math.cos(RAD)
const DZ = Math.sin(RAD)
const PX = -DZ
const PZ = DX

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
    const along = x * DX + z * DZ
    const across = x * PX + z * PZ
    bin.writeFloatLE(along / WL, uvStart + i * 8)
    bin.writeFloatLE(across / 160, uvStart + i * 8 + 4)
  }
  bin.copy(buf, binOff + 8)
  writeFileSync(path, buf)
  console.log('uv', path, posA.count)
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
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const u = x / W
    const v = y / W
    const band = Math.exp(-((u - 0.5) ** 2) / (2 * 0.045 ** 2))
    const n = noise(u * 7, v * 4)
    const broken = n > 0.35 ? (n - 0.35) / 0.65 : 0.15 * n
    const k = band * broken
    const o = (y * W + x) * 4
    cap[o] = cap[o + 1] = cap[o + 2] = Math.round(k * 255)
    cap[o + 3] = 255
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
    const wobble = 0.08 * Math.sin(ang * 5) + 0.05 * Math.sin(ang * 11 + 1.3)
    const edge = 0.72 + wobble
    const inner = 0.38
    let k = 0
    if (d > inner && d < edge) {
      const rim = Math.min(1, (d - inner) / 0.12, (edge - d) / 0.1)
      const n = noise(Math.cos(ang) * 3 + 4, Math.sin(ang) * 3 + 2)
      k = rim * (0.45 + 0.55 * n)
    }
    const o = (y * R + x) * 4
    ring[o] = ring[o + 1] = ring[o + 2] = 255
    ring[o + 3] = Math.round(Math.max(0, Math.min(1, k)) * 255)
  }
}
writeFileSync('assets/textures/water-foam-ring.png', png(R, R, ring))
console.log('foam textures')
