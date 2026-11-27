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
import { HUMAN_GLIDE_SPEED } from '../shared/pvp'

export const OWN_PAINT_SPEED_MULT: number = 1

// Client defaults (docs.decentraland.org locomotion page).
const DEFAULT_JOG = 8
const DEFAULT_RUN = 10

let boosted = false
let upgradeMult = 1

function applySpeed(): void {
  const paint = (boosted && OWN_PAINT_SPEED_MULT !== 1) ? OWN_PAINT_SPEED_MULT : 1
  const mult = paint * upgradeMult
  AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
    jogSpeed: DEFAULT_JOG * mult,
    runSpeed: DEFAULT_RUN * mult,
    glidingSpeed: HUMAN_GLIDE_SPEED * mult,
  })
}

function setBoost(on: boolean): void {
  if (on === boosted) return
  boosted = on
  applySpeed()
}

/** Compose with the own-paint bonus. 1 = no upgrade boost. Jog, run, and glide. */
export function setUpgradeSpeedMult(m: number): void {
  const next = Number.isFinite(m) && m > 0 ? m : 1
  if (next === upgradeMult) return
  upgradeMult = next
  applySpeed()
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
