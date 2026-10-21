import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted, playUiClick } from "./client/audio"
import { coverage } from "./paint"
import { getCountdownSeconds, formatMMSS, getBanner, getSummaryProgress, dismissSummary, summarySecondsLeft, ROUND_LENGTH_MINUTES } from "./round"
import { LeaderboardState, leaderboardStateEntity } from "./shared/components"
import { room } from "./shared/messages"
import { Team, TEAM_RGB } from "./shared/team"
import { OverviewEye, OverviewRow } from "./client/overviewUi"
import { AbilityHotbar, RADIUS as HOTBAR_RADIUS, BORDER_W as HOTBAR_BORDER_W, PANEL_LIGHT, SLOT_BG as HOTBAR_TILE_BG, GOLD_BORDER as HOTBAR_RIM, TILE_RING } from "./client/abilityHotbar"
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
// Top painters rows: fixed height, rank / name / cells columns shared with the header row.
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

// ─── Round-end summary screen (Luke's reference): title, territory pill, two team cards, stats row ───
// Sizes are at a 1280-wide reference and scale with the canvas (k), never below SUMMARY_K_MIN.
const BAR_TOP_PX = 10 + 68 + 6 // the score bar's top edge: the pill grows out of it
const SUMMARY_K_MAX = 1.6
const SUMMARY_PILL_W = 720
const SUMMARY_PILL_H = 48
const SUMMARY_PILL_CAP = 24 // 0% side still shows this much colour, like the bar's end caps
const CLOCK_RING = TILE_RING // dark ring between the clock's light rim and its light fill
const SUMMARY_TITLE_FONT = 72 // older build's title size
const SUMMARY_HEAD_H = 150 // title pill + margins above the territory bar
const SUMMARY_GAP = 32 // territory bar → tables
const SUMMARY_SUB_FONT = 18
const SUMMARY_PILL_FONT = 30
const SUMMARY_CARD_W = 580
const SUMMARY_CARD_GAP = 40
const SUMMARY_ROW_H = 44
const SUMMARY_ROW_FONT = 22
const SUMMARY_HEAD_FONT = 15
const SUMMARY_CARD_ROWS = 10 // per team (side by side); the rest fold into "+N more"
const SUMMARY_CARD_ROWS_SMALL = 4 // stacked / short screens
const SUMMARY_FONT_MIN = 12 // readable floor for any summary text
const SUMMARY_FIT = 0.94 // fraction of the canvas the layout may use
// Style of the LUNGE/BURST hotbar: light-grey rounded pills, thick dark rounded-square outlines, dark caps text.
const SUMMARY_CARD_BG = PANEL_LIGHT // same light panel as the hotbar
const SUMMARY_INK = Color4.create(0.13, 0.13, 0.15, 1)        // dark text + thick outlines
const SUMMARY_DIM = Color4.create(0.4, 0.4, 0.44, 1)          // secondary dark-grey text
const SUMMARY_R = HOTBAR_RADIUS
const SUMMARY_OUTLINE = HOTBAR_BORDER_W
/** Team accent readable on the light-grey panel. */
const inkTeam = (team: number) => mix(team === 1 ? BAR_RED : BAR_BLUE, Color4.Black(), 0.25)
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

type SummaryRow = { id: string; name: string; team: number; cells: number; kos: number; deaths: number; painted: number }

const cardH = (n: number, more: boolean) => 24 + 40 + n * (SUMMARY_ROW_H + 6) + (more ? 28 : 0)
const fnt = (f: number, k: number) => Math.max(SUMMARY_FONT_MIN, f * k)
const SUMMARY_BOLD_PX = 0.035 // fake-bold offset as a fraction of the font size (DCL text has no weight)
/** Rough single-line width of caps text (≈ 0.62 em per glyph). */
const textW = (t: string, f: number) => t.length * f * 0.62
/** Conservative width (wide caps + bold) used where overflow must never wrap. */
const textWSafe = (t: string, f: number) => t.length * f * 0.8
const TITLE_WORD_GAP = 0.3 // gap between title words, in em
/** Round-end title font: the older 72 px look, shrunk so team word + gap + WINS! fits the given width on one line. */
export function titleFontFor(words: string[], k: number, availW: number): number {
  const em = words.reduce((s, w) => s + textWSafe(w, 1), 0) + (words.length - 1) * TITLE_WORD_GAP
  return Math.min(SUMMARY_TITLE_FONT * k, availW / em)
}

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

