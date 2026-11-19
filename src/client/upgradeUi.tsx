/**
 * upgradeUi.tsx — painted-tile pill (gold pulse when an upgrade is ready),
 * buff icons, and the three-card selection overlay.
 *
 * The ready pulse follows Duck's animation kit: a reserved, unscaled wrapper
 * and a child that eases from scale 1 → 1.08 and back (ease-out grow,
 * ease-in shrink, 0.9 s period) so neighbors do not shift. A one-shot gold
 * color flash plays first, then the pill stays gold and pulses until the
 * player picks. Click / tap the pill to open the cards.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from './abilityHotbar'
import {
  closeUpgradeCards, FLASH_MS, getUpgradeHud, openUpgradeCards, requestUpgradeSelect, type UpgradeHud,
} from './upgrades'
import {
  UPGRADE_BONUS_UNIT, UPGRADE_DESCRIPTION, UPGRADE_ICON_SRC, UPGRADE_KINDS, UPGRADE_LABEL,
  UPGRADE_LEVEL_MAX, UPGRADE_ROMAN, bonusPct, type UpgradeKind,
} from '../shared/upgrades'

const INK = Color4.create(0.13, 0.13, 0.15, 1)
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
const GOLD_DEEP = Color4.create(0.95, 0.7, 0.15, 1)
const GOLD_FLASH = Color4.create(1, 0.95, 0.55, 1)
const GOLD_EDGE = Color4.create(0.95, 0.78, 0.28, 1)
const DIM = Color4.create(0.45, 0.45, 0.5, 1)
const OVERLAY = Color4.create(0.05, 0.05, 0.07, 0.45)
const WHITE = Color4.White()
const bold = (t: string) => '<b>' + t + '</b>'

/** Duck Pulse defaults, tuned to a gentle continuous 1 → 1.08 over 0.9 s. */
export const PILL_PULSE_PERIOD = 0.9
export const PILL_PULSE_MIN = 1
export const PILL_PULSE_MAX = 1.08

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t
const lerpC = (a: Color4, b: Color4, t: number) => Color4.create(
  a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t,
)

/** Scale at `now` after the ready-flash ends. Resting value is 1. */
export function pillPulseScale(now: number, flashUntil: number, pending: boolean): number {
  if (!pending || now < flashUntil) return PILL_PULSE_MIN
  const elapsed = (now - flashUntil) / 1000
  const cycleT = ((elapsed % PILL_PULSE_PERIOD) + PILL_PULSE_PERIOD) % PILL_PULSE_PERIOD / PILL_PULSE_PERIOD
  if (cycleT < 0.5) {
    const amount = easeOutCubic(cycleT * 2)
    return PILL_PULSE_MIN + amount * (PILL_PULSE_MAX - PILL_PULSE_MIN)
  }
  const amount = easeInCubic((cycleT - 0.5) * 2)
  return PILL_PULSE_MAX + amount * (PILL_PULSE_MIN - PILL_PULSE_MAX)
}

function readyFill(now: number, flashUntil: number, base: Color4): Color4 {
  if (now >= flashUntil) return GOLD
  // One Duck-style flash: ease to a bright gold, ease back to the settled gold.
  const start = flashUntil - FLASH_MS
  const t = Math.max(0, Math.min(1, (now - start) / FLASH_MS))
  if (t < 0.5) return lerpC(base, GOLD_FLASH, easeOutCubic(t * 2))
  return lerpC(GOLD_FLASH, GOLD, easeInCubic((t - 0.5) * 2))
}

/**
 * The painted-tile count pill. Turns gold and pulses when an upgrade is ready;
 * a thin gold fill along the bottom shows charge while charging. Click / tap
 * opens the card overlay. The wrapper stays at the rest size so a pulse
 * cannot shove the mute button or the buff icons.
 */
