/**
 * Load splash: full-screen white cover with "pixelwars" centred, hiding the messy first seconds
 * (maze growing in, snapshot paint, HUD settling). Hidden once the first server snapshot has arrived
 * AND the maze is built, but never before SPLASH_MIN_S and always by SPLASH_MAX_S; then fades out.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { isMazeReady } from '../maze/rebuild'
import { hasSnapshot } from './clientHandler'

export const SPLASH_MIN_S = 1.0 // shown at least this long
export const SPLASH_MAX_S = 4.0 // hidden by this time no matter what
export const SPLASH_FADE_S = 0.3 // fade-out duration

let t = 0
let fadeLeft = -1 // <0: not fading yet
let alpha = 1
engine.addSystem((dt: number) => {
  if (alpha <= 0) return
  t += dt
  if (fadeLeft < 0) {
    if (t >= SPLASH_MAX_S || (t >= SPLASH_MIN_S && hasSnapshot() && isMazeReady())) fadeLeft = SPLASH_FADE_S
    return
  }
  fadeLeft -= dt
  alpha = Math.max(0, fadeLeft / SPLASH_FADE_S)
})

export function SplashScreen() {
  if (alpha <= 0) return null
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: Color4.create(1, 1, 1, alpha) }}
    >
      <Label value="pixelwars" fontSize={72} color={Color4.create(0.1, 0.1, 0.12, alpha)} textAlign="middle-center" textWrap="nowrap" />
    </UiEntity>
  )
}
