/**
 * Full-screen mask that slides down from the top at round end, covering the
 * messy lobby rebuild, then retracts once the floor is ready. The win summary
 * is a sibling drawn on top and stays after the mask lifts.
 *
 * The fill is the winning team's palette colour. A tie is a vertical split of
 * every leading team; the white lip on the leading edge is unchanged.
 */
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { CURTAIN_BLEED, curtainDrop, curtainFillRgbs, curtainPhase } from '../shared/roundCurtain'


function rgb4(c: { r: number; g: number; b: number }): Color4 {
  return Color4.create(c.r, c.g, c.b, 1)
}

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

export function RoundCurtainMask(props: { teams?: readonly number[] } = {}) {
  const drop = curtainDrop()
  if (drop <= 0) return null
  const cv = canvasSize()
  const top = (drop - 1) * cv.h - CURTAIN_BLEED
  const left = -CURTAIN_BLEED
  const width = cv.w + CURTAIN_BLEED * 2
  const height = cv.h + CURTAIN_BLEED * 2
  const fills = curtainFillRgbs(props.teams ?? [])
  const split = fills.length > 1
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
          flexDirection: 'row',
          pointerFilter: 'block',
        }}
        uiBackground={split ? undefined : { color: rgb4(fills[0]) }}
      >
        {split
          ? fills.map((c) => (
              <UiEntity
                uiTransform={{
                  flexGrow: 1,
                  width: `${100 / fills.length}%`,
                  height: '100%',
                  flexShrink: 0,
                  pointerFilter: 'block',
                }}
                uiBackground={{ color: rgb4(c) }}
              />
            ))
          : null}
      </UiEntity>
    </UiEntity>
  )
}
