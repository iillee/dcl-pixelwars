/**
 * Rewrite scene.json's parcel list and spawns from WORLD_SIZE in src/maze/level.ts.
 *
 *   small  20×20 at base 0,0 (320 m). Deploy default. The sea meshes stay
 *          the 4 km set and the explorer clips whatever sticks out.
 *   full   300×300 at base -150,-150 (4800 m), inside the publisher box.
 *
 * Flip: edit WORLD_SIZE, then `npx tsx scripts/write-scene.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { SKY_PARCELS, WORLD_SIZE } from '../src/maze/level'
import { baseSpawn } from '../src/maze/generator'

const scene = JSON.parse(readFileSync(new URL('../scene.json', import.meta.url), 'utf8'))
const n = SKY_PARCELS
const origin = WORLD_SIZE === 'full' ? -150 : 0
const parcels: string[] = []
for (let z = origin + n - 1; z >= origin; z--) {
  for (let x = origin; x < origin + n; x++) parcels.push(`${x},${z}`)
}
scene.scene.base = `${origin},${origin}`
scene.scene.parcels = parcels

function spawn(team: number, name: string, isDefault: boolean) {
  const s = baseSpawn(team)
  const y = s.pos.y
  return {
    name,
    default: isDefault,
    position: {
      x: [s.pos.x - 2, s.pos.x + 2],
      y: [y, y],
      z: [s.pos.z - 2, s.pos.z + 2],
    },
    cameraTarget: { x: s.look.x, y, z: s.look.z },
  }
}
scene.spawnPoints = [spawn(1, 'RedBase', true), spawn(2, 'BlueBase', false)]
writeFileSync(new URL('../scene.json', import.meta.url), JSON.stringify(scene, null, 2) + '\n')
console.log(`scene.json ${WORLD_SIZE}: ${n}×${n} parcels, base ${origin},${origin}, bytes ${JSON.stringify(scene).length}`)
