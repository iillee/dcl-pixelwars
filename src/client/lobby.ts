/**
 * Lobby signs and the feet report. The tiles themselves come from rebuildMaze.
 * Counts are whatever the server last broadcast. This file does not decide a winner.
 */
import { engine, Entity, TextShape, Transform, Billboard, BillboardMode, Material, MaterialTransparencyMode, MeshRenderer, AudioSource } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CELL, MAZE_ORIGIN, BASE_Y, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import { events } from '../shared/events'
import { LOBBY_MODES, SIGN_H_M, SIGN_LIP_DEPTH_M, SIGN_LIP_Z, SIGN_W_M, type ModeId, billboardAnchor, cellAt, hudVoteHeadline, lobbyFeet, modeSubtitle, modeTitle, orthoSignPoses, placedModes, signBadgeY, signCaretCenterY, signCaretSize, signFaceZ, toSceneFeet, voteModeAt, voteTintPose, type OrthoSignPose } from '../shared/lobby'
import { gamePhase, inLobby, myVote, serverLobbyCounts, voteCount, voteRemainingMs } from './phase'
import { sendLobbyPos, sendLobbyReady } from './clientHandler'
import { isLobbyLayout } from '../maze/rebuild'
import { isOverviewActive, overviewFrame, overviewSignRotation, overviewSignScale, overviewViewScale } from './overviewCamera'

/** On-screen lobby trace. Turn off once a playtest shows votes landing. */
export const DEBUG_LOBBY = false

const BASE_METERS = sceneOriginParcel(SKY_PARCELS) * 16
let sent = 0
let sendFail = 0
let noTransform = 0
let lastFeet = { x: NaN, y: NaN, z: NaN }

const spawned: Entity[] = []
const signRoots: Entity[] = []
const signMeta: { cell: { x: number; z: number }; x: number; y: number; z: number }[] = []
const boards: { count: Entity }[] = []
/** SDK TextShape: fontSize 10 is 1 m tall. No extra scale on these entities. */
const TITLE_FONT = 45
const SUB_FONT = 14
const COUNT_FONT = 22
const tints: Entity[] = []
const tintSize: Vector3[] = []
let readySent = false
let confirmEnt: Entity = 0 as Entity
let pulsed: ModeId | '' = ''
let pulse = 0
const CONFIRM_SOUND = 'assets/sounds/click.wav'

type Rgb = { r: number; g: number; b: number }

const SIGN_COPY: Record<'pvp' | 'pvb' | 'prototype', { plate: Rgb; ink: Rgb }> = {
  pvp: { plate: { r: 0.96, g: 0.24, b: 0.16 }, ink: { r: 0.45, g: 0.08, b: 0.05 } },
  pvb: { plate: { r: 0.08, g: 0.62, b: 0.78 }, ink: { r: 0.02, g: 0.2, b: 0.32 } },
  prototype: { plate: { r: 0.96, g: 0.72, b: 0.18 }, ink: { r: 0.35, g: 0.22, b: 0.04 } },
}

function clearSigns(): void {
  for (const e of spawned) engine.removeEntity(e)
  spawned.length = 0
  signRoots.length = 0
  signMeta.length = 0
  boards.length = 0
  tints.length = 0
  tintSize.length = 0
  pulsed = ''
  pulse = 0
}

function add(parent: Entity, pos: Vector3, scale: Vector3, rot = Quaternion.Identity()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos, scale, rotation: rot })
  spawned.push(e)
  return e
}

function plateMat(c: Rgb) {
  return {
    albedoColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveColor: Color4.create(c.r, c.g, c.b, 1),
    emissiveIntensity: 0.55,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    reflectivityColor: Color3.create(0, 0, 0),
    castShadows: false,
  }
}

