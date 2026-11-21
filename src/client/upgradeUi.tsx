/**
 * upgradeUi.tsx — painted-tile pill (gold when an upgrade is ready),
 * buff icons, and the three-card selection overlay.
 *
 * A one-shot gold color flash plays when a pick becomes ready, then the
 * pill stays gold until the player picks. A red bouncing badge on the
 * pill marks pending picks as soon as they unlock. Click / tap the pill to open the cards.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from './abilityHotbar'
import {
  FLASH_MS, getUpgradeHud, openUpgradeCards, requestUpgradeSelect, setUpgradeCardHover, type UpgradeHud,
} from './upgrades'
import { OutlinedLabel } from './outlinedLabel'
import {
  UPGRADE_CARD_ICON_SRC, UPGRADE_LABEL,
  UPGRADE_LEVEL_MAX, UPGRADE_ROMAN, upgradeOfferLine, type UpgradeKind,
} from '../shared/upgrades'
import { CARD_ASPECT, CARD_HOVER_SCALE, CARD_TARGET_W } from '../shared/upgradeCards'

const INK = Color4.create(0.13, 0.13, 0.15, 1)
const GOLD = Color4.create(1.0, 0.8, 0.3, 1)
const BADGE_RED = Color4.create(0.91, 0.259, 0.29, 1) // #E8424A
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

function canvasSize(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0) return { w: 1280, h: 720 }
  const dpr = c.devicePixelRatio > 0 ? c.devicePixelRatio : 1
  return { w: c.width / dpr, h: c.height / dpr }
}

function lighten(c: Color4, t: number): Color4 {
  return Color4.create(c.r + (1 - c.r) * t, c.g + (1 - c.g) * t, c.b + (1 - c.b) * t, c.a)
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t
const lerpC = (a: Color4, b: Color4, t: number) => Color4.create(
  a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t,
)

function readyFill(now: number, flashUntil: number, base: Color4): Color4 {
  if (now >= flashUntil) return GOLD
  // One Duck-style flash: ease to a bright gold, ease back to the settled gold.
  const start = flashUntil - FLASH_MS
  const t = Math.max(0, Math.min(1, (now - start) / FLASH_MS))
  if (t < 0.5) return lerpC(base, GOLD_FLASH, easeOutCubic(t * 2))
  return lerpC(GOLD_FLASH, GOLD, easeInCubic((t - 0.5) * 2))
}

/**
 * The painted-tile count pill. Turns gold when an upgrade is ready.
 * Click / tap opens the card overlay. A red bouncing count badge sits on
 * the top-right corner as soon as a pick is pending, and clears when none remain.
 */
