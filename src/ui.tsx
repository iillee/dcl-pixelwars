import { SplashScreen } from "./client/splash"
import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted, playUiClick } from "./client/audio"
import { coverage, paintEconomyOn, paintRefilling, paintTank, painterTeam } from "./paint"
import { PAINT_CAPACITY, PAINT_REFILL_MODE } from "./shared/territory"
import { hudClockText } from "./client/lobby"
import { lagHudLine, lagHudOn } from "./client/lagHud"
import { inLobby } from "./client/phase"
import { getCountdownSeconds, getBanner, getSummaryProgress, dismissSummary, summarySecondsLeft, ROUND_LENGTH_MINUTES, isBalloonRound, isBasesRound } from "./round"
import { baseCharge } from "./client/baseBeams"
import { GROWTH_PER_CELL_PER_SEC } from "./shared/bases"
import { LeaderboardState, leaderboardStateEntity } from "./shared/components"
import { room } from "./shared/messages"
import { Team, TEAM_NAME, TEAM_RGB, PLAYING_TEAMS, isPlayingTeam, leadingTeams, rankedTeams, type TeamCoverage } from "./shared/team"
import {
  areaPct, cardBodyContentH, cardFrameH, rosterLayout, sortTeamRows, summaryPcts, summaryRank, standingsLayout, tablesW, textW, textWSafe, titleFontFor,
  SUMMARY_BOLD_PX, SUMMARY_CARD_BODY_H, SUMMARY_CARD_GAP, SUMMARY_CARD_H, SUMMARY_CARD_HEAD_H, SUMMARY_CARD_W, SUMMARY_FIT, SUMMARY_FONT_MIN, SUMMARY_GAP, SUMMARY_HEAD_FONT, SUMMARY_HEAD_H, SUMMARY_PILL_FONT, SUMMARY_PILL_H, SUMMARY_PILL_W, SUMMARY_ROW_FONT, SUMMARY_ROW_H, SUMMARY_SUB_FONT, SUMMARY_TITLE_FONT, TITLE_WORD_GAP,
  type SummaryRow,
} from "./shared/summaryLayout"
import { OverviewEye, OverviewRow, TileButton, TOP_BTN, TOP_GAP } from "./client/overviewUi"
import { AbilityHotbar, RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from "./client/abilityHotbar"
import { getPlayer } from "@dcl/sdk/players"
import { isMobile } from "@dcl/sdk/platform"
import { engine, UiCanvasInformation, PrimaryPointerInfo, inputSystem, InputAction, PointerEventType } from "@dcl/sdk/ecs"

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
// Top painters rows: fixed height, rank / name / cells columns shared with the header row.
// Custom scrollbar drag: grab the thumb, follow PrimaryPointerInfo screen Y (px → UI units via the canvas ratio).
const LB_BAR_W = 10, LB_THUMB_MIN = 28
let lbOffset = 0, lbMaxOff = 0, lbThumbTravel = 0
let lbDrag: { y: number; off: number } | null = null
function pointerY(): number | null {
  const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates
  return p ? p.y : null
}
function startLbDrag(): void { const y = pointerY(); if (y !== null) lbDrag = { y, off: lbOffset } }
function lbDragSystem(): void {
  if (!lbDrag) return
  if (!leaderboardOpen || inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) { lbDrag = null; return }
  const y = pointerY(); if (y === null || lbThumbTravel <= 0) return
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  const pxPerUi = c && c.height > 0 ? c.height / 1080 : 1 // virtualHeight 1080
  const dyUi = (y - lbDrag.y) / pxPerUi
  lbOffset = Math.max(0, Math.min(lbMaxOff, lbDrag.off + dyUi * (lbMaxOff / lbThumbTravel)))
}
const LB_HEAD_H = 120 // title + column header + paddings + frame above/below the rows
const LB_ROW_H = 30, LB_PAD = 10, LB_GAP = 8, LB_RANK_W = 32, LB_CELLS_W = 100, LB_OUTLINE = 2
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
  engine.addSystem(lbDragSystem)
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
const BAR_BORDER = 3
const BAR_FILL_H = 18
/** In-match top row: eye + timer + mute, matching the lobby desktop order. */
const MATCH_TIMER_W = 200
const MATCH_TOP_W = TOP_BTN + TOP_GAP + MATCH_TIMER_W + TOP_GAP + TOP_BTN
const BAR_W = MATCH_TOP_W
const BAR_INNER_W = BAR_W - BAR_BORDER * 2
const MOBILE_TIMER_W = MATCH_TIMER_W
const MOBILE_TOP_W = 68 * 3 + MOBILE_TIMER_W + 8 * 3 // BASES charge meters still span the old mobile row
const barW = () => MATCH_TOP_W
const barInnerW = () => barW() - BAR_BORDER * 2
const BAR_INNER_R = BAR_FILL_H / 2
const BAR_CAP = BAR_FILL_H / 2 // each end always shows its team colour (rounded cap) so nothing sits outside the bar at 0%
const STAR_SIZE = 14
const STAR_PAD = 4
const STAR_SRC = 'assets/images/star_white.png'
const STAR_TINT = Color4.create(0.33, 0.33, 0.34, 1) // matches the bar track's on-screen grey
const BAR_TRACK = Color4.create(0.08, 0.08, 0.1, 0.87) // flagtag PANEL_BG_SEMI
const BAR_RED    = Color4.create(TEAM_RGB[Team.Red].r,    TEAM_RGB[Team.Red].g,    TEAM_RGB[Team.Red].b,    1)
const BAR_BLUE   = Color4.create(TEAM_RGB[Team.Blue].r,   TEAM_RGB[Team.Blue].g,   TEAM_RGB[Team.Blue].b,   1)
const BAR_GREEN  = Color4.create(TEAM_RGB[Team.Green].r,  TEAM_RGB[Team.Green].g,  TEAM_RGB[Team.Green].b,  1)
const BAR_YELLOW = Color4.create(TEAM_RGB[Team.Yellow].r, TEAM_RGB[Team.Yellow].g, TEAM_RGB[Team.Yellow].b, 1)
function barColor(team: number): Color4 {
  if (team === Team.Red) return BAR_RED
  if (team === Team.Blue) return BAR_BLUE
  if (team === Team.Green) return BAR_GREEN
  if (team === Team.Yellow) return BAR_YELLOW
  return Color4.White()
}
/** Dark ink on yellow, white on the darker team fills. */
function onTeamInk(team: number): Color4 {
  return team === Team.Yellow ? Color4.create(0.16, 0.14, 0.05, 1) : Color4.White()
}

// ─── Round-end summary: title, four-team territory pill, ranked team cards, stats row ───
// Sizes are at a 1280-wide reference and scale with the canvas (k). Card height is fixed;
// every player is shown, with rows compacting (and two columns past six) so they stay inside the box.
const BAR_TOP_PX = 10 + 68 + 6 // the score bar's top edge: the pill grows out of it
const SUMMARY_PILL_CAP = 24 // 0% side still shows this much colour, like the bar's end caps
const CLOCK_RING = TILE_RING // dark ring between the clock's light rim and its light fill
// Style of the LUNGE/BURST hotbar: light-grey rounded pills, thick dark rounded-square outlines, dark caps text.
const SUMMARY_CARD_BG = PANEL_LIGHT // same light panel as the hotbar
const SUMMARY_INK = Color4.create(0.13, 0.13, 0.15, 1)        // dark text + thick outlines
const SUMMARY_DIM = Color4.create(0.4, 0.4, 0.44, 1)          // secondary dark-grey text
const SUMMARY_R = HOTBAR_RADIUS
const SUMMARY_OUTLINE = HOTBAR_BORDER_W
/** Solid dark strip behind the title so white / team-colored words stay opaque over a bright sky. */
const SUMMARY_TITLE_BG = Color4.create(0.07, 0.07, 0.09, 1)
const SUMMARY_TITLE_FG = Color4.create(1, 1, 1, 1)
/** Team accent readable on the light-grey panel. */
const inkTeam = (team: number) => barColor(team)
const SUMMARY_UNPAINTED = PANEL_LIGHT
const SUMMARY_MVP = Color4.create(0.98, 0.78, 0.2, 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mix = (c: Color4, t: Color4, k: number) => Color4.create(lerp(c.r, t.r, k), lerp(c.g, t.g, k), lerp(c.b, t.b, k), 1)
const withA = (c: Color4, a: number) => Color4.create(c.r, c.g, c.b, c.a * a)

/** Canvas size in UI units (falls back to 1280×720 before the renderer reports it). */
function canvasSize(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || c.width <= 0) return { w: 1280, h: 720 }
  const dpr = c.devicePixelRatio > 0 ? c.devicePixelRatio : 1
  return { w: c.width / dpr, h: c.height / dpr }
}

const fnt = (f: number, k: number) => Math.max(SUMMARY_FONT_MIN, f * k)
export { titleFontFor }

/** Fake bold: the same label drawn 5× (centre + 4 offsets of ~3.5% of the font size) in one fixed box. */
function BoldLabel(props: { value: string; fontSize: number; color: Color4; w: number; h: number; align: 'middle-left' | 'middle-center' | 'middle-right'; margin?: any }) {
  const o = Math.max(1, props.fontSize * SUMMARY_BOLD_PX)
  const offs: Array<[number, number]> = [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]]
  return (
    <UiEntity uiTransform={{ width: props.w, height: props.h, flexShrink: 0, margin: props.margin }}>
      {offs.map(([x, y]) => (
        <Label value={props.value} fontSize={props.fontSize} color={props.color} textAlign={props.align} textWrap="nowrap"
          uiTransform={{ positionType: 'absolute', position: { left: x, top: y }, width: props.w, height: props.h }} />
      ))}
    </UiEntity>
  )
}


