/**
 * The sea stays under the rescue line and inside the parcel box, the play
 * grid stays 5×5, and fog does not sit on the arena. Swells are geometric,
 * tall and slow, and the crest stays clear of the rescue line.
 *
 * Run: npx tsx scripts/verify-water.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { GRID_W, MIN_Y, SCENE_SIZE } from '../src/maze/generator'
import { FALL_RESPAWN_DROP, LEVEL_Y_OFFSET, SKY_PARCELS, SKY_TOP_Y } from '../src/maze/level'
import { HAZE_COLOR, RIM_COLOR, SWELL_TRAINS, WATER, WATER_COLOR, WATER_FOG, fogAt, meanSwellWavelength, resolvedWaterSize, resolvedWaterY, swellPeakY, swellTroughY } from '../src/shared/waterLook'
import { baseSpawn } from '../src/maze/generator'

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
if (!(y < rescue - 1)) {
  console.error('✗ water reaches the fall-rescue line')
  process.exit(1)
}
if (peak > rescue - 8) {
  console.error(`✗ swell crest ${peak.toFixed(2)} is too close to the rescue line ${rescue.toFixed(2)}`)
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
if (pk < 44 || pk > 52) {
  console.error(`✗ peak-to-trough is ${pk}m, want about 48`)
  process.exit(1)
}
const wl = meanSwellWavelength()
if (wl < 520 || wl > 700) {
  console.error(`✗ average wavelength ${wl.toFixed(0)} m should be about 600`)
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
if (WATER.swellPeriodS < 25 || WATER.swellPeriodS > 30) {
  console.error('✗ swell period should be a slow 25–30 s')
  process.exit(1)
}
if (WATER.metallic !== 0 || WATER.roughness < 0.45 || WATER.roughness > 0.55 || WATER.specular < 0.3 || WATER.specular > 0.5) {
  console.error('✗ reflectivity should be a soft sheen, not matte and not a white streak')
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
if (WATER_FOG.hazeRadiusM < WATER.swellFarM || WATER_FOG.hazeRadiusM > seaHalf - 8) {
  console.error('✗ the haze ring should sit just inside the sea edge, past the swell')
  process.exit(1)
}
if (WATER_FOG.hazeBottomY > y || WATER_FOG.hazeTopY < 220 || WATER_FOG.hazeTopY > 320) {
  console.error('✗ the haze should start under the waterline and rise past eye height, under the scene cap')
  process.exit(1)
}
if (WATER.swellFarM < 1600 || WATER.swellFarM > size / 2) {
  console.error('✗ the swell ring should reach toward the horizon and stay inside the sea')
  process.exit(1)
}
const gap = Math.hypot(WATER_COLOR.r - RIM_COLOR.r, WATER_COLOR.g - RIM_COLOR.g, WATER_COLOR.b - RIM_COLOR.b)
if (gap > 0.45 || gap < 0.05) {
  console.error('✗ near water should sit close to the horizon colour, a step deeper')
  process.exit(1)
}
const lum = (c: { r: number; g: number; b: number }) => c.r * 0.3 + c.g * 0.5 + c.b * 0.2
if (!(lum(WATER_COLOR) < lum(RIM_COLOR) && lum(HAZE_COLOR) + 0.02 >= lum(RIM_COLOR))) {
  console.error('✗ haze should match the horizon; near water should be a little deeper')
  process.exit(1)
}
const meshes = [WATER.swellNearSrc, WATER.swellMidSrc, WATER.swellFarSrc, WATER.swellLiteSrc, WATER.flatSrc, WATER.flatLiteSrc, WATER_FOG.hazeSrc]
for (const f of meshes) {
  if (!existsSync(new URL('../' + f, import.meta.url))) {
    console.error(`✗ missing ${f}`)
    process.exit(1)
  }
}
const scene = JSON.parse(readFileSync(new URL('../scene.json', import.meta.url), 'utf8'))
if (scene.landscapeTerrain !== false) {
  console.error('✗ landscapeTerrain must be false so the World drops the default trees')
  process.exit(1)
}
if (scene.scene.parcels.length !== SKY_PARCELS * SKY_PARCELS) {
  console.error(`✗ scene.json has ${scene.scene.parcels.length} parcels, want ${SKY_PARCELS * SKY_PARCELS}`)
  process.exit(1)
}
if (scene.scene.base !== '-150,-150') {
  console.error('✗ the 300×300 block must sit inside the publisher box (-150..149), base -150,-150')
  process.exit(1)
}
const spawnY = scene.spawnPoints?.[0]?.position?.y?.[0]
if (typeof spawnY !== 'number' || Math.abs(spawnY - red.pos.y) > 0.01) {
  console.error(`✗ scene.json spawn y ${spawnY} does not match the raised base ${red.pos.y.toFixed(3)}`)
  process.exit(1)
}
const src = readFileSync(new URL('../src/client/water.ts', import.meta.url), 'utf8')
if (/MeshCollider|TriggerArea/.test(src)) {
  console.error('✗ the sea must not collide or catch players')
  process.exit(1)
}
if (!src.includes('swellLiteSrc') || !src.includes('isMobile')) {
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
console.log('✓ swells stay under the rescue line; the arena has no fog layer')
