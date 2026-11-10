/**
 * Rewrite scene.json's parcel list and spawns from WORLD_SIZE in src/maze/level.ts.
 *
 *   small   20×20, base -10,-10, centred on parcel 0,0.
 *   fifty   50×50, base -25,-25, centred on parcel 0,0.
 *   medium  64×64, centred on parcel 0,0.
 *   large   100×100, base -50,-50, centred on parcel 0,0. Current world.
 *   wide    150×150, centred on parcel 0,0.
 *   full    300×300 at base -150,-150, inside the publisher box.
 *
 * landscapeTerrain stays false: the default grassland, trees, and sea
 * come back together, and we do not want that surround.
 * Flip the size: edit WORLD_SIZE, then `npx tsx scripts/write-scene.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { SKY_PARCELS, WORLD_SIZE, sceneOriginParcel } from '../src/maze/level'
import { BASE_Y, CELL, MAZE_ORIGIN } from '../src/maze/generator'
import { lobbyFeet } from '../src/shared/lobby'

const scene = JSON.parse(readFileSync(new URL('../scene.json', import.meta.url), 'utf8'))
const n = SKY_PARCELS
const origin = sceneOriginParcel(n)
scene.landscapeTerrain = false
scene.worldConfiguration = { name: 'pixelwars.dcl.eth' }
const parcels: string[] = []
for (let z = origin + n - 1; z >= origin; z--) {
  for (let x = origin; x < origin + n; x++) parcels.push(`${x},${z}`)
}
scene.scene.base = `${origin},${origin}`
scene.scene.parcels = parcels

// Join lands on the center of the 3-tile lobby. A match clock teleports to the team base.
function lobbySpawn(name: string, isDefault: boolean) {
  const s = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
  const y = s.y
  return {
    name,
    default: isDefault,
    position: {
      x: [s.x - 2, s.x + 2],
      y: [y, y],
      z: [s.z - 2, s.z + 2],
    },
    cameraTarget: { x: s.x, y, z: s.z + 8 },
  }
}
scene.spawnPoints = [lobbySpawn('Lobby', true), lobbySpawn('LobbyBlue', false)]
writeFileSync(new URL('../scene.json', import.meta.url), JSON.stringify(scene, null, 2) + '\n')
console.log(`scene.json ${WORLD_SIZE}: ${n}×${n} parcels, base ${origin},${origin}, bytes ${JSON.stringify(scene).length}`)
