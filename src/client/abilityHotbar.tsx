/**
 * abilityHotbar.tsx — bottom-centre PvP hotbar: LUNGE (E) left, PAINT BOMB
 * (F) right (Dash parked, see shared/pvp.ts). Look and geometry ported from dcl-snowdrift
 * (layer.inventoryHotbar / layer.brushSize TorchButton + LogsButton +
 * KeyHintBadge / layer.relightPrompt + layer.feedPrompt / layer.hotbarBridge),
 * rebuilt with plain React-ECS because pixelwars has no UI-kit dependency.
 *
 *   - Slots: 72 px desktop / 112 px mobile, opaque dark bg, 18 px radius,
 *     constant 4 px border (white, gold while its tooltip is up).
 *   - Gold fill inside the slot = recharge progress (rises from empty after
 *     use, full when ready). Seconds left are shown while cooling down.
 *   - Small E / F hint top-left on desktop only.
 *   - Gold tooltip chip with black text tucked under each slot (inner end
 *     hidden behind the button, `tuck` px) while the ability
 *     is ready: DASH to the left, PAINT BOMB to the right. Tapping it fires
 *     the ability too. Mobile adds the gold bridge strip joining slot and chip.
 *     Bridge + tooltips render before the slots so buttons win the overlap
 *     (snowdrift: hotbarBridge → inventoryHotbar → prompts).
 *   - When any mode is 'alternate', a small chip above says whether this
 *     round has abilities or is paint-only.
 *
 * Bottom centre stays clear of the overview column (right edge, vertical
 * centre) and the native mobile joystick / jump (bottom corners).
 */

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { LUNGE_MODE, BURST_MODE } from '../shared/pvp'
import { getLungeHud, triggerLunge } from './lunge'
import { getBurstHud, triggerBurst } from './paintBurst'

export const SLOT_BG = Color4.create(0.08, 0.08, 0.10, 1)
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
export const GOLD_BORDER = Color4.create(1, 1, 1, 0.95)
const GOLD_FILL = Color4.create(1, 1, 1, 0.9)
const WHITE_BORDER = Color4.create(1, 1, 1, 0.75)
const DIM_BORDER = Color4.create(1, 1, 1, 0.3)
const BLACK = Color4.create(0, 0, 0, 1)
const WHITE = Color4.White()
/** The one light panel colour shared by the hotbar, clock, score bar and summary tables. */
export const PANEL_LIGHT = WHITE
/** Dark ring between the light rim and a light fill (clock, top painters, overview buttons). */
export const TILE_RING = 6
const DIM = Color4.create(1, 1, 1, 0.35)
const CHIP_BG = Color4.create(0.1, 0.1, 0.1, 0.92) // = COUNTDOWN_BG in ui.tsx

export const RADIUS = 18
const RADIUS_SM = 12
export const BORDER_W = 4
const FILL_INSET = BORDER_W + 2
const SLOT_MARGIN_X = 8

type Geo = {
  slot: number; icon: number; bottom: number; halfRow: number; tipH: number
  tipBorder: number; tipPadX: number; tipFont: number
  bridgeInner: number; bridgeW: number
  /** How far the chip's inner end tucks under the slot (px). = snowdrift's
   *  bridge depth into the button (desktop 24, mobile 38), so the chip's
   *  inner edge lands where snowdrift's gold connector starts. */
  tuck: number
}
const DESKTOP: Geo = { slot: 72, icon: 40, bottom: 30, halfRow: 80, tipH: 71, tipBorder: 3, tipPadX: 14, tipFont: 20, bridgeInner: 56, bridgeW: 50, tuck: 48 }
const MOBILE: Geo = { slot: 112, icon: 64, bottom: 0, halfRow: 128, tipH: 112, tipBorder: 4, tipPadX: 20, tipFont: 32, bridgeInner: 90, bridgeW: 80, tuck: 72 }

type Hud = { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number; text?: string }

function KeyHint(props: { label: string }) {
  if (isMobile()) return null
  return (
    <Label
      key={`ui_pvp_key_${props.label}`}
      value={`<b>${props.label}</b>`}
      fontSize={14}
      color={Color4.create(0, 0, 0, 1)}
      uiTransform={{ positionType: 'absolute', position: { top: 6, left: 10 }, width: 16, height: 16 }}
    />
  )
}

