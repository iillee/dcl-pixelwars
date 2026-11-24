/**
 * Client tick for the round-end curtain: arm lobby-swap deferral, start the
 * drop when a round ends, flush the pending lobby rebuild once the mask is
 * opaque, and retract only after the lobby floor (and its colliders) is ready.
 */
import { engine } from '@dcl/sdk/ecs'
import { events } from '../shared/events'
import {
  advanceCurtain, isCurtainCovering, startRoundCurtain, isCurtainIdle,
} from '../shared/roundCurtain'
import {
  armLobbySwapDeferral, flushPendingLobbyWorld, hasPendingLobbyWorld, isLobbyFloorReady,
} from '../maze/rebuild'

export function initRoundCurtain(): void {
  armLobbySwapDeferral()
  events.on('round:ended', () => { startRoundCurtain() })
  engine.addSystem(() => {
    if (isCurtainIdle() && !hasPendingLobbyWorld()) return
    advanceCurtain(Date.now(), isLobbyFloorReady() && !hasPendingLobbyWorld())
    // Only rebuild once the mask is fully down — never during the slide.
    if (isCurtainCovering()) flushPendingLobbyWorld()
  })
}
