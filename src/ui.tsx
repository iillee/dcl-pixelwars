import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted } from "./client/audio"
import { coverage } from "./paint"
import { getCountdownSeconds, formatMMSS, getBanner } from "./round"

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

const PILL_BG      = Color4.create(0, 0, 0, 0.5)
const RED_COLOR    = Color4.create(255/255, 117/255, 119/255, 1) // pallet.jpeg #FF7577
const BLUE_COLOR   = Color4.create(106/255, 153/255, 252/255, 1) // pallet.jpeg #6A99FC
const COUNTDOWN_BG = Color4.create(0.1, 0.1, 0.1, 0.92)
const BANNER_BG    = Color4.create(0, 0, 0, 0.55)

function coveragePct(): { red: string; blue: string } {
  const { red, blue, total } = coverage()
  if (total === 0) return { red: '0%', blue: '0%' }
  return {
    red:  `${((red  / total) * 100).toFixed(1)}%`,
    blue: `${((blue / total) * 100).toFixed(1)}%`,
  }
}

function bannerColor(): Color4 {
  const b = getBanner()
  if (b.winner === 'RED')  return RED_COLOR
  if (b.winner === 'BLUE') return BLUE_COLOR
  return Color4.White()
}

function bannerHeadline(): string {
  const b = getBanner()
  return b.winner === 'TIE' ? "IT'S A TIE" : `${b.winner} WINS`
}

function bannerSubline(): string {
  const b = getBanner()
  return `RED ${b.redPct.toFixed(1)}%    —    BLUE ${b.bluePct.toFixed(1)}%`
}

// Full-screen UI root. Everything is a child of this so absolute-positioned
// overlays (like the round-end banner) can size themselves as 100%×100% of
// the viewport, not of the tiny HUD strip.
export const uiMenu = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 } }}>

    {/* ─── Top-left: mute button ─────────────────────────────────────── */}
    {/* Mute button lives inside the timer panel below, pinned to its right edge. */}

    {/* ─── Top-center: countdown timer + coverage pill ───────────────── */}
    {(() => {
      const secs = getCountdownSeconds()
      return (
        <UiEntity
          uiTransform={{
            positionType: 'absolute', position: { top: 2, left: 0 },
            width: '100%', flexDirection: 'row', justifyContent: 'center',
            pointerFilter: 'none',
          }}
        >
          <UiEntity uiTransform={{ width: 200, flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{
                width: 200, height: 68,
                justifyContent: 'center', alignItems: 'center', borderRadius: 18,
              }}
              uiBackground={{ color: COUNTDOWN_BG }}
            >
              <Label value={formatMMSS(secs)} fontSize={42} color={Color4.White()} textAlign="middle-center" />
              {/* Mute icon docked inside the timer panel on the right. No pill
                  background — just the icon sitting on the panel. */}
              <UiEntity
                uiTransform={{
                  width: 24, height: 24,
                  positionType: 'absolute', position: { top: 22, right: 18 },
                  pointerFilter: 'block',
                }}
                uiBackground={{
                  textureMode: 'stretch',
                  texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
                }}
                onMouseDown={toggleMusic}
              />
            </UiEntity>
            <UiEntity
              uiTransform={{
                width: 200, height: 36,
                margin: { top: 6 }, borderRadius: 18,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              }}
              uiBackground={{ color: COUNTDOWN_BG }}
            >
              <Label value={coveragePct().red}  fontSize={16} color={RED_COLOR}     textAlign="middle-center" />
              <Label value="  —  "              fontSize={16} color={Color4.White()} textAlign="middle-center" />
              <Label value={coveragePct().blue} fontSize={16} color={BLUE_COLOR}    textAlign="middle-center" />
            </UiEntity>
          </UiEntity>
        </UiEntity>
      )
    })()}

    {/* ─── Round-end banner: centered full-screen overlay ─────────────
        Fills the viewport so headline + subline are visually centered
        (both horizontally and vertically), not squeezed into the top strip. */}
    {getBanner().visible && (
      <UiEntity
        uiTransform={{
          width: '100%', height: '100%',
          positionType: 'absolute', position: { top: 0, left: 0 },
          justifyContent: 'center', alignItems: 'center', flexDirection: 'column',
        }}
        uiBackground={{ color: BANNER_BG }}
      >
        <Label value={bannerHeadline()} fontSize={96} color={bannerColor()}    textAlign="middle-center" />
        <Label value={bannerSubline()}  fontSize={32} color={Color4.White()} textAlign="middle-center" />
      </UiEntity>
    )}
  </UiEntity>
)
