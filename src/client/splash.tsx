/**
 * Load / intermission splash: full-screen white cover.
 *
 * - Cold load: covers the messy first seconds (maze grow-in, snapshot, HUD).
 * - Mode vote: same white splash with two big buttons (Pixelwars / Corruption).
 *   Opens after the round-end summary (server modeVoteOpen) and on cold start
 *   when the server is idle. Mid-round joiners never see the vote — they just
 *   get the short load cover that fades once the scene is ready.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { isMazeReady } from '../maze/rebuild'
import { hasSnapshot } from './clientHandler'
import {
  shouldShowModePick, modePickBlocksSplashFade, isModeVoting,
  modeVoteSecondsLeft, modeVoteTally, myModeVote, modeLockInfo, castModeVote,
} from './modeVote'
import { GameMode, MODE_LABEL, GameModeId } from '../shared/gameMode'
import { getSummaryProgress } from '../round'

export const SPLASH_MIN_S = 1.0 // shown at least this long (load only)
export const SPLASH_MAX_S = 4.0 // hidden by this time no matter what (load only)
export const SPLASH_FADE_S = 0.3 // fade-out duration

let t = 0
let fadeLeft = -1 // <0: not fading yet
let alpha = 1
let loadDone = false // after first load fade completes, only mode-pick can raise the splash again
/** Which mode button the pointer is over (SDK onMouseEnter/Leave). */
let hoveredMode: GameModeId | null = null

engine.addSystem((dt: number) => {
  if (!isModeVoting()) hoveredMode = null
  // Mode vote / lock banner keeps the splash up (or brings it back after summary).
  if (modePickBlocksSplashFade()) {
    // Don't interrupt the round-end summary; wait until it finishes (progress < 0).
    if (getSummaryProgress() >= 0) {
      // Summary still on screen — keep splash hidden underneath.
      if (!loadDone) {
        // First load overlapping a summary is rare; still allow load fade rules below.
      } else {
        alpha = 0
        fadeLeft = -1
        return
      }
    }
    loadDone = true
    alpha = 1
    fadeLeft = -1
    return
  }

  if (!loadDone) {
    if (alpha <= 0) { loadDone = true; return }
    t += dt
    if (fadeLeft < 0) {
      if (t >= SPLASH_MAX_S || (t >= SPLASH_MIN_S && hasSnapshot() && isMazeReady())) fadeLeft = SPLASH_FADE_S
      return
    }
    fadeLeft -= dt
    alpha = Math.max(0, fadeLeft / SPLASH_FADE_S)
    if (alpha <= 0) loadDone = true
    return
  }

  // Post-load: if vote just ended, fade out the splash.
  if (alpha <= 0) return
  if (fadeLeft < 0) fadeLeft = SPLASH_FADE_S
  fadeLeft -= dt
  alpha = Math.max(0, fadeLeft / SPLASH_FADE_S)
})

// White cover is deliberately oversized and offset beyond the HUD root: on phones the UI root is
// inset (safe area) / scaled to the 1920x1080 virtual canvas, so '100%' of it left uncovered strips.
const SPLASH_BLEED = 4000 // px (virtual) the cover extends past every edge of the HUD root

const INK = Color4.create(0.1, 0.1, 0.12, 1)
const INK_DIM = Color4.create(0.4, 0.4, 0.44, 1)
const WHITE = Color4.create(1, 1, 1, 1)
const BTN_BG = Color4.create(1, 1, 1, 1) // idle: white fill on white splash, black outline
const BTN_BORDER = Color4.create(0.13, 0.13, 0.15, 1)
const BTN_HOVER_BG = Color4.create(0.1, 0.1, 0.12, 1) // black
const BTN_SELECTED_BG = Color4.create(0.98, 0.78, 0.2, 1) // gold
const BTN_W = 420
const BTN_H = 110
const BTN_GAP = 24
const BTN_R = 18