/** Keep a sliver for 0% teams so all four colours stay visible. */
function segmentFracs(pcts: number[]): number[] {
  const sum = pcts.reduce((a, b) => a + b, 0)
  const SLIVER = 0.07
  if (sum <= 0) return pcts.map(() => 1 / Math.max(1, pcts.length))
  const empty = pcts.map(p => p <= 0)
  const reserved = empty.filter(Boolean).length * SLIVER
  const rest = Math.max(0, 1 - reserved)
  return pcts.map((p, i) => empty[i] ? SLIVER : rest * (p / sum))
}

function TeamScorePill(props: {
  pcts: number[]
  width: number
  height: number
  border: number
  track: Color4
  innerBg: Color4
  showLabels?: boolean
  fontSize?: number
  leaders?: number[]
  showStar?: boolean
  showUnpainted?: boolean
}) {
  const teamFracs = props.showUnpainted
    ? props.pcts.map(p => Math.max(0, p) / 100)
    : segmentFracs(props.pcts)
  const whiteFrac = props.showUnpainted
    ? Math.max(0, 1 - teamFracs.reduce((a, b) => a + b, 0))
    : 0
  const pieces: { team: number; frac: number; pct: number }[] = []
  for (let i = 0; i < teamFracs.length; i++) {
    if (props.showUnpainted && teamFracs[i] <= 0.0001) continue
    pieces.push({ team: PLAYING_TEAMS[i] ?? 0, frac: teamFracs[i], pct: props.pcts[i] ?? 0 })
  }
  if (whiteFrac > 0.0001) pieces.push({ team: Team.None, frac: whiteFrac, pct: 0 })
  const innerR = Math.max(1, (props.height - props.border * 2) / 2)
  const innerW = Math.max(1, props.width - props.border * 2)
  const f = props.fontSize ?? 12
  const uniqueLead = (props.leaders ?? []).length === 1 ? props.leaders![0] : -1
  // Rectangular slices inside a rounded, overflow-hidden track (same pattern
  // as DUCK's ProgressBar). A per-segment end cap wider than a thin first
  // slice was getting clipped off the rounded left. Boost short painted
  // slivers to at least the cap diameter, taking the extra from unpainted.
  const widths = pieces.map(p => p.frac * innerW)
  if (props.showUnpainted) {
    const minW = innerR * 2
    const whiteI = pieces.findIndex(p => p.team === Team.None)
    let need = 0
    const short: number[] = []
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].team !== Team.None && widths[i] > 0 && widths[i] < minW) {
        need += minW - widths[i]
        short.push(i)
      }
    }
    const available = whiteI >= 0 ? Math.max(0, widths[whiteI]) : 0
    const give = Math.min(need, available)
    if (give > 0 && need > 0) {
      for (const i of short) widths[i] += give * ((minW - widths[i]) / need)
      widths[whiteI] -= give
    }
  }
  return (
    <UiEntity uiTransform={{ width: props.width, height: props.height, flexShrink: 0, borderRadius: props.height / 2, padding: props.border }} uiBackground={{ color: props.track }}>
      <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'row', borderRadius: innerR, overflow: 'hidden' }} uiBackground={{ color: props.innerBg }}>
        {pieces.map((piece, i) => {
          const w = widths[i]
          const team = piece.team
          const label = `${Math.round(piece.pct)}%`
          const showLbl = !!props.showLabels && team !== Team.None && w >= textWSafe(label, f) + 8
          const showStar = !!props.showStar && uniqueLead === team && !showLbl && w >= STAR_SIZE + STAR_PAD * 2
          const fill = team === Team.None ? Color4.White() : barColor(team)
          return (
            <UiEntity uiTransform={{ width: w, height: '100%', flexShrink: 0, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: fill }}>
              {showLbl && <Label value={label} fontSize={f} color={onTeamInk(team)} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: w, height: '100%' }} />}
              {showStar && <UiEntity uiTransform={{ width: STAR_SIZE, height: STAR_SIZE }} uiBackground={{ textureMode: 'stretch', texture: { src: STAR_SRC } }} />}
            </UiEntity>
          )
        })}
      </UiEntity>
    </UiEntity>
  )
}