function Slot(props: { id: string; keyLabel: string; hud: Hud; glyph?: string; iconSrc?: string; onPress: () => void; g: Geo }) {
  const { hud, g } = props
  const fill = !hud.enabled ? 0 : hud.ready ? 1 : Math.max(0, Math.min(1, 1 - hud.cooldownFrac))
  const cooling = hud.enabled && !hud.ready && hud.cooldown > 0
  const border = !hud.enabled ? DIM_BORDER : hud.ready ? GOLD_BORDER : WHITE_BORDER
  return (
    <UiEntity
      key={`ui_pvp_slot_${props.id}`}
      uiTransform={{
        width: g.slot, height: g.slot, margin: { left: SLOT_MARGIN_X, right: SLOT_MARGIN_X },
        justifyContent: 'center', alignItems: 'center',
        borderRadius: RADIUS, borderWidth: BORDER_W, borderColor: border, pointerFilter: 'block',
      }}
      uiBackground={{ color: SLOT_BG }}
      onMouseDown={props.onPress}
    >
      {fill > 0 && (
        <UiEntity
          key={`ui_pvp_fillFrame_${props.id}`}
          uiTransform={{
            positionType: 'absolute', width: '100%', height: '100%',
            padding: { top: FILL_INSET, bottom: FILL_INSET, left: FILL_INSET, right: FILL_INSET },
            flexDirection: 'column', justifyContent: 'flex-end', pointerFilter: 'none',
          }}
        >
          <UiEntity
            key={`ui_pvp_fill_${props.id}`}
            uiTransform={{ width: '100%', height: `${Math.round(fill * 100)}%`, borderRadius: RADIUS_SM }}
            uiBackground={{ color: GOLD_FILL }}
          />
        </UiEntity>
      )}
      <KeyHint label={props.keyLabel} />
      {/* Glyph / icon hide while cooling so the countdown is the only centre mark
          (Dash arrows especially — they clutter the seconds). */}
      {props.iconSrc ? (
        <UiEntity
          key={`ui_pvp_icon_${props.id}`}
          uiTransform={{ width: g.icon, height: g.icon, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: props.iconSrc }, color: hud.enabled ? (props.id === 'lunge' ? Color4.create(0, 0, 0, 1) : WHITE) : DIM }}
        />
      ) : null}
      {hud.text ? (
        // Burst: charge progress ('7/10') or active seconds ('2s'), bottom of the slot.
        <Label
          key={`ui_pvp_text_${props.id}`}
          value={`<b>${hud.text}</b>`}
          fontSize={Math.round(g.slot * 0.18)}
          color={fill > 0.2 ? BLACK : WHITE}
          textAlign="middle-center"
          uiTransform={{ positionType: 'absolute', position: { bottom: Math.round(g.slot * 0.06), left: 0 }, width: '100%', height: Math.round(g.slot * 0.22) }}
        />
      ) : null}
      {!props.iconSrc ? (
        <Label
          key={`ui_pvp_glyph_${props.id}`}
          value={props.glyph ?? ''}
          fontSize={Math.round(g.icon * 0.9)}
          color={!hud.enabled ? DIM : hud.ready ? BLACK : WHITE}
          textAlign="middle-center"
          uiTransform={{ width: g.icon, height: g.icon }}
        />
      ) : null}
    </UiEntity>
  )
}

