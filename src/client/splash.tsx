/**
 * Load / intermission splash: full-screen cover.
 *
 * - Cold load: white cover for the messy first seconds (maze grow-in, snapshot, HUD).
 * - Mode vote: white choose menu (two side-by-side modes). Clicking a mode casts the
 *   vote and opens a black confirm step (chosen button centered + short blurb + Back).
 *   Back clears the ballot and returns to the choose menu.
 * - Mid-round joiners never see the vote — short load cover only.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { isMazeReady } from '../maze/rebuild'
import { hasSnapshot } from './clientHandler'
import {
  shouldShowModePick, modePickBlocksSplashFade, isModeVoting,
  modeVoteSecondsLeft, modeVoteTally, myModeVote, modeLockInfo, castModeVote, clearModeVote,
} from './modeVote'
import { GameMode, MODE_LABEL, MODE_DESC, GameModeId } from '../shared/gameMode'
import { getSummaryProgress } from '../round'

export const SPLASH_MIN_S = 1.0
export const SPLASH_MAX_S = 4.0
export const SPLASH_FADE_S = 0.3

let t = 0
let fadeLeft = -1
let alpha = 1
let loadDone = false
/** Which mode button the pointer is over on the white choose menu. */
let hoveredMode: GameModeId | null = null
/**
 * Confirm step: which mode the local player just picked.
 * Cleared on Back, on new voteOpen (myVote reset), and when voting ends.
 */
let confirmingMode: GameModeId | null = null

