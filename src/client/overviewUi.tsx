/**
 * overviewUi.tsx — overview-mode button (+ zoom / rotate while active).
 *
 * Ported from dcl-snowdrift layer.cameraToggle.tsx (parcel-grid icon,
 * gold when active), restyled to the pixelwars HUD: same dark panel colour
 * and 18 px radius as the timer. Hidden behind a small eye (from
 * dcl-snowdrift) under the timer's star; the eye opens the buttons as a row
 * to the LEFT of the timer.
 */

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { playUiClick } from './audio'
import {
  isOverviewActive, toggleOverview, rotateOverview,
  overviewZoomIn, overviewZoomOut, canOverviewZoomIn, canOverviewZoomOut,
} from './overviewCamera'

const PANEL_BG = Color4.create(0.1, 0.1, 0.1, 0.92) // = COUNTDOWN_BG in ui.tsx
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
const DIM = Color4.create(1, 1, 1, 0.3)
const BTN = 72
const SMALL = 56

function ParcelGridIcon(props: { color: Color4 }) {
  const rows = [0, 1].map(r => (
    <UiEntity key={`r${r}`} uiTransform={{ flexDirection: 'row', margin: { top: r === 0 ? 0 : 2 } }}>
      {[0, 1, 2, 3].map(c => (
        <UiEntity key={`c${r}${c}`} uiTransform={{ width: 9, height: 9, margin: { left: c === 0 ? 0 : 2 } }} uiBackground={{ color: props.color }} />
      ))}
    </UiEntity>
  ))
  return <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>{rows}</UiEntity>
}

function SmallButton(props: { id: string; label: string; enabled: boolean; onPress: () => void }) {
  return (
    <UiEntity
      key={props.id}
      uiTransform={{ width: SMALL, height: SMALL, margin: { right: ROW_GAP }, justifyContent: 'center', alignItems: 'center', borderRadius: 14, pointerFilter: 'block' }}
      uiBackground={{ color: PANEL_BG }}
      onMouseDown={() => { if (!props.enabled) return; playUiClick(); props.onPress() }}
    >
      <Label value={props.label} fontSize={28} color={props.enabled ? Color4.White() : DIM} textAlign="middle-center" />
    </UiEntity>
  )
}

// Eye toggle (icon + tint copied from dcl-snowdrift layer.brushSize.tsx SpectatorButton:
// assets/images/eye.png, white silhouette, 3:2 box, gold while active).
const EYE_SRC = 'assets/images/eye.png'
const EYE_W = 21
const EYE_H = 14
const ROW_GAP = 8

/** Small eye under the timer's star (absolute inside the timer panel): opens/closes the row. */
export function OverviewEye() {
  return (
    <UiEntity
      key="ui_overview_eye"
      uiTransform={{
        width: EYE_W, height: EYE_H,
        positionType: 'absolute', position: { top: 41, left: 19 },
        pointerFilter: 'block',
      }}
      uiBackground={{ textureMode: 'stretch', texture: { src: EYE_SRC }, color: isOverviewActive() ? GOLD : Color4.White() }}
      onMouseDown={() => { playUiClick(); toggleOverview() }}
    />
  )
}

/** Overview buttons in a row popping out to the LEFT of the timer column (absolute in it). */
export function OverviewRow() {
  if (!isOverviewActive()) return null
  return (
    <UiEntity
      key="ui_overview_row"
      uiTransform={{
        positionType: 'absolute', position: { top: 0, right: 200 },
        flexDirection: 'row', alignItems: 'flex-start', pointerFilter: 'none',
      }}
    >
      {<SmallButton id="ov_in" label="+" enabled={canOverviewZoomIn()} onPress={overviewZoomIn} />}
      {<SmallButton id="ov_out" label="−" enabled={canOverviewZoomOut()} onPress={overviewZoomOut} />}
      {<SmallButton id="ov_rot" label="⟳" enabled={true} onPress={() => rotateOverview(1)} />}
    </UiEntity>
  )
}
