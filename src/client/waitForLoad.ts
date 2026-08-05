/**
 * waitForLoad.ts — startup gate.
 *
 * SDK7 boots the scene before the player entity and camera are usable.
 * Running gameplay code too early causes intermittent bugs: missing
 * Transform on PlayerEntity / CameraEntity.
 *
 * This module registers a system that polls each precondition every
 * frame; when they're all true it removes itself and calls `onReady()`.
 * Pattern lifted from stom66/dcl-sky-chaser (`sys_waitForLoad`).
 *
 * Preconditions checked:
 *   - PlayerEntity has a Transform (player has spawned into the scene)
 *   - CameraEntity has a Transform (renderer is up)
 *
 * Deliberately does NOT wait for PlayerIdentityData.address — local
 * preview guests often never get a wallet, and joinRoster already uses
 * an immediate guest-id fallback (see clientHandler). Gating here on
 * identity would stall boot forever in that case.
 *
 * We don't gate on isStateSyncronized() here either; clientHandler waits
 * for sync before sending room messages.
 */

import { engine, Transform } from '@dcl/sdk/ecs'


// MARK: waitForLoad

/**
 * Invoke onReady once the local player and camera transforms exist.
 */
export function waitForLoad(onReady: () => void): void {
	const sys = () => {
		if (!Transform.getOrNull(engine.PlayerEntity)) return
		if (!Transform.getOrNull(engine.CameraEntity)) return

		engine.removeSystem(sys)
		console.log('[Client] waitForLoad: ready')
		onReady()
	}
	engine.addSystem(sys)
}
