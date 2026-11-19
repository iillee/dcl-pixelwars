/**
 * Round-end summary previews at 16:9 and 21:9, using the compact mid-game panel.
 * Run: npx tsx scripts/preview-end-summary.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cardFrameH, standingsLayout, summaryPcts, titleFontFor,
  SUMMARY_CARD_GAP, SUMMARY_CARD_HEAD_H, SUMMARY_CARD_W, SUMMARY_GAP, SUMMARY_HEAD_H,
  TITLE_WORD_GAP, textWSafe,
} from '../src/shared/summaryLayout'

const outDir = process.argv[2]
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp-end-previews')
mkdirSync(outDir, { recursive: true })

const TEAMS = [
  { id: 'YELLOW', color: '#FFE04A', ink: '#111' },
  { id: 'RED', color: '#FF7577', ink: '#111' },
  { id: 'BLUE', color: '#6A99FC', ink: '#111' },
  { id: 'GREEN', color: '#4FD68C', ink: '#111' },
] as const

const ROSTERS: Record<(typeof TEAMS)[number]['id'], { name: string; tiles: number; area: string; ko: number; deaths: number; me?: boolean }[]> = {
  YELLOW: [
    { name: 'PixelAce', tiles: 412, area: '14%', ko: 5, deaths: 1 },
    { name: 'Sunny', tiles: 301, area: '10%', ko: 2, deaths: 2 },
    { name: 'Dot', tiles: 188, area: '6%', ko: 1, deaths: 0 },
    { name: 'You', tiles: 140, area: '5%', ko: 0, deaths: 1, me: true },
  ],
  RED: [
    { name: 'Crimson', tiles: 355, area: '12%', ko: 4, deaths: 2 },
    { name: 'Brick', tiles: 210, area: '7%', ko: 1, deaths: 3 },
    { name: 'Flame', tiles: 96, area: '3%', ko: 0, deaths: 1 },
  ],
  BLUE: [
    { name: 'Tide', tiles: 240, area: '8%', ko: 3, deaths: 1 },
    { name: 'Navy', tiles: 175, area: '6%', ko: 1, deaths: 2 },
  ],
  GREEN: [
    { name: 'Fern', tiles: 198, area: '7%', ko: 2, deaths: 1 },
  ],
}

const COUNTS = TEAMS.map(t => ROSTERS[t.id].length)
const SHARES = summaryPcts({ red: 2640, blue: 1680, green: 960, yellow: 4200, total: 12000 })

function html(label: string, cv: { w: number; h: number }): string {
  const lay = standingsLayout(COUNTS, cv, SUMMARY_HEAD_H)
  const { k, stacked, panelW, panelH, pillW, pillH, rowHs } = lay
  const vgap = SUMMARY_GAP * 0.6 * k
  const gap = SUMMARY_CARD_GAP * k
  const cw = SUMMARY_CARD_W * k
  const headH = SUMMARY_CARD_HEAD_H * k
  const font = Math.max(12, 22 * k)
  const headF = Math.max(12, 13 * k)
  const titleCardF = Math.max(14, 28 * k)
  const pad = 8 * k
  const words = ['YELLOW', 'WINS!']
  const titleF = titleFontFor(words, 1, cv.w * 0.86)
  const titleGap = Math.max(2, titleF * TITLE_WORD_GAP)
  const titleH = titleF * 1.2
  const ink = (w: string) => w.replace(/!$/, '') === 'YELLOW' ? '#FFE04A' : '#fff'
  const wordW = (w: string) => Math.max(textWSafe(w, titleF), 4)
  const wordRow = (offset: number, shadow: boolean) =>
    `<div class="wordrow" style="top:${offset}px;left:${offset}px;height:${titleH}px;${offset ? 'position:absolute;' : ''}">` +
    words.map((w, i) => `<span style="font-size:${titleF}px;color:${shadow ? 'rgba(10,10,15,0.92)' : ink(w)};width:${wordW(w)}px;margin-left:${i === 0 ? 0 : titleGap}px">${w}</span>`).join('') +
    `</div>`

  const card = (team: typeof TEAMS[number], rank: number) => {
    const people = ROSTERS[team.id]
    const ch = cardFrameH(Math.max(1, people.length), lay.bodyCap) * k
    const bodyH = ch - (24 * k) - headH
    const rowH = bodyH / Math.max(1, people.length)
    const rows = people.map(p =>
      `<div class="row${p.me ? ' me' : ''}" style="height:${rowH}px;font-size:${font}px">
        <span class="dot" style="background:${team.color}"></span>
        <span class="name">${p.name}</span>
        <span>${p.area}</span><span>${p.tiles}</span><span>${p.ko}</span><span>${p.deaths}</span>
      </div>`
    ).join('')
    const border = rank === 1 ? '#F5C518' : '#222'
    const bw = (rank === 1 ? 4 : 3) * k
    return `<article class="card" style="width:${cw}px;height:${ch}px;border-width:${bw}px;border-color:${border}">
      <header style="height:${headH}px;font-size:${titleCardF}px;color:${team.color}">#${rank} ${team.id} TEAM
        <span class="heads" style="font-size:${headF}px">AREA TILES KO DEATHS</span>
      </header>
      <div class="body" style="height:${bodyH}px">${rows}</div>
    </article>`
  }
  const grid = stacked
    ? `<div class="stack" style="gap:${vgap}px">${TEAMS.map((t, i) => card(t, i + 1)).join('')}</div>`
    : `<div class="grid" style="width:${lay.gridW}px;gap:${vgap}px">
        <div class="grow" style="height:${rowHs[0]}px;gap:${gap}px">${card(TEAMS[0], 1)}${card(TEAMS[1], 2)}</div>
        <div class="grow" style="height:${rowHs[1]}px;gap:${gap}px">${card(TEAMS[2], 3)}${card(TEAMS[3], 4)}</div>
      </div>`
  const bar = `
    <div class="pill" style="width:${pillW}px;height:${pillH}px;border-width:${3 * k}px;margin-bottom:${SUMMARY_GAP * k}px">
      <span style="flex:${SHARES.red};background:#FF7577">RED ${Math.round(SHARES.red)}%</span>
      <span style="flex:${SHARES.blue};background:#6A99FC">BLUE ${Math.round(SHARES.blue)}%</span>
      <span style="flex:${SHARES.green};background:#4FD68C">GREEN ${Math.round(SHARES.green)}%</span>
      <span style="flex:${SHARES.yellow};background:#FFE04A">YELLOW ${Math.round(SHARES.yellow)}%</span>
      <span style="flex:${SHARES.white};background:#F4F1EA"></span>
    </div>`
  const top = Math.round((cv.h - SUMMARY_HEAD_H - panelH) / 2)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${cv.w}px;height:${cv.h}px;overflow:hidden;font-family:Arial,Helvetica,sans-serif}
    body{background:linear-gradient(180deg,#6ec6ff 0%,#c8e8ff 42%,#f3f0d8 100%)}
    .stage{position:absolute;top:${Math.max(16, top)}px;left:0;right:0;display:flex;flex-direction:column;align-items:center}
    .titlebox{height:${SUMMARY_HEAD_H}px;width:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;box-sizing:border-box;padding-bottom:10px}
    .headline{position:relative;height:${titleH + 6}px;display:flex;align-items:center;justify-content:center}
    .wordrow{display:flex;align-items:center;justify-content:center;height:${titleH}px;font-weight:800;letter-spacing:-0.02em}
    .wordrow span{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .panel{width:${panelW}px;height:${panelH}px;display:flex;flex-direction:column;align-items:center;box-sizing:border-box}
    .pill{border-radius:999px;display:flex;overflow:hidden;border-style:solid;border-color:#222;background:#F4F1EA;box-sizing:border-box;flex-shrink:0}
    .pill span{display:flex;align-items:center;justify-content:center;color:#111;font-weight:800;font-size:${Math.max(11, 16 * k)}px;min-width:0}
    .grid{display:flex;flex-direction:column;flex-shrink:0}
    .grow{display:flex;align-items:flex-start;justify-content:center}
    .stack{display:flex;flex-direction:column;align-items:center}
    .card{background:#e8e8ea;border-style:solid;border-radius:${14 * k}px;box-sizing:border-box;padding:${pad}px ${pad}px ${12 * k}px;display:flex;flex-direction:column;flex-shrink:0}
    .card header{display:flex;align-items:center;justify-content:space-between;font-weight:800;flex-shrink:0}
    .heads{color:#666;font-weight:700;letter-spacing:0.04em}
    .body{overflow:hidden;display:flex;flex-direction:column}
    .row{display:flex;align-items:center;box-sizing:border-box;padding:0 ${6 * k}px;border-radius:${6 * k}px;background:rgba(0,0,0,0.05);margin-bottom:1px;flex-shrink:0}
    .row.me{background:#fff;border:2px solid #222}
    .row span{text-align:center;flex:1;color:#222;font-weight:600}
    .row .name{text-align:left;flex:2.4;font-weight:700}
    .row .dot{flex:0 0 ${10 * k}px;width:${10 * k}px;height:${10 * k}px;border-radius:50%;border:1px solid #222;margin-right:${6 * k}px}
    .meta{position:absolute;top:8px;left:10px;color:#123;font:12px/1.2 Arial;background:rgba(255,255,255,0.75);padding:3px 6px;border-radius:4px;z-index:2}
  </style></head><body>
  <div class="meta">${label} · ${cv.w}×${cv.h} · ${stacked ? 'stacked' : '2×2'} · k=${k.toFixed(2)} · panel ${Math.round(panelW)}×${Math.round(panelH)} · title ${SUMMARY_HEAD_H}px</div>
  <div class="stage">
    <div class="titlebox"><div class="headline">${wordRow(3, true)}${wordRow(0, false)}</div></div>
    <div class="panel">${bar}${grid}</div>
  </div>
  </body></html>`
}

const frames = [
  { file: 'end-summary-16x9.html', label: '16:9 end', cv: { w: 1920, h: 1080 } },
  { file: 'end-summary-21x9.html', label: '21:9 end', cv: { w: 3440, h: 1440 } },
] as const

for (const frame of frames) {
  const file = join(outDir, frame.file)
  writeFileSync(file, html(frame.label, frame.cv))
  console.log('wrote', file)
}