function TeamCardGrid(props: {
  rows: SummaryRow[]
  total: number
  mvp: string
  me: string
  k: number
  a: number
  stacked: boolean
  order: number[]
  leaders: number[]
  fitContent?: boolean
  bodyCap?: number
}) {
  const { rows, total, mvp, me, k, a, stacked, order, leaders, fitContent, bodyCap } = props
  const cap = bodyCap ?? SUMMARY_CARD_BODY_H
  const card = (team: number, i: number) => (
    <TeamCard team={team} rows={rows.filter(r => r.team === team)} total={total} mvp={mvp} me={me} k={k} a={a} leader={leaders.includes(team)} rank={i + 1} fitContent={fitContent} bodyCap={cap} />
  )
  const gap = SUMMARY_CARD_GAP * k
  const vgap = SUMMARY_GAP * 0.6 * k
  const hOf = (team: number) => fitContent
    ? cardFrameH(Math.max(1, rows.filter(r => r.team === team).length), cap) * k
    : SUMMARY_CARD_H * k
  const gridW = tablesW(stacked) * k
  // Explicit widths and heights: DCL UI does not size auto flex rows reliably,
  // so a second 2×2 row was painting on top of the first.
  if (stacked) {
    const hs = order.map(team => hOf(team))
    const stackH = hs.reduce((s, h) => s + h, 0) + vgap * Math.max(0, order.length - 1)
    return (
      <UiEntity uiTransform={{ width: gridW, height: stackH, flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        {order.map((team, i) => (
          <UiEntity uiTransform={{ width: gridW, height: hs[i] + (i === 0 ? 0 : vgap), flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
            <UiEntity uiTransform={{ width: 1, height: i === 0 ? 0 : vgap, flexShrink: 0 }} />
            <UiEntity uiTransform={{ width: gridW, height: hs[i], flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
              {card(team, i)}
            </UiEntity>
          </UiEntity>
        ))}
      </UiEntity>
    )
  }
  const row = (a: number, b: number, ia: number, ib: number) => {
    const rh = Math.max(hOf(a), hOf(b))
    return (
    <UiEntity uiTransform={{ width: gridW, height: rh, flexDirection: 'row', alignItems: 'flex-start', flexShrink: 0 }}>
      {card(a, ia)}
      <UiEntity uiTransform={{ width: gap, height: rh, flexShrink: 0 }} />
      {card(b, ib)}
    </UiEntity>
    )
  }
  const rh0 = Math.max(hOf(order[0]), hOf(order[1]))
  const rh1 = Math.max(hOf(order[2]), hOf(order[3]))
  return (
    <UiEntity uiTransform={{ width: gridW, height: rh0 + vgap + rh1, flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
      {row(order[0], order[1], 0, 1)}
      <UiEntity uiTransform={{ width: gridW, height: vgap, flexShrink: 0 }} />
      {row(order[2], order[3], 2, 3)}
    </UiEntity>
  )
}

function HeadlineRow(props: { text: string; font: number }) {
  const words = props.text.trim().split(/\s+/).filter(Boolean)
  const gap = Math.max(2, props.font * TITLE_WORD_GAP)
  const h = props.font * 1.2
  const ink = (w: string) => {
    const tok = w.replace(/!$/, '')
    return tok === 'RED' ? BAR_RED : tok === 'BLUE' ? BAR_BLUE : tok === 'GREEN' ? BAR_GREEN : tok === 'YELLOW' ? BAR_YELLOW : SUMMARY_TITLE_FG
  }
  const wordRow = (offset: number, shadow: boolean) => (
    <UiEntity uiTransform={{
      positionType: offset ? 'absolute' : 'relative',
      position: offset ? { top: offset, left: offset } : undefined,
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
      height: h, flexShrink: 0,
    }}>
      {words.map((w, i) => (
        <Label
          value={w}
          fontSize={props.font}
          color={shadow ? Color4.create(0.04, 0.04, 0.06, 0.92) : ink(w)}
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ width: Math.max(textWSafe(w, props.font), 4), height: h, flexShrink: 0, margin: { left: i === 0 ? 0 : gap } }}
        />
      ))}
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: h + 6, flexShrink: 0 }}>
      {wordRow(3, true)}
      {wordRow(0, false)}
    </UiEntity>
  )
}
/** Hotbar style: light-grey panel, thick dark outline, dark caps; colour only on the team name and dots. */
function TeamCard(props: { team: number; rows: SummaryRow[]; total: number; mvp: string; me: string; k: number; a: number; leader?: boolean; rank?: number; fitContent?: boolean; bodyCap?: number }) {
  const { team, rows, total, mvp, me, k, a, leader, rank, fitContent, bodyCap } = props
  const col = barColor(team)
  const shown = sortTeamRows(rows)
  const cap = bodyCap ?? SUMMARY_CARD_BODY_H
  const fitted = cardBodyContentH(shown.length, cap)
  const lay = fitContent ? fitted.lay : rosterLayout(shown.length)
  const cw = SUMMARY_CARD_W * k
  const ch = (fitContent ? cardFrameH(shown.length, cap) : SUMMARY_CARD_H) * k
  const bodyH = (fitContent ? fitted.bodyH : SUMMARY_CARD_BODY_H) * k
  const rowH = lay.rowH * k
  const font = fnt(lay.font, k)
  const headF = fnt(SUMMARY_HEAD_FONT, k)
  const twoCol = lay.columns === 2
  const wide = Math.max(86 * k, textW('TERRITORY', headF) + 12 * k)
  const tightHead = wide * 4 > cw * 0.6
  const H = twoCol ? ['TILES', 'TILES'] : (tightHead ? ['AREA', 'TILES', 'KO', 'DEATHS'] : ['TERRITORY', 'TILES', 'KOS', 'DEATHS'])
  const numW = twoCol
    ? Math.max(52 * k, textW('TILES', headF) + 8 * k)
    : (tightHead ? Math.max(56 * k, textW('DEATHS', headF) + 8 * k) : wide)
  const nameW = twoCol ? (cw - 24 * k) / 2 - numW : cw - numW * 4 - 24 * k
  const cell = (v: string, c: Color4, f: number, w: number) =>
    <Label value={v} fontSize={f} color={withA(c, a)} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: w, height: '100%' }} />
  const selfOf = (r: SummaryRow) => r.id.toLowerCase() === me
  const nameCell = (r: SummaryRow, w: number) => (
    <UiEntity uiTransform={{ width: w, height: '100%', flexDirection: 'row', alignItems: 'center', padding: { left: 8 * k } }}>
      <UiEntity uiTransform={{ width: Math.max(8, 10 * k), height: Math.max(8, 10 * k), borderRadius: Math.max(4, 5 * k), margin: { right: 8 * k }, borderWidth: Math.max(1, 1.5 * k), borderColor: withA(SUMMARY_INK, a) }} uiBackground={{ color: withA(col, a) }} />
      <Label value={r.name} fontSize={font} color={withA(SUMMARY_INK, a)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%' }} />
      {r.id === mvp && !twoCol && (
        <UiEntity uiTransform={{ width: 56 * k, height: Math.min(26 * k, rowH - 4), margin: { left: 8 * k }, borderRadius: 7 * k, borderWidth: 2 * k, borderColor: withA(SUMMARY_INK, a), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: withA(SUMMARY_MVP, a) }}>
          <Label value="MVP" fontSize={fnt(14, k)} color={withA(SUMMARY_INK, a)} textAlign="middle-center" />
        </UiEntity>
      )}
    </UiEntity>
  )
  const rowBg = (r: SummaryRow) => selfOf(r) ? withA(Color4.White(), 0.92 * a) : Color4.create(0, 0, 0, 0.05 * a)
  const rowBorder = (r: SummaryRow) => selfOf(r) ? { borderWidth: SUMMARY_OUTLINE * k * 0.75, borderColor: withA(SUMMARY_INK, a) } : {}
  const fullRow = (r: SummaryRow) => (
    <UiEntity uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', flexShrink: 0, borderRadius: 8 * k, ...rowBorder(r) }}
      uiBackground={{ color: rowBg(r) }}>
      {nameCell(r, nameW)}
      {cell(`${areaPct(r.cells, total)}%`, SUMMARY_INK, font, numW)}
      {cell(`${r.painted}`, SUMMARY_INK, font, numW)}
      {cell(`${r.kos}`, SUMMARY_INK, font, numW)}
      {cell(`${r.deaths}`, SUMMARY_INK, font, numW)}
    </UiEntity>
  )
  const compactPair = (left: SummaryRow, right?: SummaryRow) => (
    <UiEntity uiTransform={{ width: '100%', height: rowH, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
      <UiEntity uiTransform={{ width: '50%', height: '100%', flexDirection: 'row', alignItems: 'center', borderRadius: 6 * k, ...rowBorder(left) }} uiBackground={{ color: rowBg(left) }}>
        {nameCell(left, nameW)}
        {cell(`${left.painted}`, SUMMARY_INK, font, numW)}
      </UiEntity>
      {right ? (
        <UiEntity uiTransform={{ width: '50%', height: '100%', flexDirection: 'row', alignItems: 'center', borderRadius: 6 * k, ...rowBorder(right) }} uiBackground={{ color: rowBg(right) }}>
          {nameCell(right, nameW)}
          {cell(`${right.painted}`, SUMMARY_INK, font, numW)}
        </UiEntity>
      ) : <UiEntity uiTransform={{ width: '50%', height: '100%' }} />}
    </UiEntity>
  )
  const pairs: Array<{ left: SummaryRow; right?: SummaryRow }> = []
  if (twoCol) {
    for (let i = 0; i < shown.length; i += 2) pairs.push({ left: shown[i], right: shown[i + 1] })
  }
  return (
    <UiEntity uiTransform={{ width: cw, height: ch, flexShrink: 0, flexDirection: 'column', padding: { top: 8 * k, bottom: 12 * k, left: 8 * k, right: 8 * k }, borderRadius: SUMMARY_R * k, borderWidth: (leader ? SUMMARY_OUTLINE * 1.35 : SUMMARY_OUTLINE) * k, borderColor: withA(leader ? SUMMARY_MVP : SUMMARY_INK, a) }}
      uiBackground={{ color: withA(SUMMARY_CARD_BG, a) }}>
      <UiEntity uiTransform={{ width: '100%', height: SUMMARY_CARD_HEAD_H * k, flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
        {isMobile()
          ? <BoldLabel value={`${rank ? `#${rank} ` : ''}${isPlayingTeam(team) ? TEAM_NAME[team] : 'TEAM'} TEAM`} fontSize={fnt(28, k)} color={withA(inkTeam(team), a)} align="middle-left" w={twoCol ? cw * 0.5 : nameW - 10 * k} h={SUMMARY_CARD_HEAD_H * k} margin={{ left: 10 * k }} />
          : <Label value={`${rank ? `#${rank} ` : ''}${isPlayingTeam(team) ? TEAM_NAME[team] : 'TEAM'} TEAM`} fontSize={fnt(28, k)} color={withA(inkTeam(team), a)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: twoCol ? cw * 0.5 : nameW - 10 * k, height: SUMMARY_CARD_HEAD_H * k, flexShrink: 0, margin: { left: 10 * k } }} />}
        {twoCol ? (
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: '100%' }}>
            {cell('TILES', SUMMARY_DIM, headF, numW)}
            <UiEntity uiTransform={{ width: nameW, height: '100%' }} />
            {cell('TILES', SUMMARY_DIM, headF, numW)}
          </UiEntity>
        ) : (
          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: '100%' }}>
            {cell(H[0], SUMMARY_DIM, headF, numW)}
            {cell(H[1], SUMMARY_DIM, headF, numW)}
            {cell(H[2], SUMMARY_DIM, headF, numW)}
            {cell(H[3], SUMMARY_DIM, headF, numW)}
          </UiEntity>
        )}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: bodyH, flexDirection: 'column', flexShrink: 0, overflow: lay.scroll ? 'scroll' : 'hidden' }}>
        {shown.length === 0 && <Label value="NO PLAYERS" fontSize={fnt(SUMMARY_ROW_FONT, k)} color={withA(SUMMARY_DIM, a)} textAlign="middle-left" uiTransform={{ height: SUMMARY_ROW_H * k, margin: { left: 12 * k } }} />}
        {twoCol ? pairs.map(p => compactPair(p.left, p.right)) : shown.map(r => fullRow(r))}
      </UiEntity>
    </UiEntity>
  )
}

// ─── Mid-round team lists: click the score bar to open/close (live rows via requestStandings) ───
const STANDINGS_REFRESH_MS = 3000
const STANDINGS_TOP_PX = BAR_TOP_PX // the big pill replaces the score bar, under the clock
let standingsOpen = false
let standingsRows: SummaryRow[] = []
let standingsReqAt = 0
let standingsWired = false
function toggleStandings(): void {
  if (!standingsWired) {
    standingsWired = true
    room.onMessage('standings', ({ owners }) => { standingsRows = owners })
  }
  standingsOpen = !standingsOpen
  playUiClick()
  if (standingsOpen) { standingsReqAt = Date.now(); room.send('requestStandings', {}) }
}

function StandingsPopup() {
  if (!standingsOpen || getSummaryProgress() >= 0) return null
  const now = Date.now()
  if (now - standingsReqAt > STANDINGS_REFRESH_MS) { standingsReqAt = now; room.send('requestStandings', {}) }
  const cv = canvasSize()
  const rows = standingsRows.slice().sort((x, y) => y.cells - x.cells)
  const cov = coverage()
  const share = { red: cov.red, blue: cov.blue, green: cov.green ?? 0, yellow: cov.yellow ?? 0, total: cov.total }
  const pcts = summaryPcts(share)
  const { order, leaders } = summaryRank(share)
  const counts = order.map(team => rows.filter(r => r.team === team).length)
  const hidePill = isBasesRound()
  const lay = standingsLayout(counts, cv, STANDINGS_TOP_PX, { hidePill })
  const { k, stacked, bodyCap, pillW, pillH, panelW, panelH } = lay
  const border = SUMMARY_OUTLINE * k
  const mvp = rows.length > 0 && rows[0].cells > 0 ? rows[0].id : ''
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  const total = cov.total
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: STANDINGS_TOP_PX, left: 0 }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: panelW, height: panelH, flexDirection: 'column', alignItems: 'center', flexShrink: 0, pointerFilter: 'block' }} onMouseDown={toggleStandings}>
      {/* Territory pill is hidden in BASES; the charge meters stay in the top HUD. */}
      {!hidePill && (
        <UiEntity uiTransform={{ width: pillW, height: pillH + SUMMARY_GAP * k, flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
          <TeamScorePill pcts={[pcts.red, pcts.blue, pcts.green, pcts.yellow]} width={pillW} height={pillH} border={border} track={SUMMARY_INK} innerBg={SUMMARY_UNPAINTED} showLabels={true} fontSize={fnt(SUMMARY_PILL_FONT, k)} leaders={leaders} showUnpainted={true} />
          <UiEntity uiTransform={{ width: pillW, height: SUMMARY_GAP * k, flexShrink: 0 }} />
        </UiEntity>
      )}
      <TeamCardGrid rows={rows} total={total} mvp={mvp} me={me} k={k} a={1} stacked={stacked} order={order} leaders={leaders} fitContent={true} bodyCap={bodyCap} />
      </UiEntity>
    </UiEntity>
  )
}


/** Big-pill percentages as an overlay pinned to the bar's ends, independent of segment widths, never wrapping. */
/** Bar % labels: integers, but 1 then 2 decimals when the two sides would otherwise read the same. */
function pctLabels(red: number, blue: number): [string, string] {
  for (const d of [0, 1]) if (red.toFixed(d) !== blue.toFixed(d)) return [`${red.toFixed(d)}%`, `${blue.toFixed(d)}%`]
  return [`${red.toFixed(2)}%`, `${blue.toFixed(2)}%`]
}
function PctOverlay(props: { red: number; blue: number; k: number; color: Color4 }) {
  const f = fnt(SUMMARY_PILL_FONT, props.k), w = textWSafe('100.00%', f)
  const [rl, bl] = pctLabels(props.red, props.blue)
  const lbl = (v: string, al: 'middle-left' | 'middle-right') =>
    <Label value={v} fontSize={f} color={props.color} textAlign={al} textWrap="nowrap" uiTransform={{ width: w, height: '100%', flexShrink: 0 }} />
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 18 * props.k, right: 18 * props.k }, pointerFilter: 'none' }}>
      {lbl(rl, 'middle-left')}
      {lbl(bl, 'middle-right')}
    </UiEntity>
  )
}

