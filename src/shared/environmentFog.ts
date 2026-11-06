/**
 * EnvironmentFog (protocol component 1225) on this scene's SDK.
 *
 * `@dcl/sdk` 7.32 is the first release that exports the component. That
 * release also drops `isServer`, `registerMessages` and `@dcl/sdk/server`,
 * which this scene's client/server split uses, so the package stays on
 * 7.30.2 and the component is registered here with the same id and protobuf
 * layout. A desktop explorer that knows the component applies it. Mobile
 * and Bevy ignore the unknown id and keep their normal fog.
 *
 * Imported from src/index.ts so it is defined before the engine seals.
 */
import { engine, Entity } from '@dcl/sdk/ecs'
import { coreComponentMappings } from '@dcl/ecs/dist/components/generated/component-names.gen'

const NAME = 'core::EnvironmentFog'
const FOG_ID = 1225
coreComponentMappings[NAME] = FOG_ID

type Rgba = { r: number; g: number; b: number; a: number }
export type FogValue = {
  color?: { keys: { time: number; color: Rgba }[] }
  density?: number
}

function f32(n: number): number[] {
  const u = new Uint8Array(4)
  new DataView(u.buffer).setFloat32(0, n, true)
  return [u[0], u[1], u[2], u[3]]
}

/** Protobuf layout of PBEnvironmentFog / ColorGradient / Color4 in SDK 7.32. */
function encodeFog(value: FogValue): Uint8Array {
  const bytes: number[] = []
  const color = value.color?.keys?.[0]?.color
  if (color) {
    const c4: number[] = []
    const field = (tag: number, v: number) => {
      if (v !== 0) c4.push(tag, ...f32(v))
    }
    field(13, color.r)
    field(21, color.g)
    field(29, color.b)
    field(37, color.a)
    const key = [18, c4.length, ...c4]
    const grad = [10, key.length, ...key]
    bytes.push(10, grad.length, ...grad)
  }
  if (value.density !== undefined) bytes.push(21, ...f32(value.density))
  return Uint8Array.from(bytes)
}

type FogComponent = {
  create: (entity: Entity, value: FogValue) => void
  componentId: number
}

const schema = {
  serialize(value: FogValue, builder: { writeBuffer: (buf: Uint8Array, lengthPrefixed: boolean) => void }) {
    builder.writeBuffer(encodeFog(value), false)
  },
  deserialize(): FogValue {
    return {}
  },
  create(): FogValue {
    return {}
  },
  jsonSchema: {
    type: 'object',
    properties: {},
    serializationType: 'protocol-buffer',
    protocolBuffer: 'PBEnvironmentFog',
  },
}

const eng = engine as unknown as {
  defineComponentFromSchema: (name: string, spec: object) => FogComponent
}

export const EnvironmentFog = eng.defineComponentFromSchema(NAME, schema)

if (EnvironmentFog.componentId !== FOG_ID) {
  console.log(`[Water] EnvironmentFog registered as ${EnvironmentFog.componentId}, not ${FOG_ID}`)
}
