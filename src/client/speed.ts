/**
 * speed.ts — "faster on your own paint" (PO V1 Week 2, experimental).
 *
 * While the local player stands on cells that were already their team's
 * colour, jog/run speed is multiplied by OWN_PAINT_SPEED_MULT via
 * AvatarLocomotionSettings on engine.PlayerEntity. The component is only
 * written on state changes; leaving your colour or a round reset writes
 * the client defaults back.
 *
 * Tuning: set OWN_PAINT_SPEED_MULT = 1 to disable (the PO's fallback if
 * the bonus snowballs the leading team).
 */

import { engine, AvatarLocomotionSettings } from '@dcl/sdk/ecs'
import { isOnOwnPaint, resetOwnPaint } from '../paint'
import { events } from '../shared/events'

export const OWN_PAINT_SPEED_MULT: number = 1

// Client defaults (docs.decentraland.org locomotion page).
const DEFAULT_JOG = 8
const DEFAULT_RUN = 10

let boosted = false

function setBoost(on: boolean): void {
  if (on === boosted) return
  boosted = on
  if (on && OWN_PAINT_SPEED_MULT !== 1) {
    AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
      jogSpeed: DEFAULT_JOG * OWN_PAINT_SPEED_MULT,
      runSpeed: DEFAULT_RUN * OWN_PAINT_SPEED_MULT,
    })
  } else {
    // Write explicit defaults rather than deleting the component, so a
    // client that ignores removal can't keep the boost stuck on.
    AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
      jogSpeed: DEFAULT_JOG,
      runSpeed: DEFAULT_RUN,
    })
  }
}

export function initSpeedBonus(): void {
  events.on('round:reset', () => {
    resetOwnPaint()
    setBoost(false)
  })
  engine.addSystem(() => {
    setBoost(isOnOwnPaint())
  })
}
