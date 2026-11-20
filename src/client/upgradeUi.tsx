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
  UPGRADE_CARD_ICON_SRC, UPGRADE_KINDS, UPGRADE_LABEL,
  UPGRADE_LEVEL_MAX, UPGRADE_ROMAN, upgradeOfferLine, type UpgradeKind,
} from '../shared/upgrades'

const INK = Color4.create(0.13, 0.13, 0.15, 1)
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
const GOLD_FLASH = Color4.create(1, 0.95, 0.55, 1)
const GOLD_EDGE = Color4.create(0.95, 0.78, 0.28, 1)
/** Card fills: Speed #6DB0F5, Paint #F278B4, Haste #FFA838. Dark text + black icons stay readable on all three. */
export const UPGRADE_CARD_FILL: Record<UpgradeKind, Color4> = {
  speed: Color4.create(0.427, 0.690, 0.961, 1),
  paint: Color4.create(0.949, 0.471, 0.706, 1),
  haste: Color4.create(1.000, 0.659, 0.220, 1),
}
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
  const frame = (HOTBAR_BORDER_W + TILE_RING) * 2
  const innerR = HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING
  const icon = Math.max(20, size - frame - 4)
  return (
    <UiEntity uiTransform={{
      width: size, height: size, margin: { left: 6 }, flexShrink: 0,
      borderRadius: HOTBAR_RADIUS, borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM,
      padding: TILE_RING, pointerFilter: 'none',
    }} uiBackground={{ color: HOTBAR_TILE_BG }}>
      <UiEntity uiTransform={{
        width: '100%', height: '100%', borderRadius: innerR,
        justifyContent: 'center', alignItems: 'center',
      }} uiBackground={{ color: UPGRADE_CARD_FILL[kind] }}>
        <UiEntity uiTransform={{ width: icon, height: icon, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_CARD_ICON_SRC[kind] } }} />
      </UiEntity>
      <UiEntity uiTransform={{
        positionType: 'absolute', position: { right: -3, bottom: -3 },
        width: badge, height: badge, borderRadius: badge / 2,
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: INK, pointerFilter: 'none',
      }} uiBackground={{ color: WHITE }}>
        <Label value={bold(roman)} fontSize={font} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
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

function Card(props: { kind: UpgradeKind; hud: UpgradeHud; width: number; height: number; mobile: boolean; index: number; compact: boolean }) {
  const { kind, hud, width, height, mobile, index, compact } = props
  const level = hud[kind]
  const maxed = level >= UPGRADE_LEVEL_MAX
  const selected = hud.highlight === kind
  const offer = upgradeOfferLine(kind, level)
  const rim = selected ? GOLD : HOTBAR_RIM
  const fill = UPGRADE_CARD_FILL[kind]
  const icon = compact ? (mobile ? 44 : 60) : (mobile ? 72 : 96)
  const titleF = compact ? (mobile ? 12 : 15) : (mobile ? 16 : 22)
  const bodyF = compact ? (mobile ? 10 : 13) : (mobile ? 12 : 16)
  const disabled = maxed || !hud.pending
  const badge = Math.max(compact ? 18 : 22, Math.round((mobile ? 52 : 68) * (compact ? 0.32 : 0.38)))
  const roman = level > 0 ? (UPGRADE_ROMAN[Math.min(level, UPGRADE_LEVEL_MAX)] ?? String(level)) : ''
  const gap = index === 0 ? 0 : (mobile ? 6 : 10)
  const padY = compact ? (mobile ? 10 : 14) : (mobile ? 18 : 28)
  const padX = compact ? 8 : 10
  return (
    <UiEntity
      uiTransform={{
        width, height, margin: { left: gap }, flexShrink: 0,
        borderRadius: HOTBAR_RADIUS, borderWidth: selected ? 4 : HOTBAR_BORDER_W, borderColor: rim,
        padding: compact ? 4 : TILE_RING, pointerFilter: disabled ? 'none' : 'block',
      }}
      uiBackground={{ color: HOTBAR_TILE_BG }}
      onMouseDown={disabled ? undefined : () => requestUpgradeSelect(kind)}
    >
      <UiEntity uiTransform={{
        width: '100%', height: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - (compact ? 4 : TILE_RING),
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: { top: padY, bottom: padY, left: padX, right: padX },
      }} uiBackground={{ color: fill }}>
        <UiEntity uiTransform={{ width: icon, height: icon, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_CARD_ICON_SRC[kind] } }} />
        <Label value={bold(UPGRADE_LABEL[kind])} fontSize={titleF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: titleF + 4, margin: { top: compact ? 8 : (mobile ? 14 : 20) } }} />
        <Label value={bold(offer)} fontSize={bodyF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: bodyF * 2 + 4, margin: { top: compact ? 4 : 6 } }} />
        {roman ? (
          <UiEntity uiTransform={{
            positionType: 'absolute', position: { right: 4, top: 4 },
            width: badge, height: badge, borderRadius: badge / 2,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 2, borderColor: INK, pointerFilter: 'none',
          }} uiBackground={{ color: GOLD }}>
            <Label value={bold(roman)} fontSize={mobile ? 11 : 14} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
          </UiEntity>
        ) : null}
      </UiEntity>
    </UiEntity>
  )
}

