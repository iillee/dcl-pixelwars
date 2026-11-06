/**
 * The sea stays under the rescue line, and the fog leaves the maze readable
 * while hiding the plane's far edge.
 *
 * Run: npx tsx scripts/verify-water.ts
 */
import { readFileSync } from 'node:fs'
import { MIN_Y, SCENE_SIZE } from '../src/maze/generator'
import { FALL_RESPAWN_DROP } from '../src/maze/level'
import { WATER, WATER_FOG, fogAt, fogDensity, resolvedWaterY } from '../src/shared/waterLook'

const rescue = MIN_Y - FALL_RESPAWN_DROP
const y = resolvedWaterY(MIN_Y, FALL_RESPAWN_DROP)
const density = fogDensity()
const near = fogAt(WATER_FOG.startM, density)
const far = fogAt(WATER_FOG.endM, density)
console.log(`rescue y=${rescue.toFixed(2)} water y=${y.toFixed(2)} fog@${WATER_FOG.startM}m=${near.toFixed(2)} fog@${WATER_FOG.endM}m=${far.toFixed(2)} size=${WATER.sizeM}`)

if (!(y < rescue - 1)) {
  console.error('✗ water reaches the fall-rescue line')
  process.exit(1)
}
if (WATER.sizeM < SCENE_SIZE * 2) {
  console.error('✗ the plane is not larger than the scene')
  process.exit(1)
}
if (near > 0.45) {
  console.error('✗ fog is thick inside the play distance')
  process.exit(1)
}
if (far < 0.85) {
  console.error('✗ fog does not hide the water edge')
  process.exit(1)
}
if (WATER.layersMobile > WATER.layersDesktop || WATER.layersMobile < 1) {
  console.error('✗ mobile should use fewer water sheets than desktop')
  process.exit(1)
}
const src = readFileSync(new URL('../src/client/water.ts', import.meta.url), 'utf8')
if (/MeshCollider|TriggerArea/.test(src)) {
  console.error('✗ the sea must not collide or catch players')
  process.exit(1)
}
console.log('✓ water sits under the rescue line, with no collider, and the fog hides the far edge')
