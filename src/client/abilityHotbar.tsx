/**
 * abilityHotbar.tsx — bottom-centre PvP hotbar: LUNGE (E) left, PAINT BOMB
 * (F) right (Dash parked, see shared/pvp.ts). Look and geometry ported from dcl-snowdrift
 * (layer.inventoryHotbar / layer.brushSize TorchButton + LogsButton +
 * KeyHintBadge / layer.relightPrompt + layer.feedPrompt / layer.hotbarBridge),
 * rebuilt with plain React-ECS because pixelwars has no UI-kit dependency.
 *
 *   - Slots: 72 px desktop / 112 px mobile, white bg, 18 px radius,
 *     constant 4 px border (dark when ready, grey while cooling).
 *   - Dark overlay inside the slot = cooldown left (full after use, drains to
 *     nothing when ready). Seconds left are shown while cooling down.
 *   - Small E / F hint top-left on desktop only.
 *   - Light-grey tooltip chip (dark outline, black text) tucked under each slot (inner end
 *     hidden behind the button, `tuck` px) while the ability
 *     is ready: DASH to the left, PAINT BOMB to the right. Tapping it fires
 *     the ability too. Mobile adds the light-grey bridge strip joining slot and chip.
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
import { LUNGE_MODE, BOMB_MODE } from '../shared/pvp'
import { getLungeHud, triggerLunge } from './lunge'
import { getBombHud, triggerBomb } from './paintBomb'

// Light scheme (Luke 2026-10-20): white slots, black marks.
const SLOT_BG = Color4.create(1, 1, 1, 1)
const INK = Color4.create(0.05, 0.05, 0.05, 1)            // E/F hints, chevron, countdown, tooltip text
const READY_BORDER = Color4.create(0.05, 0.05, 0.05, 0.9)  // ready: dark outline
const COOL_BORDER = Color4.create(0.55, 0.55, 0.55, 0.6)   // cooling: soft grey outline
const DIM_BORDER = Color4.create(0.7, 0.7, 0.7, 0.4)       // disabled
const COOL_OVERLAY = Color4.create(0, 0, 0, 0.35)          // remaining cooldown, drains downward
const DIM_ICON = Color4.create(0.75, 0.75, 0.75, 0.6)      // disabled icon (light grey)
const TIP_BG = Color4.create(0.9, 0.9, 0.9, 1)             // tooltip chip + mobile bridge: light grey
const TIP_BORDER = Color4.create(0.05, 0.05, 0.05, 0.85)   // dark outline so chips read against white slots
const WHITE = Color4.White()
const CHIP_BG = Color4.create(0.1, 0.1, 0.1, 0.92) // = COUNTDOWN_BG in ui.tsx (round-mode chip)

const RADIUS = 18
const RADIUS_SM = 12
const BORDER_W = 4
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
const DESKTOP: Geo = { slot: 72, icon: 40, bottom: 30, halfRow: 80, tipH: 71, tipBorder: 3, tipPadX: 14, tipFont: 20, bridgeInner: 56, bridgeW: 50, tuck: 24 }
const MOBILE: Geo = { slot: 112, icon: 64, bottom: 0, halfRow: 128, tipH: 112, tipBorder: 4, tipPadX: 20, tipFont: 32, bridgeInner: 90, bridgeW: 80, tuck: 38 }

type Hud = { show: boolean; enabled: boolean; ready: boolean; cooldown: number; cooldownFrac: number }

function KeyHint(props: { label: string }) {
  if (isMobile()) return null
  return (
    <Label
      key={`ui_pvp_key_${props.label}`}
      value={props.label}
      fontSize={14}
      color={INK}
      uiTransform={{ positionType: 'absolute', position: { top: 6, left: 10 }, width: 16, height: 16 }}
    />
  )
}

function Slot(props: { id: string; keyLabel: string; hud: Hud; glyph?: string; iconSrc?: string; tintIcon?: boolean; onPress: () => void; g: Geo }) {
  const { hud, g } = props
  const cooling = hud.enabled && !hud.ready && hud.cooldown > 0
  // Dark overlay = time still to wait: full right after use, drains to 0 when ready.
  const overlay = cooling ? Math.max(0, Math.min(1, hud.cooldownFrac)) : 0
  const border = !hud.enabled ? DIM_BORDER : hud.ready ? READY_BORDER : COOL_BORDER
  // Black-tinted monochrome icons (chevron); coloured art (bomb.png) keeps its colours.
  const iconColor = !hud.enabled ? DIM_ICON : props.tintIcon ? INK : WHITE
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
      {overlay > 0 && (
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
            uiTransform={{ width: '100%', height: `${Math.round(overlay * 100)}%`, borderRadius: RADIUS_SM }}
            uiBackground={{ color: COOL_OVERLAY }}
          />
        </UiEntity>
      )}
      <KeyHint label={props.keyLabel} />
      {/* Icon hides while cooling so the countdown is the only centre mark. */}
      {!cooling && props.iconSrc ? (
        <UiEntity
          key={`ui_pvp_icon_${props.id}`}
          uiTransform={{ width: g.icon, height: g.icon, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: props.iconSrc }, color: iconColor }}
        />
      ) : null}
      {!cooling && !props.iconSrc ? (
        <Label
          key={`ui_pvp_glyph_${props.id}`}
          value={props.glyph ?? ''}
          fontSize={Math.round(g.icon * 0.9)}
          color={!hud.enabled ? DIM_ICON : INK}
          textAlign="middle-center"
          uiTransform={{ width: g.icon, height: g.icon }}
        />
      ) : null}
      {cooling && (
        <Label
          key={`ui_pvp_cd_${props.id}`}
          value={isMobile() ? `${Math.ceil(hud.cooldown)}` : `<b>${Math.ceil(hud.cooldown)}</b>`}
          fontSize={Math.round(g.slot * 0.36)}
          color={INK}
          textAlign="middle-center"
          uiTransform={{ positionType: 'absolute', width: '100%', height: '100%' }}
        />
      )}
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
        borderRadius: RADIUS, borderWidth: g.tipBorder, borderColor: TIP_BORDER, pointerFilter: 'block',
      }}
      uiBackground={{ color: TIP_BG }}
      onMouseDown={props.onPress}
    >
      <Label
        key={`ui_pvp_tipLabel_${props.id}`}
        value={mobile ? props.text : `<b>${props.text}</b>`}
        fontSize={g.tipFont}
        color={INK}
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
      uiBackground={{ color: TIP_BG }}
    />
  )
}

