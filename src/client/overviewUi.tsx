/**
 * overviewUi.tsx — overview-mode button (+ zoom / rotate while active).
 *
 * Ported from dcl-snowdrift layer.cameraToggle.tsx (parcel-grid icon,
 * gold when active), restyled to the pixelwars HUD: same dark panel colour
 * and 18 px radius as the timer. Sits on the right edge, vertically
 * centred — clear of the top-centre timer/coverage pill, the full-screen
 * round banner (rendered above it) and the mobile joystick / jump buttons
 * at the bottom corners.
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
      uiTransform={{ width: SMALL, height: SMALL, margin: { bottom: 8 }, justifyContent: 'center', alignItems: 'center', borderRadius: 14, pointerFilter: 'block' }}
      uiBackground={{ color: PANEL_BG }}
      onMouseDown={() => { if (!props.enabled) return; playUiClick(); props.onPress() }}
    >
      <Label value={props.label} fontSize={28} color={props.enabled ? Color4.White() : DIM} textAlign="middle-center" />
    </UiEntity>
  )
}

/** Right-edge overview column. Render inside the full-screen UI root. */
export function OverviewUi() {
  const on = isOverviewActive()
  return (
    <UiEntity
      key="ui_overview_wrap"
      uiTransform={{
        width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
        flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', pointerFilter: 'none',
      }}
    >
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', margin: { right: 32 }, pointerFilter: 'none' }}>
        {on && <SmallButton id="ov_in" label="+" enabled={canOverviewZoomIn()} onPress={overviewZoomIn} />}
        {on && <SmallButton id="ov_out" label="−" enabled={canOverviewZoomOut()} onPress={overviewZoomOut} />}
        {on && <SmallButton id="ov_rot" label="⟳" enabled={true} onPress={() => rotateOverview(1)} />}
        <UiEntity
          key="ui_overview_btn"
          uiTransform={{ width: BTN, height: BTN, justifyContent: 'center', alignItems: 'center', borderRadius: 18, pointerFilter: 'block' }}
          uiBackground={{ color: PANEL_BG }}
          onMouseDown={() => { playUiClick(); toggleOverview() }}
        >
          <ParcelGridIcon color={on ? GOLD : Color4.White()} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
