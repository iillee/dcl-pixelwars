/**
 * Full-screen mask that slides down from the top at round end, covering the
 * messy lobby rebuild, then retracts once the floor is ready. The win summary
 * is a sibling drawn on top and stays after the mask lifts.
 */
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { CURTAIN_BLEED, curtainDrop, curtainPhase } from '../shared/roundCurtain'

/** Same dark ink as the summary title, so team-colored words stay opaque. */
const CURTAIN_MASK = Color4.create(0.07, 0.07, 0.09, 1)
/** Light lip at the leading edge — same family as the hotbar / summary panels. */
const CURTAIN_LIP = Color4.White()
const LIP_H = 10

function canvasSize(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0) return { w: 1280, h: 720 }
  const dpr = c.devicePixelRatio > 0 ? c.devicePixelRatio : 1
  return { w: c.width / dpr, h: c.height / dpr }
}

/** Vertical offset for the summary while it rides down with the mask. 0 after the drop. */
export function summarySlideY(canvasH: number, now = Date.now()): number {
  if (curtainPhase() !== 'down') return 0
  return (curtainDrop(now) - 1) * canvasH
}

export function RoundCurtainMask() {
  const drop = curtainDrop()
  if (drop <= 0) return null
  const cv = canvasSize()
  const top = (drop - 1) * cv.h - CURTAIN_BLEED
  const left = -CURTAIN_BLEED
  const width = cv.w + CURTAIN_BLEED * 2
  const height = cv.h + CURTAIN_BLEED * 2
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'block',
        overflow: 'visible',
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top, left },
          width,
          height,
          pointerFilter: 'block',
        }}
        uiBackground={{ color: CURTAIN_MASK }}
      />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: (drop - 1) * cv.h + cv.h - LIP_H, left: -CURTAIN_BLEED },
          width,
          height: LIP_H,
          pointerFilter: 'none',
        }}
        uiBackground={{ color: CURTAIN_LIP }}
      />
    </UiEntity>
  )
}