function Tooltip(props: { id: string; side: 'left' | 'right'; text: string; onPress: () => void; g: Geo }) {
  const { g } = props
  const mobile = isMobile()
  return (
    <UiEntity
      key={`ui_pvp_tip_${props.id}`}
      uiTransform={{
        positionType: 'absolute',
        position: props.side === 'left' ? { bottom: g.bottom, right: '50%' } : { bottom: g.bottom, left: '50%' },
        // Underlap: inner end starts `tuck` px inside the slot footprint
        // (halfRow = slot outer edge) and hides behind the slot, which
        // paints later. Inner padding grows by `tuck` so the text clears.
        margin: props.side === 'left' ? { right: g.halfRow - g.tuck } : { left: g.halfRow - g.tuck },
        height: g.tipH, flexDirection: 'row', alignItems: 'center',
        padding: props.side === 'left'
          ? { left: g.tipPadX, right: g.tipPadX + g.tuck }
          : { left: g.tipPadX + g.tuck, right: g.tipPadX },
        borderRadius: RADIUS, borderWidth: g.tipBorder, borderColor: GOLD_BORDER, pointerFilter: 'block',
      }}
      uiBackground={{ color: WHITE }}
      onMouseDown={props.onPress}
    >
      <Label
        key={`ui_pvp_tipLabel_${props.id}`}
        value={mobile ? props.text : `<b>${props.text}</b>`}
        fontSize={g.tipFont}
        color={BLACK}
        font="sans-serif"
        textAlign="middle-left"
        uiTransform={{ width: 'auto', height: Math.round(g.tipFont * 1.6) }}
      />
    </UiEntity>
  )
}

function Bridge(props: { id: string; side: 'left' | 'right'; g: Geo }) {
  const { g } = props
  return (
    <UiEntity
      key={`ui_pvp_bridge_${props.id}`}
      uiTransform={{
        positionType: 'absolute',
        position: props.side === 'left' ? { bottom: g.bottom, right: '50%' } : { bottom: g.bottom, left: '50%' },
        margin: props.side === 'left' ? { right: g.bridgeInner } : { left: g.bridgeInner },
        width: g.bridgeW, height: g.tipH, pointerFilter: 'none',
      }}
      uiBackground={{ color: WHITE }}
    />
  )
}

function roundLabel(lunge: Hud, bomb: Hud): string {
  if (LUNGE_MODE !== 'alternate' && BURST_MODE !== 'alternate') return ''
  return lunge.enabled || bomb.enabled ? 'LUNGE + BURST ROUND' : 'PAINT ONLY'
}

/** Render inside the full-screen UI root (src/ui.tsx). */
export function AbilityHotbar() {
  const lunge = getLungeHud()
  const bomb = getBurstHud()
  if (!lunge.show && !bomb.show) return null
  const g = isMobile() ? MOBILE : DESKTOP
  const mobile = isMobile()
  const label = roundLabel(lunge, bomb)
  const lungeTip = lunge.show && lunge.ready
  const bombTip = bomb.show && bomb.ready
  // Paint order = snowdrift: bridge + tooltips first (behind), slots last (on top)
  // where the chip kisses the button edge. Tooltips on the outer sides.
  return (
    <UiEntity
      key="ui_pvp_root"
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, pointerFilter: 'none' }}
    >
      {mobile && lungeTip && <Bridge id="lunge" side="left" g={g} />}
      {mobile && bombTip && <Bridge id="burst" side="right" g={g} />}
      {lungeTip && <Tooltip id="lunge" side="left" text="LUNGE" onPress={triggerLunge} g={g} />}
      {bombTip && <Tooltip id="burst" side="right" text="BURST" onPress={triggerBurst} g={g} />}
      <UiEntity
        key="ui_pvp_row"
        uiTransform={{
          positionType: 'absolute', position: { bottom: g.bottom, left: 0 }, width: '100%',
          flexDirection: 'column', alignItems: 'center', pointerFilter: 'none',
        }}
      >
        {label !== '' && (
          <UiEntity
            key="ui_pvp_round"
            uiTransform={{ height: 28, padding: { left: 12, right: 12 }, margin: { bottom: 8 }, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: CHIP_BG }}
          >
            <Label value={label} fontSize={14} color={label === 'PAINT ONLY' ? WHITE : GOLD} textAlign="middle-center" />
          </UiEntity>
        )}
        <UiEntity key="ui_pvp_slots" uiTransform={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
          {lunge.show && <Slot id="lunge" keyLabel="E" hud={lunge} iconSrc="assets/images/lunge_chevron.png" onPress={triggerLunge} g={g} />}
          {bomb.show && <Slot id="burst" keyLabel="F" hud={bomb} iconSrc="assets/images/burst.png" onPress={triggerBurst} g={g} />}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
