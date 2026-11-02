/**
 * build-ghost-glbs.mjs — red and blue ghost bodies.
 *
 * A Pac-Man ghost stretched a little taller: round crown, straight skirt,
 * four-wave hem. Eyes are not in the file. client/ghostFace.ts draws them
 * on these anchors so the expression can change. Keep the anchors in sync.
 *
 * Run: node scripts/build-ghost-glbs.mjs
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

export const R = 0.48
export const WAVE = 0.2
export const SKIRT_LEN = 0.88
export const SKIRT_TOP = WAVE + SKIRT_LEN
export const HEIGHT = SKIRT_TOP + R
/** Face anchors in model space. +Z is forward. */
export const EYE = { x: 0.185, y: 0.96, z: 0.56 }

const TH = 48
const SKIRT_STACKS = 16
const DOME_STACKS = 10
const WAVES = 4

const RED = [255 / 255, 117 / 255, 119 / 255]
const BLUE = [106 / 255, 153 / 255, 252 / 255]

function hem(theta) {
  return WAVE * (0.5 - 0.5 * Math.cos(WAVES * theta))
}

function buildBody() {
  const pos = []
  const ring = (y, r) => {
    const start = pos.length / 3
    for (let i = 0; i < TH; i++) {
      const t = (i / TH) * Math.PI * 2
      pos.push(Math.sin(t) * r, y, Math.cos(t) * r)
    }
    return start
  }
  const rings = []
  for (let s = 0; s <= SKIRT_STACKS; s++) {
    const v = s / SKIRT_STACKS
    const ys = []
    const start = pos.length / 3
    for (let i = 0; i < TH; i++) {
      const t = (i / TH) * Math.PI * 2
      const y = hem(t) * (1 - v) + SKIRT_TOP * v
      const radius = R * (1.03 - 0.03 * v)
      pos.push(Math.sin(t) * radius, y, Math.cos(t) * radius)
      ys.push(y)
    }
    rings.push(start)
    void ys
  }
  for (let s = 1; s < DOME_STACKS; s++) {
    const phi = (s / DOME_STACKS) * (Math.PI / 2)
    rings.push(ring(SKIRT_TOP + R * Math.sin(phi), R * Math.cos(phi)))
  }
  const apex = pos.length / 3
  pos.push(0, SKIRT_TOP + R, 0)

  const idx = []
  const quad = (a, b) => {
    for (let i = 0; i < TH; i++) {
      const i2 = (i + 1) % TH
      const a0 = a + i, a1 = a + i2, b0 = b + i, b1 = b + i2
      // Outward: up × increasing-theta points inward, so flip.
      idx.push(a0, a1, b0, a1, b1, b0)
    }
  }
  for (let s = 0; s < rings.length - 1; s++) quad(rings[s], rings[s + 1])
  const top = rings[rings.length - 1]
  for (let i = 0; i < TH; i++) {
    const i2 = (i + 1) % TH
    idx.push(top + i, top + i2, apex)
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) }
}

function normals(pos, idx) {
  const n = new Float32Array(pos.length)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
    const ax = pos[b] - pos[a], ay = pos[b + 1] - pos[a + 1], az = pos[b + 2] - pos[a + 2]
    const bx = pos[c] - pos[a], by = pos[c + 1] - pos[a + 1], bz = pos[c + 2] - pos[a + 2]
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz
  }
  let inward = 0, checked = 0
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= len; n[i + 1] /= len; n[i + 2] /= len
    const ox = pos[i], oz = pos[i + 2]
    if (ox * ox + oz * oz > 0.04) {
      checked++
      if (n[i] * ox + n[i + 2] * oz < 0) inward++
    }
  }
  if (inward > checked * 0.02) throw new Error(`normals point inward (${inward}/${checked})`)
  return n
}

function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k])
      max[k] = Math.max(max[k], pos[i + k])
    }
  }
  return { min, max }
}

