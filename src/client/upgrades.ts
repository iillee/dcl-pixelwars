/**
 * upgrades.ts — client mirror of server-authoritative round upgrades.
 * The server owns charge, pending selections, levels, and modifiers.
 * This module applies those levels to speed / paint / haste and drives
 * the HUD + card-overlay controls.
 */
import { engine, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { events } from '../shared/events'
import { room } from '../shared/messages'
import {
  emptyUpgrade, hasteCooldownMult, paintAreaMult, speedMoveMult, burstPaintRadiusCellsFor,
  trySelectUpgrade, upgradeKindFromId, upgradeProgress, UPGRADE_KIND_ID, UPGRADE_LABEL,
  type UpgradeKind, type UpgradeState, type UpgradeProgress,
} from '../shared/upgrades'
import { playUiClick, playUpgradeReadySfx } from './audio'
import { setUpgradeSpeedMult } from './speed'
import { inLobby } from './phase'
import {
  CARD_AUTO_MS, CARD_POP_MS, autoOpenDelayMs, autoTimerFrac, cardPopScale, cardSlidePx,
} from '../shared/upgradeCards'

const READY_NOTICE_MS = 1800
const SELECT_NOTICE_MS = 1400
export const FLASH_MS = 450
const HIGHLIGHT_MS = 380

let state: UpgradeState = emptyUpgrade()
let cardsOpen = false
let autoOpen = false
let closing = false
let openAt = 0
let closeAt = 0
let autoUntil = 0
let reopenAt = 0
let highlightKind: UpgradeKind | null = null
let highlightUntil = 0
let notice = ''
let noticeUntil = 0
let flashUntil = 0
let wired = false

function beginOpen(now: number, auto: boolean, playClick: boolean): void {
  cardsOpen = true
  closing = false
  autoOpen = auto
  openAt = now
  closeAt = 0
  autoUntil = auto ? now + CARD_AUTO_MS : 0
  if (playClick) playUiClick()
}

function beginClose(now: number, playClick: boolean): void {
  if (!cardsOpen || closing) {
    if (playClick && cardsOpen) playUiClick()
    return
  }
  closing = true
  closeAt = now
  autoOpen = false
  autoUntil = 0
  if (playClick) playUiClick()
}

function clusterVisible(now: number = Date.now()): boolean {
  if (closing) return now < closeAt + CARD_POP_MS
  return cardsOpen
}

function applyModifiers(): void {
  setUpgradeSpeedMult(speedMoveMult(state.speed))
}

function resetLocal(): void {
  state = emptyUpgrade()
  cardsOpen = false
  autoOpen = false
  closing = false
  openAt = 0
  closeAt = 0
  autoUntil = 0
  reopenAt = 0
  highlightKind = null
  highlightUntil = 0
  notice = ''
  noticeUntil = 0
  flashUntil = 0
  applyModifiers()
}

function setState(next: UpgradeState): void {
  const wasPending = state.pending
  const wasEarned = state.earned
  const justPicked = next.earned > wasEarned
  // A select that immediately unlocks the next threshold also counts as READY.
  const becameReady = next.pending && (!wasPending || justPicked)
  state = next
  applyModifiers()
  if (becameReady) {
    const now = Date.now()
    flashUntil = now + FLASH_MS
    notice = 'UPGRADE READY!'
    noticeUntil = now + READY_NOTICE_MS
    playUpgradeReadySfx()
    const delay = autoOpenDelayMs(justPicked)
    if (delay > 0) {
      reopenAt = now + delay
    } else if (!clusterVisible(now) && !inLobby()) {
      beginOpen(now, true, false)
    }
  }
  if (justPicked) {
    // Confirm SFX / name are triggered in requestUpgradeSelect so a
    // server echo does not play them twice. Keep the highlight window.
    highlightUntil = Math.max(highlightUntil, Date.now() + HIGHLIGHT_MS)
  }
}

export function initUpgrades(): void {
  if (wired) return
  wired = true
  events.on('upgrade:state', (s) => {
    const next: UpgradeState = {
      charge: Math.max(0, Math.floor(s.charge || 0)),
      pending: !!s.pending,
      earned: Math.max(0, Math.floor(s.earned || 0)),
      speed: Math.max(0, Math.floor(s.speed || 0)),
      paint: Math.max(0, Math.floor(s.paint || 0)),
      haste: Math.max(0, Math.floor(s.haste || 0)),
    }
    setState(next)
  })
  events.on('round:reset', () => resetLocal())
  events.on('lobby:floor', () => resetLocal())
  engine.addSystem(() => {
    const now = Date.now()
    if (highlightKind && now >= highlightUntil) highlightKind = null
    if (notice && now >= noticeUntil) notice = ''
    if (closing && now >= closeAt + CARD_POP_MS) {
      cardsOpen = false
      closing = false
    }
    if (reopenAt && now >= reopenAt) {
      if (clusterVisible(now)) {
        // Wait out the close motion, then open.
      } else {
        reopenAt = 0
        if (state.pending && !inLobby()) beginOpen(now, true, false)
      }
    }
    if (cardsOpen && !closing && autoOpen && now >= autoUntil) beginClose(now, false)
    if (inLobby() || !clusterVisible(now)) return
    if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) requestUpgradeSelect('speed')
    else if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) requestUpgradeSelect('paint')
    else if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) requestUpgradeSelect('haste')
  })
}

