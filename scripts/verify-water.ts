/**
 * The sea stays under the rescue line and inside the parcel box, the play
 * grid stays 5×5, and fog does not sit on the arena. Swells are geometric,
 * tall and slow, and the crest stays clear of the rescue line.
 *
 * Run: npx tsx scripts/verify-water.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { CELL, GRID_W, MAZE_ORIGIN, MIN_Y, ROT_OFFSET, SCENE_SIZE, TILE_SCALE, baseSpawn, generateWithRetry, getPlacedTilesInOrder, placeLobbyLayout } from '../src/maze/generator'
import { FALL_RESPAWN_DROP, LEVEL_Y_OFFSET, SKY_PARCELS, SKY_TOP_Y, WORLD_SIZE, sceneOriginParcel } from '../src/maze/level'
import { fallTriggerY, liveSwell, shouldBeginRescue, swellSurfaceY } from '../src/shared/swell'
import { FOAM, HAZE_COLOR, HAZE_RING_M, LOOK, RIM_COLOR, SURFACE, SWELL_48_PERIOD_S, SWELL_TRAINS, SWELL_TRAINS_48, SWELL_VARIANT, WATER, WATER_COLOR, WATER_FOG, fogAt, horizonRadiusM, meanSwellWavelength, resolvedWaterSize, resolvedWaterY, swellMesh, swellPeakY, swellTroughY } from '../src/shared/waterLook'
import { lobbyFeet } from '../src/shared/lobby'

const rescue = MIN_Y - FALL_RESPAWN_DROP
const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
const size = resolvedWaterSize(SCENE_SIZE)
const near = fogAt(120)
const peak = swellPeakY(y)
const trough = swellTroughY(y)
const red = baseSpawn(1)
const blue = baseSpawn(2)
console.log(`offset ${LEVEL_Y_OFFSET} roof ${SKY_TOP_Y} rescue ${rescue.toFixed(2)} scene ${SCENE_SIZE}m grid ${GRID_W}`)
console.log(`water y=${y.toFixed(2)} crest=${peak.toFixed(2)} trough=${trough.toFixed(2)} size=${size.toFixed(0)}`)
console.log(`swell ~${meanSwellWavelength().toFixed(0)}m  ±${WATER.swellAmplitudeM}m  ${WATER.swellPeriodS}s  trains ${SWELL_TRAINS.length}  fog@120m=${near.toFixed(3)}`)
console.log(`spawn red ${red.pos.x.toFixed(1)},${red.pos.y.toFixed(3)},${red.pos.z.toFixed(1)} blue ${blue.pos.x.toFixed(1)},${blue.pos.z.toFixed(1)} look ${red.look.x.toFixed(1)}`)

if (GRID_W !== 5) {
  console.error('✗ growing the scene must not grow the play grid')
  process.exit(1)
}
if (peak > MIN_Y - 8) {
  console.error(`✗ swell crest ${peak.toFixed(2)} reaches the lowest floor ${MIN_Y.toFixed(2)}`)
  process.exit(1)
}
if (peak < rescue + 20) {
  console.error('✗ the crest should rise well above the fixed rescue line')
  process.exit(1)
}
if (trough < 1) {
  console.error(`✗ swell trough ${trough.toFixed(2)} meets the world floor`)
  process.exit(1)
}
if (Math.abs(SKY_TOP_Y - (100 + LEVEL_Y_OFFSET)) > 0.01) {
  console.error('✗ the arena roof is not the offset layout')
  process.exit(1)
}
const pk = WATER.swellAmplitudeM * 2
if (pk < 100 || pk > 130) {
  console.error(`✗ peak-to-trough is ${pk}m, want about 110`)
  process.exit(1)
}
const wl = meanSwellWavelength()
if (wl < 250 || wl > 420) {
  console.error(`✗ average wavelength ${wl.toFixed(0)} m should be about 250–400`)
  process.exit(1)
}
if (SWELL_TRAINS.length < 2 || SWELL_TRAINS.length > 4) {
  console.error('✗ the sea needs a few crossing swell trains, not one stripe')
  process.exit(1)
}
const dirs = SWELL_TRAINS.map((t) => t.dirDeg).sort((a, b) => a - b)
for (let i = 1; i < dirs.length; i++) {
  const gap = dirs[i] - dirs[i - 1]
  if (gap < 20 || gap > 45) {
    console.error(`✗ swell directions are ${gap.toFixed(0)}° apart, want 20–40`)
    process.exit(1)
  }
}
if (WATER.swellPeriodS < 30 || WATER.swellPeriodS > 40) {
  console.error('✗ swell period should be a slow 30–40 s')
  process.exit(1)
}
if (WATER.metallic !== 0 || Math.abs(WATER.roughness - 0.48) > 0.02 || Math.abs(WATER.specular - 0.4) > 0.02) {
  console.error('✗ the sea should stay matte-moderate so the ripple normal can catch light')
  process.exit(1)
}
if (Math.abs(WATER_COLOR.r - 0.2) > 0.02 || Math.abs(WATER_COLOR.g - 0.4) > 0.02 || Math.abs(WATER_COLOR.b - 0.74) > 0.02) {
  console.error('✗ near water should stay a little deeper than the halfway horizon tone')
  process.exit(1)
}
if (!LOOK.gloss || Math.abs(LOOK.glossRoughness - 0.3) > 0.02 || LOOK.glossSpecular < 0.7) {
  console.error('✗ the swell gloss switch should be a sharp wet highlight')
  process.exit(1)
}
if (!LOOK.softNormal || LOOK.softNormalTileM < 100 || LOOK.softNormalTileM > 150) {
  console.error('✗ the soft normal should repeat about every 120 m')
  process.exit(1)
}
if (LOOK.depth) {
  console.error('✗ the clear layer is off: it showed the far ring and rim as pale patches')
  process.exit(1)
}
if (LOOK.depthAlpha < 0.75 || LOOK.depthAlpha > 0.92) {
  console.error('✗ the depth alpha should stay a light veil if the switch comes back on')
  process.exit(1)
}
if (Math.abs(RIM_COLOR.r - HAZE_COLOR.r) > 0.001 || Math.abs(RIM_COLOR.g - HAZE_COLOR.g) > 0.001 || Math.abs(RIM_COLOR.b - HAZE_COLOR.b) > 0.001) {
  console.error('✗ haze should use the rim horizon colour')
  process.exit(1)
}
if (size > SCENE_SIZE - 2 || size < SCENE_SIZE * 0.9) {
  console.error('✗ the sea must fill the scene and stay inside the parcel box')
  process.exit(1)
}
if (WATER_FOG.environment || WATER_FOG.density > 0 || near > 0.01) {
  console.error('✗ global fog is still on over the arena')
  process.exit(1)
}
if (WATER_FOG.skirt) {
  console.error('✗ the horizon skirt should start off')
  process.exit(1)
}
if (WATER_FOG.mist) {
  console.error('✗ the mist sheet over the water should be off')
  process.exit(1)
}
if (!WATER_FOG.haze) {
  console.error('✗ the horizon haze ring should be on')
  process.exit(1)
}
const seaHalf = size / 2
if (WATER.swellNearM >= WATER.swellMidM || WATER.swellMidM >= WATER.swellFarM) {
  console.error('✗ swell rings should grow outward: near, mid, far')
  process.exit(1)
}
if (WATER.swellFarM > seaHalf || seaHalf - WATER.swellFarM > 250) {
  console.error(`✗ the far ring (${WATER.swellFarM} m) should end just inside the sea (${seaHalf.toFixed(0)} m)`)
  process.exit(1)
}
const horizon = Math.max(16, SCENE_SIZE / 2 - 8)
if (HAZE_RING_M !== horizon || horizonRadiusM(SCENE_SIZE) !== horizon) {
  console.error(`✗ haze should sit on the parcel horizon (${horizon} m), got ${HAZE_RING_M}`)
  process.exit(1)
}
const gap = Math.hypot(WATER_COLOR.r - RIM_COLOR.r, WATER_COLOR.g - RIM_COLOR.g, WATER_COLOR.b - RIM_COLOR.b)
if (gap < 0.25) {
  console.error('✗ near water is so close to the horizon colour that the swells will not read')
  process.exit(1)
}
if (!(WATER_COLOR.b > WATER_COLOR.r + 0.3 && WATER_COLOR.b > WATER_COLOR.g)) {
  console.error('✗ near water should stay a clear blue')
  process.exit(1)
}
const lum = (c: { r: number; g: number; b: number }) => c.r * 0.3 + c.g * 0.5 + c.b * 0.2
if (!(lum(WATER_COLOR) < lum(RIM_COLOR) && lum(HAZE_COLOR) + 0.02 >= lum(RIM_COLOR))) {
  console.error('✗ haze should match the horizon; near water should be a little deeper')
  process.exit(1)
}
const meshes = [WATER.swellNearSrc, WATER.swellMidSrc, WATER.swellFarSrc, WATER.swellLiteSrc, WATER.swell48NearSrc, WATER.swell48MidSrc, WATER.swell48FarSrc, WATER.swell48LiteSrc, WATER.flatSrc, WATER.flatLiteSrc, WATER_FOG.hazeSrc, swellMesh('near'), SURFACE.albedoSrc, LOOK.softNormalSrc]
for (const f of meshes) {
  if (!existsSync(new URL('../' + f, import.meta.url))) {
    console.error(`✗ missing ${f}`)
    process.exit(1)
  }
}
const scene = JSON.parse(readFileSync(new URL('../scene.json', import.meta.url), 'utf8'))
if (scene.landscapeTerrain !== false) {
  console.error('✗ landscapeTerrain must be false — the default surround brings trees back with the sea')
  process.exit(1)
}
if (!LOOK.sea || !LOOK.seaLast || !LOOK.gloss || !LOOK.softNormal) {
  console.error('✗ the sea, its gloss, and the soft normal should be on')
  process.exit(1)
}
if (scene.scene.parcels.length !== SKY_PARCELS * SKY_PARCELS) {
  console.error(`✗ scene.json has ${scene.scene.parcels.length} parcels, want ${SKY_PARCELS * SKY_PARCELS}`)
  process.exit(1)
}
const origin = sceneOriginParcel(SKY_PARCELS)
const expectBase = `${origin},${origin}`
if (scene.scene.base !== expectBase) {
  console.error(`✗ scene.json base is ${scene.scene.base}, want ${expectBase} for WORLD_SIZE=${WORLD_SIZE}`)
  process.exit(1)
}
if (scene.worldConfiguration?.name !== 'pixelwars.dcl.eth') {
  console.error(`✗ worldConfiguration name is ${scene.worldConfiguration?.name}, want pixelwars.dcl.eth`)
  process.exit(1)
}
if (scene.landscapeTerrain !== false) {
  console.error('✗ landscapeTerrain should stay false')
  process.exit(1)
}
const spawnY = scene.spawnPoints?.[0]?.position?.y?.[0]
if (typeof spawnY !== 'number' || Math.abs(spawnY - red.pos.y) > 0.01) {
  console.error(`✗ scene.json spawn y ${spawnY} does not match the raised base ${red.pos.y.toFixed(3)}`)
  process.exit(1)
}
const src = readFileSync(new URL('../src/client/water.ts', import.meta.url), 'utf8')
if (!src.includes("part !== 'far'") || !src.includes('addFlat(seaRoot')) {
  console.error('✗ desktop should draw the far swell and the flat rim')
  process.exit(1)
}
const indexSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
if (!indexSrc.includes('startOceanAmbience')) {
  console.error('✗ the ocean bed should start after the sea meshes')
  process.exit(1)
}
const ignored = readFileSync(new URL('../.dclignore', import.meta.url), 'utf8')
if (ignored.includes('assets/sounds/ocean.mp3') || ignored.includes('water-haze.glb')) {
  console.error('✗ water assets are still in .dclignore')
  process.exit(1)
}
const rescueSrc = readFileSync(new URL('../src/client/fallRescue.ts', import.meta.url), 'utf8')
if (!rescueSrc.includes('isLobbyLayout()') || !rescueSrc.includes('lobbyFeet')) {
  console.error('✗ lobby fall rescue should still return to the cross with the sea on')
  process.exit(1)
}
if (/MeshCollider|TriggerArea/.test(src)) {
  console.error('✗ the sea must not collide or catch players')
  process.exit(1)
}
if (!src.includes("swellMesh('lite')") || !src.includes('isMobile')) {
  console.error('✗ mobile should use the lighter swell mesh')
  process.exit(1)
}
if (src.includes('horizonSrcVeil') || src.includes('1.08')) {
  console.error('✗ the overlapping horizon curtain is still in the client')
  process.exit(1)
}
if (!src.includes('hazeSrc')) {
  console.error('✗ the seamless haze ring is not spawned')
  process.exit(1)
}
const pillarDrop = 99.75 * TILE_SCALE
const pillarBottom = MIN_Y - pillarDrop
console.log(`pillar bottom ${pillarBottom.toFixed(1)} trough ${trough.toFixed(1)} immersion ${(trough - pillarBottom).toFixed(1)}m`)
if (pillarBottom > trough - 5) {
  console.error('✗ the shortest pillar comes out of the water at a trough')
  process.exit(1)
}
function glbClipSeconds(rel: string): number {
  const buf = readFileSync(new URL('../' + rel, import.meta.url))
  const jlen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.slice(20, 20 + jlen).toString()) as {
    animations?: Array<{ name: string; samplers: Array<{ input: number }> }>
    accessors: Array<{ max?: number[] }>
  }
  const anim = json.animations?.find((a) => a.name === 'wave')
  if (!anim) return -1
  return json.accessors[anim.samplers[0].input].max?.[0] ?? -1
}
if (SWELL_VARIANT === '48m') {
  if (SWELL_48_PERIOD_S < 40 || SWELL_48_PERIOD_S > 50) {
    console.error(`✗ live swell period is ${SWELL_48_PERIOD_S}s, want about 45`)
    process.exit(1)
  }
  const clip = glbClipSeconds(WATER.swell48NearSrc)
  if (Math.abs(clip - SWELL_48_PERIOD_S) > 0.05) {
    console.error(`✗ live swell clip is ${clip}s but the surface uses ${SWELL_48_PERIOD_S}s`)
    process.exit(1)
  }
  const nearBytes = statSync(new URL('../' + WATER.swell48NearSrc, import.meta.url)).size
  if (nearBytes > 800_000) {
    console.error(`✗ live near swell is ${(nearBytes / 1e6).toFixed(2)} MB; keep it near 0.3 MB`)
    process.exit(1)
  }
  const secondary = SWELL_TRAINS_48.slice(1).reduce((a, t) => a + t.weight, 0)
  if (SWELL_TRAINS_48[0].weight < 0.7 || secondary > 0.35) {
    console.error('✗ the live swell should be one dominant train with small companions')
    process.exit(1)
  }
}
if (src.includes('paintWhitecaps') || src.includes('Math.min(8')) {
  console.error('✗ the swell clock is still catching up to the wall clock')
  process.exit(1)
}
if (!src.includes('speed: 1')) {
  console.error('✗ the swell clip should play at a constant speed')
  process.exit(1)
}
if (FOAM.rings || FOAM.whitecaps) {
  console.error('✗ sticker rings and whitecap blobs should stay off')
  process.exit(1)
}
if (SURFACE.ripple || SURFACE.foam) {
  console.error('✗ the ripple normal and the foam veil should stay off')
  process.exit(1)
}
if (!src.includes("part !== 'far'")) {
  console.error('✗ the soft normal and the clear layer must stop before the far ring')
  process.exit(1)
}
if (SURFACE.foamAlpha < 0.2 || SURFACE.foamAlpha > 0.35) {
  console.error('✗ the foam sheet should stay a light veil')
  process.exit(1)
}
if (SURFACE.rippleTileM < 4 || SURFACE.rippleTileM > 24) {
  console.error('✗ ripple tiles should be a few metres, not a stretch across the sea')
  process.exit(1)
}
if (!SURFACE.mobileFoam && !src.includes('mobileFoam')) {
  console.error('✗ mobile should be able to skip the foam sheet')
  process.exit(1)
}
let high = -Infinity
const period = liveSwell().periodS
for (let s = 0; s < period; s += 1.5) {
  for (let dx = -400; dx <= 400; dx += 200) {
    high = Math.max(high, swellSurfaceY(SCENE_SIZE / 2 + dx, SCENE_SIZE / 2, s))
  }
}
if (high < y + (SWELL_VARIANT === '48m' ? 12 : 40)) {
  console.error(`✗ crest ${high.toFixed(1)} does not rise with the live swell`)
  process.exit(1)
}
if (fallTriggerY(SCENE_SIZE / 2, SCENE_SIZE / 2, 0) < rescue) {
  console.error('✗ the fall trigger dropped below the fixed rescue line')
  process.exit(1)
}
if (SWELL_VARIANT === '48m') {
  let hi = -Infinity
  let lo = Infinity
  for (let s = 0; s < period; s += 3) {
    for (let dx = -400; dx <= 400; dx += 80) {
      for (let dz = -400; dz <= 400; dz += 80) {
        const h = swellSurfaceY(SCENE_SIZE / 2 + dx, SCENE_SIZE / 2 + dz, s)
        hi = Math.max(hi, h)
        lo = Math.min(lo, h)
      }
    }
  }
  const span = hi - lo
  console.log(`live surface span ${span.toFixed(1)} m (48 m meshes)`)
  if (span > 60 || span < 40) {
    console.error('✗ swellSurfaceY does not match the live 48 m meshes')
    process.exit(1)
  }
}
if (!shouldBeginRescue(2, false, rescue, MIN_Y)) {
  console.error('✗ standing on the base ground must rescue even before the maze is ready')
  process.exit(1)
}
if (shouldBeginRescue(MIN_Y + 1, false, rescue, MIN_Y)) {
  console.error('✗ a player on the floor must not rescue while the maze is still building')
  process.exit(1)
}
if (!shouldBeginRescue(rescue - 1, true, rescue, MIN_Y)) {
  console.error('✗ a finished maze must still rescue a fall through the line')
  process.exit(1)
}
function inside(name: string, x: number, z: number): void {
  if (x < -0.01 || z < -0.01 || x > SCENE_SIZE + 0.01 || z > SCENE_SIZE + 0.01) {
    console.error(`✗ ${name} at ${x.toFixed(1)},${z.toFixed(1)} is outside the ${SCENE_SIZE}m scene`)
    process.exit(1)
  }
}
function tileCorners(tiles: { type: string; r: number; x: number; z: number }[], label: string): void {
  for (const p of tiles) {
    const [dx, dz] = ROT_OFFSET[p.r]
    const px = p.x * CELL + dx + MAZE_ORIGIN
    const pz = p.z * CELL + dz + MAZE_ORIGIN
    inside(`${label} ${p.type} pivot`, px, pz)
    inside(`${label} ${p.type} cell`, p.x * CELL + MAZE_ORIGIN, p.z * CELL + MAZE_ORIGIN)
    inside(`${label} ${p.type} cell`, p.x * CELL + CELL + MAZE_ORIGIN, p.z * CELL + CELL + MAZE_ORIGIN)
  }
}
tileCorners(placeLobbyLayout(), 'lobby')
const lobby = lobbyFeet(CELL, MAZE_ORIGIN, 0)
inside('lobby spawn', lobby.x, lobby.z)
for (const team of [1, 2]) {
  const s = baseSpawn(team).pos
  inside(`base spawn ${team}`, s.x, s.z)
}
if (generateWithRetry(1) === null) {
  console.error('✗ could not build a maze to check bounds')
  process.exit(1)
}
tileCorners(getPlacedTilesInOrder(), 'maze')
const mid = SCENE_SIZE / 2
inside('water inner', mid - seaHalf, mid - seaHalf)
inside('water outer', mid + seaHalf, mid + seaHalf)
const haze = horizonRadiusM(SCENE_SIZE)
inside('haze inner', mid - haze, mid - haze)
inside('haze outer', mid + haze, mid + haze)
inside('swell far', mid - WATER.swellFarM, mid - WATER.swellFarM)
inside('swell far', mid + WATER.swellFarM, mid + WATER.swellFarM)
console.log('✓ swells stay under the rescue line; lobby, maze, water, and spawns stay inside the scene')
