/**
 * Lobby signs and the feet report. The tiles themselves come from rebuildMaze.
 * Counts are whatever the server last broadcast. This file does not decide a winner.
 */
import { engine, Entity, TextShape, Transform, Billboard } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { CELL, MAZE_ORIGIN, BASE_Y, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import { events } from '../shared/events'
import { LOBBY_MODES, cellAt, lobbyFeet, toSceneFeet, voteModeAt } from '../shared/lobby'
import { gamePhase, inLobby, serverLobbyCounts, voteCount, voteRemainingMs } from './phase'
import { sendLobbyPos, sendLobbyReady } from './clientHandler'
import { isLobbyLayout } from '../maze/rebuild'

/** On-screen lobby trace. Turn off once a playtest shows votes landing. */
export const DEBUG_LOBBY = true

const BASE_METERS = sceneOriginParcel(SKY_PARCELS) * 16
let sent = 0
let sendFail = 0
let noTransform = 0
let lastFeet = { x: NaN, y: NaN, z: NaN }

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
    // Phase alone. The layout flag used to gate this, so a joiner whose HUD
    // already said VOTE (phase idle) but whose floor was still the arena
    // never sent a sample. The server names the zone.
    if (!inLobby()) return
    if (!readySent && isLobbyLayout()) {
      readySent = true
      try { sendLobbyReady() } catch (err) { console.log('[Lobby] ready send failed', err); readySent = false }
    }
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (!t) { noTransform++; return }
    noTransform = 0
    const p = t.position
    lastFeet = { x: p.x, y: p.y, z: p.z }
    posClock += dt
    if (posClock < 0.5) return
    posClock = 0
    try { sendLobbyPos(p.x, p.y, p.z); sent++ } catch (err) { sendFail++; console.log('[Lobby] pos send failed', err) }
  })
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(0) : 'na'
}

/** Same conversion the server uses, so the HUD shows the zone that sample would score. */
export function hudLobbyDebug(): string {
  if (!DEBUG_LOBBY || !inLobby()) return ''
  const scene = toSceneFeet(lastFeet.x, lastFeet.z, SCENE_SIZE, MAZE_ORIGIN, CELL, BASE_METERS)
  const c = cellAt(scene.x, scene.z, MAZE_ORIGIN, CELL)
  const named = LOBBY_MODES.find(m => c && m.cell.x === c.x && m.cell.z === c.z)
  const zone = named ? (named.live ? named.id : `${named.id}-soon`) : (voteModeAt(scene.x, scene.z, MAZE_ORIGIN, CELL) || (c ? 'abstain' : 'out'))
  const wire = serverLobbyCounts()
  return `DBG ${isLobbyLayout() ? 'layout' : 'NO-LAYOUT'} raw ${fmt(lastFeet.x)},${fmt(lastFeet.y)},${fmt(lastFeet.z)} scene ${fmt(scene.x)},${fmt(scene.z)} ${scene.frame} cell ${c ? `${c.x},${c.z}` : 'out'} zone ${zone} sent ${sent} fail ${sendFail} noTf ${noTransform} srv ${gamePhase()} clocks ${wire.clocks} present ${wire.present} feet ${wire.feet} pvp ${voteCount('pvp')} pvb ${voteCount('pvb')}`
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
