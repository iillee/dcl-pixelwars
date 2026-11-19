/**
 * upgradeUi.tsx — upgrade progress meter, buff icons, and the three-card
 * selection overlay. Mounted from ui.tsx next to the painted-tile pill
 * (desktop, growing right) or under the territory bar (mobile).
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from './abilityHotbar'
import {
  closeUpgradeCards, getUpgradeHud, openUpgradeCards, requestUpgradeSelect, type UpgradeHud,
} from './upgrades'
import {
  UPGRADE_BONUS_UNIT, UPGRADE_DESCRIPTION, UPGRADE_ICON_SRC, UPGRADE_KINDS, UPGRADE_LABEL,
  UPGRADE_LEVEL_MAX, UPGRADE_ROMAN, bonusPct, type UpgradeKind,
} from '../shared/upgrades'

const INK = Color4.create(0.13, 0.13, 0.15, 1)
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
const GOLD_DEEP = Color4.create(0.95, 0.7, 0.15, 1)
const DIM = Color4.create(0.45, 0.45, 0.5, 1)
const TRACK = Color4.create(0.18, 0.18, 0.2, 1)
const OVERLAY = Color4.create(0.05, 0.05, 0.07, 0.45)
const WHITE = Color4.White()
const bold = (t: string) => '<b>' + t + '</b>'

function meterLabel(hud: UpgradeHud): string {
  if (hud.maxed) return 'MAX'
  if (hud.pending) return 'READY'
  return ''
}

function Meter(props: { hud: UpgradeHud; width: number; height: number; font: number; clickable: boolean }) {
  const { hud, width, height, font, clickable } = props
  const ready = hud.pending
  const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(Date.now() / 180))
  const fill = hud.maxed ? 1 : hud.progress.fill
  const fillW = Math.max(0, Math.round((width - (HOTBAR_BORDER_W + TILE_RING) * 2) * fill))
  const innerH = height - (HOTBAR_BORDER_W + TILE_RING) * 2
  const fillColor = hud.flash || ready
    ? Color4.create(GOLD.r, GOLD.g, GOLD.b, ready ? pulse : 1)
    : hud.maxed ? GOLD_DEEP : GOLD
  const rim = hud.flash || ready ? GOLD : HOTBAR_RIM
  const label = meterLabel(hud)
  return (
    <UiEntity
      uiTransform={{
        width, height, flexShrink: 0, borderRadius: HOTBAR_RADIUS,
        borderWidth: HOTBAR_BORDER_W, borderColor: rim, padding: TILE_RING,
        pointerFilter: clickable && ready ? 'block' : 'none',
      }}
      uiBackground={{ color: HOTBAR_TILE_BG }}
      onMouseDown={clickable && ready ? openUpgradeCards : undefined}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: Math.max(4, HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING), overflow: 'hidden' }}
        uiBackground={{ color: PANEL_LIGHT }}>
        <UiEntity uiTransform={{ width: Math.max(0, fillW), height: innerH, borderRadius: 4 }} uiBackground={{ color: fillColor }} />
        {label ? (
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
            <Label value={bold(label)} fontSize={font} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

function IconBadge(props: { kind: UpgradeKind; level: number; size: number; font: number }) {
  const { kind, level, size, font } = props
  if (level <= 0) return null
  const roman = UPGRADE_ROMAN[Math.min(level, UPGRADE_LEVEL_MAX)] ?? String(level)
  const badge = Math.max(16, Math.round(size * 0.48))
  return (
    <UiEntity uiTransform={{ width: size, height: size, margin: { left: 4 }, flexShrink: 0, borderRadius: 10, borderWidth: 2, borderColor: HOTBAR_RIM, pointerFilter: 'none' }}
      uiBackground={{ color: HOTBAR_TILE_BG }}>
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: PANEL_LIGHT }}>
        <UiEntity uiTransform={{ width: size - 10, height: size - 10, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_ICON_SRC[kind] } }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { right: -2, bottom: -2 }, width: badge, height: badge, borderRadius: badge / 2, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: INK }}
          uiBackground={{ color: GOLD }}>
          <Label value={bold(roman)} fontSize={font} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function IconRow(props: { hud: UpgradeHud; size: number; font: number }) {
  const { hud, size, font } = props
  const any = hud.speed > 0 || hud.paint > 0 || hud.haste > 0
  if (!any) return null
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: size, flexShrink: 0, pointerFilter: 'none' }}>
      <IconBadge kind="speed" level={hud.speed} size={size} font={font} />
      <IconBadge kind="paint" level={hud.paint} size={size} font={font} />
      <IconBadge kind="haste" level={hud.haste} size={size} font={font} />
    </UiEntity>
  )
}

function Notice(props: { text: string; font: number }) {
  if (!props.text) return null
  const w = Math.max(120, Math.ceil(props.text.length * props.font * 0.8 + 24))
  return (
    <UiEntity uiTransform={{ width: w, height: props.font + 14, margin: { left: 6 }, borderRadius: 10, borderWidth: 2, borderColor: GOLD, justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: Color4.create(0.12, 0.1, 0.05, 0.92) }}>
      <Label value={bold(props.text)} fontSize={props.font} color={GOLD} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** Desktop extras that sit immediately right of the painted-tile pill and grow right. */
export function DesktopUpgradeExtras(props: { pillWidth: number; topBtn: number; gap: number }) {
  if (isMobile()) return null
  const hud = getUpgradeHud()
  if (!hud.show) return null
  const barW = 148
  const barH = 28
  const icon = 36
  const left = props.pillWidth + props.gap
  return (
    <UiEntity uiTransform={{
      positionType: 'absolute', position: { top: 0, left },
      height: props.topBtn, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none',
    }}>
      {hud.maxed ? null : <Meter hud={hud} width={barW} height={barH} font={14} clickable={true} />}
      {hud.maxed ? (
        <Meter hud={hud} width={72} height={barH} font={14} clickable={false} />
      ) : null}
      <IconRow hud={hud} size={icon} font={12} />
      <Notice text={hud.notice} font={14} />
    </UiEntity>
  )
}