function roundLabel(lunge: Hud, bomb: Hud): string {
  if (LUNGE_MODE !== 'alternate' && BOMB_MODE !== 'alternate') return ''
  return lunge.enabled || bomb.enabled ? 'LUNGE + BOMB ROUND' : 'PAINT ONLY'
}

/** Render inside the full-screen UI root (src/ui.tsx). */
export function AbilityHotbar() {
  const lunge = getLungeHud()
  const bomb = getBombHud()
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
      {mobile && bombTip && <Bridge id="bomb" side="right" g={g} />}
      {lungeTip && <Tooltip id="lunge" side="left" text="LUNGE" onPress={triggerLunge} g={g} />}
      {bombTip && <Tooltip id="bomb" side="right" text="PAINT BOMB" onPress={triggerBomb} g={g} />}
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
            <Label value={label} fontSize={14} color={label === 'PAINT ONLY' ? WHITE : TIP_BG} textAlign="middle-center" />
          </UiEntity>
        )}
        <UiEntity key="ui_pvp_slots" uiTransform={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
          {lunge.show && <Slot id="lunge" keyLabel="E" hud={lunge} iconSrc="assets/images/lunge_chevron.png" tintIcon onPress={triggerLunge} g={g} />}
          {bomb.show && <Slot id="bomb" keyLabel="F" hud={bomb} iconSrc="assets/images/bomb.png" onPress={triggerBomb} g={g} />}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