/** Pill: a box plus a disk on each end. Disks face local +Z. */
function pill(parent: Entity, w: number, h: number, d: number, center: Vector3, mat: ReturnType<typeof plateMat>): void {
  const box = add(parent, center, Vector3.create(Math.max(0.2, w - h), h, d))
  MeshRenderer.setBox(box)
  Material.setPbrMaterial(box, mat)
  const spin = Quaternion.fromEulerDegrees(90, 0, 0)
  const capScale = Vector3.create(h, d, h)
  const x = (w - h) / 2
  for (const side of [-1, 1]) {
    const cap = add(parent, Vector3.create(center.x + side * x, center.y, center.z), capScale, spin)
    MeshRenderer.setCylinder(cap)
    Material.setPbrMaterial(cap, mat)
  }
}

function laySigns(): void {
  clearSigns()
  for (const m of placedModes()) {
    const copy = SIGN_COPY[m.id as 'pvp' | 'pvb' | 'prototype']
    const pose = billboardAnchor(m.cell, MAZE_ORIGIN, CELL, BASE_Y)
    const root = engine.addEntity()
    // Letters sit on local −Z, the side a yaw billboard turns toward the camera.
    // In play, BM_Y yaws each sign on its own. In overview that perspective
    // splits them, so the billboard is switched off and both signs copy the
    // camera rotation (parallel to the screen) including during a 90° turn.
    Transform.create(root, { position: Vector3.create(pose.x, pose.y, pose.z) })
    Billboard.create(root, { billboardMode: BillboardMode.BM_Y })
    spawned.push(root)
    signRoots.push(root)
    signMeta.push({ cell: m.cell, x: pose.x, y: pose.y, z: pose.z })
    const face = signFaceZ()
    const slab = plateMat(copy.plate)
    const lip = plateMat({ r: copy.plate.r * 0.55, g: copy.plate.g * 0.55, b: copy.plate.b * 0.55 })
    pill(root, SIGN_W_M + 0.7, SIGN_H_M + 0.55, SIGN_LIP_DEPTH_M, Vector3.create(0, 0, SIGN_LIP_Z), lip)
    pill(root, SIGN_W_M, SIGN_H_M, 0.7, Vector3.Zero(), slab)
    const caret = signCaretSize()
    const tail = add(
      root,
      Vector3.create(0, signCaretCenterY(), face),
      Vector3.create(caret.w, caret.h, 0.45),
      Quaternion.fromEulerDegrees(180, 0, 0),
    )
    MeshRenderer.setCylinder(tail, 0.5, 0)
    Material.setPbrMaterial(tail, slab)
    const title = add(root, Vector3.create(0, 1.15, face), Vector3.One())
    TextShape.create(title, {
      text: modeTitle(m.id),
      fontSize: TITLE_FONT,
      fontSrc: 'Lilita One',
      textColor: Color4.create(1, 1, 1, 1),
      outlineWidth: 0,
      textWrapping: false,
      width: SIGN_W_M - 4,
      height: 5.2,
    })
    const sub = add(root, Vector3.create(0, -2.45, face), Vector3.One())
    TextShape.create(sub, {
      text: modeSubtitle(m.id),
      fontSize: SUB_FONT,
      fontSrc: 'Lilita One',
      textColor: Color4.create(1, 1, 1, 1),
      outlineWidth: 0,
      textWrapping: false,
      width: 40,
      height: 2,
    })
    const badgeY = signBadgeY()
    pill(root, 6.4, 3.4, 0.45, Vector3.create(0, badgeY, face + 0.35), plateMat({ r: 0.98, g: 0.97, b: 0.94 }))
    const count = add(root, Vector3.create(0, badgeY, face), Vector3.One())
    TextShape.create(count, {
      text: '0',
      fontSize: COUNT_FONT,
      fontSrc: 'Lilita One',
      textColor: Color4.create(0.1, 0.06, 0.07, 1),
      outlineWidth: 0,
      textWrapping: false,
      width: 6,
      height: 3,
    })
    boards.push({ count })

    const tint = voteTintPose(m.cell, MAZE_ORIGIN, CELL)
    const pad = engine.addEntity()
    Transform.create(pad, {
      position: Vector3.create(tint.x, BASE_Y + 0.58, tint.z),
      rotation: Quaternion.fromEulerDegrees(0, tint.yawDeg, 0),
      scale: Vector3.Zero(),
    })
    MeshRenderer.setBox(pad)
    Material.setPbrMaterial(pad, tintMat(m.color, 0.4, 1))
    spawned.push(pad)
    tints.push(pad)
    tintSize.push(Vector3.create(tint.width, 0.08, tint.length))
  }
  syncSignFacing()
}