/** Scale + arrangement for the two team tables under `top` px (unscaled) of other content.
 *  Side by side shows up to 10 rows/team, dropping to 8/6/4 until the scale stays ≥ SUMMARY_K_READ;
 *  stacked (phones) shows 4/team. Whatever doesn't fit folds into "+N more". Fits 94% of width AND height. */
const SUMMARY_K_READ = 0.75
function tablesLayout(all: SummaryRow[], cv: { w: number; h: number }, top: number): { k: number; stacked: boolean; rowCap: number } {
  const nRed = all.filter(r => r.team === 1).length, nBlue = all.filter(r => r.team === 2).length
  const hOf = (cap: number, n: number) => cardH(Math.max(1, Math.min(cap, n)), n > cap)
  const sideW = Math.max(SUMMARY_CARD_W * 2 + SUMMARY_CARD_GAP, SUMMARY_PILL_W)
  const kSideAt = (cap: number) => Math.min(cv.w * SUMMARY_FIT / sideW, cv.h * SUMMARY_FIT / (top + Math.max(hOf(cap, nRed), hOf(cap, nBlue))))
  let sideCap = SUMMARY_CARD_ROWS_SMALL
  for (const c of [10, 8, 6]) if (kSideAt(c) >= SUMMARY_K_READ) { sideCap = c; break }
  const kSide = kSideAt(sideCap)
  const stackH = top + hOf(SUMMARY_CARD_ROWS_SMALL, nRed) + hOf(SUMMARY_CARD_ROWS_SMALL, nBlue) + SUMMARY_GAP * 0.6
  const kStack = Math.min(cv.w * SUMMARY_FIT / Math.max(SUMMARY_CARD_W, SUMMARY_PILL_W), cv.h * SUMMARY_FIT / stackH)
  const stacked = kStack > kSide * 1.15
  return { k: Math.min(SUMMARY_K_MAX, stacked ? kStack : kSide), stacked, rowCap: stacked ? SUMMARY_CARD_ROWS_SMALL : sideCap }
}