function glb(pos, nrm, idx, color) {
  const { min, max } = bounds(pos)
  const bin = Buffer.alloc(pos.byteLength + nrm.byteLength + idx.byteLength + 4)
  Buffer.from(pos.buffer).copy(bin, 0)
  Buffer.from(nrm.buffer).copy(bin, pos.byteLength)
  const iOff = pos.byteLength + nrm.byteLength
  Buffer.from(idx.buffer).copy(bin, iOff)
  const pad = (4 - (bin.length % 4)) % 4
  const json = {
    asset: { version: '2.0', generator: 'pixelwars build-ghost-glbs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Ghost', mesh: 0 }],
    meshes: [{
      name: 'Ghost',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    }],
    materials: [{
      name: 'body',
      pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.62 },
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength },
      { buffer: 0, byteOffset: iOff, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: bin.length - pad }],
  }
  const jsonBuf = Buffer.from(JSON.stringify(json))
  const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const total = 12 + 8 + jsonPad.length + 8 + bin.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonPad.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  jsonPad.copy(out, 20)
  const bOff = 20 + jsonPad.length
  out.writeUInt32LE(bin.length, bOff)
  out.writeUInt32LE(0x004e4942, bOff + 4)
  bin.copy(out, bOff + 8)
  return out
}

function sphere(cx, cy, cz, sx, sy, sz, color, stacks = 8, slices = 12) {
  const pos = [], col = [], idx = []
  for (let s = 0; s <= stacks; s++) {
    const v = s / stacks
    const phi = v * Math.PI
    for (let i = 0; i <= slices; i++) {
      const t = (i / slices) * Math.PI * 2
      const x = Math.sin(phi) * Math.cos(t)
      const y = Math.cos(phi)
      const z = Math.sin(phi) * Math.sin(t)
      pos.push(cx + x * sx, cy + y * sy, cz + z * sz)
      col.push(...color)
    }
  }
  const row = slices + 1
  for (let s = 0; s < stacks; s++) {
    for (let i = 0; i < slices; i++) {
      const a = s * row + i
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
    }
  }
  return { pos, col, idx }
}

/** Same lid / pupil numbers as client/ghostFace.ts LOOK. */
const LOOK = {
  calm: { lid: 0.16, pupil: 0.15, py: 0, px: 0 },
  focus: { lid: 0.02, pupil: 0.10, py: -0.01, px: 0 },
  glide: { lid: 0.15, pupil: 0.13, py: 0.03, px: 0 },
  hurt: { lid: 0.22, pupil: 0.21, py: 0, px: 0.015 },
  down: { lid: -0.02, pupil: 0.12, py: 0.03, px: 0 },
}

