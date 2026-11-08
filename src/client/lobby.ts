/**
 * Lobby signs and the feet report. The tiles themselves come from rebuildMaze.
 * Counts are whatever the server last broadcast. This file does not decide a winner.
 */
import { engine, Entity, TextShape, Transform, Billboard, Material, MaterialTransparencyMode, MeshRenderer, AudioSource } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { CELL, MAZE_ORIGIN, BASE_Y, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import { events } from '../shared/events'
import { LOBBY_MODES, type ModeId, cellAt, lobbyFeet, placedModes, toSceneFeet, voteModeAt } from '../shared/lobby'
import { gamePhase, inLobby, myVote, serverLobbyCounts, voteCount, voteRemainingMs } from './phase'
import { sendLobbyPos, sendLobbyReady } from './clientHandler'
import { isLobbyLayout } from '../maze/rebuild'

/** On-screen lobby trace. Turn off once a playtest shows votes landing. */
export const DEBUG_LOBBY = false

const BASE_METERS = sceneOriginParcel(SKY_PARCELS) * 16
let sent = 0
let sendFail = 0
let noTransform = 0
let lastFeet = { x: NaN, y: NaN, z: NaN }

const signs: Entity[] = []
const tints: Entity[] = []
let readySent = false
let confirmEnt: Entity = 0 as Entity
let pulsed: ModeId | '' = ''
let pulse = 0
const CONFIRM_SOUND = 'assets/sounds/click.wav'

function clearSigns(): void {
  for (const e of signs) engine.removeEntity(e)
  signs.length = 0
  for (const e of tints) engine.removeEntity(e)
  tints.length = 0
  pulsed = ''
  pulse = 0
}

function laySigns(): void {
  clearSigns()
  for (const m of placedModes()) {
    const x = m.cell.x * CELL + CELL / 2 + MAZE_ORIGIN
    const z = m.cell.z * CELL + CELL / 2 + MAZE_ORIGIN
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(x, BASE_Y + 8, z) })
    TextShape.create(e, {
      text: signText(m.id, m.label),
      fontSize: 5,
      textColor: Color4.create(m.color.r, m.color.g, m.color.b, 1),
    })
    Billboard.create(e)
    signs.push(e)
    const pad = engine.addEntity()
    Transform.create(pad, { position: Vector3.create(x, BASE_Y + 0.62, z), scale: Vector3.Zero() })
    MeshRenderer.setBox(pad)
    Material.setPbrMaterial(pad, tintMat(m.color, 0.4, 1))
    tints.push(pad)
  }
}

function signText(id: string, label: string): string {
  return `${label}\n${voteCount(id as 'pvp')}`
}

function refreshSigns(): void {
  const modes = placedModes()
  if (signs.length !== modes.length) return
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i]
    const shape = TextShape.getMutableOrNull(signs[i])
    if (shape) shape.text = signText(m.id, m.label)
  }
}

function tintMat(c: { r: number; g: number; b: number }, alpha: number, glow: number) {
  return {
    albedoColor: Color4.create(c.r, c.g, c.b, alpha),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: glow,
    roughness: 0.45,
    metallic: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  }
}

function playConfirm(): void {
  if (!confirmEnt) {
    confirmEnt = engine.addEntity()
    Transform.create(confirmEnt, { position: Vector3.create(0, 0, 0) })
  }
  AudioSource.createOrReplace(confirmEnt, {
    audioClipUrl: CONFIRM_SOUND, playing: true, loop: false, volume: 0.55, global: true,
  })
}

/** Local tint while standing on an end. Brighter and steady once the server counts it. */
function tickTints(dt: number, local: ModeId | ''): void {
  const mine = myVote()
  const modes = placedModes()
  if (tints.length !== modes.length) return
  if (mine && mine === local && mine !== pulsed) { pulsed = mine; pulse = 0.55; playConfirm() }
  if (!mine) pulsed = ''
  if (pulse > 0) pulse = Math.max(0, pulse - dt)
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i]
    const tr = Transform.getMutableOrNull(tints[i])
    if (!tr) continue
    const here = local === m.id
    const confirmed = here && mine === m.id
    const others = voteCount(m.id) > (mine === m.id ? 1 : 0)
    const show = here || others
    if (!show) { tr.scale = Vector3.Zero(); continue }
    tr.scale = Vector3.create(28, 0.08, 28)
    const glow = confirmed ? 2.4 + pulse * 8 : here ? 1.3 : 0.35
    const alpha = confirmed ? 0.78 : here ? 0.42 : 0.16
    Material.setPbrMaterial(tints[i], tintMat(m.color, alpha, glow))
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
    if (!inLobby()) { if (tints.length) clearSigns(); return }
    if (!readySent && isLobbyLayout()) {
      readySent = true
      try { sendLobbyReady() } catch (err) { console.log('[Lobby] ready send failed', err); readySent = false }
    }
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (!t) { noTransform++; return }
    noTransform = 0
    const p = t.position
    lastFeet = { x: p.x, y: p.y, z: p.z }
    const sceneNow = toSceneFeet(p.x, p.z, SCENE_SIZE, MAZE_ORIGIN, CELL, BASE_METERS)
    tickTints(dt, voteModeAt(sceneNow.x, sceneNow.z, MAZE_ORIGIN, CELL))
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
  return `DBG ${isLobbyLayout() ? 'layout' : 'NO-LAYOUT'} raw ${fmt(lastFeet.x)},${fmt(lastFeet.y)},${fmt(lastFeet.z)} scene ${fmt(scene.x)},${fmt(scene.z)} ${scene.frame} cell ${c ? `${c.x},${c.z}` : 'out'} zone ${zone} sent ${sent} fail ${sendFail} noTf ${noTransform} srv ${gamePhase()} clocks ${wire.clocks} present ${wire.present} feet ${wire.feet} pvp ${voteCount('pvp')} pvb ${voteCount('pvb')} srvZone ${wire.zone} why=${wire.why}`
}

function voteTag(): string {
  const mine = myVote()
  return mine === 'pvp' ? 'PvP' : mine === 'pvb' ? 'PvB' : ''
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

/** Shown inside the VOTE pill once the server has counted this player. */
export function hudYourVote(): string {
  if (!inLobby()) return ''
  const tag = voteTag()
  return tag ? `Your vote: ${tag}` : ''
}