engine.addSystem((dt: number) => {
  if (!isModeVoting()) {
    hoveredMode = null
    confirmingMode = null
  }

  if (modePickBlocksSplashFade()) {
    if (getSummaryProgress() >= 0) {
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

  if (alpha <= 0) return
  if (fadeLeft < 0) fadeLeft = SPLASH_FADE_S
  fadeLeft -= dt
  alpha = Math.max(0, fadeLeft / SPLASH_FADE_S)
})

const SPLASH_BLEED = 4000

const INK = Color4.create(0.1, 0.1, 0.12, 1)
const INK_DIM = Color4.create(0.4, 0.4, 0.44, 1)
const WHITE = Color4.create(1, 1, 1, 1)
const BLACK = Color4.create(0.05, 0.05, 0.06, 1)
const BTN_BG = Color4.create(1, 1, 1, 1)
const BTN_BORDER = Color4.create(0.13, 0.13, 0.15, 1)
const BTN_HOVER_BG = Color4.create(0.1, 0.1, 0.12, 1)
const BTN_W = 420
const BTN_H = 110
const BTN_GAP = 24
const BTN_R = 18
const DESC_W = 520
const BACK_W = 160
const BACK_H = 52

function pickMode(mode: GameModeId): void {
  if (!isModeVoting()) return
  confirmingMode = mode
  castModeVote(mode)
}

function backToChoose(): void {
  confirmingMode = null
  clearModeVote()
}

/** White-menu mode button: idle white, hover white-on-black. No gold selected state. */
function ModeButton(props: { mode: GameModeId; enabled: boolean; marginRight?: number }) {
  const a = alpha
  const hovered = hoveredMode === props.mode
  const bg = hovered ? BTN_HOVER_BG : BTN_BG
  const fg = hovered ? WHITE : INK
  return (
    <UiEntity
      uiTransform={{
        width: BTN_W, height: BTN_H, flexShrink: 0, margin: { right: props.marginRight ?? 0 },
        borderRadius: BTN_R, borderWidth: 3,
        borderColor: Color4.create(BTN_BORDER.r, BTN_BORDER.g, BTN_BORDER.b, a),
        justifyContent: 'center', alignItems: 'center', flexDirection: 'column', pointerFilter: 'block',
      }}
      uiBackground={{ color: Color4.create(bg.r, bg.g, bg.b, a) }}
      onMouseEnter={() => { hoveredMode = props.mode }}
      onMouseLeave={() => { if (hoveredMode === props.mode) hoveredMode = null }}
      onMouseDown={() => { if (props.enabled) pickMode(props.mode) }}
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

/** Centered confirm button on the black screen: white outline + white text. */
function ConfirmModeButton(props: { mode: GameModeId }) {
  const a = alpha
  return (
    <UiEntity
      uiTransform={{
        width: BTN_W, height: BTN_H, flexShrink: 0,
        borderRadius: BTN_R, borderWidth: 4,
        borderColor: Color4.create(WHITE.r, WHITE.g, WHITE.b, a),
        justifyContent: 'center', alignItems: 'center', flexDirection: 'column', pointerFilter: 'none',
      }}
      uiBackground={{ color: Color4.create(BLACK.r, BLACK.g, BLACK.b, a) }}
    >
      <Label
        value={MODE_LABEL[props.mode]}
        fontSize={36}
        color={Color4.create(WHITE.r, WHITE.g, WHITE.b, a)}
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
      ? `${MODE_LABEL[GameMode.Ooze]} COMING SOON - STARTING ${MODE_LABEL[GameMode.Pixelwars]}`
      : `${MODE_LABEL[lock.mode]} SELECTED`
    return (
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <Label value={line} fontSize={28} color={Color4.create(WHITE.r, WHITE.g, WHITE.b, a)} textAlign="middle-center" textWrap="nowrap" />
      </UiEntity>
    )
  }
  if (!isModeVoting()) return null

  const tally = modeVoteTally()
  const secs = modeVoteSecondsLeft()
  const tallyLine = `${tally.pixelwars}  ·  ${tally.ooze}`
  const timerLine = secs > 0 ? `STARTING IN ${secs}s` : 'STARTING…'

  // Confirm step: black screen, chosen mode centered + blurb + Back.
  if (confirmingMode !== null) {
    const mode = confirmingMode
    return (
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <ConfirmModeButton mode={mode} />
        <Label
          value={MODE_DESC[mode]}
          fontSize={20}
          color={Color4.create(0.75, 0.75, 0.78, a)}
          textAlign="middle-center"
          textWrap="wrap"
          uiTransform={{ width: DESC_W, margin: { top: 22 }, height: 72 }}
        />
        <UiEntity
          uiTransform={{
            width: BACK_W, height: BACK_H, flexShrink: 0, margin: { top: 10 },
            borderRadius: 12, borderWidth: 2,
            borderColor: Color4.create(WHITE.r, WHITE.g, WHITE.b, a * 0.7),
            justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0) }}
          onMouseDown={() => backToChoose()}
        >
          <Label value="BACK" fontSize={20} color={Color4.create(WHITE.r, WHITE.g, WHITE.b, a)} textAlign="middle-center" textWrap="nowrap" />
        </UiEntity>
        <Label
          value={timerLine}
          fontSize={18}
          color={Color4.create(0.55, 0.55, 0.58, a)}
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ margin: { top: 28 } }}
        />
        <Label
          value={tallyLine}
          fontSize={16}
          color={Color4.create(0.45, 0.45, 0.48, a)}
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ margin: { top: 8 } }}
        />
      </UiEntity>
    )
  }

  // Choose menu: white splash, two modes side by side.
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
        <ModeButton mode={GameMode.Pixelwars} enabled={true} marginRight={BTN_GAP} />
        <ModeButton mode={GameMode.Ooze} enabled={true} />
      </UiEntity>
      <Label
        value={timerLine}
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
  if (alpha <= 0 && !shouldShowModePick()) return null
  const showPick = shouldShowModePick() && getSummaryProgress() < 0
  const a = showPick ? Math.max(alpha, 1) : alpha
  const coverA = showPick ? 1 : a
  // Confirm / lock banner → black full-screen; choose menu / load → white.
  const confirming = showPick && (confirmingMode !== null || modeLockInfo() !== null)
  const cover = confirming ? BLACK : WHITE
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block', overflow: 'visible', flexDirection: 'column' }}
    >
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -SPLASH_BLEED, left: -SPLASH_BLEED }, width: 1920 + 2 * SPLASH_BLEED, height: 1080 + 2 * SPLASH_BLEED, pointerFilter: 'block' }}
        uiBackground={{ color: Color4.create(cover.r, cover.g, cover.b, coverA) }}
      />
      {showPick && <ModePickContent />}
    </UiEntity>
  )
}
