/**
 * Load splash: full-screen white cover with the Pixelwars logo centred, hiding the messy first
 * seconds (maze growing in, snapshot paint, HUD settling). Hidden once the first server snapshot
 * has arrived AND the maze is built, but never before SPLASH_MIN_S and always by SPLASH_MAX_S;
 * then fades out.
 *
 * The logo is 16:9 and is contained (letterboxed) so ultrawide and portrait screens do not stretch
 * it. The oversized white bleed covers the bars and the phone safe-area strips around the HUD root.
 */
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMazeReady } from '../maze/rebuild'
import { hasSnapshot } from './clientHandler'

export const SPLASH_MIN_S = 1.0 // shown at least this long
export const SPLASH_MAX_S = 4.0 // hidden by this time no matter what
export const SPLASH_FADE_S = 0.3 // fade-out duration
export const SPLASH_SRC = 'assets/images/splash.png'
export const SPLASH_AR = 16 / 9
const SPLASH_CANVAS_W = 1920
const SPLASH_CANVAS_H = 1080

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

// White cover is deliberately oversized and offset beyond the HUD root: on phones the UI root is
// inset (safe area) / scaled to the 1920x1080 virtual canvas, so '100%' of it left uncovered strips.
const SPLASH_BLEED = 4000 // px (virtual) the cover extends past every edge of the HUD root

/** True while the white load cover is still up. The format banner waits this out so it isn't hidden. */
export function loadSplashCovering(): boolean {
  return alpha > 0.05
}

/** Virtual size of a 16:9 rect contained in the HUD canvas (letterbox if the canvas is stretched). */
export function splashImageSize(canvasW = SPLASH_CANVAS_W, canvasH = SPLASH_CANVAS_H): { w: number; h: number } {
  const boxW = SPLASH_CANVAS_W
  const boxH = SPLASH_CANVAS_H
  const w = canvasW > 0 ? canvasW : boxW
  const h = canvasH > 0 ? canvasH : boxH
  const ar = w / h
  if (Math.abs(ar - SPLASH_AR) < 0.02) return { w: boxW, h: boxH }
  // If the 1920x1080 virtual canvas is stretched to a different screen aspect, shrink the
  // virtual size so the logo still appears 16:9 (contain / letterbox).
  const virtAR = (SPLASH_AR * SPLASH_AR) / ar
  if (virtAR >= boxW / boxH) return { w: boxW, h: boxW / virtAR }
  return { w: boxH * virtAR, h: boxH }
}

function liveSplashImageSize(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0 || c.height <= 0) return splashImageSize()
  return splashImageSize(c.width, c.height)
}

export function SplashScreen() {
  if (alpha <= 0) return null
  const size = liveSplashImageSize()
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block', overflow: 'visible' }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -SPLASH_BLEED, left: -SPLASH_BLEED }, width: 1920 + 2 * SPLASH_BLEED, height: 1080 + 2 * SPLASH_BLEED, pointerFilter: 'block' }}
        uiBackground={{ color: Color4.create(1, 1, 1, alpha) }}
      />
      <UiEntity
        uiTransform={{ width: size.w, height: size.h, flexShrink: 0 }}
        uiBackground={{
          textureMode: 'stretch',
          texture: { src: SPLASH_SRC },
          color: Color4.create(1, 1, 1, alpha),
        }}
      />
    </UiEntity>
  )
}
