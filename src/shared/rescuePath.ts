/**
 * rescuePath.ts — the Lakitu cloud's trip timings and path, shared by the
 * rider's client (client/fallRescue.ts), every observer's copy of the cloud,
 * and the server, which flies a fallen bot along the same path so the ghost
 * rides the cloud everyone sees.
 *
 * Path (cloud root, HANG_Y above the rider's feet): swoop in over the catch
 * during GRAB_S, rise to cruise height above the top floor, cruise to the
 * base, descend to ARRIVE_ABOVE over the base, then the rider drops.
 */
import { SKY_TOP_Y } from '../maze/level'

export const RESCUE_PATH = {
  /** Floater swoops in. Panel stays put so they can fall onto it. The rise does the lift. */
  GRAB_S: 0.4,
  /** Rise from the catch to cruise height (~95 m from the fall line at ~12.5; ~45 m/s, the old 0.9 s climb speed). */
  RISE_S: 2.1,
  /** Cruise across, above the top floor, to the base's XZ. */
  CRUISE_S: 1.7,
  /** Descend so the panel top sits just above the base. */
  DESCEND_S: 0.8,
  /** Walk only / no abilities after arrival, before full control. Target 0.5–0.8s. */
  LAND_LOCK_S: 0.65,
  /** Floater root height above the panel surface while carrying a player (~1.8 m avatar). The hook hangs 0.95 m below this, at the crown. */
  HANG_Y: 2.65,
  /**
   * Cloud root above a custom bot's feet. The custom ghost (GHOST_SCALE 1.2,
   * GHOST_FLOAT 1.0) has its outline crown at ~3.33 m, and the hook hangs 0.95 m
   * below the cloud root. 4.30 m puts the hook just above the crown and the puff
   * clearly over the head, matching the player clearance. The previous bot attach
   * reused HANG_Y 2.65 and sat inside the body.
   */
  BOT_HANG_Y: 4.30,
  /** Extra height at the start of the grab swoop. */
  APPROACH_EXTRA_Y: 4.5,
  /** Panel surface this many meters above SKY_TOP_Y while cruising, so the trip clears the roof. */
  CRUISE_CLEAR: 8,
  /** Panel surface above the base feet (baseSpawn y). Removing the panel is the drop. */
  ARRIVE_ABOVE: 1.5,
}

export type RescueVec = { x: number; y: number; z: number }
export type RescueTimes = { grab: number; rise: number; cruise: number; descend: number }

export const RESCUE_TIMES: RescueTimes = {
  grab: RESCUE_PATH.GRAB_S, rise: RESCUE_PATH.RISE_S, cruise: RESCUE_PATH.CRUISE_S, descend: RESCUE_PATH.DESCEND_S,
}

export function rescueTripSeconds(t: RescueTimes = RESCUE_TIMES): number {
  return t.grab + t.rise + t.cruise + t.descend
}

function lerp(a: RescueVec, b: RescueVec, u: number): RescueVec {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }
}

export function rescueHangY(who?: string): number {
  return who && who.toLowerCase().startsWith('bot:') ? RESCUE_PATH.BOT_HANG_Y : RESCUE_PATH.HANG_Y
}

function hangAt(p: RescueVec, extraY = 0, hangY = RESCUE_PATH.HANG_Y): RescueVec {
  return { x: p.x, y: p.y + hangY + extraY, z: p.z }
}

/** Cloud root pose `age` seconds after the catch. The rider's feet are `hangY` below `pos`
 *  once the grab is over. `done` is true after the descend leg. Bots pass BOT_HANG_Y. */
export function rescueCloudPose(catchP: RescueVec, base: RescueVec, age: number, t: RescueTimes = RESCUE_TIMES,
  hangY = RESCUE_PATH.HANG_Y):
  { pos: RescueVec; scale: number; done: boolean } {
  if (age < t.grab) {
    const u = age / Math.max(0.05, t.grab)
    return { pos: hangAt(catchP, (1 - u) * RESCUE_PATH.APPROACH_EXTRA_Y, hangY), scale: 0.2 + 0.8 * u, done: false }
  }
  let left = age - t.grab
  const cruiseY = SKY_TOP_Y + RESCUE_PATH.CRUISE_CLEAR + hangY
  const arriveY = base.y + RESCUE_PATH.ARRIVE_ABOVE + hangY
  const start = hangAt(catchP, 0, hangY)
  const riseTo = { x: catchP.x, y: cruiseY, z: catchP.z }
  const cruiseTo = { x: base.x, y: cruiseY, z: base.z }
  const landTo = { x: base.x, y: arriveY, z: base.z }
  const legs: Array<{ from: RescueVec; to: RescueVec; s: number }> = [
    { from: start, to: riseTo, s: t.rise },
    { from: riseTo, to: cruiseTo, s: t.cruise },
    { from: cruiseTo, to: landTo, s: t.descend },
  ]
  for (const leg of legs) {
    if (left <= leg.s) {
      const u = leg.s <= 0.001 ? 1 : Math.min(1, left / leg.s)
      return { pos: lerp(leg.from, leg.to, u), scale: 1, done: false }
    }
    left -= leg.s
  }
  return { pos: landTo, scale: 1, done: true }
}

/**
 * Delayed snapshot interpolation must not run while the bot is still riding
 * or dropping from the cloud. Those snapshots lag the local cloud, and when
 * the visual drop finishes they replay the descent — the bot pops back up
 * and is lowered a second time.
 */
export function rescueAllowsSnapshotInterp(riding: boolean): boolean {
  return !riding
}

/** Keep only the landing pose so a post-ride interpolator cannot climb the ride path. */
export function snapsAfterRescueRelease<P>(landT: number, landPos: P): Array<{ t: number; pos: P }> {
  return [{ t: landT, pos: landPos }]
}
