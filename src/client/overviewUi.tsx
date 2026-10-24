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
import { KeyHint, RADIUS, BORDER_W, GOLD_BORDER, SLOT_BG, PANEL_LIGHT, TILE_RING } from './abilityHotbar'
import {
  isOverviewActive, toggleOverview, rotateOverview,
  overviewZoomIn, overviewZoomOut, canOverviewZoomIn, canOverviewZoomOut,
} from './overviewCamera'

const INK = Color4.create(0.13, 0.13, 0.15, 1) // = SUMMARY_INK in ui.tsx
const INK_DIM = Color4.create(0.13, 0.13, 0.15, 0.3)
/** Yellow plate on the eye button while overview is on. The eye glyph stays INK. */
const EYE_FILL_ON = Color4.create(1, 0.88, 0.15, 1)
const SMALL = 68 // same height as the clock panel
const GLYPH = 24 // +/− bar length and rotate icon box
const BAR = 4    // glyph stroke
/** White silhouette, tinted with the glyph colour. Same box as the +/− strokes. */
const ROTATE_SRC = 'assets/images/overview_rotate.png'

/** + and − are bars. Rotate is a thick near-full circular arrow (⟳ isn't in the UI font). */
function Glyph(props: { kind: 'in' | 'out' | 'rot'; color: Color4 }) {
  const c = props.color
  if (props.kind === 'rot') {
    return (
      <UiEntity uiTransform={{ width: GLYPH, height: GLYPH, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: ROTATE_SRC }, color: c }} />
    )
  }
  return (
    <UiEntity uiTransform={{ width: GLYPH, height: GLYPH, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', width: GLYPH, height: BAR, position: { top: (GLYPH - BAR) / 2, left: 0 } }} uiBackground={{ color: c }} />
      {props.kind === 'in' && <UiEntity uiTransform={{ positionType: 'absolute', width: BAR, height: GLYPH, position: { top: 0, left: (GLYPH - BAR) / 2 } }} uiBackground={{ color: c }} />}
    </UiEntity>
  )
}

/** Key-tile framed square button (light rim, dark ring, PANEL_LIGHT fill) used for the top bar buttons. */
export function TileButton(props: { id: string; onPress: () => void; children?: any; marginRight?: number; keyLabel?: string; fill?: Color4 }) {
  return (
    <UiEntity
      key={props.id}
      uiTransform={{
        width: SMALL, height: SMALL, flexShrink: 0, margin: { right: props.marginRight ?? 0 }, borderRadius: RADIUS, pointerFilter: 'block',
        borderWidth: BORDER_W, borderColor: GOLD_BORDER, padding: TILE_RING,
      }}
      uiBackground={{ color: SLOT_BG }}
      onMouseDown={props.onPress}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: RADIUS - BORDER_W - TILE_RING, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: props.fill ?? PANEL_LIGHT }}>
        {props.children}
      </UiEntity>
      {props.keyLabel && <KeyHint label={props.keyLabel} />}
    </UiEntity>
  )
}
export const TOP_BTN = SMALL
export const TOP_GAP = 8

function SmallButton(props: { id: string; kind: 'in' | 'out' | 'rot'; enabled: boolean; onPress: () => void; keyLabel?: string }) {
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
      {props.keyLabel && <KeyHint label={props.keyLabel} />}
    </UiEntity>
  )
}

// Eye icon copied from dcl-snowdrift layer.brushSize.tsx SpectatorButton
// (assets/images/eye.png, white silhouette, 3:2 box). Stays ink; the plate goes yellow while overview is on.
const EYE_SRC = 'assets/images/eye.png'
const EYE_W = 21
const EYE_H = 14
const ROW_GAP = 8

/** Eye button (left of the timer): toggles overview. The white plate turns yellow while on; the eye stays ink. */
export function OverviewEye() {
  return (
    <TileButton id="ui_overview_eye" onPress={() => { playUiClick(); toggleOverview() }} keyLabel="4"
      fill={isOverviewActive() ? EYE_FILL_ON : PANEL_LIGHT}>
      <UiEntity uiTransform={{ width: EYE_W * 1.6, height: EYE_H * 1.6, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: EYE_SRC }, color: INK }} />
    </TileButton>
  )
}

/** Desktop: small eye inside the clock panel under the star (absolute), as before the mobile top-button split. */
export function OverviewEyeInline() {
  return (
    <UiEntity
      key="ui_overview_eye_inline"
      uiTransform={{ width: EYE_W, height: EYE_H, positionType: 'absolute', position: { top: 35, left: 19 }, pointerFilter: 'block' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: EYE_SRC }, color: INK }}
      onMouseDown={() => { playUiClick(); toggleOverview() }}
    />
  )
}

/** Overview buttons in a row popping out to the LEFT of the eye button (absolute inside the eye's slot). */
export function OverviewRow(props: { desktop?: boolean } = {}) {
  if (!isOverviewActive()) return null
  return (
    <UiEntity
      key="ui_overview_row"
      uiTransform={{
        positionType: 'absolute', position: props.desktop ? { top: 0, right: 200 + TOP_GAP + SMALL } /* desktop: left of the eye (each button's 8 px right margin = gap) */ : { top: 0, left: SMALL + ROW_GAP }, // mobile: grows right of the eye
        flexDirection: 'row', alignItems: 'flex-start', pointerFilter: 'none',
      }}
    >
      {/* Mobile (grows right of the eye): rotate first, next to the eye; desktop keeps + − rotate. */}
      {!props.desktop && <SmallButton id="ov_rot" kind="rot" enabled={true} onPress={() => rotateOverview(1)} />}
      {<SmallButton id="ov_in" kind="in" enabled={canOverviewZoomIn()} onPress={overviewZoomIn} keyLabel={props.desktop ? '1' : undefined} />}
      {<SmallButton id="ov_out" kind="out" enabled={canOverviewZoomOut()} onPress={overviewZoomOut} keyLabel={props.desktop ? '2' : undefined} />}
      {props.desktop && <SmallButton id="ov_rot" kind="rot" enabled={true} onPress={() => rotateOverview(1)} keyLabel="3" />}
    </UiEntity>
  )
}
