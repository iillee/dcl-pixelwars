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

const READY_NOTICE_MS = 1800
const SELECT_NOTICE_MS = 1400
const FLASH_MS = 450
const HIGHLIGHT_MS = 380

let state: UpgradeState = emptyUpgrade()
let cardsOpen = false
let highlightKind: UpgradeKind | null = null
let highlightUntil = 0
let notice = ''
let noticeUntil = 0
let flashUntil = 0
let wired = false

function applyModifiers(): void {
  setUpgradeSpeedMult(speedMoveMult(state.speed))
}

function resetLocal(): void {
  state = emptyUpgrade()
  cardsOpen = false
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
    flashUntil = Date.now() + FLASH_MS
    notice = 'UPGRADE READY!'
    noticeUntil = Date.now() + READY_NOTICE_MS
    playUpgradeReadySfx()
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
    if (highlightKind && now >= highlightUntil) {
      highlightKind = null
      if (!state.pending) cardsOpen = false
    }
    if (notice && now >= noticeUntil) notice = ''
    if (inLobby() || !state.pending) {
      // Keys 1/2/3 only apply while the overlay is open.
    }
    if (!cardsOpen) return
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
  return cardsOpen
}

export function openUpgradeCards(): void {
  if (!state.pending) return
  cardsOpen = true
  playUiClick()
}

export function closeUpgradeCards(): void {
  if (!cardsOpen) return
  cardsOpen = false
  playUiClick()
}

export function toggleUpgradeCards(): void {
  if (cardsOpen) closeUpgradeCards()
  else openUpgradeCards()
}

export function requestUpgradeSelect(kind: UpgradeKind): void {
  if (!cardsOpen || !state.pending) return
  const preview = trySelectUpgrade(state, kind)
  if (!preview.ok) return
  highlightKind = kind
  notice = UPGRADE_LABEL[kind]
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
  highlight: UpgradeKind | null
  notice: string
  flash: boolean
}

export function getUpgradeHud(): UpgradeHud {
  const now = Date.now()
  const progress = upgradeProgress(state)
  return {
    show: !inLobby(),
    paintedOk: true,
    pending: state.pending,
    maxed: progress.mode === 'max',
    progress,
    speed: state.speed,
    paint: state.paint,
    haste: state.haste,
    cardsOpen,
    highlight: highlightKind && now < highlightUntil ? highlightKind : null,
    notice: now < noticeUntil ? notice : '',
    flash: now < flashUntil,
  }
}

/** Used by verify and by UI that needs a full local copy. */
export function localUpgradeState(): UpgradeState {
  return { ...state }
}

export { upgradeKindFromId }