/** White title with a dark outline so it stays readable over a bright sky. */
function OutlinedTitle(props: { text: string; font: number; height: number }) {
  const stroke = 3
  const dirs: Array<[number, number]> = [
    [-stroke, 0], [stroke, 0], [0, -stroke], [0, stroke],
    [-stroke, -stroke], [-stroke, stroke], [stroke, -stroke], [stroke, stroke],
  ]
  const width = Math.ceil(props.text.length * props.font * 0.8 + 24)
  return (
    <UiEntity uiTransform={{
      width, height: props.height + stroke * 2, margin: { bottom: 16 },
      justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none',
    }}>
      {dirs.map(([dx, dy]) => (
        <Label
          value={bold(props.text)}
          fontSize={props.font}
          color={INK}
          font="sans-serif"
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ positionType: 'absolute', position: { top: dy, left: dx }, width: '100%', height: '100%' }}
        />
      ))}
      <Label value={bold(props.text)} fontSize={props.font} color={WHITE} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/**
 * Compact upgrade cluster, parked above the Dash / Burst hotbar (desktop)
 * or in the lower centre on mobile, clear of the joystick (left) and the
 * jump / ability column (right). Auto and manual opens share this layout.
 * Gameplay is not paused; only the cards and Close capture clicks.
 *
 * Desktop clearance: 30 (hotbar bottom) + 72 (slot) + 18 gap = 120.
 * Mobile clearance: 220, just above the jump button (top ≈ 175) and a
 * typical native joystick, while the right-side ability column sits
 * outside the centred row.
 */
const CLUSTER_BOTTOM_DESKTOP = 120
const CLUSTER_BOTTOM_MOBILE = 220
const COMPACT = 0.65

export function UpgradeOverlay() {
  const hud = getUpgradeHud()
  if (!hud.clusterVisible) return null
  const mobile = isMobile()
  const pop = hud.popScale
  const cardW = Math.max(1, Math.round((mobile ? 136 : 228) * COMPACT * pop))
  const cardH = Math.max(1, Math.round((mobile ? 280 : 348) * COMPACT * pop))
  const gap = mobile ? 6 : 10
  const rowW = cardW * 3 + gap * 2
  const closeW = mobile ? 110 : 128
  const closeH = mobile ? 36 : 40
  const barH = 6
  const bottom = Math.max(0, (mobile ? CLUSTER_BOTTOM_MOBILE : CLUSTER_BOTTOM_DESKTOP) - Math.round(hud.popSlide))
  const showTimer = hud.autoOpen && hud.autoFrac > 0
  return (
    <UiEntity uiTransform={{
      width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
      pointerFilter: 'none',
    }}>
      <UiEntity uiTransform={{
        positionType: 'absolute', position: { bottom, left: 0 }, width: '100%',
        flexDirection: 'column', alignItems: 'center', pointerFilter: 'none',
      }}>
        <OutlinedTitle text="CHOOSE AN UPGRADE" font={mobile ? 16 : 20} height={mobile ? 22 : 28} />
        {showTimer ? (
          <UiEntity uiTransform={{
            width: rowW, height: barH, margin: { bottom: 8 }, borderRadius: 3,
            overflow: 'hidden', flexShrink: 0, pointerFilter: 'none',
          }} uiBackground={{ color: INK }}>
            <UiEntity uiTransform={{
              width: Math.max(2, Math.round(rowW * hud.autoFrac)), height: barH, borderRadius: 3,
            }} uiBackground={{ color: GOLD }} />
          </UiEntity>
        ) : null}
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'stretch', pointerFilter: 'none' }}>
          {UPGRADE_KINDS.map((kind, i) => (
            <Card kind={kind} hud={hud} width={cardW} height={cardH} mobile={mobile} index={i} compact={true} />
          ))}
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: closeW, height: closeH, margin: { top: 12 }, borderRadius: 12,
            borderWidth: 4, borderColor: INK, justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
          }}
          uiBackground={{ color: PANEL_LIGHT }}
          onMouseDown={closeUpgradeCards}
        >
          <Label value={bold('CLOSE')} fontSize={mobile ? 14 : 16} color={INK} font="sans-serif" textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
