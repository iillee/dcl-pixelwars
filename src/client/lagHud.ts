/**
 * Optional lag readout. Off by default: set DEBUG_LAG to true and
 * preview/deploy, or press 5 (IA_ACTION_5) when the overview camera is closed.
 *
 * Line reads: ping (round-trip to our scene server), upd (ms since the last
 * server message), fps (client frames). High ping or upd with a normal
 * server [Lag] tick points at the network or host. A high server tick ms
 * points at our code.
 */
import { engine, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { room } from '../shared/messages'
import { isOverviewActive } from './overviewCamera'

/** Set true to show the lag HUD on load. 5 still toggles it at runtime. */
export const DEBUG_LAG = false

let on = DEBUG_LAG
let pingMs = -1
let lastRx = 0
let fps = 0
let pingClock = 0
const PING_S = 2

export function lagHudOn(): boolean { return on }

export function lagHudLine(): string {
  const ping = pingMs >= 0 ? `${Math.round(pingMs)}ms` : '—'
  const upd = lastRx > 0 ? `${Math.max(0, Date.now() - lastRx)}ms` : '—'
  return `LAG  ping ${ping}  upd ${upd}  fps ${Math.round(fps)}`
}

export function noteServerRx(): void { lastRx = Date.now() }

export function noteLagPong(t: number): void {
  if (!Number.isFinite(t)) return
  pingMs = Math.max(0, Date.now() - t)
  lastRx = Date.now()
}

export function initLagHud(): void {
  on = DEBUG_LAG
  engine.addSystem((dt: number) => {
    if (!isOverviewActive() && inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) {
      on = !on
    }
    if (dt > 0 && dt < 1) fps = fps > 0 ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt
    if (!on) return
    pingClock += dt
    if (pingClock < PING_S) return
    pingClock = 0
    room.send('lagPing', { t: Date.now() })
  })
}