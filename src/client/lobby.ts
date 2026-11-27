/**
 * Lobby signs and the feet report. The tiles themselves come from rebuildMaze.
 * Counts are whatever the server last broadcast. This file does not assign a team.
 */
import { engine, Entity, TextShape, Transform, Billboard, BillboardMode, Material, MaterialTransparencyMode, MeshRenderer, TextAlignMode, TextureFilterMode, TextureWrapMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CELL, MAZE_ORIGIN, BASE_Y, SCENE_SIZE } from '../maze/generator'
import { sceneOriginParcel, SKY_PARCELS } from '../maze/level'
import { events } from '../shared/events'
import { LOBBY_TEAMS, SIGN_BADGE_H_M, SIGN_BADGE_W_M, SIGN_COUNT_FONT, SIGN_H_M, SIGN_LIP_DEPTH_M, SIGN_LIP_PAD_H, SIGN_LIP_PAD_W, SIGN_LIP_Z, SIGN_W_M, type TeamId, billboardAnchor, cellAt, hudVoteHeadline, LOBBY_STATUS_STARTING, lobbyFeet, signBadgeY, signFaceZ, signTitlePlane, teamTitle, isStandingOnLobbyFloor, toSceneFeet, voteTeamIdAt, voteTintPose } from '../shared/lobby'
import { gamePhase, inLobby, isLobbyStarting, serverLobbyCounts, voteCount, voteDisplayRemainingMs } from './phase'
import { sendLobbyPos, sendLobbyReady } from './clientHandler'
import { isLobbyLayout } from '../maze/rebuild'
import { isMobile } from '@dcl/sdk/platform'
import { isOverviewActive, overviewSignRotation, overviewSignScale, overviewViewScale } from './overviewCamera'
import { playCountdownGo, playCountdownTick, playUpgradeHoverSfx } from './audio'

/** On-screen lobby trace. Turn off once a playtest shows votes landing. */
export const DEBUG_LOBBY = false

const BASE_METERS = sceneOriginParcel(SKY_PARCELS) * 16
let sent = 0
let sendFail = 0
let noTransform = 0
let lastFeet = { x: NaN, y: NaN, z: NaN }
let lastSentGrounded = false
let lastSentZone: TeamId | '' = ''

const spawned: Entity[] = []
const signRoots: Entity[] = []
/** Resting height of each sign root; the bob rides on top of it. */
const signBaseY: number[] = []
/** Gentle idle bob: metres up/down at full size, and seconds per cycle. */
const SIGN_BOB_M = 0.35
const SIGN_BOB_PERIOD_S = 3.2
const boards: { count: Entity }[] = []
/** Titles are unlit texture plates (TextShape is scene-lit and has no unlit flag).
 *  Every pill uses the same width, sized for YELLOW, and the same letter height. */
const SUB_FONT = 8
const COUNT_FONT = SIGN_COUNT_FONT
const TITLE_Y_M = 0
const SUB_Y_M = -2
const SUB_BOX_H = 1.2
const SUB_BOX_W = 20
const COUNT_BOX_W = SIGN_BADGE_W_M * 0.9
const COUNT_BOX_H = SIGN_BADGE_H_M * 0.9
const TITLE_INK = Color4.create(1, 1, 1, 1)
/**
 * Title planes use MeshRenderer.setPlane with no custom UVs. Unity explorer's
 * PlaneFactory (dev) builds a two-sided quad whose front face (vertices 0–3,
 * normal Vector3.back) already maps (0,0) at lower-left, (0,1) at upper-left,
 * (1,1) at upper-right, (1,0) at lower-right. BillboardSystem BM_Y does
 * LookRotation(sign - camera), so +Z points away from the camera and the
 * camera sees that front face: upright, left-to-right, correct aspect.
 * The Materials docs list corners as LL, LR, UR, UL, which is not the mesh
 * vertex order (LL, UL, UR, LR). Feeding that array in 612e1fb rotated and
 * squashed the letters. Leave the UV channel alone and do not yaw the title;
 * every sign shares this same root billboard and identity title rotation.
 */
