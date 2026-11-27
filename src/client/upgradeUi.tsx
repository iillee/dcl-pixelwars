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
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import { RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from './abilityHotbar'
import { TOP_BTN, TOP_GAP } from './overviewUi'
import {
  FLASH_MS, getUpgradeHud, openUpgradeCards, requestUpgradeSelect, setUpgradeCardHover, type UpgradeHud,
} from './upgrades'
import { OutlinedLabel } from './outlinedLabel'
import {
  UPGRADE_CARD_ICON_SRC, UPGRADE_LABEL,
  UPGRADE_LEVEL_MAX, upgradeOfferLine, type UpgradeKind,
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

/**
 * The UI root is the safe area, not the raw canvas. A window resize mid-round
 * changes that inset, and a flight aimed at the full canvas then misses the icon.
 */
function canvasSize(): { w: number; h: number } {
  const mobile = isMobile()
  const vw = mobile ? 1600 : 1920
  const vh = mobile ? 720 : 1080
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0 || c.height <= 0) return { w: vw, h: vh }
  const scale = Math.min(c.width / vw, c.height / vh)
  if (!(scale > 0)) return { w: vw, h: vh }
  const inset = c.screenInsetArea
  const w = c.width - (inset?.left ?? 0) - (inset?.right ?? 0)
  const h = c.height - (inset?.top ?? 0) - (inset?.bottom ?? 0)
  return { w: Math.max(1, w / scale), h: Math.max(1, h / scale) }
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

/** Same corner chip as the red pending badge: white fill, dark count, thick ring. */
function countChipSize(iconSize: number): number {
  return Math.max(14, Math.round(iconSize * 0.48))
}

function countChipHang(badge: number): number {
  return Math.round(badge * 0.35)
}

function CountChip(props: { n: number; size: number; top?: number; left?: number; right?: number }) {
  const badge = Math.max(14, Math.round(props.size))
  const hang = countChipHang(badge)
  const top = props.top ?? -hang
  const position = props.left !== undefined
    ? { top, left: props.left }
    : { top, right: props.right ?? -hang }
  return (
    <UiEntity uiTransform={{
      positionType: 'absolute',
      position,
      width: badge, height: badge, borderRadius: badge / 2,
      borderWidth: 3, borderColor: INK,
      justifyContent: 'center', alignItems: 'center',
      pointerFilter: 'none',
    }} uiBackground={{ color: WHITE }}>
      <Label
        value={bold(String(props.n))}
        fontSize={Math.max(11, Math.round(badge * 0.55))}
        color={INK}
        font="sans-serif"
        textAlign="middle-center"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%' }}
      />
    </UiEntity>
  )
}

const ICON_GAP = 6
const TIMER_W = 200
const HUD_TOP = 10

function IconBadge(props: { kind: UpgradeKind; level: number; size: number; gap?: number; chip?: boolean }) {
  const { kind, level, size } = props
  if (level <= 0) return null
  const frame = (HOTBAR_BORDER_W + TILE_RING) * 2
  const innerR = HOTBAR_RADIUS - HOTBAR_BORDER_W - TILE_RING
  const icon = Math.max(20, size - frame - 4)
  return (
    <UiEntity uiTransform={{
      width: size, height: size, margin: { left: props.gap ?? ICON_GAP }, flexShrink: 0,
      overflow: 'visible', pointerFilter: 'none',
    }}>
      <UiEntity uiTransform={{
        width: size, height: size,
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
      </UiEntity>
      {props.chip === false ? null : (
        <CountChip n={Math.min(level, UPGRADE_LEVEL_MAX)} size={countChipSize(size)} />
      )}
    </UiEntity>
  )
}

function IconRow(props: { hud: UpgradeHud; size: number }) {
  const { hud, size } = props
  if (hud.iconOrder.length === 0) return null
  const flying = hud.fly?.kind ?? null
  const badge = countChipSize(size)
  const hang = countChipHang(badge)
  const step = size + ICON_GAP
  // SDK 7.32.1 draws later siblings over earlier ones and ignores zIndex on
  // these chips, so the next tile's outline would cover the hanging count.
  // Icons go down first; every chip is painted afterwards in one overlay.
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: size, flexShrink: 0, overflow: 'visible', pointerFilter: 'none' }}>
      {hud.iconOrder.map((kind) => flying === kind && hud.fly?.fresh
        ? <UiEntity uiTransform={{ width: size, height: size, margin: { left: ICON_GAP }, flexShrink: 0 }} />
        : <IconBadge kind={kind} level={hud[kind]} size={size} chip={false} />)}
      <UiEntity uiTransform={{
        positionType: 'absolute', position: { top: 0, left: 0 },
        width: hud.iconOrder.length * step, height: size,
        overflow: 'visible', pointerFilter: 'none',
      }}>
        {hud.iconOrder.map((kind, i) => {
          if (flying === kind && hud.fly?.fresh) return null
          const level = hud[kind]
          if (level <= 0) return null
          return (
            <CountChip
              n={Math.min(level, UPGRADE_LEVEL_MAX)}
              size={badge}
              top={-hang}
              left={ICON_GAP + i * step + size - badge + hang}
            />
          )
        })}
      </UiEntity>
    </UiEntity>
  )
}

/** Center of one buff tile, as an offset from the screen center. Slot 0 sits just right of the score. */
function buffDock(_mobile: boolean, count: number, slot: number): { x: number; y: number; size: number } {
  const size = TOP_BTN
  const n = Math.max(1, count)
  const i = Math.max(0, Math.min(slot, n - 1))
  const step = size + ICON_GAP
  const pillW = TOP_BTN + TOP_GAP + TOP_BTN
  const rowW = TOP_BTN + TOP_GAP + TOP_BTN + TOP_GAP + TIMER_W + TOP_GAP + pillW
  const fromLeft = TOP_BTN + TOP_GAP + TOP_BTN + TOP_GAP + TIMER_W + TOP_GAP + pillW + TOP_GAP + ICON_GAP + i * step
  return { x: -rowW / 2 + fromLeft + size / 2, y: HUD_TOP + size / 2, size }
}

/** Buff icons immediately right of the painted-tile pill, on desktop and mobile. */
export function DesktopUpgradeExtras(props: { pillWidth: number; topBtn: number; gap: number }) {
  const hud = getUpgradeHud()
  if (!hud.show) return null
  const left = props.pillWidth + props.gap
  return (
    <UiEntity uiTransform={{
      positionType: 'absolute', position: { top: 0, left },
      height: props.topBtn, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none',
    }}>
      <IconRow hud={hud} size={props.topBtn} />
    </UiEntity>
  )
}

function Card(props: { kind: UpgradeKind; hud: UpgradeHud; width: number; height: number; mobile: boolean; index: number; scale?: number; level?: number; frozen?: boolean; locked?: boolean }) {
  const { kind, hud, width, height, mobile, index } = props
  const scale = props.scale ?? 1
  const level = props.level ?? hud[kind]
  const maxed = level >= UPGRADE_LEVEL_MAX
  const selected = !props.locked && (hud.highlight === kind || !!props.frozen)
  const hovered = !props.locked && !props.frozen && !mobile && hud.hover === kind
  const offer = upgradeOfferLine(kind, Math.max(0, level - (props.frozen ? 1 : 0)))
  const rim = hovered ? WHITE : (selected ? GOLD : HOTBAR_RIM)
  const fill = hovered ? lighten(UPGRADE_CARD_FILL[kind], 0.16) : UPGRADE_CARD_FILL[kind]
  // Grow the icon only. Growing the frame makes that card wider and eats the gap beside it.
  const icon = Math.max(8, Math.round((mobile ? 72 : 112) * scale * (hovered ? CARD_HOVER_SCALE : 1)))
  const titleF = Math.max(8, Math.round((mobile ? 18 : 26) * scale))
  const bodyF = Math.max(8, Math.round((mobile ? 14 : 18) * scale))
  const disabled = !!props.locked || props.frozen || maxed || !hud.pending
  const padY = Math.max(4, Math.round((mobile ? 18 : 28) * scale))
  const padX = Math.max(4, Math.round((mobile ? 10 : 14) * scale))
  const titleGap = Math.max(0, Math.round((mobile ? 12 : 18) * scale))
  const bodyGap = Math.max(0, Math.round(6 * scale))
  return (
    <UiEntity
      key={`ui_upgrade_card_${kind}`}
      uiTransform={{
        width, height, flexShrink: 0,
        justifyContent: 'center', alignItems: 'center',
        overflow: 'visible',
        pointerFilter: disabled ? 'none' : 'block',
        zIndex: 12 - index,
      }}
      onMouseDown={disabled ? undefined : () => requestUpgradeSelect(kind)}
      onMouseEnter={disabled || mobile ? undefined : () => setUpgradeCardHover(kind)}
      onMouseLeave={disabled || mobile ? undefined : () => setUpgradeCardHover(null)}
    >
      <UiEntity
        uiTransform={{
          width, height, flexShrink: 0,
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
          <Label value={bold(UPGRADE_LABEL[kind])} fontSize={titleF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: titleF + 6, margin: { top: titleGap } }} />
          <Label value={bold(offer)} fontSize={bodyF} color={INK} font="sans-serif" textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: bodyF * 2 + 6, margin: { top: bodyGap } }} />
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

/** Selected card shrinks quickly, then glides into that buff's slot. */
function FlyingPick(props: { hud: UpgradeHud }) {
  const fly = props.hud.fly
  if (!fly) return null
  const mobile = isMobile()
  const { h: uiH } = canvasSize()
  const { cardW, cardH, gap } = fitCardSize(mobile, fly.count, 1)
  const titleH = (mobile ? 28 : 36) + 6 + 16
  const rowW = cardW * fly.count + gap * Math.max(0, fly.count - 1)
  const fromX = -rowW / 2 + fly.index * (cardW + gap) + cardW / 2
  const fromY = (uiH - (titleH + cardH)) / 2 + titleH + cardH / 2
  const dock = buffDock(mobile, props.hud.iconOrder.length, fly.slot)
  const w = cardW + (dock.size - cardW) * fly.shrink
  const h = cardH + (dock.size - cardH) * fly.shrink
  const offX = fromX + (dock.x - fromX) * fly.move
  const cy = fromY + (dock.y - fromY) * fly.move
  const iconish = fly.shrink > 0.92
  return (
    <UiEntity uiTransform={{
      width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
      pointerFilter: 'none', overflow: 'visible',
    }}>
      {/* Left edge sits on the live screen center, so a resize mid-round cannot shove the flight. */}
      <UiEntity uiTransform={{
        positionType: 'absolute', position: { left: '50%', top: 0 },
        width: 0, height: '100%', pointerFilter: 'none', overflow: 'visible',
      }}>
      <UiEntity uiTransform={{
        positionType: 'absolute',
        position: { left: offX - w / 2, top: cy - h / 2 },
        width: w, height: h, overflow: 'visible', pointerFilter: 'none',
        justifyContent: 'center', alignItems: 'center',
        zIndex: 30,
      }}>
        {iconish
          ? <IconBadge kind={fly.kind} level={fly.level} size={Math.max(1, Math.round(Math.min(w, h)))} gap={0} />
          : <Card kind={fly.kind} hud={props.hud} width={w} height={h} mobile={mobile} index={0} scale={w / cardW} level={fly.level} frozen />}
      </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

/**
 * Centered upgrade cards, shared by auto-open and a manual pill tap.
 * Gameplay is not paused; only the cards capture clicks. The popup
 * dismisses when the player picks a card or when the 5-second auto-tuck
 * expires. A pick shrinks that card into its buff slot. The other
 * cards stay put until the flight ends. There is
 * no visible timer bar or Close button.
 */
function CardCluster(props: { hud: UpgradeHud; mobile: boolean; cardW: number; cardH: number; gap: number; hold: boolean }) {
  const { hud, mobile, cardW, cardH, gap, hold } = props
  const kinds = hold && hud.fly ? hud.fly.offer : hud.offer
  const flying = hold ? hud.fly?.kind ?? null : null
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
        <UiEntity uiTransform={{
          width: kinds.length * cardW + Math.max(0, kinds.length - 1) * gap,
          height: cardH,
          flexShrink: 0,
          overflow: 'visible',
          pointerFilter: 'none',
        }}>
          {kinds.map((kind, i) => (
            <UiEntity
              key={`ui_upgrade_pos_${kind}`}
              uiTransform={{
                positionType: 'absolute',
                position: { left: i * (cardW + gap), top: 0 },
                width: cardW,
                height: cardH,
                overflow: 'visible',
                pointerFilter: 'none',
              }}
            >
              {flying === kind
                ? null
                : <Card kind={kind} hud={hud} width={cardW} height={cardH} mobile={mobile} index={i} level={hold && hud.fly ? hud.fly.levels[kind] : undefined} locked={hold} />}
            </UiEntity>
          ))}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

export function UpgradeOverlay() {
  const hud = getUpgradeHud()
  if (hud.fly) {
    const mobile = isMobile()
    const { cardW, cardH, gap } = fitCardSize(mobile, hud.fly.count, 1)
    return (
      <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, pointerFilter: 'none', overflow: 'visible' }}>
        <CardCluster hud={hud} mobile={mobile} cardW={cardW} cardH={cardH} gap={gap} hold />
        <FlyingPick hud={hud} />
      </UiEntity>
    )
  }
  if (!hud.clusterVisible) return null
  const mobile = isMobile()
  const { cardW, cardH, gap } = fitCardSize(mobile, hud.offer.length, hud.popScale)
  return <CardCluster hud={hud} mobile={mobile} cardW={cardW} cardH={cardH} gap={gap} hold={false} />
}
