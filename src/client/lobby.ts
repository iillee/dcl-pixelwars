/**
 * Lobby signs and the feet report. The tiles themselves come from rebuildMaze.
 * Counts are whatever the server last broadcast. This file does not decide a winner.
 */
import { engine, Entity, TextShape, Transform, Billboard } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { CELL, MAZE_ORIGIN, BASE_Y } from '../maze/generator'
import { events } from '../shared/events'
import { LOBBY_MODES, lobbyFeet } from '../shared/lobby'
import { inLobby, voteCount, voteRemainingMs, gamePhase } from './phase'
import { sendLobbyPos, sendLobbyReady } from './clientHandler'
import { isLobbyLayout } from '../maze/rebuild'

const signs: Entity[] = []
let readySent = false

function clearSigns(): void {
  for (const e of signs) engine.removeEntity(e)
  signs.length = 0
}

function laySigns(): void {
  clearSigns()
  for (const m of LOBBY_MODES) {
    const e = engine.addEntity()
    const x = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
    const z = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
    Transform.create(e, { position: Vector3.create(x, BASE_Y + 6, z) })
    TextShape.create(e, {
      text: signText(m.id, m.label, m.live),
      fontSize: 4,
      textColor: Color4.create(m.color.r, m.color.g, m.color.b, 1),
    })
    Billboard.create(e)
    signs.push(e)
  }
}

function signText(id: string, label: string, live: boolean): string {
  const n = voteCount(id as 'pvp')
  return live ? `${label}\n${n}` : `${label}\nSOON`
}

function refreshSigns(): void {
  if (signs.length !== LOBBY_MODES.length) return
  for (let i = 0; i < LOBBY_MODES.length; i++) {
    const m = LOBBY_MODES[i]
    const shape = TextShape.getMutableOrNull(signs[i])
    if (shape) shape.text = signText(m.id, m.label, m.live)
  }
}

export function lobbyStand(): { x: number; y: number; z: number } {
  return lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
}

export function initLobby(): void {
  events.on('lobby:floor', () => {
    laySigns()
    readySent = false
  })
  events.on('round:reset', ({ layout }) => {
    if (layout === 'arena') clearSigns()
  })
  events.on('round:clock', () => refreshSigns())

  let posClock = 0
  engine.addSystem((dt: number) => {
    if (!isLobbyLayout() || !inLobby()) return
    if (!readySent) {
      readySent = true
      try { sendLobbyReady() } catch (err) { console.log('[Lobby] ready send failed', err); readySent = false }
    }
    posClock += dt
    if (posClock < 0.5) return
    posClock = 0
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (!t) return
    const p = t.position
    try { sendLobbyPos(p.x, p.y, p.z) } catch (err) { console.log('[Lobby] pos send failed', err) }
  })
}

export function hudClockText(matchSecs: number): string {
  const phase = gamePhase()
  if (phase === 'match') {
    const m = Math.floor(matchSecs / 60)
    const s = matchSecs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  if (phase === 'summary') return 'END'
  const left = Math.max(0, Math.ceil(voteRemainingMs() / 1000))
  if (phase === 'lobby' && left > 0) return `VOTE ${left}`
  return 'VOTE'
}

export function hudVoteLine(): string {
  if (!inLobby()) return ''
  return LOBBY_MODES.map(m => `${m.live ? m.label : m.label} ${m.live ? voteCount(m.id) : '—'}`).join('   ')
}