const tints: Entity[] = []
const tintSize: Vector3[] = []
let readySent = false
let pulsed: TeamId | '' = ''
/** 0-1 ease toward selected (full colour) and toward dim (other tiles). */
const tintSel: number[] = []
const tintDim: number[] = []
const TINT_NORMAL_LIFT = 0.52
const TINT_DIM_LIFT = 0.88
const TINT_EASE_S = 0.2
/** Tint top sits 0.05 m above the lobby floor (BASE_Y + 0.5), the same as in-game paint (FLAT_OFFSET 0.55). */
const TINT_TOP = 0.55
const TINT_THICK = 0.08
type TileFrame = { bars: Entity[]; width: number; length: number; ease: number; dim: number }
const tileFrames = new Map<TeamId, TileFrame>()

type Rgb = { r: number; g: number; b: number }

function pillHex(id: TeamId): string {
  const t = LOBBY_TEAMS.find(x => x.id === id)
  return t?.hex ?? '#FFFFFF'
}

function pillTextHex(_id: TeamId): string {
  return '#FFFFFF'
}

function pillRgb(id: TeamId): Rgb {
  const c = Color4.fromHexString(pillHex(id))
  return { r: c.r, g: c.g, b: c.b }
}

function clearSigns(): void {
  for (const e of spawned) engine.removeEntity(e)
  spawned.length = 0
  signRoots.length = 0
  signBaseY.length = 0
  boards.length = 0
  tints.length = 0
  tintSize.length = 0
  tintSel.length = 0
  tintDim.length = 0
  pulsed = ''
  tileFrames.clear()
}

function add(parent: Entity, pos: Vector3, scale: Vector3, rot = Quaternion.Identity()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos, scale, rotation: rot })
  spawned.push(e)
  return e
}

/** Unlit, fully opaque BasicMaterial so the pill renders at the true hex, not a lit or blended pastel. */
function plateMat(c: Color4) {
  return {
    diffuseColor: Color4.create(c.r, c.g, c.b, 1),
    alphaTest: 0,
    castShadows: false,
  }
}

/** Pill: a box plus a disk on each end. Disks face local +Z. */
function pill(parent: Entity, w: number, h: number, d: number, center: Vector3, mat: ReturnType<typeof plateMat>): void {
  const box = add(parent, center, Vector3.create(Math.max(0.2, w - h), h, d))
  MeshRenderer.setBox(box)
  Material.setBasicMaterial(box, mat)
  const spin = Quaternion.fromEulerDegrees(90, 0, 0)
  const capScale = Vector3.create(h, d, h)
  const x = (w - h) / 2
  for (const side of [-1, 1]) {
    const cap = add(parent, Vector3.create(center.x + side * x, center.y, center.z), capScale, spin)
    MeshRenderer.setCylinder(cap)
    Material.setBasicMaterial(cap, mat)
  }
}