export function PaintedCountPill(props: { width: number; height: number; font: number; countText: string; ink: Color4 }) {
  const { width, height, font, countText, ink } = props
  const hud = getUpgradeHud()
  const now = Date.now()
  const ready = hud.pending
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
  const showBadge = ready && hud.pendingCount > 0
  const badge = Math.max(22, Math.round(height * 0.48))
  return (
    <UiEntity uiTransform={{
      width, height, flexShrink: 0, justifyContent: 'center', alignItems: 'center',
      overflow: 'visible',
      pointerFilter: ready ? 'block' : 'none',
    }} onMouseDown={ready ? openUpgradeCards : undefined}>
      <UiEntity
        uiTransform={{
          width, height, borderRadius: HOTBAR_RADIUS,
          borderWidth: HOTBAR_BORDER_W, borderColor: rim, padding: TILE_RING,
          pointerFilter: ready ? 'block' : 'none',
        }}
        uiBackground={{ color: HOTBAR_TILE_BG }}
        onMouseDown={ready ? openUpgradeCards : undefined}
      >
        <UiEntity uiTransform={{
          width: '100%', height: '100%', borderRadius: innerR, justifyContent: 'center', alignItems: 'center',
          pointerFilter: 'none',
        }} uiBackground={{ color: fill }}>
          <Label value={bold(countText)} fontSize={font} color={text} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>
      {showBadge ? (
        <UiEntity uiTransform={{
          positionType: 'absolute',
          position: {
            top: -Math.round(badge * 0.35) + hud.badgeBob,
            right: -Math.round(badge * 0.35),
          },
          width: badge, height: badge, borderRadius: badge / 2,
          borderWidth: 3, borderColor: WHITE,
          justifyContent: 'center', alignItems: 'center',
          pointerFilter: 'none',
        }} uiBackground={{ color: BADGE_RED }}>
          <Label
            value={bold(String(hud.pendingCount))}
            fontSize={Math.max(12, Math.round(badge * 0.55))}
            color={WHITE}
            font="sans-serif"
            textAlign="middle-center"
            textWrap="nowrap"
            uiTransform={{ width: '100%', height: '100%' }}
          />
        </UiEntity>
      ) : null}
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

function Card(props: { kind: UpgradeKind; hud: UpgradeHud; width: number; height: number; mobile: boolean; index: number; gap: number }) {
  const { kind, hud, width, height, mobile, index, gap } = props
  const level = hud[kind]
  const maxed = level >= UPGRADE_LEVEL_MAX
  const selected = hud.highlight === kind
  const hovered = !mobile && hud.hover === kind
  const offer = upgradeOfferLine(kind, level)
  const rim = hovered ? WHITE : (selected ? GOLD : HOTBAR_RIM)
  const fill = hovered ? lighten(UPGRADE_CARD_FILL[kind], 0.16) : UPGRADE_CARD_FILL[kind]
  const icon = mobile ? 72 : 112
  const titleF = mobile ? 18 : 26
  const bodyF = mobile ? 14 : 18
  const disabled = maxed || !hud.pending
  const badge = Math.max(22, Math.round((mobile ? 52 : 68) * 0.38))
  const roman = level > 0 ? (UPGRADE_ROMAN[Math.min(level, UPGRADE_LEVEL_MAX)] ?? String(level)) : ''
  const left = index === 0 ? 0 : gap
  const padY = mobile ? 18 : 28
  const padX = mobile ? 10 : 14
  const grow = hovered ? CARD_HOVER_SCALE : 1
  const drawW = Math.max(1, Math.round(width * grow))
  const drawH = Math.max(1, Math.round(height * grow))
  return (
    <UiEntity
      uiTransform={{
        width, height, margin: { left }, flexShrink: 0,
        justifyContent: 'center', alignItems: 'center',
        overflow: 'visible',
        pointerFilter: disabled ? 'none' : 'block',
      }}
      onMouseDown={disabled ? undefined : () => requestUpgradeSelect(kind)}
      onMouseEnter={disabled || mobile ? undefined : () => setUpgradeCardHover(kind)}
      onMouseLeave={disabled || mobile ? undefined : () => setUpgradeCardHover(null)}
    >
      <UiEntity
        uiTransform={{
          width: drawW, height: drawH, flexShrink: 0,
          borderRadius: HOTBAR_RADIUS, borderWidth: hovered || selected ? 4 : HOTBAR_BORDER_W, borderColor: rim,
          padding: TILE_RING, pointerFilter: 'none',
        }}
        uiBackground={{ color: HOTBAR_TILE_BG }}
      >
        <UiEntity uiTransform={{
          width: '100%', height: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: { top: padY, bottom: padY, left: padX, right: padX },
          pointerFilter: 'none',
        }} uiBackground={{ color: fill }}>
          <UiEntity uiTransform={{ width: icon, height: icon, flexShrink: 0, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: UPGRADE_CARD_ICON_SRC[kind] } }} />
          <Label value={bold(UPGRADE_LABEL[kind])} fontSize={titleF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: titleF + 6, margin: { top: mobile ? 12 : 18 } }} />
          <Label value={bold(offer)} fontSize={bodyF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: bodyF * 2 + 6, margin: { top: 6 } }} />
          {roman ? (
            <UiEntity uiTransform={{
              positionType: 'absolute', position: { right: 6, top: 6 },
              width: badge, height: badge, borderRadius: badge / 2,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: 2, borderColor: INK, pointerFilter: 'none',
            }} uiBackground={{ color: GOLD }}>
              <Label value={bold(roman)} fontSize={mobile ? 12 : 16} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
            </UiEntity>
          ) : null}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function fitCardSize(mobile: boolean, count: number, pop: number): { cardW: number; cardH: number; gap: number } {
  const { w, h } = canvasSize()
  const gap = mobile ? 10 : 16
  const side = mobile ? 36 : 72
  const chromeH = mobile ? 120 : 150
  const n = Math.max(1, count)
  const maxRow = Math.max(80, w - side)
  const maxH = Math.max(180, h - chromeH)
  let cardW = mobile ? Math.min(210, CARD_TARGET_W) : CARD_TARGET_W
  let cardH = Math.round(cardW / CARD_ASPECT)
  const rowW = cardW * n + gap * Math.max(0, n - 1)
  if (rowW > maxRow) {
    cardW = Math.floor((maxRow - gap * Math.max(0, n - 1)) / n)
    cardH = Math.round(cardW / CARD_ASPECT)
  }
  if (cardH > maxH) {
    cardH = maxH
    cardW = Math.round(cardH * CARD_ASPECT)
  }
  return {
    cardW: Math.max(1, Math.round(cardW * pop)),
    cardH: Math.max(1, Math.round(cardH * pop)),
    gap,
  }
}

/** White title with a dark outline so it stays readable over a bright sky. */
function OutlinedTitle(props: { text: string; font: number; height: number }) {
  const stroke = 3
  const width = Math.ceil(props.text.length * props.font * 0.8 + 24)
  return (
    <OutlinedLabel
      value={bold(props.text)}
      fontSize={props.font}
      color={WHITE}
      outlineColor={INK}
      outline={stroke}
      width={width}
      height={props.height + stroke * 2}
      margin={{ bottom: 16 }}
    />
  )
}

/**
 * Centered upgrade cards, shared by auto-open and a manual pill tap.
 * Gameplay is not paused; only the cards capture clicks. The popup
 * dismisses when the player picks a card or when the 5-second auto-tuck
 * expires. There is no visible timer bar or Close button.
 */
export function UpgradeOverlay() {
  const hud = getUpgradeHud()
  if (!hud.clusterVisible) return null
  const mobile = isMobile()
  const { cardW, cardH, gap } = fitCardSize(mobile, hud.offer.length, hud.popScale)
  return (
    <UiEntity uiTransform={{
      width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
      justifyContent: 'center', alignItems: 'center', overflow: 'visible',
      pointerFilter: 'none',
    }}>
      <UiEntity uiTransform={{
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        overflow: 'visible', pointerFilter: 'none',
      }}>
        <OutlinedTitle text="CHOOSE AN UPGRADE" font={mobile ? 20 : 28} height={mobile ? 28 : 36} />
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', overflow: 'visible', pointerFilter: 'none' }}>
          {hud.offer.map((kind, i) => (
            <Card kind={kind} hud={hud} width={cardW} height={cardH} mobile={mobile} index={i} gap={gap} />
          ))}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