export function localPaintAreaMult(): number {
  return paintAreaMult(state.paint)
}

export function localBurstPaintRadiusCells(): number {
  return burstPaintRadiusCellsFor(state.paint)
}

export function localHasteCooldownMult(): number {
  return hasteCooldownMult(state.haste)
}

export function localPaintLevel(): number {
  return state.paint
}

export function isUpgradeCardsOpen(): boolean {
  return clusterVisible()
}

export function openUpgradeCards(): void {
  if (!state.pending) return
  const now = Date.now()
  reopenAt = 0
  if (clusterVisible(now) && !closing) {
    // Already showing — a tap on the pill just cancels the auto-dismiss timer.
    autoOpen = false
    autoUntil = 0
    playUiClick()
    return
  }
  beginOpen(now, false, true)
}

export function closeUpgradeCards(): void {
  beginClose(Date.now(), true)
}

export function toggleUpgradeCards(): void {
  if (cardsOpen) closeUpgradeCards()
  else openUpgradeCards()
}

export function requestUpgradeSelect(kind: UpgradeKind): void {
  if (!clusterVisible() || !state.pending) return
  const preview = trySelectUpgrade(state, kind)
  if (!preview.ok) return
  const now = Date.now()
  highlightKind = kind
  highlightUntil = now + HIGHLIGHT_MS
  notice = UPGRADE_LABEL[kind]
  noticeUntil = now + SELECT_NOTICE_MS
  playUiClick()
  beginClose(now, false)
  try { room.send('upgradeSelect', { kind: UPGRADE_KIND_ID[kind] }) } catch (err) {
    console.log('[Upgrade] select send failed', err)
  }
}

export type UpgradeHud = {
  show: boolean
  paintedOk: boolean
  pending: boolean
  maxed: boolean
  progress: UpgradeProgress
  speed: number
  paint: number
  haste: number
  cardsOpen: boolean
  /** True while the cluster is up or playing its close motion. */
  clusterVisible: boolean
  autoOpen: boolean
  /** Remaining auto-dismiss time, 1 → 0. 0 when the timer is off. */
  autoFrac: number
  popScale: number
  popSlide: number
  highlight: UpgradeKind | null
  notice: string
  flash: boolean
  /** When the ready-flash ends and the scale pulse may start (ms). */
  flashUntil: number
}

export function getUpgradeHud(): UpgradeHud {
  const now = Date.now()
  const progress = upgradeProgress(state)
  const visible = clusterVisible(now)
  const elapsed = closing ? now - closeAt : now - openAt
  return {
    show: !inLobby(),
    paintedOk: true,
    pending: state.pending,
    maxed: progress.mode === 'max',
    progress,
    speed: state.speed,
    paint: state.paint,
    haste: state.haste,
    cardsOpen: visible,
    clusterVisible: visible,
    autoOpen: autoOpen && visible && !closing,
    autoFrac: autoOpen && visible && !closing ? autoTimerFrac(now, autoUntil) : 0,
    popScale: visible ? cardPopScale(elapsed, closing) : 1,
    popSlide: visible ? cardSlidePx(elapsed, closing) : 0,
    highlight: highlightKind && now < highlightUntil ? highlightKind : null,
    notice: now < noticeUntil ? notice : '',
    flash: now < flashUntil,
    flashUntil,
  }
}

/** Used by verify and by UI that needs a full local copy. */
export function localUpgradeState(): UpgradeState {
  return { ...state }
}

export { upgradeKindFromId }
