import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted, playUiClick } from "./client/audio"
import { coverage } from "./paint"
import { getCountdownSeconds, formatMMSS, getBanner, getSummaryProgress } from "./round"
import { LeaderboardState, leaderboardStateEntity } from "./shared/components"
import { room } from "./shared/messages"
import { Team, TEAM_RGB } from "./shared/team"
import { OverviewEye, OverviewRow } from "./client/overviewUi"
import { AbilityHotbar } from "./client/abilityHotbar"
import { getPlayer } from "@dcl/sdk/players"
import { engine, UiCanvasInformation } from "@dcl/sdk/ecs"

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
const BAR_INNER_R = BAR_FILL_H / 2
const BAR_CAP = BAR_FILL_H / 2 // each end always shows its team colour (rounded cap) so nothing sits outside the bar at 0%
const STAR_SIZE = 14
const STAR_PAD = 4
const STAR_SRC = 'assets/images/star_white.png'
const STAR_TINT = Color4.create(0.33, 0.33, 0.34, 1) // matches the bar track's on-screen grey
const BAR_TRACK = Color4.create(0.08, 0.08, 0.1, 0.87) // flagtag PANEL_BG_SEMI
const BAR_RED   = Color4.create(TEAM_RGB[Team.Red].r,  TEAM_RGB[Team.Red].g,  TEAM_RGB[Team.Red].b,  1)
const BAR_BLUE  = Color4.create(TEAM_RGB[Team.Blue].r, TEAM_RGB[Team.Blue].g, TEAM_RGB[Team.Blue].b, 1)

// Round-end summary square (the bar grown). Bar's top edge sits 10 (top) + 68 (timer) + 6 (margin) px down.
// Wide panel (Luke's mockup): light-grey frame → dark border → red | unpainted | blue infographic.
// Sized from the screen: SUMMARY_W_FRAC of the canvas width (clamped), height = width / SUMMARY_ASPECT.
// Every size below is at the reference width SUMMARY_REF_W and scales with the panel.
const SUMMARY_W_FRAC = 0.6
const SUMMARY_W_MIN = 640
const SUMMARY_W_MAX = 1500
const SUMMARY_ASPECT = 2.7
const SUMMARY_REF_W = 760
const SUMMARY_FRAME = 12        // light-grey outer frame thickness
const SUMMARY_FRAME_R = 44
const SUMMARY_BORDER = 10       // dark inner border thickness
const SUMMARY_RADIUS = 32       // dark border outer radius
const SUMMARY_CAP = 18 // 0% side still shows this much colour, like the bar's end caps
const SUMMARY_FONT = 64         // big team totals
const SUMMARY_TITLE_FONT = 60
const SUMMARY_BAND_FONT = 20    // name + % inside each band
const SUMMARY_BAND_FONT_MIN = 16
const SUMMARY_SIDE_GAP = 20     // px between the panel and the side total tags
const SUMMARY_FRAME_COLOR = Color4.create(0.86, 0.86, 0.87, 1)
const SUMMARY_UNPAINTED = Color4.create(0.85, 0.85, 0.86, 1)
const SUMMARY_TEXT = Color4.create(0.15, 0.15, 0.17, 1)
const SUMMARY_TIE_TAG = Color4.create(0.75, 0.75, 0.77, 1)

/** Canvas size in UI units (falls back to 1280×720 before the renderer reports it). */
function canvasSize(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0) return { w: 1280, h: 720 }
  const dpr = c.devicePixelRatio > 0 ? c.devicePixelRatio : 1
  return { w: c.width / dpr, h: c.height / dpr }
}
const BAR_TOP_PX = 10 + 68 + 6
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// Per-painter shades inside each team region (roundOwners). Segments narrower than this (at full size)
// merge into one "others" shade; the local player's segment is never merged.
const SUMMARY_MIN_SEG_PX = 8
const SUMMARY_SHADE_STEP = 0.14   // alternate darker/lighter steps between neighbouring painters
const SUMMARY_SELF_LIGHTEN = 0.6 // local player's band: pale (lightened toward white) + outlined
const SUMMARY_SELF_OUTLINE = 3
const SUMMARY_OTHERS_MIX = 0.45   // "others" shade: team colour mixed toward grey

const mix = (c: Color4, t: Color4, k: number) => Color4.create(lerp(c.r, t.r, k), lerp(c.g, t.g, k), lerp(c.b, t.b, k), 1)
function shadeAt(base: Color4, i: number): Color4 {
  if (i === 0) return base
  const k = SUMMARY_SHADE_STEP * Math.ceil(i / 2) % 0.56
  return i % 2 ? mix(base, Color4.Black(), k) : mix(base, Color4.White(), k)
}

/** Painter bands for one team column of height `regionH`: full column width, stacked top→bottom, largest at the top.
 *  Label = name + share of the WHOLE map (team's bands sum to teamPct), right-aligned; hidden if the band is too short. */
