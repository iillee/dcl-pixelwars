/**
 * The sea stays under the rescue line and inside the parcel box, the play
 * grid stays 5×5, and the global fog does not wash the arena.
 *
 * Run: npx tsx scripts/verify-water.ts
 */
import { readFileSync } from 'node:fs'
import { GRID_W, MIN_Y, SCENE_SIZE } from '../src/maze/generator'
import { FALL_RESPAWN_DROP, SKY_PARCELS } from '../src/maze/level'
import { WATER, WATER_FOG, fogAt, resolvedWaterSize, resolvedWaterY } from '../src/shared/waterLook'
import { baseSpawn } from '../src/maze/generator'

const rescue = MIN_Y - FALL_RESPAWN_DROP
const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
const size = resolvedWaterSize(SCENE_SIZE)
const near = fogAt(120)
const far = fogAt(SCENE_SIZE / 2)
const red = baseSpawn(1)
const blue = baseSpawn(2)
console.log(`scene ${SCENE_SIZE}m grid ${GRID_W} water y=${y.toFixed(2)} size=${size.toFixed(0)} fog@120m=${near.toFixed(3)}`)
console.log(`spawn red ${red.pos.x.toFixed(1)},${red.pos.y.toFixed(3)},${red.pos.z.toFixed(1)} blue ${blue.pos.x.toFixed(1)},${blue.pos.z.toFixed(1)} look ${red.look.x.toFixed(1)}`)

if (GRID_W !== 5) {
  console.error('✗ growing the scene must not grow the play grid')
  process.exit(1)
}
if (!(y < rescue - 1)) {
  console.error('✗ water reaches the fall-rescue line')
  process.exit(1)
}
if (size > SCENE_SIZE - 2 || size < SCENE_SIZE * 0.9) {
  console.error('✗ the plane must fill the scene and stay inside the parcel box')
  process.exit(1)
}
if (near > 0.12) {
  console.error('✗ global fog is still thick over the arena')
  process.exit(1)
}
if (!WATER_FOG.skirt || !WATER_FOG.mist) {
  console.error('✗ the perimeter skirt and the mist should start enabled')
  process.exit(1)
}
if (WATER.waveAmplitudeM < 0.5 || WATER.swellM < 0.2) {
  console.error('✗ the swell is still the 5 cm bob')
  process.exit(1)
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
const src = readFileSync(new URL('../src/client/water.ts', import.meta.url), 'utf8')
if (/MeshCollider|TriggerArea/.test(src)) {
  console.error('✗ the sea must not collide or catch players')
  process.exit(1)
}
console.log('✓ sea fills the larger scene under the rescue line; fog over the arena stays thin')
