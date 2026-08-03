/**
 * waitForLoad.ts — startup gate.
 *
 * SDK7 boots the scene before the player entity, camera, and network
 * state are actually usable. Running gameplay code too early causes
 * intermittent bugs: missing Transform on PlayerEntity, empty
 * PlayerIdentityData, first paintTick landing before the server has
 * assigned our team.
 *
 * This module registers a system that polls each precondition every
 * frame; when they're all true it removes itself and calls `onReady()`.
 * Pattern lifted from stom66/dcl-sky-chaser (`sys_waitForLoad`).
 *
 * Preconditions checked:
 *   - PlayerEntity has a Transform (player has spawned into the scene)
 *   - CameraEntity has a Transform (renderer is up)
 *   - PlayerIdentityData exists with an address (wallet or guest id populated)
 *
 * We don't gate on isStateSyncronized() because Squareoff's authoritative
 * server is the source of truth — a joining client either gets a snapshot
 * from the server after teamAssigned, or is the first-joiner (whose seed
 * watcher rolls a fresh maze).
 */

import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'

export function waitForLoad(onReady: () => void): void {
  const sys = () => {
    if (!Transform.getOrNull(engine.PlayerEntity)) return
    if (!Transform.getOrNull(engine.CameraEntity)) return
    const pid = PlayerIdentityData.getOrNull(engine.PlayerEntity)
    if (!pid || !pid.address) return

    engine.removeSystem(sys)
    console.log('[Client] waitForLoad: ready')
    onReady()
  }
  engine.addSystem(sys)
}