function laySigns(): void {
  clearSigns()
  for (const m of LOBBY_TEAMS) {
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
    signBaseY.push(pose.y)
    const face = signFaceZ()
    // fromHexString is /255 sRGB with alpha 1; same as Color4.create of those channels.
    // A previous 33% mix toward white is what made these look muted and greyish.
    const display = Color4.fromHexString(pillHex(m.id))
    const ink = TITLE_INK
    const slab = plateMat(display)
    const lip = plateMat(Color4.create(display.r * 0.55, display.g * 0.55, display.b * 0.55, 1))
    const width = SIGN_W_M
    pill(root, width + SIGN_LIP_PAD_W, SIGN_H_M + SIGN_LIP_PAD_H, SIGN_LIP_DEPTH_M, Vector3.create(0, 0, SIGN_LIP_Z), lip)
    pill(root, width, SIGN_H_M, 0.7, Vector3.Zero(), slab)
    const titleSpec = signTitlePlane(teamTitle(m.id))
    const title = add(root, Vector3.create(0, TITLE_Y_M, face), Vector3.create(titleSpec.w, titleSpec.h, 1))
    MeshRenderer.setPlane(title)
    const titleTex = Material.Texture.Common({
      src: titleSpec.src,
      wrapMode: TextureWrapMode.TWM_CLAMP,
      filterMode: TextureFilterMode.TFM_BILINEAR,
    })
    Material.setBasicMaterial(title, {
      texture: titleTex,
      alphaTexture: titleTex,
      alphaTest: 0.4,
      castShadows: false,
    })
    const sub = add(root, Vector3.create(0, SUB_Y_M, face), Vector3.One())
    TextShape.create(sub, {
      text: '',
      fontSize: SUB_FONT,
      fontSrc: 'Lilita One',
      textColor: ink,
      outlineWidth: 0,
      textWrapping: false,
      width: SUB_BOX_W,
      height: SUB_BOX_H,
    })
    const badgeY = signBadgeY()
    pill(root, SIGN_BADGE_W_M, SIGN_BADGE_H_M, 0.45, Vector3.create(0, badgeY, face + 0.35), plateMat(Color4.create(0.98, 0.97, 0.94, 1)))
    const count = add(root, Vector3.create(0, badgeY, face), Vector3.One())
    TextShape.create(count, {
      text: '0',
      fontSize: COUNT_FONT,
      fontSrc: 'Lilita One',
      textColor: Color4.create(0.1, 0.06, 0.07, 1),
      outlineWidth: 0.06,
      outlineColor: Color4.create(0.98, 0.97, 0.94, 1),
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
      textWrapping: false,
      width: COUNT_BOX_W,
      height: COUNT_BOX_H,
    })
    boards.push({ count })

    // Visual only: stretch each tint inward to the center square's edge (side = tint width)
    // so tiles, square and frames meet flush. Vote detection still uses voteTintPose.
    const raw = voteTintPose(m.cell, MAZE_ORIGIN, CELL)
    const hubC = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
    const off = Math.hypot(raw.x - hubC.x, raw.z - hubC.z)
    const gap = Math.max(0, off - raw.length / 2 - raw.width / 2)
    const ux = (raw.x - hubC.x) / off
    const uz = (raw.z - hubC.z) / off
    void gap // all five tiles are the same square, touching the center one edge to edge
    const len = raw.width + 6 // 6 m longer than the center square, inner edge touching it
    const tint = { ...raw, x: hubC.x + ux * (raw.width + len) / 2, z: hubC.z + uz * (raw.width + len) / 2, length: len }
    const pad = engine.addEntity()
    Transform.create(pad, {
      position: Vector3.create(tint.x, BASE_Y + TINT_TOP - TINT_THICK / 2, tint.z),
      rotation: Quaternion.fromEulerDegrees(0, tint.yawDeg, 0),
      scale: Vector3.create(tint.width, 0.08, tint.length),
    })
    MeshRenderer.setBox(pad)
    Material.setPbrMaterial(pad, zoneMat(pillRgb(m.id), TINT_NORMAL_LIFT))
    spawned.push(pad)
    tints.push(pad)
    tintSize.push(Vector3.create(tint.width, 0.08, tint.length))
    tintSel.push(0)
    tintDim.push(0)
    layTileFrame(tint)
  }
  // White center square at tint height so the corners between the four colour tiles read as one floor.
  // Visual only (the hub's invisible pad already holds players); a hair below the tints so the overlap doesn't flicker.
  const hub = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
  // Side reaches each colour tile's inner edge so the square meets all four.
  const t0 = voteTintPose(LOBBY_TEAMS[0].cell, MAZE_ORIGIN, CELL)
  const hubSide = t0.width // tints are stretched inward to meet this edge
  const center = engine.addEntity()
  Transform.create(center, {
    position: Vector3.create(hub.x, BASE_Y + TINT_TOP - TINT_THICK / 2 - 0.005, hub.z),
    scale: Vector3.create(hubSide, 0.08, hubSide),
  })
  MeshRenderer.setBox(center)
  Material.setPbrMaterial(center, zoneMat({ r: 1, g: 1, b: 1 }, 0))
  spawned.push(center)
  layTileFrame({ x: hub.x, z: hub.z, yawDeg: 0, width: hubSide, length: hubSide })
  syncSignFacing()
}

/** Mobile signs are 1.5x the desktop size, in play and in overview. */
function signWorldScale(): number {
  const zoom = isOverviewActive() ? overviewSignScale() : 1
  // Mobile ortho signs read too small at 1.5x; use 3x there. Play stays 1.5x.
  return zoom * (isMobile() ? (isOverviewActive() ? 3 : 1.5) : 1)
}

