import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted, playUiClick } from "./client/audio"
import { coverage } from "./paint"
import { getCountdownSeconds, formatMMSS, getBanner } from "./round"
import { LeaderboardState, leaderboardStateEntity } from "./shared/components"
import { room } from "./shared/messages"
import { Team, TEAM_RGB } from "./shared/team"
import { OverviewEye, OverviewRow } from "./client/overviewUi"
import { AbilityHotbar } from "./client/abilityHotbar"

// Popup open/close state — module-local, driven by star-button clicks.
// React-ECS re-renders every frame so a plain variable is enough.
let leaderboardOpen = false
function toggleLeaderboard(): void {
  playUiClick()
  leaderboardOpen = !leaderboardOpen
  if (leaderboardOpen) {
    // Ask server for the freshest snapshot when opening; response arrives
    // as a CRDT update to LeaderboardState within a frame or two.
    room.send('requestLeaderboard', {})
  }
}

interface LbEntry { userId: string; name: string; cellsPainted: number }
function readLeaderboard(): LbEntry[] {
  const s = LeaderboardState.getOrNull(leaderboardStateEntity)
  if (!s || !s.json) return []
  try {
    const arr = JSON.parse(s.json)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

const PILL_BG      = Color4.create(0, 0, 0, 0.5)
const RED_COLOR    = Color4.create(255/255, 117/255, 119/255, 1) // pallet.jpeg #FF7577
const BLUE_COLOR   = Color4.create(106/255, 153/255, 252/255, 1) // pallet.jpeg #6A99FC
const COUNTDOWN_BG = Color4.create(0.1, 0.1, 0.1, 0.92)
const BANNER_BG    = Color4.create(0, 0, 0, 0.55)

// Territory bar styling taken from flagtag's drown (air) bar, src/ui/components/ProgressBar.tsx:
// pill-shaped dark semi-transparent track (PANEL_BG_SEMI), uniform border padding, fully rounded
// outer ends (radius = half the fill height); red/white/blue meet on straight vertical edges.
// No texture, no label.
const BAR_W = 200
const BAR_BORDER = 3
const BAR_FILL_H = 16
const BAR_INNER_W = BAR_W - BAR_BORDER * 2
const BAR_INNER_R = BAR_FILL_H // renderer under-rounds at exactly h/2; over-size so the inner ends are fully round like the outer pill
const STAR_SIZE = 14
const STAR_PAD = 4
const STAR_SRC = 'assets/images/star_white.png'
const STAR_TINT = Color4.create(0.33, 0.33, 0.34, 1) // matches the bar track's on-screen grey
const BAR_TRACK = Color4.create(0.08, 0.08, 0.1, 0.87) // flagtag PANEL_BG_SEMI
const BAR_RED   = Color4.create(TEAM_RGB[Team.Red].r,  TEAM_RGB[Team.Red].g,  TEAM_RGB[Team.Red].b,  1)
const BAR_BLUE  = Color4.create(TEAM_RGB[Team.Blue].r, TEAM_RGB[Team.Blue].g, TEAM_RGB[Team.Blue].b, 1)

/** Territory shares in %, same source and 1-decimal rounding the old text readout showed. */
function coveragePct(): { red: number; blue: number } {
  const { red, blue, total } = coverage()
  if (total === 0) return { red: 0, blue: 0 }
  return {
    red:  Number(((red  / total) * 100).toFixed(1)),
    blue: Number(((blue / total) * 100).toFixed(1)),
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
            positionType: 'absolute', position: { top: 10, left: 0 },
            width: '100%', flexDirection: 'row', justifyContent: 'center',
            pointerFilter: 'none',
          }}
        >
          <UiEntity uiTransform={{ width: 200, flexDirection: 'column', alignItems: 'center' }}>
            <OverviewRow />
            <UiEntity
              uiTransform={{
                width: 200, height: 68,
                justifyContent: 'center', alignItems: 'center', borderRadius: 18,
              }}
              uiBackground={{ color: COUNTDOWN_BG }}
            >
              <Label value={formatMMSS(secs)} fontSize={42} color={Color4.White()} textAlign="middle-center" />
              {/* Star icon on the left, mirror position to the mute icon on
                  the right. Placeholder — no handler yet; wire onMouseDown
                  when we decide what it does (leaderboard? favorites?). */}
              <UiEntity
                uiTransform={{
                  width: 19, height: 19,
                  positionType: 'absolute', position: { top: 16, left: 20 },
                  justifyContent: 'center', alignItems: 'center',
                  pointerFilter: 'block',
                }}
                onMouseDown={toggleLeaderboard}
              >
                <Label value="★" fontSize={22} color={Color4.White()} textAlign="middle-center" />
              </UiEntity>
              <OverviewEye />
              {/* Mute icon docked inside the timer panel on the right. No pill
                  background — just the icon sitting on the panel. */}
              <UiEntity
                uiTransform={{
                  width: 19, height: 19,
                  positionType: 'absolute', position: { top: 25, right: 20 },
                  pointerFilter: 'block',
                }}
                uiBackground={{
                  textureMode: 'stretch',
                  texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
                }}
                onMouseDown={toggleMusic}
              />
            </UiEntity>
            {/* Territory bar: red from the left, blue from the right, white = unpainted. */}
            {(() => {
              const pct = coveragePct()
              // Winning star: centred in the leader's segment, only if it fits with padding; none on a tie / 0–0.
              const lead = pct.red > pct.blue ? 'red' : pct.blue > pct.red ? 'blue' : null
              const leadW = lead ? BAR_INNER_W * (lead === 'red' ? pct.red : pct.blue) / 100 : 0
              const star = lead !== null && leadW >= STAR_SIZE + STAR_PAD * 2
                ? <UiEntity uiTransform={{ width: STAR_SIZE, height: STAR_SIZE, margin: lead === 'red' ? { bottom: 1 } : undefined }} uiBackground={{ textureMode: 'stretch', texture: { src: STAR_SRC } }} />
                : null
              return (
                <UiEntity
                  uiTransform={{
                    width: BAR_W, height: BAR_FILL_H + BAR_BORDER * 2, margin: { top: 6 },
                    borderRadius: (BAR_FILL_H + BAR_BORDER * 2) / 2, padding: BAR_BORDER,
                  }}
                  uiBackground={{ color: BAR_TRACK }}
                >
                  <UiEntity
                    uiTransform={{ width: '100%', height: '100%', borderRadius: BAR_INNER_R }}
                    uiBackground={{ color: Color4.White() }}
                  >
                    {pct.red > 0 && <UiEntity
                      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: `${pct.red}%`, height: '100%', borderRadius: { topLeft: BAR_INNER_R, bottomLeft: BAR_INNER_R, topRight: 0, bottomRight: 0 }, justifyContent: 'center', alignItems: 'center' }}
                      uiBackground={{ color: BAR_RED }}
                    >{lead === 'red' && star}</UiEntity>}
                    {pct.blue > 0 && <UiEntity
                      uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0 }, width: `${pct.blue}%`, height: '100%', borderRadius: { topLeft: 0, bottomLeft: 0, topRight: BAR_INNER_R, bottomRight: BAR_INNER_R }, justifyContent: 'center', alignItems: 'center' }}
                      uiBackground={{ color: BAR_BLUE }}
                    >{lead === 'blue' && star}</UiEntity>}
                  </UiEntity>
                </UiEntity>
              )
            })()}
          </UiEntity>
        </UiEntity>
      )
    })()}

    {/* ─── Leaderboard popup: centered modal ────────────────────────
        Renders when leaderboardOpen is true. Star button in the timer
        panel toggles this + fires requestLeaderboard for a fresh snapshot. */}
    {leaderboardOpen && (() => {
      const rows = readLeaderboard()
      return (
        <UiEntity
          uiTransform={{
            width: '100%', height: '100%',
            positionType: 'absolute', position: { top: 0, left: 0 },
            justifyContent: 'center', alignItems: 'center',
          }}
          uiBackground={{ color: BANNER_BG }}
          onMouseDown={toggleLeaderboard}
        >
          {/* Modal card. Any click anywhere (card, X, backdrop) closes the
              popup — no stop-propagation, so the outer overlay's onMouseDown
              handles it uniformly. */}
          <UiEntity
            uiTransform={{
              width: 520, height: 640, borderRadius: 20,
              padding: 24, flexDirection: 'column', alignItems: 'stretch',
            }}
            uiBackground={{ color: Color4.create(0.08, 0.08, 0.08, 0.98) }}
            onMouseDown={toggleLeaderboard}
          >
            {/* Header */}
            <UiEntity uiTransform={{ width: '100%', height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label value="★ TOP PAINTERS" fontSize={28} color={Color4.White()} textAlign="middle-left" />
              <UiEntity
                uiTransform={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
                onMouseDown={toggleLeaderboard}
              >
                <Label value="✕" fontSize={22} color={Color4.White()} textAlign="middle-center" />
              </UiEntity>
            </UiEntity>
            {/* Column headers */}
            <UiEntity uiTransform={{ width: '100%', height: 28, margin: { top: 12 }, flexDirection: 'row', alignItems: 'center' }}>
              <Label value="#"     fontSize={14} color={Color4.Gray()} textAlign="middle-left"  uiTransform={{ width: 40 }} />
              <Label value="PLAYER" fontSize={14} color={Color4.Gray()} textAlign="middle-left"  uiTransform={{ width: 340 }} />
              <Label value="CELLS"  fontSize={14} color={Color4.Gray()} textAlign="middle-right" uiTransform={{ width: 90 }} />
            </UiEntity>
            {/* Rows */}
            {rows.length === 0 ? (
              <UiEntity uiTransform={{ width: '100%', height: 60, margin: { top: 12 }, justifyContent: 'center', alignItems: 'center' }}>
                <Label value="No painters yet — be the first!" fontSize={16} color={Color4.Gray()} textAlign="middle-center" />
              </UiEntity>
            ) : rows.map((r, i) => (
              <UiEntity
                uiTransform={{ width: '100%', height: 26, margin: { top: 2 }, flexDirection: 'row', alignItems: 'center' }}
              >
                <Label value={`${i + 1}`}                   fontSize={16} color={i < 3 ? Color4.Yellow() : Color4.White()} textAlign="middle-left"  uiTransform={{ width: 40 }} />
                <Label value={r.name}                       fontSize={16} color={Color4.White()} textAlign="middle-left"  uiTransform={{ width: 340 }} />
                <Label value={r.cellsPainted.toLocaleString()} fontSize={16} color={Color4.White()} textAlign="middle-right" uiTransform={{ width: 90 }} />
              </UiEntity>
            ))}
          </UiEntity>
        </UiEntity>
      )
    })()}

    {/* ─── Right edge: overview-mode button (+ zoom/rotate while on).
        Rendered before the banner so the banner stays on top. */}

    {/* ─── Bottom centre: PvP hotbar, Lunge (E) + Paint Bomb (F). */}
    <AbilityHotbar />

    {/* ─── Top centre under the coverage pill: lunge test-dummy reset chip. */}

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
        {getBanner().personal !== '' && (
          <Label value={getBanner().personal} fontSize={26} color={Color4.White()} textAlign="middle-center" uiTransform={{ margin: { top: 12 } }} />
        )}
      </UiEntity>
    )}
  </UiEntity>
)
