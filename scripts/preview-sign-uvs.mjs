/**
 * Simulate what a Unity-explorer camera sees on the four lobby title planes.
 *
 * Vertex and default UV layout from:
 *   decentraland/unity-explorer PlaneFactory.cs (dev)
 * Billboard yaw from:
 *   decentraland/unity-explorer BillboardSystem.cs (BM_Y → LookRotation(pos - camera),
 *   so transform +Z points away from the camera and the camera sees the −Z front face).
 *
 * Usage:
 *   node scripts/preview-sign-uvs.mjs [texturesDir] [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))

// PlaneFactory.cs — PrimitivesSize.PLANE_SIZE is (1, 1, 0.01)
const HX = 0.5, HY = 0.5
const VERTS = [
  [-HX, -HY, 0], // 0 front lower-left,  normal (0,0,-1)
  [-HX,  HY, 0], // 1 front upper-left
  [ HX,  HY, 0], // 2 front upper-right
  [ HX, -HY, 0], // 3 front lower-right
  [ HX, -HY, 0], // 4 back  lower-right, normal (0,0,+1)
  [ HX,  HY, 0], // 5 back  upper-right
  [-HX,  HY, 0], // 6 back  upper-left
  [-HX, -HY, 0], // 7 back  lower-left
]
const DEFAULT_UVS = [
  [0, 0], [0, 1], [1, 1], [1, 0],
  [1, 0], [1, 1], [0, 1], [0, 0],
]
// Materials docs list corners as LL, LR, UR, UL — that is NOT the mesh vertex order.
const DOCS_UVS = [
  [0, 0], [1, 0], [1, 1], [0, 1],
  [1, 0], [0, 0], [0, 1], [1, 1],
]

const META = {
  RED:    { file: 'sign-title-red.png',    w: 9.8154, h: 4.4383, rgba: [255, 117, 119] },
  BLUE:   { file: 'sign-title-blue.png',   w: 12.2572, h: 4.4717, rgba: [106, 153, 252] },
  GREEN:  { file: 'sign-title-green.png',  w: 16.0238, h: 4.5051, rgba: [79, 214, 140] },
  YELLOW: { file: 'sign-title-yellow.png', w: 20.3396, h: 4.5051, rgba: [255, 224, 74] },
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function writePng(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[(width * 4 + 1) * y] = 0
    rgba.copy(raw, (width * 4 + 1) * y + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = zlib.deflateSync(raw)
  const chunks = []
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    chunks.push(len, td, crc)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  chunk('IHDR', ihdr)
  chunk('IDAT', compressed)
  chunk('IEND', Buffer.alloc(0))
  writeFileSync(path, Buffer.concat([sig, ...chunks]))
}

// Minimal PNG reader (8-bit RGBA or RGB or paletted-enough via only RGBA/RGB/GA)
function readPng(path) {
  const { createCanvas, loadImage } = tryCanvas()
  if (loadImage) {
    // unused
  }
  return decodePng(readFileSync(path))
}

function decodePng(buf) {
  if (buf[0] !== 137 || buf[1] !== 80) throw new Error('not a png')
  let off = 8
  let width = 0, height = 0, depth = 0, ctype = 0
  const idats = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); off += 4
    const type = buf.slice(off, off + 4).toString('ascii'); off += 4
    const data = buf.slice(off, off + len); off += len
    off += 4 // crc
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
    } else if (type === 'IDAT') idats.push(data)
    else if (type === 'IEND') break
  }
  const raw = zlib.inflateSync(Buffer.concat(idats))
  const channels = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : 1
  if (depth !== 8 || (ctype !== 6 && ctype !== 2)) {
    throw new Error(`unsupported png type=${ctype} depth=${depth}`)
  }
  const rgba = Buffer.alloc(width * height * 4)
  let src = 0
  const bpp = channels
  const stride = width * bpp
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    raw.copy(cur, 0, src, src + stride)
    src += stride
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0
      const up = prev[i]
      const upleft = i >= bpp ? prev[i - bpp] : 0
      let v = cur[i]
      if (filter === 1) v = (v + left) & 255
      else if (filter === 2) v = (v + up) & 255
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 255
      else if (filter === 4) v = (v + paeth(left, up, upleft)) & 255
      cur[i] = v
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (channels === 4) cur.copy(rgba, o, x * 4, x * 4 + 4)
      else {
        rgba[o] = cur[x * 3]
        rgba[o + 1] = cur[x * 3 + 1]
        rgba[o + 2] = cur[x * 3 + 2]
        rgba[o + 3] = 255
      }
    }
    cur.copy(prev)
  }
  return { width, height, rgba }
}

function tryCanvas() { return {} }

function sample(tex, u, v) {
  const x = u * (tex.width - 1)
  const y = (1 - v) * (tex.height - 1) // Unity: V=0 is the bottom of the texture
  const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(y)))
  const x1 = Math.min(x0 + 1, tex.width - 1)
  const y1 = Math.min(y0 + 1, tex.height - 1)
  const sx = x - x0, sy = y - y0
  const at = (xx, yy) => {
    const o = (yy * tex.width + xx) * 4
    return [tex.rgba[o], tex.rgba[o + 1], tex.rgba[o + 2], tex.rgba[o + 3]]
  }
  const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1)
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t)
  return mix(mix(p00, p10, sx), mix(p01, p11, sx), sy).map(v => Math.round(v))
}

function rasterFace(tex, uvs, scale, outW, outH) {
  const rgba = Buffer.alloc(outW * outH * 4)
  const [uv_ll, uv_ul, uv_ur, uv_lr] = uvs
  const sx = scale[0], sy = scale[1]
  for (let j = 0; j < outH; j++) {
    const fy = 1 - (j + 0.5) / outH
    const y = (fy - 0.5) * sy
    const ty = (y + sy / 2) / sy
    for (let i = 0; i < outW; i++) {
      const fx = (i + 0.5) / outW
      const x = (fx - 0.5) * sx
      const tx = (x + sx / 2) / sx
      const u0 = uv_ll[0] * (1 - tx) + uv_lr[0] * tx
      const v0 = uv_ll[1] * (1 - tx) + uv_lr[1] * tx
      const u1 = uv_ul[0] * (1 - tx) + uv_ur[0] * tx
      const v1 = uv_ul[1] * (1 - tx) + uv_ur[1] * tx
      const u = u0 * (1 - ty) + u1 * ty
      const v = v0 * (1 - ty) + v1 * ty
      const p = sample(tex, u, v)
      const o = (j * outW + i) * 4
      if (p[3] < 12) continue
      rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; rgba[o + 3] = p[3]
    }
  }
  return { width: outW, height: outH, rgba }
}

function roundedPill(w, h, rgb) {
  const rgba = Buffer.alloc(w * h * 4)
  const r = Math.floor(h / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = true
      if (x < r && y < r) inside = (x - r) ** 2 + (y - r) ** 2 <= r * r
      else if (x >= w - r && y < r) inside = (x - (w - 1 - r)) ** 2 + (y - r) ** 2 <= r * r
      else if (x < r && y >= h - r) inside = (x - r) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
      else if (x >= w - r && y >= h - r) inside = (x - (w - 1 - r)) ** 2 + (y - (h - 1 - r)) ** 2 <= r * r
      if (!inside) continue
      const o = (y * w + x) * 4
      rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255
    }
  }
  return { width: w, height: h, rgba }
}

function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x
      if (dx < 0 || dx >= dst.width) continue
      const so = (y * src.width + x) * 4
      const a = src.rgba[so + 3]
      if (a < 12) continue
      const dos = (dy * dst.width + dx) * 4
      const inv = 1 - a / 255
      dst.rgba[dos] = Math.round(src.rgba[so] * (a / 255) + dst.rgba[dos] * inv)
      dst.rgba[dos + 1] = Math.round(src.rgba[so + 1] * (a / 255) + dst.rgba[dos + 1] * inv)
      dst.rgba[dos + 2] = Math.round(src.rgba[so + 2] * (a / 255) + dst.rgba[dos + 2] * inv)
      dst.rgba[dos + 3] = 255
    }
  }
}

function fill(dst, rgb) {
  for (let i = 0; i < dst.width * dst.height; i++) {
    dst.rgba[i * 4] = rgb[0]
    dst.rgba[i * 4 + 1] = rgb[1]
    dst.rgba[i * 4 + 2] = rgb[2]
    dst.rgba[i * 4 + 3] = 255
  }
}

function rowOf(textures, uvs, scalePx, pad = 28, pillPad = 18, gap = 36) {
  const cards = []
  for (const word of ['RED', 'BLUE', 'GREEN', 'YELLOW']) {
    const m = META[word]
    const pw = Math.round(m.w * scalePx)
    const ph = Math.round(m.h * scalePx)
    const title = rasterFace(textures[word], uvs, [m.w, m.h], pw, ph)
    const pill = roundedPill(pw + pillPad * 2, ph + pillPad * 2, m.rgba)
    blit(pill, title, pillPad, pillPad)
    cards.push(pill)
  }
  const W = pad * 2 + cards.reduce((s, c) => s + c.width, 0) + gap * 3
  const H = pad * 2 + Math.max(...cards.map(c => c.height))
  const canvas = { width: W, height: H, rgba: Buffer.alloc(W * H * 4) }
  fill(canvas, [143, 208, 255])
  let x = pad
  const maxH = Math.max(...cards.map(c => c.height))
  for (const im of cards) {
    blit(canvas, im, x, pad + Math.floor((maxH - im.height) / 2))
    x += im.width + gap
  }
  return canvas
}

function lookRotation(forward) {
  // Unity Quaternion.LookRotation(forward) with world up. Used by BillboardSystem.
  const len = Math.hypot(forward[0], forward[1], forward[2]) || 1
  const f = [forward[0] / len, forward[1] / len, forward[2] / len]
  const up = [0, 1, 0]
  let r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]]
  const rl = Math.hypot(r[0], r[1], r[2]) || 1
  r = [r[0] / rl, r[1] / rl, r[2] / rl]
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]
  // columns of the rotation matrix are right, up, forward (+X,+Y,+Z)
  return { right: r, up: u, forward: f }
}

function billboardY(signPos, cameraPos) {
  // BillboardSystem: billboardForward = signPos - cameraPos, y zeroed
  const f = [signPos[0] - cameraPos[0], 0, signPos[2] - cameraPos[2]]
  return lookRotation(f)
}

function assertFrontFacing() {
  const rot = billboardY([0, 0, 0], [0, 1.6, -8])
  const z = rot.forward
  if (Math.abs(z[0]) > 1e-6 || Math.abs(z[1]) > 1e-6 || z[2] < 0.99) {
    throw new Error(`BM_Y should aim +Z away from a camera at (0,_,-8), got ${z}`)
  }
  // camera looks along world +Z, so it sees the plane's -Z face (vertices 0-3)
}

function resolveTexturesDir(arg) {
  const candidates = [
    arg,
    join(here, '..', 'assets', 'textures'),
    join(here, '..', '..', 'sign-titles'),
    '/tmp/pw/sign-titles',
  ].filter(Boolean)
  for (const dir of candidates) {
    if (existsSync(join(dir, 'sign-title-red.png'))) return dir
  }
  throw new Error('could not find sign-title-red.png (pass the textures dir as argv[2])')
}

const texDir = resolveTexturesDir(process.argv[2])
const outDir = process.argv[3] || join(here, '..', 'tmp-sign-previews')
mkdirSync(outDir, { recursive: true })
assertFrontFacing()

const textures = {}
for (const word of Object.keys(META)) {
  const file = join(texDir, META[word].file)
  textures[word] = readPng(file)
  console.log('loaded', file, textures[word].width, 'x', textures[word].height)
}

const good = rowOf(textures, DEFAULT_UVS, 36)
const bad = rowOf(textures, DOCS_UVS, 36)
writePng(join(outDir, 'sign-titles-sim.png'), good.width, good.height, good.rgba)
writePng(join(outDir, 'sign-titles-sim-docs-uvs.png'), bad.width, bad.height, bad.rgba)
console.log('wrote', join(outDir, 'sign-titles-sim.png'), good.width, 'x', good.height)
console.log('wrote', join(outDir, 'sign-titles-sim-docs-uvs.png'), bad.width, 'x', bad.height)
console.log('mapping: PlaneFactory default UVs, BM_Y camera sees -Z front, all four upright LTR')