function applySignPose(root: Entity): void {
  const bill = Billboard.getMutableOrNull(root)
  const tr = Transform.getMutableOrNull(root)
  if (!tr) return
  if (isOverviewActive()) {
    if (bill && bill.billboardMode !== BillboardMode.BM_NONE) bill.billboardMode = BillboardMode.BM_NONE
    const cam = overviewSignRotation()
    tr.rotation = Quaternion.fromEulerDegrees(cam.pitch, cam.yaw, 0)
    const s = signWorldScale()
    tr.scale = Vector3.create(s, s, s)
    return
  }
  if (bill && bill.billboardMode !== BillboardMode.BM_Y) {
    bill.billboardMode = BillboardMode.BM_Y
    tr.rotation = Quaternion.Identity()
  }
  const play = signWorldScale()
  tr.scale = Vector3.create(play, play, play)
}

let loggedSignScale = Number.NaN

function syncSignFacing(): void {
  const t = Date.now() / 1000
  const scale = signWorldScale()
  for (let i = 0; i < signRoots.length; i++) {
    const root = signRoots[i]
    applySignPose(root)
    const tr = Transform.getMutableOrNull(root)
    if (!tr) continue
    // Each sign is offset in phase so the two do not move in lockstep.
    const bob = Math.sin((t / SIGN_BOB_PERIOD_S) * Math.PI * 2 + i * 2.1) * SIGN_BOB_M * scale
    tr.position = Vector3.create(tr.position.x, signBaseY[i] + bob, tr.position.z)
  }
  const shown = Math.round(signWorldScale() * 100) / 100
  if (shown === loggedSignScale) return
  loggedSignScale = shown
  const where = isOverviewActive() ? `viewScale ${overviewViewScale().toFixed(1)}` : 'play'
  console.log(`[Lobby] sign scale ${shown.toFixed(2)} (${where})`)
}

function refreshSigns(): void {
  const teams = LOBBY_TEAMS
  if (boards.length !== teams.length) return
  for (let i = 0; i < teams.length; i++) {
    const count = TextShape.getMutableOrNull(boards[i].count)
    if (count) count.text = String(voteCount(teams[i].id))
  }
}

/** Unlit black frame around each activation tile. Raised above the tint so all
 *  four sides stay visible from the ground, and wide enough to cover the white
 *  floor seam that showed in the inset around the pad. */
const TILE_FRAME_M = 0.07
const TILE_FRAME_H = 0.024
const TILE_FRAME_SELECTED_MUL = 3
const TILE_FRAME_EASE_S = 0.18
const FRAME_DIM_GREY = 0 // frames stay black; only the color surface fades
function frameMat(dim = 0) {
  const g = FRAME_DIM_GREY * dim
  return { diffuseColor: Color4.create(g, g, g, 1), castShadows: false }
}

function poseTileFrameBars(bars: Entity[], w: number, l: number, bw: number): void {
  const poses = [
    { lx: 0, lz: (l + bw) / 2, sx: w + 2 * bw, sz: bw },
    { lx: 0, lz: -(l + bw) / 2, sx: w + 2 * bw, sz: bw },
    { lx: (w + bw) / 2, lz: 0, sx: bw, sz: l },
    { lx: -(w + bw) / 2, lz: 0, sx: bw, sz: l },
  ]
  for (let i = 0; i < bars.length && i < poses.length; i++) {
    const tr = Transform.getMutableOrNull(bars[i])
    if (!tr) continue
    tr.position = Vector3.create(poses[i].lx, 0, poses[i].lz)
    tr.scale = Vector3.create(poses[i].sx, TILE_FRAME_H, poses[i].sz)
  }
}

function layTileFrame(tint: { x: number; z: number; yawDeg: number; width: number; length: number }): void {
  // Tint box center is BASE_Y+0.58, height 0.08, so its top is +0.04.
  // Sit just above that top so the bars stay visible without floating.
  const y = BASE_Y + TINT_TOP + TILE_FRAME_H / 2 + 0.004
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(tint.x, y, tint.z),
    rotation: Quaternion.fromEulerDegrees(0, tint.yawDeg, 0),
  })
  spawned.push(root)
  const w = tint.width
  const l = tint.length
  const bw = TILE_FRAME_M
  const bars: Entity[] = []
  const addBar = (lx: number, lz: number, sx: number, sz: number) => {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create(lx, 0, lz),
      scale: Vector3.create(sx, TILE_FRAME_H, sz),
    })
    MeshRenderer.setBox(e)
    Material.setBasicMaterial(e, frameMat())
    spawned.push(e)
    bars.push(e)
  }
  addBar(0, (l + bw) / 2, w + 2 * bw, bw)
  addBar(0, -(l + bw) / 2, w + 2 * bw, bw)
  addBar((w + bw) / 2, 0, bw, l)
  addBar(-(w + bw) / 2, 0, bw, l)
  const team = LOBBY_TEAMS.find((m) => {
    const pose = voteTintPose(m.cell, MAZE_ORIGIN, CELL)
    return Math.abs(pose.x - tint.x) < 8 && Math.abs(pose.z - tint.z) < 8
  })
  if (team) tileFrames.set(team.id, { bars, width: w, length: l, ease: 0, dim: 0 })
}