export function PaintedCountPill(props: { width: number; height: number; font: number; countText: string; ink: Color4 }) {
  const { width, height, font, countText, ink } = props
  const hud = getUpgradeHud()
  const now = Date.now()
  const ready = hud.pending
  const scale = pillPulseScale(now, hud.flashUntil, ready)
  const drawW = Math.max(1, Math.round(width * scale))
  const drawH = Math.max(1, Math.round(height * scale))
  const innerR = HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING
  let fill = PANEL_LIGHT
  let rim = HOTBAR_RIM
  let text = ink
  if (ready) {
    fill = readyFill(now, hud.flashUntil, PANEL_LIGHT)
    rim = readyFill(now, hud.flashUntil, HOTBAR_RIM)
    text = INK
  } else if (hud.maxed) {
    rim = GOLD_EDGE
  }
  const showBar = !ready && !hud.maxed
  const barH = 5
  const innerW = Math.max(1, width - (HOTBAR_BORDER_W + TILE_RING) * 2)
  const fillW = Math.round(innerW * Math.max(0, Math.min(1, hud.progress.fill)))
  return (
    <UiEntity uiTransform={{
      width, height, flexShrink: 0, justifyContent: 'center', alignItems: 'center',
      overflow: 'visible',
      pointerFilter: ready ? 'block' : 'none',
    }} onMouseDown={ready ? openUpgradeCards : undefined}>
      <UiEntity
        uiTransform={{
          width: drawW, height: drawH, borderRadius: HOTBAR_RADIUS,
          borderWidth: HOTBAR_BORDER_W, borderColor: rim, padding: TILE_RING,
          pointerFilter: ready ? 'block' : 'none',
        }}
        uiBackground={{ color: HOTBAR_TILE_BG }}
        onMouseDown={ready ? openUpgradeCards : undefined}
      >
        <UiEntity uiTransform={{
          width: '100%', height: '100%', borderRadius: innerR, justifyContent: 'center', alignItems: 'center',
          overflow: 'hidden', flexDirection: 'column', pointerFilter: 'none',
        }} uiBackground={{ color: fill }}>
          <Label value={bold(countText)} fontSize={font} color={text} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', flexGrow: 1 }} />
          {showBar ? (
            <UiEntity uiTransform={{ width: '100%', height: barH, flexShrink: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
              <UiEntity uiTransform={{ width: Math.max(0, fillW), height: barH, borderRadius: 2 }} uiBackground={{ color: GOLD }} />
            </UiEntity>
          ) : null}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function IconBadge(props: { kind: UpgradeKind; level: number; size: number; font: number }) {
  const { kind, level, size, font } = props
  if (level <= 0) return null
  const roman = UPGRADE_ROMAN[Math.min(level, UPGRADE_LEVEL_MAX)] ?? String(level)
  const badge = Math.max(22, Math.round(size * 0.4))
  const icon = Math.max(20, size - 16)
  return (
    <UiEntity uiTransform={{ width: size, height: size, margin: { left: 6 }, flexShrink: 0, borderRadius: 14, borderWidth: 3, borderColor: HOTBAR_RIM, pointerFilter: 'none' }}
      uiBackground={{ color: HOTBAR_TILE_BG }}>
      <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 11, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: PANEL_LIGHT }}>
        <UiEntity uiTransform={{ width: icon, height: icon, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_ICON_SRC[kind] } }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { right: -3, bottom: -3 }, width: badge, height: badge, borderRadius: badge / 2, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: INK }}
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

/** Brief toast only. Not a persistent READY chip. */
function Toast(props: { text: string; font: number }) {
  if (!props.text) return null
  const w = Math.max(120, Math.ceil(props.text.length * props.font * 0.8 + 24))
  return (
    <UiEntity uiTransform={{ width: w, height: props.font + 14, margin: { left: 8 }, borderRadius: 10, borderWidth: 2, borderColor: GOLD, justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: Color4.create(0.12, 0.1, 0.05, 0.92) }}>
      <Label value={bold(props.text)} fontSize={props.font} color={GOLD} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** Desktop extras immediately right of the painted-tile pill: buff icons, maybe a short toast. */
export function DesktopUpgradeExtras(props: { pillWidth: number; topBtn: number; gap: number }) {
  if (isMobile()) return null
  const hud = getUpgradeHud()
  if (!hud.show) return null
  const left = props.pillWidth + props.gap
  return (
    <UiEntity uiTransform={{
      positionType: 'absolute', position: { top: 0, left },
      height: props.topBtn, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none',
    }}>
      <IconRow hud={hud} size={props.topBtn} font={18} />
      <Toast text={hud.notice} font={14} />
    </UiEntity>
  )
}

/** Mobile buff icons under the territory bar, sized to the top-button height. */
export function MobileUpgradeRow() {
  if (!isMobile()) return null
  const hud = getUpgradeHud()
  if (!hud.show) return null
  const any = hud.speed > 0 || hud.paint > 0 || hud.haste > 0 || !!hud.notice
  if (!any) return null
  return (
    <UiEntity uiTransform={{ width: '100%', margin: { top: 8 }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <IconRow hud={hud} size={68} font={18} />
      <Toast text={hud.notice} font={16} />
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
