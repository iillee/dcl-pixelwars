/**
 * Simulate what a Unity-explorer camera sees on the four lobby title planes,
 * composited onto the uniform pills.
 *
 * Vertex and default UV layout from decentraland/unity-explorer PlaneFactory.cs.
 * Billboard yaw from BillboardSystem.cs (BM_Y → LookRotation(pos - camera),
 * so +Z points away from the camera and the camera sees the −Z front face).
 *
 * Usage: npx tsx scripts/preview-sign-uvs.ts [texturesDir] [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { SIGN_H_M, SIGN_TITLE_PAD_M, SIGN_W_M, signTitlePlane, signTitleScale } from '../src/shared/lobby.ts'
import { TEAM_HEX, Team } from '../src/shared/team.ts'

const here = dirname(fileURLToPath(import.meta.url))

const DEFAULT_UVS: [number, number][] = [
  [0, 0], [0, 1], [1, 1], [1, 0],
  [1, 0], [1, 1], [0, 1], [0, 0],
]

const TITLES: { name: string; file: string; hex: string }[] = [
  { name: 'RED', file: 'sign-title-red.png', hex: TEAM_HEX[Team.Red] },
  { name: 'BLUE', file: 'sign-title-blue.png', hex: TEAM_HEX[Team.Blue] },
  { name: 'GREEN', file: 'sign-title-green.png', hex: TEAM_HEX[Team.Green] },
  { name: 'YELLOW', file: 'sign-title-yellow.png', hex: TEAM_HEX[Team.Yellow] },
]

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function writePng(path: string, width: number, height: number, rgba: Buffer): void {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[(width * 4 + 1) * y] = 0
    rgba.copy(raw, (width * 4 + 1) * y + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = zlib.deflateSync(raw)
  const chunks: Buffer[] = []
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  function chunk(type: string, data: Buffer) {
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

type Pix = { width: number; height: number; rgba: Buffer }

function decodePng(buf: Buffer): Pix {
  if (buf[0] !== 137 || buf[1] !== 80) throw new Error('not a png')
  let off = 8
  let width = 0, height = 0, depth = 0, ctype = 0
  const idats: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); off += 4
    const type = buf.slice(off, off + 4).toString('ascii'); off += 4
    const data = buf.slice(off, off + len); off += len
    off += 4
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      ctype = data[9]
    } else if (type === 'IDAT') idats.push(data)
    else if (type === 'IEND') break
  }
  const raw = zlib.inflateSync(Buffer.concat(idats))
  const channels = ctype === 6 ? 4 : ctype === 2 ? 3 : 1
  if (depth !== 8 || (ctype !== 6 && ctype !== 2)) throw new Error(`unsupported png type=${ctype} depth=${depth}`)
  const rgba = Buffer.alloc(width * height * 4)
  let src = 0
  const bpp = channels
  const stride = width * bpp
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  const paeth = (a: number, b: number, c: number) => {
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
        rgba[o] = cur[x * 3]; rgba[o + 1] = cur[x * 3 + 1]; rgba[o + 2] = cur[x * 3 + 2]; rgba[o + 3] = 255
      }
    }
    cur.copy(prev)
  }
  return { width, height, rgba }
}

function sample(tex: Pix, u: number, v: number): number[] {
  const x = u * (tex.width - 1)
  const y = (1 - v) * (tex.height - 1)
  const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(y)))
  const x1 = Math.min(x0 + 1, tex.width - 1)
  const y1 = Math.min(y0 + 1, tex.height - 1)
  const sx = x - x0, sy = y - y0
  const at = (xx: number, yy: number) => {
    const o = (yy * tex.width + xx) * 4
    return [tex.rgba[o], tex.rgba[o + 1], tex.rgba[o + 2], tex.rgba[o + 3]]
  }
  const p00 = at(x0, y0), p10 = at(x1, y0), p01 = at(x0, y1), p11 = at(x1, y1)
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t)
  return mix(mix(p00, p10, sx), mix(p01, p11, sx), sy).map(v => Math.round(v))
}

function rasterFace(tex: Pix, uvs: [number, number][], outW: number, outH: number): Pix {
  const rgba = Buffer.alloc(outW * outH * 4)
  const [uv_ll, uv_ul, uv_ur, uv_lr] = uvs
  for (let j = 0; j < outH; j++) {
    const ty = 1 - (j + 0.5) / outH
    for (let i = 0; i < outW; i++) {
      const tx = (i + 0.5) / outW
      const u0 = uv_ll[0] * (1 - tx) + uv_lr[0] * tx
      const v0 = uv_ll[1] * (1 - tx) + uv_lr[1] * tx
      const u1 = uv_ul[0] * (1 - tx) + uv_ur[0] * tx
      const v1 = uv_ul[1] * (1 - tx) + uv_ur[1] * tx
      const u = u0 * (1 - ty) + u1 * ty
      const v = v0 * (1 - ty) + v1 * ty
      const p = sample(tex, u, v)
      if (p[3] < 12) continue
      const o = (j * outW + i) * 4
      rgba[o] = p[0]; rgba[o + 1] = p[1]; rgba[o + 2] = p[2]; rgba[o + 3] = p[3]
    }
  }
  return { width: outW, height: outH, rgba }
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function roundedPill(w: number, h: number, rgb: [number, number, number]): Pix {
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

function blit(dst: Pix, src: Pix, x0: number, y0: number): void {
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

function fill(dst: Pix, rgb: [number, number, number]): void {
  for (let i = 0; i < dst.width * dst.height; i++) {
    dst.rgba[i * 4] = rgb[0]
    dst.rgba[i * 4 + 1] = rgb[1]
    dst.rgba[i * 4 + 2] = rgb[2]
    dst.rgba[i * 4 + 3] = 255
  }
}

function lookRotation(forward: number[]) {
  const len = Math.hypot(forward[0], forward[1], forward[2]) || 1
  const f = [forward[0] / len, forward[1] / len, forward[2] / len]
  const up = [0, 1, 0]
  let r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]]
  const rl = Math.hypot(r[0], r[1], r[2]) || 1
  r = [r[0] / rl, r[1] / rl, r[2] / rl]
  return { forward: f, right: r }
}

function assertFrontFacing(): void {
  const f = lookRotation([0 - 0, 0, 0 - (-8)]).forward
  if (Math.abs(f[0]) > 1e-6 || Math.abs(f[1]) > 1e-6 || f[2] < 0.99) {
    throw new Error(`BM_Y should aim +Z away from a camera at (0,_,-8), got ${f}`)
  }
}

function resolveTexturesDir(arg?: string): string {
  const candidates = [
    arg,
    join(here, '..', 'assets', 'textures'),
    '/tmp/pw/sign-titles',
  ].filter(Boolean) as string[]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'sign-title-red.png'))) return dir
  }
  throw new Error('could not find sign-title-red.png (pass the textures dir)')
}

assertFrontFacing()
const texDir = resolveTexturesDir(process.argv[2])
const outDir = process.argv[3] || join(here, '..', 'tmp-sign-previews')
mkdirSync(outDir, { recursive: true })

const PX = 28
const pillW = Math.round(SIGN_W_M * PX)
const pillH = Math.round(SIGN_H_M * PX)
const pad = 28
const gap = 36
const cards: Pix[] = []
for (const t of TITLES) {
  const tex = decodePng(readFileSync(join(texDir, t.file)))
  const plane = signTitlePlane(t.name)
  const tw = Math.max(2, Math.round(plane.w * PX))
  const th = Math.max(2, Math.round(plane.h * PX))
  const title = rasterFace(tex, DEFAULT_UVS, tw, th)
  const pill = roundedPill(pillW, pillH, parseHex(t.hex))
  blit(pill, title, Math.round((pillW - tw) / 2), Math.round((pillH - th) / 2))
  cards.push(pill)
  console.log(t.name, 'pill', pillW, 'x', pillH, 'plane', tw, 'x', th, 'sidePx', Math.round((pillW - tw) / 2))
}

const W = pad * 2 + pillW * 4 + gap * 3
const H = pad * 2 + pillH
const canvas: Pix = { width: W, height: H, rgba: Buffer.alloc(W * H * 4) }
fill(canvas, [143, 208, 255])
let x = pad
for (const im of cards) {
  blit(canvas, im, x, pad)
  x += pillW + gap
}
const out = join(outDir, 'sign-titles-sim.png')
writePng(out, canvas.width, canvas.height, canvas.rgba)
console.log('wrote', out, canvas.width, 'x', canvas.height)
console.log('shared pill', SIGN_W_M.toFixed(3), 'x', SIGN_H_M.toFixed(3), 'pad', SIGN_TITLE_PAD_M.toFixed(3), 'scale', signTitleScale())