/** Hotbar style: light-grey panel, thick dark outline, dark caps; colour only on the team name and dots. */
function TeamCard(props: { team: number; rows: SummaryRow[]; total: number; mvp: string; me: string; k: number; a: number; cap: number }) {
  const { team, rows, total, mvp, me, k, a, cap } = props
  const col = team === 1 ? BAR_RED : BAR_BLUE
  const shown = rows.slice(0, cap)
  const more = rows.length - shown.length
  const cw = SUMMARY_CARD_W * k
  const headF = fnt(SUMMARY_HEAD_FONT, k)
  // Full headers unless they'd squeeze the name column under ~40% of the card (phones): then short ones.
  const wide = Math.max(86 * k, textW('TERRITORY', headF) + 12 * k)
  const compact = wide * 4 > cw * 0.6
  const H = compact ? ['AREA', 'TILES', 'KO', 'DEATHS'] : ['TERRITORY', 'TILES', 'KOS', 'DEATHS']
  const numW = compact ? Math.max(56 * k, textW('DEATHS', headF) + 8 * k) : wide, nameW = cw - numW * 4 - 24 * k
  const cell = (v: string, c: Color4, f: number, w: number) =>
    <Label value={v} fontSize={f} color={withA(c, a)} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: w, height: '100%' }} />
  return (
    <UiEntity uiTransform={{ width: cw, flexDirection: 'column', padding: { top: 8 * k, bottom: 12 * k, left: 8 * k, right: 8 * k }, borderRadius: SUMMARY_R * k }}
      uiBackground={{ color: withA(SUMMARY_CARD_BG, a) }}>
      <UiEntity uiTransform={{ width: '100%', height: 40 * k, flexDirection: 'row', alignItems: 'center' }}>
        <BoldLabel value={team === 1 ? 'RED TEAM' : 'BLUE TEAM'} fontSize={fnt(28, k)} color={withA(inkTeam(team), a)} align="middle-left" w={nameW - 10 * k} h={40 * k} margin={{ left: 10 * k }} />
        {cell(H[0], SUMMARY_DIM, fnt(SUMMARY_HEAD_FONT, k), numW)}
        {cell(H[1], SUMMARY_DIM, fnt(SUMMARY_HEAD_FONT, k), numW)}
        {cell(H[2], SUMMARY_DIM, fnt(SUMMARY_HEAD_FONT, k), numW)}
        {cell(H[3], SUMMARY_DIM, fnt(SUMMARY_HEAD_FONT, k), numW)}
      </UiEntity>
      {shown.length === 0 && <Label value="NO PLAYERS" fontSize={fnt(SUMMARY_ROW_FONT, k)} color={withA(SUMMARY_DIM, a)} textAlign="middle-left" uiTransform={{ height: SUMMARY_ROW_H * k, margin: { left: 12 * k } }} />}
      {shown.map(r => {
        const self = r.id.toLowerCase() === me
        return (
          <UiEntity uiTransform={{ width: '100%', height: SUMMARY_ROW_H * k, flexDirection: 'row', alignItems: 'center', margin: { top: 6 * k }, borderRadius: 10 * k, ...(self ? { borderWidth: SUMMARY_OUTLINE * k * 0.75, borderColor: withA(SUMMARY_INK, a) } : {}) }}
            uiBackground={{ color: self ? withA(Color4.White(), 0.9 * a) : Color4.create(0, 0, 0, 0.05 * a) }}>
            <UiEntity uiTransform={{ width: nameW, height: '100%', flexDirection: 'row', alignItems: 'center', padding: { left: 10 * k } }}>
              <UiEntity uiTransform={{ width: 14 * k, height: 14 * k, borderRadius: 7 * k, margin: { right: 10 * k }, borderWidth: 2 * k, borderColor: withA(SUMMARY_INK, a) }} uiBackground={{ color: withA(col, a) }} />
              <Label value={r.name} fontSize={fnt(SUMMARY_ROW_FONT, k)} color={withA(SUMMARY_INK, a)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%' }} />
              {r.id === mvp && (
                <UiEntity uiTransform={{ width: 56 * k, height: 26 * k, margin: { left: 10 * k }, borderRadius: 7 * k, borderWidth: 2 * k, borderColor: withA(SUMMARY_INK, a), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: withA(SUMMARY_MVP, a) }}>
                  <Label value="MVP" fontSize={fnt(14, k)} color={withA(SUMMARY_INK, a)} textAlign="middle-center" />
                </UiEntity>
              )}
            </UiEntity>
            {cell(`${total > 0 ? Math.round(r.cells / total * 100) : 0}%`, SUMMARY_INK, fnt(SUMMARY_ROW_FONT, k), numW)}
            {cell(`${r.painted}`, SUMMARY_INK, fnt(SUMMARY_ROW_FONT, k), numW)}
            {cell(`${r.kos}`, SUMMARY_INK, fnt(SUMMARY_ROW_FONT, k), numW)}
            {cell(`${r.deaths}`, SUMMARY_INK, fnt(SUMMARY_ROW_FONT, k), numW)}
          </UiEntity>
        )
      })}
      {more > 0 && <Label value={`+${more} MORE`} fontSize={fnt(16, k)} color={withA(SUMMARY_DIM, a)} textAlign="middle-left" uiTransform={{ height: 26 * k, margin: { left: 12 * k, top: 2 * k } }} />}
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
  const { k, stacked, rowCap } = tablesLayout(rows, { w: cv.w, h: cv.h - STANDINGS_TOP_PX }, SUMMARY_PILL_H + SUMMARY_GAP)
  const pct = coveragePct()
  const pw = tablesW(stacked) * k, ph = SUMMARY_PILL_H * k, border = SUMMARY_OUTLINE * k, cap = SUMMARY_PILL_CAP * k
  const innerW = pw - border * 2, innerR = (ph - border * 2) / 2
  const redW = cap + (innerW - cap * 2) * pct.red / 100
  const blueW = cap + (innerW - cap * 2) * pct.blue / 100
  const mvp = rows.length > 0 && rows[0].cells > 0 ? rows[0].id : ''
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  const total = coverage().total
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: STANDINGS_TOP_PX, left: 0 }, flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', pointerFilter: 'block' }} onMouseDown={toggleStandings}>
      {/* Enlarged score bar (the round-end territory pill, live %) heading the lists; click closes back to the bar. */}
      <UiEntity uiTransform={{ width: pw, height: ph, flexShrink: 0, borderRadius: ph / 2, padding: border, margin: { bottom: SUMMARY_GAP * k } }} uiBackground={{ color: SUMMARY_INK }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: innerR }} uiBackground={{ color: SUMMARY_UNPAINTED }}>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: redW, height: '100%', borderRadius: { topLeft: innerR, bottomLeft: innerR, topRight: 0, bottomRight: 0 }, justifyContent: 'center', alignItems: 'flex-start', }}
            uiBackground={{ color: BAR_RED }}>
          </UiEntity>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0 }, width: blueW, height: '100%', borderRadius: { topLeft: 0, bottomLeft: 0, topRight: innerR, bottomRight: innerR }, justifyContent: 'center', alignItems: 'flex-end', }}
            uiBackground={{ color: BAR_BLUE }}>
          </UiEntity>
          <PctOverlay red={pct.red} blue={pct.blue} k={k} color={SUMMARY_INK} />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'center' : 'flex-start' }}>
        <TeamCard team={1} rows={rows.filter(r => r.team === 1)} total={total} mvp={mvp} me={me} k={k} a={1} cap={rowCap} />
        <UiEntity uiTransform={{ width: stacked ? 1 : SUMMARY_CARD_GAP * k, height: stacked ? SUMMARY_GAP * 0.6 * k : 1 }} />
        <TeamCard team={2} rows={rows.filter(r => r.team === 2)} total={total} mvp={mvp} me={me} k={k} a={1} cap={rowCap} />
      </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