/** Mobile row under the territory bar: meter, icons, and a tappable READY state. */
export function MobileUpgradeRow() {
  if (!isMobile()) return null
  const hud = getUpgradeHud()
  if (!hud.show) return null
  return (
    <UiEntity uiTransform={{ width: '100%', margin: { top: 8 }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      {hud.maxed ? <Meter hud={hud} width={88} height={32} font={16} clickable={false} /> : <Meter hud={hud} width={168} height={32} font={16} clickable={true} />}
      <IconRow hud={hud} size={40} font={13} />
      <Notice text={hud.notice} font={16} />
    </UiEntity>
  )
}

function Card(props: { kind: UpgradeKind; hud: UpgradeHud; width: number; height: number; mobile: boolean; index: number }) {
  const { kind, hud, width, height, mobile, index } = props
  const level = hud[kind]
  const maxed = level >= UPGRADE_LEVEL_MAX
  const next = Math.min(UPGRADE_LEVEL_MAX, level + 1)
  const nowPct = bonusPct(kind, level)
  const nextPct = bonusPct(kind, next)
  const selected = hud.highlight === kind
  const sign = kind === 'haste' ? '−' : '+'
  const levelLine = maxed ? `LEVEL ${level}  MAX` : `LEVEL ${level}  →  ${next}`
  const bonusLine = maxed
    ? `${sign}${nowPct}% ${UPGRADE_BONUS_UNIT[kind]}`
    : `${sign}${nowPct}%  →  ${sign}${nextPct}% ${UPGRADE_BONUS_UNIT[kind]}`
  const rim = selected ? GOLD : HOTBAR_RIM
  const icon = mobile ? 44 : 64
  const titleF = mobile ? 16 : 22
  const bodyF = mobile ? 11 : 14
  const keyF = mobile ? 12 : 16
  const disabled = maxed || !hud.pending
  return (
    <UiEntity
      uiTransform={{
        width, height, margin: { left: index === 0 ? 0 : (mobile ? 6 : 12) }, flexShrink: 0,
        borderRadius: HOTBAR_RADIUS, borderWidth: selected ? 4 : HOTBAR_BORDER_W, borderColor: rim,
        padding: TILE_RING, pointerFilter: disabled ? 'none' : 'block',
      }}
      uiBackground={{ color: HOTBAR_TILE_BG }}
      onMouseDown={disabled ? undefined : () => requestUpgradeSelect(kind)}
    >
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING, flexDirection: 'column', alignItems: 'center', padding: { top: mobile ? 8 : 12, bottom: 8, left: 6, right: 6 } }}
        uiBackground={{ color: selected ? Color4.create(1, 0.95, 0.75, 1) : PANEL_LIGHT }}>
        <UiEntity uiTransform={{ width: icon, height: icon, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_ICON_SRC[kind] } }} />
        <Label value={bold(UPGRADE_LABEL[kind])} fontSize={titleF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: titleF + 6, margin: { top: 4 } }} />
        <Label value={bold(levelLine)} fontSize={bodyF} color={selected ? GOLD_DEEP : INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: bodyF + 4 }} />
        <Label value={bold(bonusLine)} fontSize={bodyF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: bodyF * 2 + 4 }} />
        <Label value={UPGRADE_DESCRIPTION[kind]} fontSize={Math.max(10, bodyF - 1)} color={DIM} font="sans-serif" textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: bodyF * 2 + 2 }} />
        {mobile ? null : (
          <UiEntity uiTransform={{ width: 28, height: 28, margin: { top: 6 }, borderRadius: 8, borderWidth: 2, borderColor: INK, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: GOLD }}>
            <Label value={bold(String(index + 1))} fontSize={keyF} color={INK} font="sans-serif" textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

/** Compact centered overlay. Gameplay is not paused; only the cards and Close capture clicks. */
export function UpgradeOverlay() {
  const hud = getUpgradeHud()
  if (!hud.cardsOpen) return null
  const mobile = isMobile()
  const cardW = mobile ? 112 : 200
  const cardH = mobile ? 210 : 280
  const closeW = mobile ? 120 : 140
  const closeH = mobile ? 40 : 44
  return (
    <UiEntity uiTransform={{
      width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
      justifyContent: 'center', alignItems: 'center', flexDirection: 'column', pointerFilter: 'none',
    }}>
      <UiEntity uiTransform={{
        flexDirection: 'column', alignItems: 'center', padding: { top: 16, bottom: 16, left: 16, right: 16 },
        borderRadius: 20, pointerFilter: 'none',
      }} uiBackground={{ color: OVERLAY }}>
        <Label value={bold('CHOOSE AN UPGRADE')} fontSize={mobile ? 18 : 24} color={WHITE} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: mobile ? 26 : 36, margin: { bottom: 10 } }} />
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'stretch', pointerFilter: 'none' }}>
          {UPGRADE_KINDS.map((kind, i) => (
            <Card kind={kind} hud={hud} width={cardW} height={cardH} mobile={mobile} index={i} />
          ))}
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: closeW, height: closeH, margin: { top: 12 }, borderRadius: 12,
            borderWidth: 3, borderColor: HOTBAR_RIM, justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
          }}
          uiBackground={{ color: PANEL_LIGHT }}
          onMouseDown={closeUpgradeCards}
        >
          <Label value={bold('CLOSE')} fontSize={mobile ? 16 : 18} color={INK} font="sans-serif" textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
