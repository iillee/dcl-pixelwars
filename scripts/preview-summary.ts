import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  rosterLayout, tablesLayout,
  SUMMARY_CARD_BODY_H, SUMMARY_CARD_H, SUMMARY_CARD_W, SUMMARY_GAP, SUMMARY_HEAD_H,
  SUMMARY_OWNERS_MAX, SUMMARY_PILL_H, TITLE_WORD_GAP, textWSafe, titleFontFor,
} from '../src/shared/summaryLayout'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp-summary-previews')
mkdirSync(outDir, { recursive: true })

const TEAMS = [
  { id: 'RED', color: '#FF7577' },
  { id: 'BLUE', color: '#6A99FC' },
  { id: 'GREEN', color: '#4FD68C' },
  { id: 'YELLOW', color: '#FFE04A' },
] as const

function names(n: number, team: string, meTeam: string): { name: string; tiles: number; me: boolean }[] {
  return Array.from({ length: n }, (_, i) => ({
    name: i === n - 1 && team === meTeam ? 'You' : `${team[0]}${i + 1}` ,
    tiles: Math.max(1, 40 - i * 2 - (team === 'YELLOW' ? 4 : 0)),
    me: i === n - 1 && team === meTeam,
  }))
}

function html(kind: 'desktop' | 'mobile', n: number): string {
  const cv = kind === 'desktop' ? { w: 1280, h: 720 } : { w: 390, h: 844 }
  const top = SUMMARY_HEAD_H + SUMMARY_PILL_H + SUMMARY_GAP
  const { k, stacked } = tablesLayout([], cv, top)
  const lay = rosterLayout(n)
  const titleF = titleFontFor(['BLUE', 'WINS!'], k, cv.w * 0.86)
  const gap = Math.max(4, titleF * TITLE_WORD_GAP)
  const subF = Math.max(12, 18 * k)
  const cw = SUMMARY_CARD_W * k
  const ch = SUMMARY_CARD_H * k
  const bodyH = SUMMARY_CARD_BODY_H * k
  const rowH = lay.rowH * k
  const font = Math.max(12, lay.font * k)
  const card = (team: typeof TEAMS[number], rank: number) => {
    const people = names(n, team.id, 'BLUE')
    let rows = ''
    if (lay.columns === 1) {
      rows = people.map(p => `<div class='row ${p.me ? 'me' : ''}' style='height:${rowH}px;font-size:${font}px'><span class='dot' style='background:${team.color}'></span><span class='name'>${p.name}${p.me ? '  ★' : ''}</span><span>12%</span><span>${p.tiles}</span><span>3</span><span>1</span></div>`).join('')
    } else {
      for (let i = 0; i < people.length; i += 2) {
        const a = people[i], b = people[i + 1]
        rows += `<div class='pair' style='height:${rowH}px;font-size:${font}px'>`
        rows += `<div class='row compact ${a.me ? 'me' : ''}'><span class='dot' style='background:${team.color}'></span><span class='name'>${a.name}</span><span>${a.tiles}</span></div>`
        if (b) rows += `<div class='row compact ${b.me ? 'me' : ''}'><span class='dot' style='background:${team.color}'></span><span class='name'>${b.name}</span><span>${b.tiles}</span></div>`
        rows += `</div>`
      }
    }
    const overflow = lay.scroll ? 'auto' : 'hidden'
    return `<article class='card' style='width:${cw}px;height:${ch}px'><header style='color:${team.color}'>#${rank} ${team.id} TEAM${lay.columns===2?'<span class=heads>TILES TILES</span>':'<span class=heads>AREA TILES KO DEATHS</span>'}</header><div class='body' style='height:${bodyH}px;overflow:${overflow}'>${rows}</div></article>`
  }
  const grid = stacked
    ? `<div class='stack'>${TEAMS.map((t,i) => card(t, i+1)).join('')}</div>`
    : `<div class='grid'><div class='grow'>${card(TEAMS[0],1)}${card(TEAMS[1],2)}</div><div class='grow'>${card(TEAMS[2],3)}${card(TEAMS[3],4)}</div></div>`
  const vgap = SUMMARY_GAP * 0.6 * k
  return `<!doctype html><html><head><meta charset='utf-8'><style>
    html,body{margin:0;width:${cv.w}px;height:${cv.h}px;overflow:hidden;font-family:Arial,Helvetica,sans-serif}
    body{background:linear-gradient(180deg,#8fd0ff 0%,#e8f4ff 48%,#fff4c8 100%)}
    .wrap{display:flex;flex-direction:column;align-items:center;height:100%;box-sizing:border-box;padding-top:${Math.round(24*k)}px}
    .title{background:#121216;color:#fff;border-radius:${16*k}px;padding:${10*k}px ${28*k}px ${12*k}px;display:flex;flex-direction:column;align-items:center}
    .headline{display:flex;align-items:center;height:${titleF*1.15}px;font-weight:800;letter-spacing:-0.02em}
    .headline .blue{color:#6A99FC;font-size:${titleF}px}
    .headline .wins{color:#fff;font-size:${titleF}px;margin-left:${gap}px}
    .sub,.next{color:#fff;font-size:${subF}px;margin-top:2px;font-weight:600}
    .next{font-size:${Math.max(12, subF*0.9)}px}
    .pill{margin:${SUMMARY_GAP*k}px 0 ${vgap}px;width:${Math.min(cv.w*0.9, (stacked?SUMMARY_CARD_W:SUMMARY_CARD_W*2+40)*k)}px;height:${SUMMARY_PILL_H*k}px;border-radius:999px;display:flex;overflow:hidden;border:3px solid #222;background:#eee}
    .pill span{display:flex;align-items:center;justify-content:center;color:#111;font-weight:800;font-size:${14*k}px}
    .grid{display:flex;flex-direction:column;gap:${vgap}px}
    .grow{display:flex;gap:${40*k}px;justify-content:center}
    .stack{display:flex;flex-direction:column;gap:${vgap}px;align-items:center}
    .card{background:#e8e8ea;border:3px solid #222;border-radius:${14*k}px;box-sizing:border-box;padding:${8*k}px ${8*k}px ${12*k}px;display:flex;flex-direction:column}
    .card header{height:${40*k}px;display:flex;align-items:center;font-weight:800;font-size:${22*k}px;justify-content:space-between}
    .heads{color:#666;font-size:${11*k}px;font-weight:700;letter-spacing:0.04em}
    .body{overflow:hidden}
    .row{display:flex;align-items:center;box-sizing:border-box;padding:0 ${6*k}px;border-radius:${6*k}px;background:rgba(0,0,0,0.05);margin-bottom:1px}
    .row.me{background:#fff;border:2px solid #222}
    .row span{text-align:center;flex:1;color:#222}
    .row .name{text-align:left;flex:2;font-weight:700}
    .row .dot{flex:0 0 ${10*k}px;width:${10*k}px;height:${10*k}px;border-radius:50%;border:1px solid #222;margin-right:${6*k}px}
    .pair{display:flex}
    .pair .row{flex:1;width:50%}
    .meta{position:absolute;top:8px;left:10px;color:#123;font:12px/1.2 Arial;background:rgba(255,255,255,0.7);padding:3px 6px;border-radius:4px}
  </style></head><body>
  <div class='meta'>${kind} · ${n} per team${n===SUMMARY_OWNERS_MAX?' (max 60)':''} · ${stacked?'stacked':'2×2'} · k=${k.toFixed(2)}${lay.columns===2?' · 2-col':''}${lay.scroll?' · scroll':''}</div>
  <div class='wrap'>
    <div class='title'><div class='headline'><span class='blue'>BLUE</span><span class='wins'>WINS!</span></div>
      <div class='sub'>FINAL TERRITORY CONTROL</div>
      <div class='next'>NEXT ROUND IN 0:20</div></div>
    <div class='pill'><span style='flex:2.1;background:#FF7577'>RED 28%</span><span style='flex:2.6;background:#6A99FC'>BLUE 35%</span><span style='flex:1.6;background:#4FD68C'>GREEN 22%</span><span style='flex:1.1;background:#FFE04A'>YELLOW 15%</span></div>
    ${grid}
  </div></body></html>`
}

for (const kind of ['desktop', 'mobile'] as const) {
  for (const n of [1, 4, 8, SUMMARY_OWNERS_MAX]) {
    const label = n === SUMMARY_OWNERS_MAX ? 'max' : String(n)
    const file = join(outDir, `summary-${kind}-${label}.html`)
    writeFileSync(file, html(kind, n))
    console.log('wrote', file)
  }
}
