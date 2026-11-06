/**
 * The sea stays under the rescue line and inside the parcel box, the play
 * grid stays 5×5, and fog does not sit on the arena. Swells are geometric,
 * tall and slow, and the crest stays clear of the rescue line.
 *
 * Run: npx tsx scripts/verify-water.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { GRID_W, MIN_Y, SCENE_SIZE } from '../src/maze/generator'
import { FALL_RESPAWN_DROP, SKY_PARCELS } from '../src/maze/level'
import { WATER, WATER_FOG, fogAt, resolvedWaterSize, resolvedWaterY, swellPeakY, swellTroughY } from '../src/shared/waterLook'
import { baseSpawn } from '../src/maze/generator'

const rescue = MIN_Y - FALL_RESPAWN_DROP
const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
const size = resolvedWaterSize(SCENE_SIZE)
const near = fogAt(120)
const peak = swellPeakY(y)
const trough = swellTroughY(y)
const red = baseSpawn(1)
const blue = baseSpawn(2)
console.log(`scene ${SCENE_SIZE}m grid ${GRID_W} water y=${y.toFixed(2)} crest=${peak.toFixed(2)} trough=${trough.toFixed(2)} size=${size.toFixed(0)}`)
console.log(`swell ${WATER.swellWavelengthM}m  ±${WATER.swellAmplitudeM}m  ${WATER.swellPeriodS}s  fog@120m=${near.toFixed(3)}`)
console.log(`spawn red ${red.pos.x.toFixed(1)},${red.pos.y.toFixed(3)},${red.pos.z.toFixed(1)} blue ${blue.pos.x.toFixed(1)},${blue.pos.z.toFixed(1)} look ${red.look.x.toFixed(1)}`)

if (GRID_W !== 5) {
  console.error('✗ growing the scene must not grow the play grid')
  process.exit(1)
}
if (!(y < rescue - 1)) {
  console.error('✗ water reaches the fall-rescue line')
  process.exit(1)
}
if (peak > rescue - 3) {
  console.error(`✗ swell crest ${peak.toFixed(2)} is too close to the rescue line ${rescue.toFixed(2)}`)
  process.exit(1)
}
if (trough > -4) {
  console.error('✗ troughs should sit well under the mean so a 12 m swell fits under the rescue line')
  process.exit(1)
}
const pk = WATER.swellAmplitudeM * 2
if (pk < 11 || pk > 13) {
  console.error(`✗ peak-to-trough is ${pk}m, want about 12`)
  process.exit(1)
}
if (WATER.swellWavelengthM < 120 || WATER.swellWavelengthM > 160) {
  console.error('✗ wavelength should be 120–160 m')
  process.exit(1)
}
if (WATER.swellPeriodS < 12 || WATER.swellPeriodS > 14) {
  console.error('✗ swell period should be a slow 12–14 s')
  process.exit(1)
}
if (WATER.metallic !== 0 || WATER.roughness < 0.6 || WATER.specular > 0.25) {
  console.error('✗ the sea is still shiny enough to streak white')
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
if (!WATER_FOG.horizon || WATER_FOG.horizonRadiusM < 2000 || WATER_FOG.horizonHeightM > 60) {
  console.error('✗ the horizon veil should be a short curtain near the parcel edge')
  process.exit(1)
}
if (WATER.swellFarM < 1600 || WATER.swellFarM > size / 2) {
  console.error('✗ the swell ring should reach toward the horizon and stay inside the sea')
  process.exit(1)
}
if (WATER.color.b < 0.55 || WATER.color.b < WATER.color.r * 8 || WATER.color.g > WATER.color.b * 0.6) {
  console.error('✗ the sea should be a deep saturated blue')
  process.exit(1)
}
const meshes = [WATER.swellNearSrc, WATER.swellMidSrc, WATER.swellFarSrc, WATER.swellLiteSrc, WATER.flatSrc, WATER.flatLiteSrc]
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
const src = readFileSync(new URL('../src/client/water.ts', import.meta.url), 'utf8')
if (/MeshCollider|TriggerArea/.test(src)) {
  console.error('✗ the sea must not collide or catch players')
  process.exit(1)
}
if (!src.includes('swellLiteSrc') || !src.includes('isMobile')) {
  console.error('✗ mobile should use the lighter swell mesh')
  process.exit(1)
}
console.log('✓ swells stay under the rescue line; the arena has no fog layer')