/** Round-end screen at progress p (0 = the score bar, 1 = full). The pill grows out of the bar; the rest fades in. */
function RoundSummary(p: number) {
  const b = getBanner()
  const cv = canvasSize()
  const a = Math.max(0, Math.min(1, (p - 0.5) / 0.5)) // everything but the pill fades in over the second half
  const barH = BAR_FILL_H + BAR_BORDER * 2
  const rows = (b.owners as SummaryRow[]).slice().sort((x, y) => y.cells - x.cells)
  const mvp = rows.length > 0 && rows[0].cells > 0 ? rows[0].id : ''
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  const endCov: TeamCoverage = { red: b.red, blue: b.blue, green: b.green, yellow: b.yellow, total: b.total }
  const pcts = summaryPcts(endCov)
  const ranked = summaryRank(endCov)
  const leaders = b.kind === 'balloon' ? [] : ranked.leaders
  const order = b.kind === 'balloon' ? [...PLAYING_TEAMS] : ranked.order
  const counts = order.map(team => rows.filter(r => r.team === team).length)
  const hidePill = b.kind === 'balloon'
  // Same compact panel as the mid-game standings (capped width, content-sized cards),
  // reserved under the title so the block stays fully on screen at 16:9 and 21:9.
  const lay = standingsLayout(counts, cv, SUMMARY_HEAD_H, { hidePill })
  const { k, stacked, bodyCap, pillW, pillH, panelW, panelH } = lay
  const pw = lerp(barW(), pillW, p), ph = lerp(barH, pillH, p)
  const border = lerp(BAR_BORDER, SUMMARY_OUTLINE * k, p)
  const show = a > 0
  const headline = b.headline || (b.winner === 'TIE' || b.winner === '' ? "IT'S A TIE!" : b.winner === 'PLAYER' ? ((b.victorName || 'SOMEONE').toUpperCase() + ' WINS!') : (b.winner + ' WINS!'))
  const titleWords = headline.trim().split(/\s+/).filter(Boolean)
  const titleF = titleFontFor(titleWords, 1, cv.w * 0.86)
  const grid = (
    <TeamCardGrid rows={rows} total={b.total} mvp={mvp} me={me} k={k} a={a} stacked={stacked} order={order} leaders={leaders} fitContent={true} bodyCap={bodyCap} />
  )
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, flexDirection: 'column', alignItems: 'center', pointerFilter: show ? 'block' : 'none' }}
      onMouseDown={() => dismissSummary()}>
      <UiEntity uiTransform={{ width: 1, flexGrow: p, height: 0 }} />
      <UiEntity uiTransform={{ width: 1, height: BAR_TOP_PX * (1 - p), flexShrink: 0 }} />
      {/* Title only: team word + WINS!, a tight gap, and a subtle drop shadow so it stays readable over the sky. */}
      <UiEntity uiTransform={{ width: '100%', height: SUMMARY_HEAD_H * a, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
        {show && (
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', margin: { bottom: 10 } }}>
            <HeadlineRow text={headline} font={titleF} />
          </UiEntity>
        )}
      </UiEntity>
      {/* Territory pill: four team segments. Hidden for Balloon Battle. */}
      {b.kind !== 'balloon' && (
        <UiEntity uiTransform={{ width: panelW, height: show ? panelH : ph, flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
          <UiEntity uiTransform={{ width: Math.max(pw, 1), height: ph + (show ? SUMMARY_GAP * k : 0), flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
            <TeamScorePill pcts={[pcts.red, pcts.blue, pcts.green, pcts.yellow]} width={pw} height={ph} border={border} track={p > 0.5 ? SUMMARY_INK : BAR_TRACK} innerBg={p > 0.5 ? SUMMARY_UNPAINTED : Color4.White()} showLabels={show} fontSize={fnt(SUMMARY_PILL_FONT, k)} leaders={leaders} showUnpainted={b.kind !== 'bases'} />
            <UiEntity uiTransform={{ width: pw, height: show ? SUMMARY_GAP * k : 0, flexShrink: 0 }} />
          </UiEntity>
          {show ? grid : null}
        </UiEntity>
      )}
      {b.kind === 'balloon' && show ? (
        <UiEntity uiTransform={{ width: panelW, height: panelH, flexShrink: 0, flexDirection: 'column', alignItems: 'center' }}>
          {grid}
        </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ width: 1, flexGrow: p, height: 0 }} />
    </UiEntity>
  )
}

/** Territory shares in %, same source and 1-decimal rounding the old text readout showed. */
function coveragePct(): { red: number; blue: number; green: number; yellow: number } {
  if (isBasesRound()) {
    const c = baseCharge()
    const t = c.threshold > 0 ? c.threshold : 1
    return {
      red: Number(((c.redProgress / t) * 100).toFixed(1)),
      blue: Number(((c.blueProgress / t) * 100).toFixed(1)),
      green: 0,
      yellow: 0,
    }
  }
  const { red, blue, green, yellow, total } = coverage()
  if (total === 0) return { red: 0, blue: 0, green: 0, yellow: 0 }
  return {
    red: Number(((red / total) * 100).toFixed(1)),
    blue: Number(((blue / total) * 100).toFixed(1)),
    green: Number((((green ?? 0) / total) * 100).toFixed(1)),
    yellow: Number((((yellow ?? 0) / total) * 100).toFixed(1)),
  }
}

function bannerColor(): Color4 {
  const b = getBanner()
  if (b.winner === 'RED') return BAR_RED
  if (b.winner === 'BLUE') return BAR_BLUE
  if (b.winner === 'GREEN') return BAR_GREEN
  if (b.winner === 'YELLOW') return BAR_YELLOW
  return Color4.White()
}

/** Playtest format banner. Centered, ~2.5s, no input lock (pointerFilter none). Scales down on a narrow phone. */
function bannerHeadline(): string {
  const b = getBanner()
  return (b.headline || (b.winner === 'TIE' ? "IT'S A TIE!" : `${b.winner} WINS!`)).replace(/!$/, '')
}

/** Prototype only. Vertical pill on the right: caption and team-colored fill from the bottom. */
function PaintTankBar() {
  if (!paintEconomyOn() || inLobby()) return null
  const mob = isMobile()
  const cv = canvasSize()
  const trackH = mob ? 168 : 240
  const trackW = mob ? 28 : 36
  const pad = 3
  const radius = trackW / 2
  const innerW = trackW - pad * 2
  const innerH = trackH - pad * 2
  const innerR = innerW / 2
  const n = Math.max(0, Math.min(PAINT_CAPACITY, paintTank()))
  const filling = paintRefilling()
  const empty = n <= 0 && !filling
  const fillH = n <= 0 ? 0 : Math.max(innerW, Math.round(innerH * (n / PAINT_CAPACITY)))
  const teamColor = isPlayingTeam(painterTeam()) ? barColor(painterTeam()) : BAR_RED
  const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(Date.now() / 180))
  const fillColor = filling ? Color4.create(teamColor.r, teamColor.g, teamColor.b, pulse) : teamColor
  const labelColor = empty ? Color4.create(1, 0.82, 0.45, 1) : Color4.White()
  const top = Math.max(16, Math.round((cv.h - trackH - 24) / 2))
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top, right: mob ? 10 : 22 },
        width: 72,
        height: trackH + 24,
        flexDirection: 'column',
        alignItems: 'center',
        pointerFilter: 'none',
      }}
    >
      <Label value={empty ? 'NO PAINT' : filling ? (PAINT_REFILL_MODE === 'depot' ? 'REFILL' : 'RECHARGE') : 'PAINT'} fontSize={mob ? 13 : 15} color={labelColor} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: 72, height: 16, margin: { bottom: 8 } }} />
      <UiEntity
        uiTransform={{ width: trackW, height: trackH, borderRadius: radius, padding: pad, flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0, 0, 0, empty ? 0.72 : 0.5) }}
      >
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: innerR, flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
          <UiEntity uiTransform={{ width: '100%', height: fillH, borderRadius: innerR }} uiBackground={{ color: fillColor }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

/** Two side-by-side BASES charge meters. Replaces the shared territory bar. */
function chargeHudW() {
  return isMobile() ? MOBILE_TOP_W : 420
}
function BasesChargeMeter(props: { team: 1 | 2; progress: number; connected: number; growing: boolean; threshold: number }) {
  const mob = isMobile()
  const color = props.team === 1 ? BAR_RED : BAR_BLUE
  const name = props.team === 1 ? 'RED' : 'BLUE'
  const t = props.threshold > 0 ? props.threshold : 1
  const u = Math.max(0, Math.min(1, props.progress / t))
  const pct = `${Math.round(u * 100)}%`
  const rate = Math.round(props.connected * GROWTH_PER_CELL_PER_SEC)
  const cue = u >= 0.999 ? 'FULL' : props.growing ? `+${rate}/s` : `${props.connected} tiles`
  const pulse = props.growing ? 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(Date.now() / 180)) : 0.9
  const trackH = mob ? 14 : 16
  const meterW = (chargeHudW() - 10) / 2
  const innerW = Math.max(8, meterW - 4)
  const fillW = Math.max(u > 0 ? 6 : 0, Math.round(innerW * u))
  return (
    <UiEntity uiTransform={{ width: meterW, flexDirection: 'column', alignItems: 'stretch', margin: { left: props.team === 2 ? 5 : 0, right: props.team === 1 ? 5 : 0 } }}>
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: mob ? 14 : 16, margin: { bottom: 2 } }}>
        <Label value={name} fontSize={mob ? 11 : 13} color={color} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: mob ? 14 : 16 }} />
        <Label value={pct} fontSize={mob ? 11 : 13} color={Color4.White()} textAlign="middle-right" textWrap="nowrap" uiTransform={{ height: mob ? 14 : 16 }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: trackH, borderRadius: trackH / 2, padding: 2 }} uiBackground={{ color: BAR_TRACK }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: (trackH - 4) / 2 }} uiBackground={{ color: PANEL_LIGHT }}>
          <UiEntity uiTransform={{ width: fillW, height: '100%', borderRadius: (trackH - 4) / 2 }} uiBackground={{ color }} />
        </UiEntity>
      </UiEntity>
      <Label value={cue} fontSize={mob ? 10 : 12} color={Color4.create(1, 1, 1, pulse)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: mob ? 13 : 15, margin: { top: 1 } }} />
    </UiEntity>
  )
}
function BasesChargeHud() {
  const c = baseCharge()
  const mob = isMobile()
  return (
    <UiEntity uiTransform={{ width: chargeHudW(), margin: { top: 6 }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <Label value="FILL THE BASE" fontSize={mob ? 10 : 12} color={Color4.create(0.92, 0.92, 0.94, 1)} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: mob ? 13 : 15, margin: { bottom: 2 } }} />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start' }}>
        <BasesChargeMeter team={1} progress={c.redProgress} connected={c.redConnected} growing={c.redGrowing} threshold={c.threshold} />
        <BasesChargeMeter team={2} progress={c.blueProgress} connected={c.blueConnected} growing={c.blueGrowing} threshold={c.threshold} />
      </UiEntity>
    </UiEntity>
  )
}

