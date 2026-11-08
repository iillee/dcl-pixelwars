/**
 * Creator Hub copies scene.json's parcel list into
 * inspector::SceneMetadata-v5 inside assets/scene/main.composite.
 * On a 300×300 world that is 90,000 parcels (~1.58 MB). sdk-commands then
 * writes the same list into main.crdt, and every client loads that file
 * at start.
 *
 * scene.json is the deploy parcel map. The composite copy is not. This
 * empties layout.parcels, points layout.base at the scene origin, and
 * rewrites spawn points onto the lobby center at the raised floor. A stale
 * copy (y 90.7, x ~96) drops the player on the base ground under the tiles.
 * When anything changed, it regenerates main.crdt.
 *
 *   npx tsx scripts/strip-scene-metadata.ts
 *
 * npm run build runs it first. Run it again after Creator Hub rewrites
 * the composite, before a deploy. Idempotent when the list is already empty.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Composite, Engine, EntityMappingMode } from '@dcl/ecs/dist-cjs'
import { dumpEngineToCrdtCommands } from '@dcl/inspector'
import { BASE_Y, CELL, MAZE_ORIGIN } from '../src/maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../src/maze/level'
import { lobbyFeet } from '../src/shared/lobby'

const compositePath = new URL('../assets/scene/main.composite', import.meta.url)
const crdtPath = new URL('../main.crdt', import.meta.url)

type Meta = {
  layout?: { parcels?: unknown[]; base?: { x: number; y: number } }
  spawnPoints?: unknown
  hideLandscapeTerrain?: boolean
}
const json = JSON.parse(readFileSync(compositePath, 'utf8')) as {
  components?: Array<{ name?: string; data?: Record<string, { json?: Meta }> }>
}

const origin = sceneOriginParcel(SKY_PARCELS)
const stand = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
const range = (a: number, b: number) => ({ $case: 'range', value: [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000] })
const spawns = ['Lobby', 'LobbyBlue'].map((name, i) => ({
  name,
  default: i === 0,
  position: {
    x: range(stand.x - 2, stand.x + 2),
    y: range(stand.y, stand.y),
    z: range(stand.z - 2, stand.z + 2),
  },
  cameraTarget: { x: stand.x, y: stand.y, z: stand.z + 8 },
}))

let removed = 0
let changed = false
for (const comp of json.components ?? []) {
  if (comp.name !== 'inspector::SceneMetadata-v5' || !comp.data) continue
  for (const entry of Object.values(comp.data)) {
    const meta = entry?.json
    if (!meta) continue
    if (!meta.layout) meta.layout = {}
    const parcels = meta.layout.parcels
    if (Array.isArray(parcels) && parcels.length > 0) {
      removed += parcels.length
      meta.layout.parcels = []
      changed = true
    } else if (!Array.isArray(parcels)) {
      meta.layout.parcels = []
      changed = true
    }
    const base = meta.layout.base
    if (!base || base.x !== origin || base.y !== origin) {
      meta.layout.base = { x: origin, y: origin }
      changed = true
    }
    if (JSON.stringify(meta.spawnPoints) !== JSON.stringify(spawns)) {
      meta.spawnPoints = spawns
      changed = true
    }
    if (meta.hideLandscapeTerrain !== true) {
      meta.hideLandscapeTerrain = true
      changed = true
    }
  }
}

if (!changed) {
  console.log('SceneMetadata-v5 already stripped and spawns match the lobby floor')
  process.exit(0)
}

writeFileSync(compositePath, JSON.stringify(json, null, 2) + '\n')

const definition = Composite.fromJson(json)
const src = 'assets/scene/main.composite'
const engine = Engine()
Composite.instance(engine, { src, composite: definition }, {
  getCompositeOrNull(name: string) {
    return name === src ? { src, composite: definition } : null
  },
}, {
  entityMapping: {
    type: EntityMappingMode.EMM_DIRECT_MAPPING,
    getCompositeEntity: (id: number) => id,
  },
})
const bytes = dumpEngineToCrdtCommands(engine)
writeFileSync(crdtPath, bytes)
console.log(`SceneMetadata cleaned (${removed} parcels removed) spawn ${stand.x.toFixed(1)},${stand.y.toFixed(3)},${stand.z.toFixed(1)} base ${origin},${origin} → composite ${JSON.stringify(json).length} bytes, main.crdt ${bytes.length} bytes`)
