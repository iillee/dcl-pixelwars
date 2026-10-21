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
import { RADIUS, BORDER_W, GOLD_BORDER, SLOT_BG, PANEL_LIGHT, TILE_RING } from './abilityHotbar'
import {
  isOverviewActive, toggleOverview, rotateOverview,
  overviewZoomIn, overviewZoomOut, canOverviewZoomIn, canOverviewZoomOut,
} from './overviewCamera'

const INK = Color4.create(0.13, 0.13, 0.15, 1) // = SUMMARY_INK in ui.tsx
const INK_DIM = Color4.create(0.13, 0.13, 0.15, 0.3)
const EYE_ON = Color4.create(0.72, 0.45, 0.0, 1) // dark amber: "active" but readable on the light panel
const SMALL = 68 // same height as the clock panel
const GLYPH = 24 // +/− bar length and rotate ring diameter
const BAR = 4    // glyph stroke

/** +, − and rotate drawn as boxes so they sit exactly centred (font glyphs don't, and ⟳ is missing). */
function Glyph(props: { kind: 'in' | 'out' | 'rot'; color: Color4 }) {
  const c = props.color
  if (props.kind === 'rot') {
    return (
      <UiEntity uiTransform={{ width: GLYPH, height: GLYPH, borderRadius: GLYPH / 2, borderWidth: BAR, borderColor: c, pointerFilter: 'none' }}>
        {/* arrow head notch at the top-right */}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: -BAR - 2, right: -2 }, width: 9, height: 9 }} uiBackground={{ color: c }} />
      </UiEntity>
    )
  }
  return (
    <UiEntity uiTransform={{ width: GLYPH, height: GLYPH, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', width: GLYPH, height: BAR, position: { top: (GLYPH - BAR) / 2, left: 0 } }} uiBackground={{ color: c }} />
      {props.kind === 'in' && <UiEntity uiTransform={{ positionType: 'absolute', width: BAR, height: GLYPH, position: { top: 0, left: (GLYPH - BAR) / 2 } }} uiBackground={{ color: c }} />}
    </UiEntity>
  )
}

function SmallButton(props: { id: string; kind: 'in' | 'out' | 'rot'; enabled: boolean; onPress: () => void }) {
  return (
    <UiEntity
      key={props.id}
      uiTransform={{
        width: SMALL, height: SMALL, margin: { right: ROW_GAP }, borderRadius: RADIUS, pointerFilter: 'block',
        // Hotbar key-tile frame: light rim, dark ring, PANEL_LIGHT fill.
        borderWidth: BORDER_W, borderColor: GOLD_BORDER, padding: TILE_RING,
      }}
      uiBackground={{ color: SLOT_BG }}
      onMouseDown={() => { if (!props.enabled) return; playUiClick(); props.onPress() }}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: RADIUS - BORDER_W - TILE_RING, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: PANEL_LIGHT }}>
        <Glyph kind={props.kind} color={props.enabled ? INK : INK_DIM} />
      </UiEntity>
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
        positionType: 'absolute', position: { top: 35, left: 19 },
        pointerFilter: 'block',
      }}
      uiBackground={{ textureMode: 'stretch', texture: { src: EYE_SRC }, color: isOverviewActive() ? EYE_ON : INK }}
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
      {<SmallButton id="ov_in" kind="in" enabled={canOverviewZoomIn()} onPress={overviewZoomIn} />}
      {<SmallButton id="ov_out" kind="out" enabled={canOverviewZoomOut()} onPress={overviewZoomOut} />}
      {<SmallButton id="ov_rot" kind="rot" enabled={true} onPress={() => rotateOverview(1)} />}
    </UiEntity>
  )
}