function faceMesh(mood, bodyColor) {
  const look = LOOK[mood]
  const parts = []
  for (const side of [-1, 1]) {
    const ex = EYE.x * side, ey = EYE.y, ez = EYE.z
    parts.push(sphere(ex, ey, ez, 0.17, 0.20, 0.15, [248, 250, 255]))
    const px = look.px * side
    parts.push(sphere(ex + px, ey + look.py, ez + 0.11, look.pupil / 2, look.pupil / 2, 0.06, [18, 20, 26]))
    parts.push(sphere(ex + px - 0.045 * side, ey + look.py + 0.05, ez + 0.15, 0.035, 0.035, 0.018, [255, 255, 255]))
    // Thin band across the top of the eye. Same colour as the body, so it reads as a lid, not a lump.
    parts.push(sphere(ex, ey + look.lid, ez + 0.1, 0.23, 0.055, 0.17, bodyColor.map(c => Math.round(c * 255))))
  }
  return parts
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[(w * 4 + 1) * y] = 0
    rgba.copy(raw, (w * 4 + 1) * y + 1, y * w * 4, (y + 1) * w * 4)
  }
  const crc = (buf) => zlib.crc32(buf)
  const chunk = (type, data) => {
    const t = Buffer.from(type)
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([t, data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body) >>> 0)
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function renderSheet(pos, nrm, idx) {
  const panels = [
    ['calm', LOOK.calm], ['wind-up', LOOK.focus], ['glide', LOOK.glide],
    ['hit', LOOK.hurt], ['rescue', LOOK.down],
  ]
  const pw = 220, ph = 420, gap = 8
  const W = panels.length * pw + (panels.length - 1) * gap, H = ph
  const img = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { img[i * 4] = 18; img[i * 4 + 1] = 22; img[i * 4 + 2] = 40; img[i * 4 + 3] = 255 }

    const paint = (tris, ox) => {
    const zbuf = new Float32Array(pw * ph).fill(Infinity)
    const camY = 0.78, camZ = 2.55, f = 340
    const light = { x: -0.25, y: 0.55, z: 0.8 }
    const ll = Math.hypot(light.x, light.y, light.z)
    light.x /= ll; light.y /= ll; light.z /= ll
    for (const tri of tris) {
      const proj = tri.p.map(p => {
        const depth = camZ - p[2]
        return [pw / 2 + (p[0] / depth) * f, ph * 0.58 - (p[1] - camY) / depth * f, depth]
      })
      const area = (proj[1][0] - proj[0][0]) * (proj[2][1] - proj[0][1]) - (proj[2][0] - proj[0][0]) * (proj[1][1] - proj[0][1])
      // Front faces project with negative area (y-down). Fill uses the matching test.
      if (area >= 0) continue
      let minX = pw, maxX = 0, minY = ph, maxY = 0
      for (const s of proj) {
        minX = Math.min(minX, s[0]); maxX = Math.max(maxX, s[0])
        minY = Math.min(minY, s[1]); maxY = Math.max(maxY, s[1])
      }
      const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(pw - 1, Math.ceil(maxX))
      const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(ph - 1, Math.ceil(maxY))
      const nd = tri.n[0] * light.x + tri.n[1] * light.y + tri.n[2] * light.z
      const shade = 0.62 + Math.max(0, nd) * 0.5
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const w0 = (proj[1][0] - x) * (proj[2][1] - y) - (proj[2][0] - x) * (proj[1][1] - y)
          const w1 = (proj[2][0] - x) * (proj[0][1] - y) - (proj[0][0] - x) * (proj[2][1] - y)
          const w2 = (proj[0][0] - x) * (proj[1][1] - y) - (proj[1][0] - x) * (proj[0][1] - y)
          if (w0 > 0 || w1 > 0 || w2 > 0) continue
          const z = (w0 * proj[0][2] + w1 * proj[1][2] + w2 * proj[2][2]) / (w0 + w1 + w2)
          const pi = y * pw + x
          if (z >= zbuf[pi]) continue
          zbuf[pi] = z
          const o = ((y * W) + (x + ox)) * 4
          img[o] = Math.min(255, tri.c[0] * shade)
          img[o + 1] = Math.min(255, tri.c[1] * shade)
          img[o + 2] = Math.min(255, tri.c[2] * shade)
          img[o + 3] = 255
        }
      }
    }
  }

  panels.forEach((panel, p) => {
    const mood = panel[0] === 'calm' ? 'calm' : panel[0] === 'wind-up' ? 'focus' : panel[0] === 'glide' ? 'glide' : panel[0] === 'hit' ? 'hurt' : 'down'
    const tris = []
    for (let i = 0; i < idx.length; i += 3) {
      const ids = [idx[i], idx[i + 1], idx[i + 2]]
      const P = ids.map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]])
      const N = [0, 0, 0]
      for (const v of ids) { N[0] += nrm[v * 3]; N[1] += nrm[v * 3 + 1]; N[2] += nrm[v * 3 + 2] }
      const nl = Math.hypot(N[0], N[1], N[2]) || 1
      tris.push({ p: P, n: N.map(v => v / nl), c: RED.map(c => c * 255) })
    }
    for (const part of faceMesh(mood, RED)) {
      const pp = part.pos, ii = part.idx, cc = part.col
      for (let i = 0; i < ii.length; i += 3) {
        const ids = [ii[i], ii[i + 1], ii[i + 2]]
        const P = ids.map(v => [pp[v * 3], pp[v * 3 + 1], pp[v * 3 + 2]])
        const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2]
        const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2]
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
        const nl = Math.hypot(nx, ny, nz) || 1
        tris.push({ p: P, n: [nx / nl, ny / nl, nz / nl], c: [cc[0], cc[1], cc[2]] })
      }
    }
    paint(tris, p * (pw + gap))
  })
  return png(W, H, img)
}

const body = buildBody()
const nrm = normals(body.pos, body.idx)
const b = bounds(body.pos)
const outDir = path.join(process.cwd(), 'assets/models/bots')
fs.writeFileSync(path.join(outDir, 'ghost-red.glb'), glb(body.pos, nrm, body.idx, RED))
fs.writeFileSync(path.join(outDir, 'ghost-blue.glb'), glb(body.pos, nrm, body.idx, BLUE))
const sheetDir = '/opt/cursor/artifacts/ghost-look'
fs.mkdirSync(sheetDir, { recursive: true })
fs.writeFileSync(path.join(sheetDir, 'expressions.png'), renderSheet(body.pos, nrm, body.idx))
console.log(`verts ${body.pos.length / 3} tris ${body.idx.length / 3}`)
console.log(`bounds x ${b.min[0].toFixed(3)}..${b.max[0].toFixed(3)} y ${b.min[1].toFixed(3)}..${b.max[1].toFixed(3)} z ${b.min[2].toFixed(3)}..${b.max[2].toFixed(3)}`)
console.log(`height ${HEIGHT.toFixed(3)} eye`, EYE)