function ModeButton(props: { mode: GameModeId; selected: boolean; enabled: boolean; marginRight?: number }) {
  const a = alpha
  const hovered = hoveredMode === props.mode
  // Selected (voted) wins over hover; then hover; else idle.
  const bg = props.selected ? BTN_SELECTED_BG : hovered ? BTN_HOVER_BG : BTN_BG
  const fg = props.selected || hovered ? WHITE : INK
  const borderW = props.selected ? 5 : 3
  return (
    <UiEntity
      uiTransform={{
        width: BTN_W, height: BTN_H, flexShrink: 0, margin: { right: props.marginRight ?? 0 },
        borderRadius: BTN_R, borderWidth: borderW,
        borderColor: Color4.create(BTN_BORDER.r, BTN_BORDER.g, BTN_BORDER.b, a),
        justifyContent: 'center', alignItems: 'center', flexDirection: 'column', pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(bg.r, bg.g, bg.b, a) }}
      onMouseEnter={() => { hoveredMode = props.mode }}
      onMouseLeave={() => { if (hoveredMode === props.mode) hoveredMode = null }}
      onMouseDown={() => { if (props.enabled) castModeVote(props.mode) }}
    >
      <Label
        value={MODE_LABEL[props.mode]}
        fontSize={36}
        color={Color4.create(fg.r, fg.g, fg.b, a)}
        textAlign="middle-center"
        textWrap="nowrap"
      />
    </UiEntity>
  )
}

function ModePickContent() {
  const lock = modeLockInfo()
  const a = alpha
  if (lock) {
    const line = lock.fallback
      ? `${MODE_LABEL[GameMode.Ooze]} COMING SOON — STARTING ${MODE_LABEL[GameMode.Pixelwars]}`
      : `${MODE_LABEL[lock.mode]} SELECTED`
    return (
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <Label value={line} fontSize={28} color={Color4.create(INK.r, INK.g, INK.b, a)} textAlign="middle-center" textWrap="nowrap" />
      </UiEntity>
    )
  }
  if (!isModeVoting()) return null
  const tally = modeVoteTally()
  const mine = myModeVote()
  const secs = modeVoteSecondsLeft()
  // Tiny external tally (order matches left/right buttons) — no descriptor under titles.
  const tallyLine = `${tally.pixelwars}  ·  ${tally.ooze}`
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <Label
        value="CHOOSE A MODE"
        fontSize={22}
        color={Color4.create(INK_DIM.r, INK_DIM.g, INK_DIM.b, a)}
        textAlign="middle-center"
        textWrap="nowrap"
        uiTransform={{ margin: { bottom: 8 } }}
      />
      <Label
        value={tallyLine}
        fontSize={18}
        color={Color4.create(INK_DIM.r, INK_DIM.g, INK_DIM.b, a)}
        textAlign="middle-center"
        textWrap="nowrap"
        uiTransform={{ margin: { bottom: 18 } }}
      />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
        <ModeButton mode={GameMode.Pixelwars} selected={mine === GameMode.Pixelwars} enabled={true} marginRight={BTN_GAP} />
        <ModeButton mode={GameMode.Ooze} selected={mine === GameMode.Ooze} enabled={true} />
      </UiEntity>
      <Label
        value={secs > 0 ? `STARTING IN ${secs}s` : 'STARTING…'}
        fontSize={20}
        color={Color4.create(INK_DIM.r, INK_DIM.g, INK_DIM.b, a)}
        textAlign="middle-center"
        textWrap="nowrap"
        uiTransform={{ margin: { top: 18 } }}
      />
    </UiEntity>
  )
}

export function SplashScreen() {
  // Keep mounting during vote even if alpha briefly 0 between summary→vote.
  if (alpha <= 0 && !shouldShowModePick()) return null
  const showPick = shouldShowModePick() && getSummaryProgress() < 0
  const a = showPick ? Math.max(alpha, 1) : alpha
  // Force opaque white while voting (system also sets alpha=1).
  const coverA = showPick ? 1 : a
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block', overflow: 'visible', flexDirection: 'column' }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -SPLASH_BLEED, left: -SPLASH_BLEED }, width: 1920 + 2 * SPLASH_BLEED, height: 1080 + 2 * SPLASH_BLEED, pointerFilter: 'block' }}
        uiBackground={{ color: Color4.create(1, 1, 1, coverA) }}
      />
      {showPick && <ModePickContent />}
    </UiEntity>
  )
}
