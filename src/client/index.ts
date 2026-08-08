/**
 * client.ts — client runtime orchestrator.
 *
 * Wires the client-side modules together in a controlled boot order and
 * registers the two top-level systems (seed watcher, first-joiner init)
 * that don't belong to any single feature module.
 *
 * All heavy lifting lives in its natural home:
 *   - client/maze/*                  — maze data, generation, visuals
 *   - client/paint                   — grid painting + coverage
 *   - client/clientHandler           — network boundary (room.on/send)
 *   - client/audio                   — music + UI SFX
 *   - client/ui/*                    — HUD layers + theme (React-ECS)
 *
 * Kept in this file (for now):
 *   - Composite lever-entity scrubber (removes a decorative composite entity)
 *   - Seed watcher (SeedHolder → rebuildMaze)
 *   - First-joiner init (roll seed if none is synced after grace period)
 *
 * These will move to client/index.ts in a future commit alongside a
 * proper waitForLoad gate (sky-chaser pattern).
 */

import { engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import {
	SeedHolder,
	seedHolder,
} from 'src/shared/components'
import { SEED_NETWORK_ID } from 'src/shared/paintGrid'

import { initAudio } from 'src/client/audio'
import { initBotVisual } from 'src/client/bots/botVisual'
import { initClientHandler } from 'src/client/clientHandler'
import { CELL, STEP, lookupTile } from 'src/shared/maze/generator'
import { initMazeNet, rebuildMaze } from 'src/client/maze/rebuild'
import { initPaintNet, initPaintingSystem } from 'src/client/paint'
import { initPlayerNet } from 'src/client/player'
import { getRoundIndex, initRoundNet } from 'src/client/round'
import { runStress } from 'src/client/stress'
import { setupUi } from 'src/client/ui'

// ─── Stress-test toggle (Squareoff design §8.1) ─────────────────────
// Set to 0 for normal maze. Non-zero = spawn N planes at spawn, skip maze.
// Try: 5000, 15000, 30000. Read fps from the floating text at spawn.
const STRESS_COUNT = 0

// ─── Seed watcher ───────────────────────────────────────────────────
// Reacts to any change in the synced seed (set by first-joiner init or by
// the server's roundReset message) and rebuilds the maze.
let currentSeed = 0
engine.addSystem(() => {
  const s = SeedHolder.get(seedHolder).seed
  if (s !== 0 && s !== currentSeed) {
    currentSeed = s
    rebuildMaze(s)
  }
})

// ─── First-joiner initialization ────────────────────────────────────
// If we've been in-scene for a grace period and the synced seed is still 0,
// nobody has ever set it — we're the first player. Roll a seed from the
// UTC round index so the scene isn't empty forever. Subsequent joiners
// will receive the current seed via CRDT sync before their grace elapses
// and skip this path.
let initTimer = 0
let initDone = false
const INIT_GRACE = 1.5 // seconds
engine.addSystem((dt: number) => {
  if (initDone) return
  initTimer += dt
  if (initTimer < INIT_GRACE) return
  initDone = true
  if (SeedHolder.get(seedHolder).seed === 0) {
    const s = getRoundIndex() || 1
    console.log(`No existing maze seed after ${INIT_GRACE}s — initializing with round index ${s}`)
    SeedHolder.createOrReplace(seedHolder, { seed: s })
  }
})

// ─── setupClient — boot sequence ────────────────────────────────────
export async function setupClient(): Promise<void> {
	if (STRESS_COUNT > 0) { runStress(STRESS_COUNT); return }
	initAudio()

	// Composite-lever scrubber. The scene's main.composite still contains a
	// decorative lever entity from an earlier iteration where pulling it
	// regenerated the maze. UTC-boundary rounds + server roundReset replaced
	// that flow entirely, but removing the entity from the composite would
	// disturb interdependent asset-packs data — so we remove it at runtime.
	// Every entity carrying an asset-packs::States component (only the lever,
	// in practice) is deleted on boot along with its descendants.
	engine.addSystem(() => {
	const statesComp = engine.getComponentOrNull('asset-packs::States')
	if (!statesComp) return
		for (const [entity] of engine.getEntitiesWith(statesComp)) {
			engine.removeEntity(entity)
		}
	})

	// Painting system needs a callback to resolve player world position →
	// the tile they're standing on. lookupTile lives in the generator
	// module (private grid access).
	initPaintingSystem(CELL, STEP, lookupTile)

	// Wire event subscribers + CRDT paint observers. PaintCoverage /
	// PaletteEntry / PaintCell / LeaderboardState are server-owned
	// (syncEntity only on the server); clients observe replicas.
	initPaintNet()
	initMazeNet()
	initRoundNet()
	initPlayerNet()
	initBotVisual()

	// Register the network boundary LAST so `room.onMessage` subscribers
	// above are all in place before the first message can arrive.
	initClientHandler()

	// TRANSITIONAL (Phase 4 Step 6): SeedHolder is still client-authored.
	// Auth-server skill wants server-only syncEntity for singletons — move
	// seed ownership to the server, then remove this client syncEntity.
	syncEntity(seedHolder, [SeedHolder.componentId], SEED_NETWORK_ID)
	// Maze construction is fully event-driven from here: the seed watcher
	// above builds the maze the moment a non-zero seed arrives.

	// Finally, setup the UI
	setupUi()
}
