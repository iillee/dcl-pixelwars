/**
 * Lightweight server lag diagnostics. Measures our work vs host stalls
 * so a playtest can tell "our tick is heavy" from "the runtime hiccuped".
 *
 * Watch the preview / hammurabi server console for `[Lag]` lines.
 */
const SLOW_TICK_MS = 30
const SLOW_GAP_MS = 150
const REPORT_MS = 5000

let lastStart = 0
let windowAt = 0
let frames = 0
let sumTick = 0
let maxTick = 0
let maxGap = 0
let sent = 0
let frameBots = 0
let framePaint = 0
let frameNet = 0
let frameGap = 0
let open = false

export function noteLagSend(): void { sent++ }

let frameDtMs = 0

export function beginLagFrame(dt?: number): void {
  const now = Date.now()
  if (open) finish(0, 0)
  frameGap = lastStart > 0 ? now - lastStart : 0
  lastStart = now
  frameDtMs = dt !== undefined && Number.isFinite(dt) ? Math.round(dt * 1000) : 0
  if (!windowAt) windowAt = now
  frameBots = 0
  framePaint = 0
  frameNet = 0
  open = true
}

export function noteLagSection(which: 'bots' | 'paint' | 'net', startedAt: number): void {
  const ms = Math.max(0, Date.now() - startedAt)
  if (which === 'bots') frameBots += ms
  else if (which === 'paint') framePaint += ms
  else frameNet += ms
}

export function endLagFrame(cells: number, bots: number): void {
  if (!open) return
  finish(cells, bots)
}

function finish(cells: number, bots: number): void {
  open = false
  const tick = Math.max(0, Date.now() - lastStart)
  const gap = frameGap
  frames++
  sumTick += tick
  if (tick > maxTick) maxTick = tick
  if (gap > maxGap) maxGap = gap
  if (tick >= SLOW_TICK_MS || gap >= SLOW_GAP_MS) {
    const why = tick >= SLOW_TICK_MS ? 'slow tick' : 'slow gap'
    console.log(`[Lag] ${why} tick=${tick}ms bots=${frameBots} paint=${framePaint} net=${frameNet} gap=${gap}ms dt=${frameDtMs}ms cells=${cells} botsN=${bots}`)
  }
  const now = Date.now()
  if (now - windowAt < REPORT_MS || frames <= 0) return
  const dt = (now - windowAt) / 1000
  const avg = sumTick / frames
  console.log(`[Lag] 5s ticks=${frames} avg=${avg.toFixed(1)} max=${maxTick} gapMax=${maxGap} cells=${cells} bots=${bots} send=${(sent / dt).toFixed(0)}/s`)
  windowAt = now
  frames = 0
  sumTick = 0
  maxTick = 0
  maxGap = 0
  sent = 0
}
/** Count every room.send without touching each call site. */
export function hookRoomSend(room: { send: (...args: never[]) => unknown }): void {
  const inner = room.send.bind(room)
  room.send = ((...args: never[]) => {
    noteLagSend()
    return inner(...args)
  }) as typeof room.send
}