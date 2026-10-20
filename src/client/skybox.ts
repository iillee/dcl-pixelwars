/**
 * skybox.ts — round-clock-driven SkyboxTime lock (literal port of dcl-snowdrift's skybox.ts).
 *
 * Writes SkyboxTime on engine.RootEntity at 10 Hz with a directional transitionMode so the
 * interpolator does not reset every frame. Large jumps delete the component first so we do not
 * ease the long way around midnight. We do not delete on every write — that leaks Explorer's
 * default time between frames. Snowdrift notes Worlds may ignore fixedTime (still honours the lock).
 */
import { engine, SkyboxTime, TransitionMode } from '@dcl/sdk/ecs'
import { DAY_NIGHT_ENABLED, SKYBOX_DAY_SEC, skySecondsAt } from '../shared/dayNight'

const WRITE_INTERVAL_S = 1 / 10
/** Sky-seconds: anything bigger is a snap (recreate) rather than an ease. */
const SNAP_ARC_SEC = 1800

let installed = false
let lastWritten = -1
let writeClock = 0

/** TM_FORWARD or TM_BACKWARD for the shorter path around the 24 h seam. */
function shortestMode(from: number, to: number): TransitionMode {
  const fwd = ((to - from) % SKYBOX_DAY_SEC + SKYBOX_DAY_SEC) % SKYBOX_DAY_SEC
  return fwd <= SKYBOX_DAY_SEC / 2 ? TransitionMode.TM_FORWARD : TransitionMode.TM_BACKWARD
}

function writeSkybox(seconds: number): void {
  if (lastWritten >= 0) {
    const fwd = ((seconds - lastWritten) % SKYBOX_DAY_SEC + SKYBOX_DAY_SEC) % SKYBOX_DAY_SEC
    if (Math.min(fwd, SKYBOX_DAY_SEC - fwd) > SNAP_ARC_SEC) {
      SkyboxTime.deleteFrom(engine.RootEntity)
      console.log(`skybox: snap ${lastWritten.toFixed(0)} -> ${seconds.toFixed(0)}`)
      lastWritten = -1
    }
  }
  const mode = lastWritten < 0 ? TransitionMode.TM_FORWARD : shortestMode(lastWritten, seconds)
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: seconds, transitionMode: mode })
  lastWritten = seconds
}

/** Lock the sky to the round clock. Idempotent; no-op when DAY_NIGHT_ENABLED is false. */
export function setupSkybox(): void {
  if (installed || !DAY_NIGHT_ENABLED) return
  installed = true
  writeSkybox(skySecondsAt())
  engine.addSystem((dt: number) => {
    writeClock += dt
    if (writeClock < WRITE_INTERVAL_S) return
    writeClock = 0
    writeSkybox(skySecondsAt())
  })
  console.log('skybox: locked to round clock at 10 Hz')
}