/** Unscaled width of the team tables: one card when stacked, both + gap side by side (the big pill matches it). */
const tablesW = (stacked: boolean) => stacked ? SUMMARY_CARD_W : SUMMARY_CARD_W * 2 + SUMMARY_CARD_GAP
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
  const { k, stacked, rowCap } = tablesLayout(b.owners as SummaryRow[], cv, SUMMARY_HEAD_H + SUMMARY_PILL_H + SUMMARY_GAP)
  const a = Math.max(0, Math.min(1, (p - 0.5) / 0.5)) // everything but the pill fades in over the second half
  const barH = BAR_FILL_H + BAR_BORDER * 2
  const pw = lerp(BAR_W, tablesW(stacked) * k, p), ph = lerp(barH, SUMMARY_PILL_H * k, p)
  const border = lerp(BAR_BORDER, SUMMARY_OUTLINE * k, p)
  const innerW = pw - border * 2, cap = lerp(BAR_CAP, SUMMARY_PILL_CAP * k, p)
  const redW = cap + (innerW - cap * 2) * b.redPct / 100
  const blueW = cap + (innerW - cap * 2) * b.bluePct / 100
  const innerR = (ph - border * 2) / 2
  const rows = (b.owners as SummaryRow[]).slice().sort((x, y) => y.cells - x.cells)
  const mvp = rows.length > 0 && rows[0].cells > 0 ? rows[0].id : ''
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  const teamWord = b.winner === 'RED' ? 'RED TEAM' : b.winner === 'BLUE' ? 'BLUE TEAM' : ''
  const show = a > 0
  const titleWords = teamWord !== '' ? [teamWord, 'WINS!'] : ["IT'S A TIE"]
  const titleF = titleFontFor(titleWords, k, cv.w * 0.9)
  // Letter-spaced subtitle; on narrow phones where it would drop under the 12 px floor, the plain words.
  const SUB_WIDE = 'F I N A L     T E R R I T O R Y     C O N T R O L'
  const SUB = cv.w * 0.9 / textWSafe(SUB_WIDE, 1) >= SUMMARY_FONT_MIN ? SUB_WIDE : 'FINAL TERRITORY CONTROL'
  const subF = Math.min(fnt(SUMMARY_SUB_FONT, k), cv.w * 0.9 / textWSafe(SUB, 1))
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, flexDirection: 'column', alignItems: 'center', pointerFilter: show ? 'block' : 'none' }}
      onMouseDown={() => dismissSummary()}>
      <UiEntity uiTransform={{ width: 1, flexGrow: p, height: 0 }} />
      <UiEntity uiTransform={{ width: 1, height: BAR_TOP_PX * (1 - p), flexShrink: 0 }} />
      {/* Title + subtitle: light text floating over the scene (fold to nothing while the pill is still a bar) */}
      <UiEntity uiTransform={{ width: '100%', height: SUMMARY_HEAD_H * k * a, flexShrink: 0, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
        {show && (
          <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', margin: { bottom: 14 * k } }}>
            <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: titleF * 1.2, flexShrink: 0 }}>
              {teamWord !== '' && <Label value={teamWord} fontSize={titleF} color={withA(b.winner === 'RED' ? RED_COLOR : BLUE_COLOR, a)} textAlign="middle-right" textWrap="nowrap" uiTransform={{ width: textWSafe(teamWord, titleF), height: titleF * 1.2, flexShrink: 0, margin: { right: titleF * TITLE_WORD_GAP } }} />}
              <Label value={teamWord !== '' ? 'WINS!' : "IT'S A TIE"} fontSize={titleF} color={withA(Color4.White(), a)} textAlign={teamWord !== '' ? 'middle-left' : 'middle-center'} textWrap="nowrap" uiTransform={{ width: textWSafe(teamWord !== '' ? 'WINS!' : "IT'S A TIE", titleF), height: titleF * 1.2, flexShrink: 0 }} />
            </UiEntity>
            <Label value={SUB} fontSize={subF} color={withA(Color4.create(0.92, 0.92, 0.94, 1), a)} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: textWSafe(SUB, subF), height: subF * 1.45, flexShrink: 0 }} />
          </UiEntity>
        )}
      </UiEntity>
      {/* Territory pill: red left | unpainted | blue right */}
      <UiEntity uiTransform={{ width: pw, height: ph, flexShrink: 0, borderRadius: ph / 2, padding: border }} uiBackground={{ color: p > 0.5 ? SUMMARY_INK : BAR_TRACK }}>
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: innerR }} uiBackground={{ color: p > 0.5 ? SUMMARY_UNPAINTED : Color4.White() }}>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: redW, height: '100%', borderRadius: { topLeft: innerR, bottomLeft: innerR, topRight: 0, bottomRight: 0 }, justifyContent: 'center', alignItems: 'flex-start', }}
            uiBackground={{ color: BAR_RED }}>
          </UiEntity>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0 }, width: blueW, height: '100%', borderRadius: { topLeft: 0, bottomLeft: 0, topRight: innerR, bottomRight: innerR }, justifyContent: 'center', alignItems: 'flex-end', }}
            uiBackground={{ color: BAR_BLUE }}>
          </UiEntity>
          {show && <PctOverlay red={b.redPct} blue={b.bluePct} k={k} color={withA(SUMMARY_INK, a)} />}
        </UiEntity>
      </UiEntity>
      {show && (
        <UiEntity uiTransform={{ flexDirection: stacked ? 'column' : 'row', justifyContent: 'center', alignItems: stacked ? 'center' : 'flex-start', margin: { top: SUMMARY_GAP * k } }}>
          <TeamCard team={1} rows={rows.filter(r => r.team === 1)} total={b.total} mvp={mvp} me={me} k={k} a={a} cap={rowCap} />
          <UiEntity uiTransform={{ width: stacked ? 1 : SUMMARY_CARD_GAP * k, height: stacked ? SUMMARY_GAP * 0.6 * k : 1 }} />
          <TeamCard team={2} rows={rows.filter(r => r.team === 2)} total={b.total} mvp={mvp} me={me} k={k} a={a} cap={rowCap} />
        </UiEntity>
      )}
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
                justifyContent: 'center', alignItems: 'center', borderRadius: HOTBAR_RADIUS,
                // Hotbar key-tile frame: light rim (same width/colour/radius as the tiles) around a dark ring.
                borderWidth: HOTBAR_BORDER_W, borderColor: HOTBAR_RIM,
              }}
              uiBackground={{ color: HOTBAR_TILE_BG }}
            >
              <UiEntity uiTransform={{ positionType: 'absolute', position: { top: CLOCK_RING, bottom: CLOCK_RING, left: CLOCK_RING, right: CLOCK_RING }, borderRadius: HOTBAR_RADIUS - HOTBAR_BORDER_W - CLOCK_RING, pointerFilter: 'none' }}
                uiBackground={{ color: SUMMARY_CARD_BG }} />
              <Label value={formatMMSS(secs)} fontSize={42} color={SUMMARY_INK} textAlign="middle-center" />
              {/* Star icon on the left, mirror position to the mute icon on
                  the right. Placeholder — no handler yet; wire onMouseDown
                  when we decide what it does (leaderboard? favorites?). */}
              <UiEntity
                uiTransform={{
                  width: 19, height: 19,
                  positionType: 'absolute', position: { top: 10, left: 20 },
                  justifyContent: 'center', alignItems: 'center',
                  pointerFilter: 'block',
                }}
                onMouseDown={toggleLeaderboard}
              >
                <Label value="★" fontSize={22} color={SUMMARY_INK} textAlign="middle-center" />
              </UiEntity>
              <OverviewEye />
              {/* Mute icon docked inside the timer panel on the right. No pill
                  background — just the icon sitting on the panel. */}
              <UiEntity
                uiTransform={{
                  width: 21, height: 21,
                  positionType: 'absolute', position: { top: 20, right: 19 },
                  pointerFilter: 'block',
                }}
                uiBackground={{
                  textureMode: 'stretch',
                  texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
                  color: SUMMARY_INK,
                }}
                onMouseDown={toggleMusic}
              />
            </UiEntity>
            {/* Territory bar: red from the left, blue from the right, white = unpainted. */}
            {getSummaryProgress() >= 0 || standingsOpen ? (
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
                    pointerFilter: 'block',
                  }}
                  uiBackground={{ color: BAR_TRACK }}
                  onMouseDown={toggleStandings}
                >
                  <UiEntity
                    uiTransform={{ width: '100%', height: '100%', borderRadius: BAR_INNER_R }}
                    uiBackground={{ color: PANEL_LIGHT }}
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
              <BoldLabel value="★ TOP PAINTERS" fontSize={28} color={SUMMARY_INK} align="middle-left" w={textW('★ TOP PAINTERS', 28)} h={48} />
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
            ) : rows.map((r, i) => {
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

    <StandingsPopup />

    {/* ─── Round-end summary: the score bar grows into a red|blue square, holds, shrinks back. */}
    {(() => { const p = getSummaryProgress(); return p >= 0 ? RoundSummary(p) : null })()}
  </UiEntity>
)