// Full-screen UI root. Everything is a child of this so absolute-positioned
// overlays (like the round-end banner) can size themselves as 100%×100% of
// the viewport, not of the tiny HUD strip.
export const uiMenu = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 } }}>
    <PaintTankBar />

    {/* ─── Top-left: mute button ─────────────────────────────────────── */}
    {/* Mute button lives inside the timer panel below, pinned to its right edge. */}

    {/* ─── Top-center: countdown timer + coverage pill ───────────────── */}
    {(() => {
      const secs = getCountdownSeconds()
      const lobby = inLobby()
      const canvasW = UiCanvasInformation.getOrNull(engine.RootEntity)?.width ?? 1280
      const voteW = Math.max(280, Math.min(canvasW - 24, 760))
      const lobbyFont = isMobile() ? 16 : 22
      // One fixed width for both lobby states, snug around the longer line plus a little padding.
      const lobbyPillW = Math.ceil(Math.max(textWSafe('CHOOSE A TEAM', lobbyFont), textWSafe('STARTING IN 10', lobbyFont)) + 36 + CLOCK_RING * 2 + HOTBAR_BORDER_W * 2)
      return (
        <UiEntity
          uiTransform={{
            positionType: 'absolute', position: { top: 10, left: 0 },
            width: '100%', flexDirection: 'row', justifyContent: 'center',
            pointerFilter: 'none',
          }}
        >
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', width: lobby ? voteW : undefined }}>
            {/* Match (mobile + desktop): eye | timer | mute. Lobby keeps its existing layouts. */}
            {isMobile() ? (
            lobby ? (
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
              <UiEntity uiTransform={{ flexDirection: 'row', margin: { right: TOP_GAP } }}>
                <TileButton id="ui_top_mute" onPress={toggleMusic}>
                  <UiEntity uiTransform={{ width: 28, height: 28, pointerFilter: 'none' }}
                    uiBackground={{ textureMode: 'stretch', texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' }, color: SUMMARY_INK }} />
                </TileButton>
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: Math.min(lobbyPillW, Math.max(MOBILE_TIMER_W, canvasW - 120)), height: TOP_BTN, borderRadius: HOTBAR_RADIUS,
                  // Key-tile frame: light rim, dark ring (padding), light inner panel filling the rest.
                  borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM, padding: CLOCK_RING,
                }}
                uiBackground={{ color: HOTBAR_TILE_BG }}
              >
                <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
                  uiBackground={{ color: SUMMARY_CARD_BG }}>
                  <Label value={hudClockText(secs)} fontSize={16} color={SUMMARY_INK} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: 32 }} />
                </UiEntity>
              </UiEntity>
              <UiEntity uiTransform={{ width: TOP_BTN, height: TOP_BTN, margin: { left: TOP_GAP } }}>
                <OverviewRow />
                <OverviewEye />
              </UiEntity>
            </UiEntity>
            ) : (
            <UiEntity uiTransform={{ width: MATCH_TOP_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <UiEntity uiTransform={{ width: TOP_BTN, height: TOP_BTN }}>
                <OverviewRow />
                <OverviewEye />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: MATCH_TIMER_W, height: TOP_BTN, margin: { left: TOP_GAP, right: TOP_GAP }, borderRadius: HOTBAR_RADIUS,
                  borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM, padding: CLOCK_RING,
                }}
                uiBackground={{ color: HOTBAR_TILE_BG }}
              >
                <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
                  uiBackground={{ color: SUMMARY_CARD_BG }}>
                  <Label value={hudClockText(secs)} fontSize={36} color={SUMMARY_INK} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
                </UiEntity>
              </UiEntity>
              <TileButton id="ui_top_mute" onPress={toggleMusic}>
                <UiEntity uiTransform={{ width: 28, height: 28, pointerFilter: 'none' }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' }, color: SUMMARY_INK }} />
              </TileButton>
            </UiEntity>
            )
            ) : lobby ? (
            <UiEntity uiTransform={{ width: lobbyPillW + 2 * (TOP_BTN + TOP_GAP), height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <UiEntity uiTransform={{ width: TOP_BTN, height: TOP_BTN }}>
                <OverviewRow desktop besideEye />
                <OverviewEye />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: lobbyPillW, height: 68, margin: { left: TOP_GAP, right: TOP_GAP },
                  justifyContent: 'center', alignItems: 'center', borderRadius: HOTBAR_RADIUS,
                  borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM,
                }}
                uiBackground={{ color: HOTBAR_TILE_BG }}
              >
                <UiEntity uiTransform={{ positionType: 'absolute', position: { top: CLOCK_RING, bottom: CLOCK_RING, left: CLOCK_RING, right: CLOCK_RING }, borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, pointerFilter: 'none' }}
                  uiBackground={{ color: SUMMARY_CARD_BG }} />
                <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
                  <Label value={hudClockText(secs)} fontSize={22} color={SUMMARY_INK} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: 36 }} />
                </UiEntity>
              </UiEntity>
              <TileButton id="ui_lobby_mute" onPress={toggleMusic}>
                <UiEntity uiTransform={{ width: 28, height: 28, pointerFilter: 'none' }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' }, color: SUMMARY_INK }} />
              </TileButton>
            </UiEntity>
            ) : (
            <UiEntity uiTransform={{ width: MATCH_TOP_W, height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <UiEntity uiTransform={{ width: TOP_BTN, height: TOP_BTN }}>
                <OverviewRow desktop besideEye />
                <OverviewEye />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: MATCH_TIMER_W, height: 68, margin: { left: TOP_GAP, right: TOP_GAP },
                  justifyContent: 'center', alignItems: 'center', borderRadius: HOTBAR_RADIUS,
                  // Hotbar key-tile frame: light rim (same width/colour/radius as the tiles) around a dark ring.
                  borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM,
                }}
                uiBackground={{ color: HOTBAR_TILE_BG }}
              >
                <UiEntity uiTransform={{ positionType: 'absolute', position: { top: CLOCK_RING, bottom: CLOCK_RING, left: CLOCK_RING, right: CLOCK_RING }, borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, pointerFilter: 'none' }}
                  uiBackground={{ color: SUMMARY_CARD_BG }} />
                <Label value={hudClockText(secs)} fontSize={42} color={SUMMARY_INK} textAlign="middle-center" />
              </UiEntity>
              <TileButton id="ui_match_mute" onPress={toggleMusic}>
                <UiEntity uiTransform={{ width: 28, height: 28, pointerFilter: 'none' }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' }, color: SUMMARY_INK }} />
              </TileButton>
            </UiEntity>
            )}
            {/* Territory bar: team colours plus a white unpainted remainder. Hidden in the lobby, Balloon Battle, and BASES (BASES has its own charge meters). */}
            {lobby || isBalloonRound() ? null : isBasesRound() ? (
              getSummaryProgress() >= 0 ? <UiEntity uiTransform={{ width: chargeHudW(), height: isMobile() ? 58 : 66, margin: { top: 6 } }} /> : <BasesChargeHud />
            ) : getSummaryProgress() >= 0 || standingsOpen ? (
              <UiEntity uiTransform={{ width: barW(), height: BAR_FILL_H + BAR_BORDER * 2, margin: { top: 6 } }} />
            ) : (() => {
              const pct = coveragePct()
              const cov = coverage()
              const leaders = leadingTeams(cov)
              return (
                <UiEntity uiTransform={{ margin: { top: 6 }, pointerFilter: 'block' }} onMouseDown={toggleStandings}>
                  <TeamScorePill pcts={[pct.red, pct.blue, pct.green, pct.yellow]} width={barW()} height={BAR_FILL_H + BAR_BORDER * 2} border={BAR_BORDER} track={BAR_TRACK} innerBg={PANEL_LIGHT} showUnpainted={true} showStar={true} leaders={leaders} />
                </UiEntity>
              )
            })()}
          </UiEntity>
        </UiEntity>
      )
    })()}

    {/* ─── Leaderboard popup: centered modal ────────────────────────
        Renders when leaderboardOpen is true. The in-match timer no longer
        has a star button; standings still open from the score bar. */}
    {leaderboardOpen && (() => {
      // Mobile: top 10 only (fits without scrolling), no backdrop; tapping the board or its X closes it.
      const mob = isMobile()
      const rows = mob ? readLeaderboard().slice(0, 10) : readLeaderboard()
      return (
        <UiEntity
          uiTransform={{
            width: '100%', height: '100%',
            positionType: 'absolute', position: { top: 0, left: 0 },
            justifyContent: 'center', alignItems: 'center', pointerFilter: mob ? 'none' : 'block',
          }}
          uiBackground={mob ? undefined : { color: BANNER_BG }}
          onMouseDown={toggleLeaderboard}
        >
          {/* Modal card. Any click anywhere (card, X, backdrop) closes the
              popup — no stop-propagation, so the outer overlay's onMouseDown
              handles it uniformly. */}
          <UiEntity
            uiTransform={{
              width: 520, borderRadius: HOTBAR_RADIUS, flexDirection: 'column', alignItems: 'stretch', // height hugs the rows
              // Key-tile frame like the clock: light rim around a dark ring, PANEL_LIGHT fill.
              borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM, padding: CLOCK_RING,
            }}
            uiBackground={{ color: HOTBAR_TILE_BG }}
            onMouseDown={toggleLeaderboard}
          >
            <UiEntity uiTransform={{ width: '100%', borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, padding: { left: 14, right: 14, top: 8, bottom: 14 }, flexDirection: 'column', alignItems: 'stretch' }}
              uiBackground={{ color: PANEL_LIGHT }}>
            {/* Header */}
            <UiEntity uiTransform={{ width: '100%', height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label value="★ TOP PAINTERS" fontSize={28} color={SUMMARY_INK} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 48 }} />
              <UiEntity
                uiTransform={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
                onMouseDown={toggleLeaderboard}
              >
                <Label value="✕" fontSize={22} color={SUMMARY_INK} textAlign="middle-center" />
              </UiEntity>
            </UiEntity>
            {/* Column headers (summary-table style: dim dark caps) */}
            <UiEntity uiTransform={{ width: '100%', height: 24, flexShrink: 0, flexDirection: 'row', alignItems: 'center', padding: { left: LB_PAD, right: LB_PAD } }}>
              <Label value="#"      fontSize={fnt(SUMMARY_HEAD_FONT, 1)} color={SUMMARY_DIM} textAlign="middle-center" uiTransform={{ width: LB_RANK_W, height: '100%', margin: { right: LB_GAP } }} />
              <Label value="PLAYER" fontSize={fnt(SUMMARY_HEAD_FONT, 1)} color={SUMMARY_DIM} textAlign="middle-left"   uiTransform={{ flexGrow: 1, height: '100%' }} />
              <Label value="CELLS"  fontSize={fnt(SUMMARY_HEAD_FONT, 1)} color={SUMMARY_DIM} textAlign="middle-right"  uiTransform={{ width: LB_CELLS_W, height: '100%' }} />
            </UiEntity>
            {/* Rows */}
            {rows.length === 0 ? (
              <UiEntity uiTransform={{ width: '100%', height: 60, margin: { top: 12 }, justifyContent: 'center', alignItems: 'center' }}>
                <Label value="No painters yet — be the first!" fontSize={16} color={SUMMARY_DIM} textAlign="middle-center" />
              </UiEntity>
            ) : (
            // Rows: clipped viewport + custom pill scrollbar (drag) when the board would be taller than the screen.
            (() => {
            const total = rows.length * (LB_ROW_H + 3)
            const view = mob ? total : Math.min(total, Math.max(LB_ROW_H * 3, canvasSize().h * 0.85 - LB_HEAD_H))
            const maxOff = Math.max(0, total - view)
            lbMaxOff = maxOff
            lbThumbTravel = view - Math.max(LB_THUMB_MIN, view * view / total)
            lbOffset = Math.min(lbOffset, maxOff)
            const thumbH = Math.max(LB_THUMB_MIN, view * view / total)
            const thumbTop = maxOff > 0 ? (lbOffset / maxOff) * (view - thumbH) : 0
            return (
            <UiEntity uiTransform={{ width: '100%', height: view, flexShrink: 0, flexDirection: 'row' }}>
            <UiEntity uiTransform={{ flexGrow: 1, height: view, overflow: 'hidden', pointerFilter: mob ? 'none' : 'block' }}>
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', positionType: 'absolute', position: { top: -lbOffset, left: 0 } }}>
            {rows.map((r, i) => {
              const self = r.userId.toLowerCase() === (getPlayer()?.userId ?? '').toLowerCase()
              return (
                <UiEntity
                  uiTransform={{ width: '100%', height: LB_ROW_H, flexShrink: 0, margin: { top: 3 }, flexDirection: 'row', alignItems: 'center', padding: { left: LB_PAD - (self ? LB_OUTLINE : 0), right: LB_PAD - (self ? LB_OUTLINE : 0) }, borderRadius: 8,
                    ...(self ? { borderWidth: LB_OUTLINE, borderColor: SUMMARY_INK } : {}) }}
                  uiBackground={{ color: self ? Color4.White() : Color4.create(0, 0, 0, 0.05) }}
                >
                  {/* Rank: top 3 get a small gold chip as the only accent */}
                  <UiEntity uiTransform={{ width: LB_RANK_W, height: '100%', flexShrink: 0, justifyContent: 'center', alignItems: 'center', margin: { right: LB_GAP } }}>
                    <UiEntity uiTransform={{ width: LB_RANK_W, height: LB_ROW_H - 8, borderRadius: 6, justifyContent: 'center', alignItems: 'center', ...(i < 3 ? { borderWidth: 2, borderColor: SUMMARY_INK } : {}) }}
                      uiBackground={{ color: i < 3 ? SUMMARY_MVP : Color4.create(0, 0, 0, 0) }}>
                      <Label value={`${i + 1}`} fontSize={16} color={SUMMARY_INK} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
                    </UiEntity>
                  </UiEntity>
                  <Label value={r.name} fontSize={16} color={SUMMARY_INK} textAlign="middle-left" textWrap="nowrap" uiTransform={{ flexGrow: 1, height: '100%' }} />
                  <Label value={r.cellsPainted.toLocaleString()} fontSize={16} color={SUMMARY_INK} textAlign="middle-right" textWrap="nowrap" uiTransform={{ width: LB_CELLS_W, height: '100%', flexShrink: 0 }} />
                </UiEntity>
              )
            })}
            </UiEntity>
            </UiEntity>
            {maxOff > 0 && (
              <UiEntity uiTransform={{ width: LB_BAR_W, height: view, margin: { left: 6 }, borderRadius: LB_BAR_W / 2, pointerFilter: 'block' }}
                uiBackground={{ color: Color4.create(0, 0, 0, 0.08) }}>
                <UiEntity uiTransform={{ positionType: 'absolute', position: { top: thumbTop, left: 0 }, width: LB_BAR_W, height: thumbH, borderRadius: LB_BAR_W / 2, pointerFilter: 'block' }}
                  uiBackground={{ color: SUMMARY_INK }}
                  onMouseDown={startLbDrag} onMouseUp={() => { lbDrag = null }} />
              </UiEntity>
            )}
            </UiEntity>
            )
            })()
            )}
            </UiEntity>
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
      >
        {/* No backdrop: '100%' of the 1920x1080 virtual canvas doesn't reliably reach the edges on phones. */}
        {/* Headline, percentages and personal line now live in the summary square below. */}
      </UiEntity>
    )}

    <StandingsPopup />

    {/* ─── Round-end summary: the score bar grows into a red|blue square, holds, shrinks back. */}
    {(() => { const p = getSummaryProgress(); return p >= 0 ? RoundSummary(p) : null })()}
    {lagHudOn() ? (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 16, bottom: 16 }, pointerFilter: 'none' }}>
        <Label value={lagHudLine()} fontSize={16} color={Color4.White()} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 22 }} />
      </UiEntity>
    ) : null}
    {/* Load splash: last child = top-most layer. */}
    <SplashScreen />
  </UiEntity>
)
