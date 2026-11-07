/**
 * Creator Hub copies scene.json's parcel list into
 * inspector::SceneMetadata-v5 inside assets/scene/main.composite.
 * On a 300×300 world that is 90,000 parcels (~1.58 MB). sdk-commands then
 * writes the same list into main.crdt, and every client loads that file
 * at start.
 *
 * scene.json is the deploy parcel map. The composite copy is not. This
 * empties layout.parcels (base and spawns stay) and, when it removed any,
 * regenerates main.crdt from the stripped composite.
 *
 *   npx tsx scripts/strip-scene-metadata.ts
 *
 * npm run build runs it first. Run it again after Creator Hub rewrites
 * the composite, before a deploy. Idempotent when the list is already empty.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Composite, Engine, EntityMappingMode } from '@dcl/ecs/dist-cjs'
import { dumpEngineToCrdtCommands } from '@dcl/inspector'

const compositePath = new URL('../assets/scene/main.composite', import.meta.url)
const crdtPath = new URL('../main.crdt', import.meta.url)

const json = JSON.parse(readFileSync(compositePath, 'utf8')) as {
  components?: Array<{ name?: string; data?: Record<string, { json?: { layout?: { parcels?: unknown[] } } }> }>
}

let removed = 0
for (const comp of json.components ?? []) {
  if (comp.name !== 'inspector::SceneMetadata-v5' || !comp.data) continue
  for (const entry of Object.values(comp.data)) {
    const parcels = entry?.json?.layout?.parcels
    if (!Array.isArray(parcels) || parcels.length === 0) continue
    removed += parcels.length
    entry.json!.layout!.parcels = []
  }
}

if (removed === 0) {
  console.log('SceneMetadata-v5 parcels already empty — composite and main.crdt left as they are')
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
console.log(`stripped ${removed} SceneMetadata parcels → composite ${JSON.stringify(json).length} bytes, main.crdt ${bytes.length} bytes`)