function OwnerSegments(team: number, regionH: number, scale: number, innerR: number, fromRight: boolean, teamPct: number, font: number, showText: boolean, textA: number) {
  const owners = getBanner().owners.filter(o => o.team === team && o.cells > 0)
  const sum = owners.reduce((a, o) => a + o.cells, 0)
  if (sum === 0) return null
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  const base = team === 1 ? BAR_RED : BAR_BLUE
  const segs: Array<{ h: number; color: Color4; self: boolean; name: string; cells: number }> = []
  let others = 0, othersCells = 0
  owners.forEach((o, i) => {
    const h = regionH * o.cells / sum
    const self = o.id.toLowerCase() === me
    if (!self && h < SUMMARY_MIN_SEG_PX * scale) { others += h; othersCells += o.cells; return }
    segs.push({ h, color: self ? mix(shadeAt(base, i), Color4.White(), SUMMARY_SELF_LIGHTEN) : shadeAt(base, i), self, name: o.name || 'player', cells: o.cells })
  })
  if (others > 0) segs.push({ h: others, color: mix(base, Color4.Gray(), SUMMARY_OTHERS_MIX), self: false, name: 'Others', cells: othersCells })
  let at = 0
  return segs.map((sg, i) => {
    const pos = { top: at, left: 0 }
    at += sg.h
    // Only the column's outer corners are rounded: top band gets the top one, bottom band the bottom one.
    const rt = i === 0 ? innerR : 0, rb = i === segs.length - 1 ? innerR : 0
    const pct = Math.round(teamPct * sg.cells / sum)
    return (
      <UiEntity
        uiTransform={{
          positionType: 'absolute', position: pos, width: '100%', height: sg.h,
          borderRadius: fromRight ? { topLeft: 0, bottomLeft: 0, topRight: rt, bottomRight: rb } : { topLeft: rt, bottomLeft: rb, topRight: 0, bottomRight: 0 },
          justifyContent: 'center', alignItems: 'flex-end', padding: { right: 14 * scale },
          ...(sg.self ? { borderWidth: SUMMARY_SELF_OUTLINE * scale, borderColor: Color4.White() } : {}),
        }}
        uiBackground={{ color: sg.color }}
      >
        {showText && sg.h >= font * 1.3 && (
          <Label value={`${sg.name}  ${pct}%`} fontSize={font} color={Color4.create(SUMMARY_TEXT.r, SUMMARY_TEXT.g, SUMMARY_TEXT.b, textA)} textAlign="middle-right" />
        )}
      </UiEntity>
    )
  })
}

/** Team-coloured tag with dark text (title + side totals). */
function SummaryTag(props: { text: string; color: Color4; font: number; w: number; h: number; pos: any; a: number }) {
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: props.pos, width: props.w, height: props.h, justifyContent: 'center', alignItems: 'center', borderRadius: 8 }}
      uiBackground={{ color: Color4.create(props.color.r, props.color.g, props.color.b, props.a) }}>
      <Label value={props.text} fontSize={props.font} color={Color4.create(SUMMARY_TEXT.r, SUMMARY_TEXT.g, SUMMARY_TEXT.b, props.a)} textAlign="middle-center" />
    </UiEntity>
  )
}