/** Grow the selected tile's frame outward from the inner edge; ease back when deselected. */
function tickTileFrames(dt: number, local: TeamId | ''): void {
  const step = dt / TILE_FRAME_EASE_S
  tileFrames.forEach((frame, id) => {
    const target = local === id ? 1 : 0
    if (frame.ease < target) frame.ease = Math.min(target, frame.ease + step)
    else if (frame.ease > target) frame.ease = Math.max(target, frame.ease - step)
    const u = frame.ease
    const e = u * u * (3 - 2 * u)
    const bw = TILE_FRAME_M * (1 + (TILE_FRAME_SELECTED_MUL - 1) * e)
    poseTileFrameBars(frame.bars, frame.width, frame.length, bw)
    const dimTarget = local && local !== id ? 1 : 0
    if (frame.dim < dimTarget) frame.dim = Math.min(dimTarget, frame.dim + step)
    else if (frame.dim > dimTarget) frame.dim = Math.max(dimTarget, frame.dim - step)
    const d = frame.dim * frame.dim * (3 - 2 * frame.dim)
    const mat = frameMat(d)
    for (const bar of frame.bars) Material.setBasicMaterial(bar, mat)
  })
}

/** Opaque matte slab in the pill colour. Alpha blend over the white floor was washing it out. */
function zoneMat(c: Rgb, lift: number) {
  const mix = (v: number) => v + (1 - v) * lift
  return {
    albedoColor: Color4.create(mix(c.r), mix(c.g), mix(c.b), 1),
    emissiveColor: Color4.create(0, 0, 0, 1),
    emissiveIntensity: 0,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false,
  }
}

/** Selected tile stays full strength; other tiles ease toward a very light tint. */
function tickTints(dt: number, local: TeamId | ''): void {
  const teams = LOBBY_TEAMS
  if (tints.length !== teams.length) return
  if (local && local !== pulsed) { pulsed = local; playUpgradeHoverSfx() }
  if (!local) pulsed = ''
  const step = dt / TINT_EASE_S
  for (let i = 0; i < teams.length; i++) {
    const m = teams[i]
    const tr = Transform.getMutableOrNull(tints[i])
    if (!tr) continue
    tr.scale = tintSize[i]
    const selTarget = local === m.id ? 1 : 0
    const dimTarget = local && local !== m.id ? 1 : 0
    let sel = tintSel[i] ?? 0
    let dim = tintDim[i] ?? 0
    if (sel < selTarget) sel = Math.min(selTarget, sel + step)
    else if (sel > selTarget) sel = Math.max(selTarget, sel - step)
    if (dim < dimTarget) dim = Math.min(dimTarget, dim + step)
    else if (dim > dimTarget) dim = Math.max(dimTarget, dim - step)
    tintSel[i] = sel
    tintDim[i] = dim
    const s = sel * sel * (3 - 2 * sel)
    const d = dim * dim * (3 - 2 * dim)
    const lift = (1 - s) * (TINT_NORMAL_LIFT + (TINT_DIM_LIFT - TINT_NORMAL_LIFT) * d)
    Material.setPbrMaterial(tints[i], zoneMat(pillRgb(m.id), lift))
  }
}

/** Lobby teleports land at a random spot on the white center tile (within the 16 m hub hold pad) so players don't stack. */
const LOBBY_SCATTER_M = 7.5
export function lobbyStand(): { x: number; y: number; z: number } {
  const c = lobbyFeet(CELL, MAZE_ORIGIN, BASE_Y)
  return { x: c.x + (Math.random() * 2 - 1) * LOBBY_SCATTER_M, y: c.y, z: c.z + (Math.random() * 2 - 1) * LOBBY_SCATTER_M }
}

