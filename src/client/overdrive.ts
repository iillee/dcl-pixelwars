/**
 * overdrive.ts — star orb visuals, plus the feet the server uses to award a pickup.
 * The old star buff (glow, theme, touch knock) is gone. Pickup opens an upgrade.
 */
import { engine, Transform } from '@dcl/sdk/ecs'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import { BOT_AIM_REPORT_HZ } from '../shared/pvp'
import { inLobby } from './phase'
import { clearStarOrbs, hideStarOrb, initStarOrbs, showStarOrb } from './starOrb'

let wired = false
let feetClock = 0

export function initOverdrive(): void {
  if (wired) return
  wired = true
  initStarOrbs()
  events.on('star:spawn', ({ i, x, y, z, fall }) => {
    if (!Number.isFinite(i) || ![x, y, z].every(n => typeof n === 'number' && isFinite(n))) return
    showStarOrb(i, x, y, z, fall ?? 0)
  })
  events.on('star:despawn', ({ i }) => {
    if (Number.isFinite(i)) hideStarOrb(i)
  })
  events.on('round:reset', () => clearStarOrbs())
  events.on('lobby:floor', () => clearStarOrbs())
  engine.addSystem((dt) => {
    // Feet go out for the whole match. A solo player who stopped reporting
    // after the first star ended never registered the next pickup.
    if (inLobby()) return
    feetClock += dt
    if (feetClock < 1 / Math.max(BOT_AIM_REPORT_HZ, 10)) return
    feetClock = 0
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    try { room.send('botAim', { x: p.x, y: p.y, z: p.z }) } catch { /* room not up yet */ }
  })
}