/** The score bar at progress p (0 = bar, 1 = full panel). Final round shares from the banner. */
function RoundSummary(p: number) {
  const b = getBanner()
  const cv = canvasSize()
  const fullW = Math.max(SUMMARY_W_MIN, Math.min(SUMMARY_W_MAX, cv.w * SUMMARY_W_FRAC))
  const k = fullW / SUMMARY_REF_W // scale for every size at full growth
  const barH = BAR_FILL_H + BAR_BORDER * 2
  const w = lerp(BAR_W, fullW, p)
  const h = lerp(barH, fullW / SUMMARY_ASPECT, p)
  const frame = SUMMARY_FRAME * k * p // light-grey frame grows in from nothing (the bar has none)
  const border = lerp(BAR_BORDER, SUMMARY_BORDER * k, p)
  const frameR = lerp(barH / 2, SUMMARY_FRAME_R * k, p)
  const outerR = lerp(barH / 2, SUMMARY_RADIUS * k, p)
  const innerR = Math.max(0, outerR - border)
  const cap = lerp(BAR_CAP, SUMMARY_CAP * k, p)
  const innerW = w - frame * 2 - border * 2
  const innerH = h - frame * 2 - border * 2
  // Same three regions as the score bar: red | unpainted | blue, each sized by its share of the whole map.
  const span = innerW - cap * 2
  const redW = cap + span * b.redPct / 100
  const blueW = cap + span * b.bluePct / 100
  const showText = p > 0.6
  const textA = Math.min(1, (p - 0.6) / 0.4) // all text fades in/out with the grow/shrink
  const bandFont = Math.max(SUMMARY_BAND_FONT_MIN, SUMMARY_BAND_FONT * k)
  const bigFont = SUMMARY_FONT * k
  const tagW = bigFont * 2.6, tagH = bigFont * 1.4
  const title = b.winner === 'TIE' ? "IT'S A TIE" : `${b.winner} WIN!`
  const titleColor = b.winner === 'RED' ? BAR_RED : b.winner === 'BLUE' ? BAR_BLUE : SUMMARY_TIE_TAG
  const titleFont = SUMMARY_TITLE_FONT * k
  const titleW = titleFont * (title.length * 0.62 + 1.2), titleH = titleFont * 1.45
  const paleRed = mix(BAR_RED, Color4.White(), 0.45), paleBlue = mix(BAR_BLUE, Color4.White(), 0.45)
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 1, flexGrow: p, height: 0 }} />
      <UiEntity uiTransform={{ width: 1, height: BAR_TOP_PX * (1 - p), flexShrink: 0 }} />
      <UiEntity uiTransform={{ width: w, height: h, flexShrink: 0, borderRadius: frameR, padding: frame }} uiBackground={{ color: p > 0 ? SUMMARY_FRAME_COLOR : BAR_TRACK }}>
        {showText && <SummaryTag text={title} color={titleColor} font={titleFont} w={titleW} h={titleH} pos={{ bottom: h + 18 * k, left: (w - titleW) / 2 }} a={textA} />}
        {showText && <SummaryTag text={`${Math.round(b.redPct)}%`} color={paleRed} font={bigFont} w={tagW} h={tagH} pos={{ top: (h - tagH) / 2, left: -(tagW + SUMMARY_SIDE_GAP * k) }} a={textA} />}
        {showText && <SummaryTag text={`${Math.round(b.bluePct)}%`} color={paleBlue} font={bigFont} w={tagW} h={tagH} pos={{ top: (h - tagH) / 2, right: -(tagW + SUMMARY_SIDE_GAP * k) }} a={textA} />}
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: outerR, padding: border }} uiBackground={{ color: BAR_TRACK }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: innerR }} uiBackground={{ color: p > 0.5 ? SUMMARY_UNPAINTED : Color4.White() }}>
            <UiEntity
              uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: redW, height: '100%', borderRadius: { topLeft: innerR, bottomLeft: innerR, topRight: 0, bottomRight: 0 } }}
              uiBackground={{ color: BAR_RED }}
            >{OwnerSegments(1, innerH, p * k, innerR, false, b.redPct, bandFont, showText, textA)}</UiEntity>
            <UiEntity
              uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0 }, width: blueW, height: '100%', borderRadius: { topLeft: 0, bottomLeft: 0, topRight: innerR, bottomRight: innerR } }}
              uiBackground={{ color: BAR_BLUE }}
            >{OwnerSegments(2, innerH, p * k, innerR, true, b.bluePct, bandFont, showText, textA)}</UiEntity>
          </UiEntity>
        </UiEntity>
        {showText && b.personal !== '' && (
          <Label value={b.personal} fontSize={Math.max(22, 26 * k)} color={Color4.create(1, 1, 1, textA)} textAlign="middle-center"
            uiTransform={{ positionType: 'absolute', position: { top: h + 16 * k, left: (w - 1400) / 2 }, width: 1400, height: 40 * k }} />
        )}
      </UiEntity>
      <UiEntity uiTransform={{ width: 1, flexGrow: p, height: 0 }} />
    </UiEntity>
  )
}

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
                  positionType: 'absolute', position: { top: 14, left: 20 },
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
            {getSummaryProgress() >= 0 ? (
              <UiEntity uiTransform={{ width: BAR_W, height: BAR_FILL_H + BAR_BORDER * 2, margin: { top: 6 } }} />
            ) : (() => {
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
                    {<UiEntity
                      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: BAR_CAP + (BAR_INNER_W - BAR_CAP * 2) * pct.red / 100, height: '100%', borderRadius: { topLeft: BAR_INNER_R, bottomLeft: BAR_INNER_R, topRight: 0, bottomRight: 0 }, justifyContent: 'center', alignItems: 'center' }}
                      uiBackground={{ color: BAR_RED }}
                    >{lead === 'red' && star}</UiEntity>}
                    {<UiEntity
                      uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0 }, width: BAR_CAP + (BAR_INNER_W - BAR_CAP * 2) * pct.blue / 100, height: '100%', borderRadius: { topLeft: 0, bottomLeft: 0, topRight: BAR_INNER_R, bottomRight: BAR_INNER_R }, justifyContent: 'center', alignItems: 'center' }}
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
        {/* Headline, percentages and personal line now live in the summary square below. */}
      </UiEntity>
    )}

    {/* ─── Round-end summary: the score bar grows into a red|blue square, holds, shrinks back. */}
    {(() => { const p = getSummaryProgress(); return p >= 0 ? RoundSummary(p) : null })()}
  </UiEntity>
)