function applySignPose(root: Entity, i: number, overview: OrthoSignPose | null): void {
  const bill = Billboard.getMutableOrNull(root)
  const tr = Transform.getMutableOrNull(root)
  const home = signMeta[i]
  if (!tr || !home) return
  if (overview) {
    if (bill && bill.billboardMode !== BillboardMode.BM_NONE) bill.billboardMode = BillboardMode.BM_NONE
    const cam = overviewSignRotation()
    tr.rotation = Quaternion.fromEulerDegrees(cam.pitch, cam.yaw, 0)
    tr.position = Vector3.create(overview.x, overview.y, overview.z)
    tr.scale = Vector3.create(overview.scale, overview.scale, overview.scale)
    return
  }
  if (bill && bill.billboardMode !== BillboardMode.BM_Y) {
    bill.billboardMode = BillboardMode.BM_Y
    tr.rotation = Quaternion.Identity()
  }
  tr.position = Vector3.create(home.x, home.y, home.z)
  tr.scale = Vector3.One()
}

let loggedSignScale = Number.NaN

function syncSignFacing(): void {
  let poses: OrthoSignPose[] | null = null
  if (isOverviewActive() && signMeta.length) {
    const frame = overviewFrame()
    if (frame.dist > 1) {
      poses = orthoSignPoses(
        signMeta.map(s => s.cell), MAZE_ORIGIN, CELL, BASE_Y,
        frame.focus, frame.yaw, frame.pitch, frame.dist, frame.fov, overviewSignScale(),
      )
    }
  }
  for (let i = 0; i < signRoots.length; i++) applySignPose(signRoots[i], i, poses ? poses[i] : null)
  const shown = isOverviewActive() ? Math.round(overviewSignScale() * 100) / 100 : 1
  if (shown === loggedSignScale) return
  loggedSignScale = shown
  const where = isOverviewActive() ? `viewScale ${overviewViewScale().toFixed(1)}` : 'play'
  console.log(`[Lobby] sign scale ${shown.toFixed(2)} (${where})`)
}

function refreshSigns(): void {
  const modes = placedModes()
  if (boards.length !== modes.length) return
  for (let i = 0; i < modes.length; i++) {
    const count = TextShape.getMutableOrNull(boards[i].count)
    if (count) count.text = String(voteCount(modes[i].id))
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
    tr.scale = tintSize[i]
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
    syncSignFacing()
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
    refreshSigns()
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
  return modeTitle(myVote())
}

export function hudClockText(matchSecs: number): string {
  const phase = gamePhase()
  if (phase === 'match') {
    const m = Math.floor(matchSecs / 60)
    const s = matchSecs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  if (phase === 'summary') return 'END'
  if (phase === 'lobby' || phase === 'idle') return hudVoteHeadline(myVote() !== '')
  return 'VOTE'
}

/** Big seconds under the vote pill. Empty unless a vote countdown is running. */
export function hudVoteCountdown(): string {
  if (gamePhase() !== 'lobby') return ''
  const left = Math.max(0, Math.ceil(voteRemainingMs() / 1000))
  return left > 0 ? String(left) : ''
}

/** Shown inside the vote pill once the server has counted this player. */
export function hudYourVote(): string {
  if (!inLobby()) return ''
  const tag = voteTag()
  return tag ? `Your vote: ${tag}` : ''
}
