/**
 * dashUi.tsx — on-screen DASH button + round-mode label (Dash prototype).
 *
 * Right edge, below the overview button and above the mobile jump button
 * in the bottom-right corner. Works on desktop (click) and mobile (tap);
 * desktop also has F. Shows the cooldown seconds and greys out while
 * unavailable. With DASH_MODE = 'alternate' a small label says whether
 * this round is a DASH ROUND or PAINT ONLY.
 */

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { getDashHud, triggerDash } from './dash'

const PANEL_BG = Color4.create(0.1, 0.1, 0.1, 0.92) // = COUNTDOWN_BG in ui.tsx
const READY_BG = Color4.create(1.0, 0.8, 0.3, 0.95) // = GOLD in overviewUi.tsx
const DARK = Color4.create(0.1, 0.1, 0.1, 1)
const DIM = Color4.create(1, 1, 1, 0.35)
const BTN = 96
const SHOW_KEY_HINT = !isMobile()

export function DashUi() {
  const hud = getDashHud()
  if (!hud.show) return null
  const label = hud.ready ? 'DASH' : hud.enabled && hud.cooldown > 0 ? `${Math.ceil(hud.cooldown)}` : 'DASH'
  return (
    <UiEntity
      key="ui_dash_wrap"
      uiTransform={{
        positionType: 'absolute', position: { right: 20, bottom: 300 },
        flexDirection: 'column', alignItems: 'center', pointerFilter: 'none',
      }}
    >
      {hud.roundLabel !== '' && (
        <UiEntity
          uiTransform={{ height: 28, padding: { left: 10, right: 10 }, margin: { bottom: 8 }, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: PANEL_BG }}
        >
          <Label value={hud.roundLabel} fontSize={14} color={hud.enabled ? READY_BG : Color4.White()} textAlign="middle-center" />
        </UiEntity>
      )}
      <UiEntity
        key="ui_dash_btn"
        uiTransform={{
          width: BTN, height: BTN, borderRadius: BTN / 2,
          flexDirection: 'column', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
        }}
        uiBackground={{ color: hud.ready ? READY_BG : PANEL_BG }}
        onMouseDown={triggerDash}
      >
        <Label value={label} fontSize={hud.ready ? 24 : 30} color={hud.ready ? DARK : DIM} textAlign="middle-center" />
        {SHOW_KEY_HINT && hud.enabled && (
          <Label value="F" fontSize={13} color={hud.ready ? DARK : DIM} textAlign="middle-center" />
        )}
      </UiEntity>
    </UiEntity>
  )
}