/** Play countdown-tick once at displayed 3, 2, and 1, then countdown-go once at displayed 0. */
let lastLobbyTickSec = -1
let playedLobbyGo = false
function tickLobbyStartSfx(): void {
  if (!inLobby()) {
    lastLobbyTickSec = -1
    playedLobbyGo = false
    return
  }
  const ms = voteDisplayRemainingMs()
  if (ms <= 0 && !isLobbyStarting()) {
    lastLobbyTickSec = -1
    playedLobbyGo = false
    return
  }
  const sec = ms <= 0 ? 0 : Math.ceil(ms / 1000)
  if (sec > 3) {
    lastLobbyTickSec = -1
    playedLobbyGo = false
    return
  }
  if (sec === lastLobbyTickSec) return
  lastLobbyTickSec = sec
  if (sec >= 1 && sec <= 3) playCountdownTick()
  else if (sec === 0 && !playedLobbyGo) {
    playedLobbyGo = true
    playCountdownGo()
  }
}

export function initLobby(): void {
  events.on('lobby:floor', () => {
    laySigns()
    readySent = false
  })
  events.on('round:reset', ({ layout }) => {
    if (layout === 'arena') clearSigns()
    else laySigns()
  })
  events.on('round:clock', () => refreshSigns())

  let posClock = 0
  engine.addSystem((dt: number) => {
    // Signs follow the floor, not the phase. roundReset can swap in the
    // lobby tiles while the clock is still 'match' for a frame; clearing
    // on phase alone then skipped the rebuild and left the boards gone.
    if (isLobbyLayout()) {
      if (tints.length === 0) laySigns()
    } else if (tints.length) {
      clearSigns()
    }
    // Feet reports still follow phase alone. The layout flag used to gate
    // this, so a joiner whose HUD already said VOTE (phase idle) but whose
    // floor was still the arena never sent a sample. The server names the zone.
    if (!inLobby()) return
    tickLobbyStartSfx()
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
    const onFloor = isStandingOnLobbyFloor(p.y, BASE_Y)
    // Tint follows the live stand, not the 2 Hz sample, so a jump clears it immediately.
    const zoneNow = onFloor ? voteTeamIdAt(sceneNow.x, sceneNow.z, MAZE_ORIGIN, CELL) : ''
    tickTints(dt, zoneNow)
    tickTileFrames(dt, zoneNow)
    refreshSigns()
    posClock += dt
    const standChanged = onFloor !== lastSentGrounded || zoneNow !== lastSentZone
    if (posClock < 0.5 && !standChanged) return
    posClock = 0
    lastSentGrounded = onFloor
    lastSentZone = zoneNow
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
  const named = LOBBY_TEAMS.find(m => c && m.cell.x === c.x && m.cell.z === c.z)
  const onFloor = isStandingOnLobbyFloor(lastFeet.y, BASE_Y)
  const standing = onFloor ? voteTeamIdAt(scene.x, scene.z, MAZE_ORIGIN, CELL) : ''
  const zone = standing || (named && onFloor ? named.id : (c ? 'abstain' : 'out'))
  const wire = serverLobbyCounts()
  return `DBG ${isLobbyLayout() ? 'layout' : 'NO-LAYOUT'} raw ${fmt(lastFeet.x)},${fmt(lastFeet.y)},${fmt(lastFeet.z)} scene ${fmt(scene.x)},${fmt(scene.z)} ${scene.frame} cell ${c ? `${c.x},${c.z}` : 'out'} zone ${zone} sent ${sent} fail ${sendFail} noTf ${noTransform} srv ${gamePhase()} clocks ${wire.clocks} present ${wire.present} feet ${wire.feet} red ${voteCount('red')} blue ${voteCount('blue')} srvZone ${wire.zone} why=${wire.why}`
}

export function hudClockText(matchSecs: number): string {
  const phase = gamePhase()
  if (phase === 'match') {
    const m = Math.floor(matchSecs / 60)
    const s = matchSecs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  if (phase === 'summary') return 'END'
  if (phase === 'lobby' || phase === 'idle') {
    const left = phase === 'lobby' ? Math.max(0, Math.ceil(voteDisplayRemainingMs() / 1000)) : 0
    if (left > 0) return hudVoteHeadline(left)
    if (isLobbyStarting()) return LOBBY_STATUS_STARTING
    return hudVoteHeadline(0)
  }
  return 'VOTE'
}

