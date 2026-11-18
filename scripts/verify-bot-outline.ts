/**
 * verify-bot-outline.ts — inverted-hull outline lives in the custom body
 * GLB, keeps its own unlit navy material, and is not tinted with the team.
 *
 * Run from the scene root: npx tsx scripts/verify-bot-outline.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs'

let failed = 0
function fail(msg: string): void {
  failed += 1
  console.error(`FAIL: ${msg}`)
}
function ok(msg: string): void {
  console.log(`ok  ${msg}`)
}

const root = new URL('..', import.meta.url)
const body = readFileSync(new URL('../src/client/botBody.ts', import.meta.url), 'utf8')
const visual = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
const glbPath = new URL('assets/models/bots/bot-custom-flat.glb', root)
if (!existsSync(glbPath)) {
  fail('missing assets/models/bots/bot-custom-flat.glb')
  console.error(`${failed} bot-outline check(s) failed`)
  process.exit(1)
}

const buf = readFileSync(glbPath)
const jsonLen = buf.readUInt32LE(12)
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
  nodes?: Array<{ name?: string; mesh?: number; skin?: number }>
  meshes?: Array<{ name?: string; primitives: Array<{ indices?: number; material?: number }> }>
  accessors?: Array<{ count: number }>
  materials?: Array<{
    name?: string
    doubleSided?: boolean
    alphaMode?: string
    pbrMetallicRoughness?: { baseColorFactor?: number[] }
    extensions?: Record<string, unknown>
  }>
  animations?: Array<{ name?: string }>
  extensionsUsed?: string[]
}

const nodeNames = (gltf.nodes ?? []).map(n => n.name ?? '')
const meshNodes = (gltf.nodes ?? []).filter(n => n.mesh !== undefined)
const expectedBody = ['BotBody', 'Arm_L', 'Arm_R']
const expectedOutline = ['BotBodyOutline', 'Arm_L_Outline', 'Arm_R_Outline']
const clips = (gltf.animations ?? []).map(a => a.name ?? '')

{
  for (const name of expectedBody) {
    if (!nodeNames.includes(name)) fail(`missing body mesh node ${name}`)
  }
  for (const name of expectedOutline) {
    if (!nodeNames.includes(name)) fail(`missing outline mesh node ${name}`)
  }
  if (failed === 0) ok('GLB has BotBody / Arm_L / Arm_R and matching *Outline mesh nodes')
}

{
  const skinned = meshNodes.filter(n => n.skin !== undefined).map(n => n.name)
  for (const name of [...expectedBody, ...expectedOutline]) {
    if (!skinned.includes(name)) fail(`${name} is not skinned`)
  }
  if (failed === 0) ok('outline meshes are skinned to the same armature as the body')
}

{
  const want = ['idle', 'jump', 'double', 'glide', 'fall', 'slide']
  const missing = want.filter(c => !clips.includes(c))
  const dupes = clips.filter(c => c.includes('.'))
  if (missing.length) fail(`missing clips: ${missing.join(', ')} (have ${clips.join(', ')})`)
  if (dupes.length) fail(`duplicate/renamed clips: ${dupes.join(', ')}`)
  if (failed === 0) ok(`clips are intact (${want.join(', ')})`)
}

let outlineTris = 0
let bodyTris = 0
{
  const nameOf = new Map<number, string>()
  for (const n of gltf.nodes ?? []) {
    if (n.mesh !== undefined) nameOf.set(n.mesh, n.name ?? '')
  }
  for (let i = 0; i < (gltf.meshes ?? []).length; i++) {
    const mesh = gltf.meshes![i]
    const nodeName = nameOf.get(i) ?? mesh.name ?? ''
    for (const prim of mesh.primitives) {
      const count = prim.indices !== undefined ? (gltf.accessors?.[prim.indices]?.count ?? 0) : 0
      const tris = count / 3
      if (/Outline/.test(nodeName) || /Outline/.test(mesh.name ?? '')) outlineTris += tris
      else bodyTris += tris
    }
  }
  if (outlineTris < 10_000 || outlineTris > 14_000) fail(`unexpected outline tri count ${outlineTris}`)
  if (Math.abs(outlineTris - bodyTris) > 500) fail(`outline tris ${outlineTris} should be close to body tris ${bodyTris}`)
  else ok(`outline adds ${outlineTris} tris (body ${bodyTris}, total ${outlineTris + bodyTris})`)
}

{
  const mat = (gltf.materials ?? []).find(m => m.name === 'BotOutline')
  if (!mat) fail('missing BotOutline material')
  else {
    const unlit = !!(mat.extensions && 'KHR_materials_unlit' in mat.extensions)
    const opaque = !mat.alphaMode || mat.alphaMode === 'OPAQUE'
    const single = mat.doubleSided !== true
    const c = mat.pbrMetallicRoughness?.baseColorFactor ?? []
    const navy = c.length >= 3 && Math.round(c[0] * 255) === 0x20 && Math.round(c[1] * 255) === 0x28 && Math.round(c[2] * 255) === 0x3B
    if (!unlit) fail('BotOutline is not KHR_materials_unlit')
    if (!opaque) fail(`BotOutline alphaMode is ${mat.alphaMode}`)
    if (!single) fail('BotOutline is doubleSided (the front wall would cover the body and face)')
    if (!navy) fail(`BotOutline base color is ${c}, expected #20283B`)
    if (unlit && opaque && single && navy) ok('BotOutline is unlit, opaque, single-sided navy #20283B')
  }
  if (!(gltf.extensionsUsed ?? []).includes('KHR_materials_unlit')) fail('GLB extensionsUsed is missing KHR_materials_unlit')
}

{
  const size = statSync(glbPath).size
  if (size < 1_200_000) fail(`GLB is only ${size} bytes; outline meshes may be missing`)
  else ok(`bot-custom-flat.glb is ${size} bytes`)
}

{
  const checks: Array<[boolean, string]> = [
    [body.includes("'BotBody'") && body.includes("'Arm_L'") && body.includes("'Arm_R'"), 'team tint still targets BotBody, Arm_L, Arm_R'],
    [!body.includes('BotBodyOutline') || body.includes('must not be included'), 'botBody documents that outline nodes are not tinted'],
    [!/path:\s*''/.test(body) && !/path:\s*""/.test(body), 'body tint does not use a global path: \'\''],
    [visual.includes('bot-custom-flat.glb') && !visual.includes('bot-custom-flat-red'), 'botVisual still loads the single custom GLB'],
  ]
  for (const [pass, msg] of checks) {
    if (!pass) fail(msg)
  }
  if (failed === 0) ok('runtime tint leaves the outline material alone')
}

if (failed) {
  console.error(`${failed} bot-outline check(s) failed`)
  process.exit(1)
}
console.log('✓ bot outline checks passed')
