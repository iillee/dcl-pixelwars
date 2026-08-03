/**
 * components.ts — shared ECS component definitions.
 *
 * MUST be statically imported from src/index.ts so all engine.defineComponent()
 * calls fire BEFORE main() begins (which seals the engine).
 * Dynamic-importing this file crashes with:
 *   "Engine is already sealed. No components can be added at this stage"
 *
 * Same rule as src/shared/messages.ts. See flagtag/src/shared/components.ts.
 */

import { engine, Schemas } from '@dcl/sdk/ecs'

// ─── SeedHolder ──────────────────────────────────────────────────────
// CRDT-synced maze seed. Set by first-joiner init and the round-boundary
// system in client.ts. Will be REMOVED in Phase 4 Step 6 when the server
// broadcasts roundReset directly.
export const SeedHolder = engine.defineComponent('maze::seed-holder', { seed: Schemas.Int })
export const seedHolder = engine.addEntity()
SeedHolder.create(seedHolder, { seed: 0 })
