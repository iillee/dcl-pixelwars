/**
 * overdrive.ts — star-power charge, activation, touch knock, and paint-brush size.
 * Pure logic: the server is the authority; the client and verify script share this.
 */
import {
  OVERDRIVE_TILES, OVERDRIVE_MS, OVERDRIVE_TOUCH_RADIUS, OVERDRIVE_TOUCH_MAX_DY,
  OVERDRIVE_HIT_WINDOW_MS, OVERDRIVE_PAINT_RADIUS_MULT, OVERDRIVE_FEET_STALE_MS,
} from './pvp'

export const PAINT_BRUSH_RADIUS_CELLS = 1

export type OverdriveState = {
  charge: number
  activeUntil: number
}

export function emptyOverdrive(): OverdriveState {
  return { charge: 0, activeUntil: 0 }
}

export function isOverdriveActive(state: OverdriveState, now: number): boolean {
  return state.activeUntil > now
}

export function isOverdriveReady(state: OverdriveState, now: number): boolean {
  return !isOverdriveActive(state, now) && state.charge >= OVERDRIVE_TILES
}

export function overdrivePaintRadiusCells(active: boolean): number {
  const base = PAINT_BRUSH_RADIUS_CELLS
  return active ? Math.max(base, Math.round(base * OVERDRIVE_PAINT_RADIUS_MULT)) : base
}

/** Square brush offsets in world metres, same shape as the default 3x3 (radius 1). */
export function paintBrushOffsets(cellMeters: number, radiusCells: number): Array<[number, number]> {
  const r = Math.max(0, Math.floor(radiusCells))
  const out: Array<[number, number]> = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) out.push([dx * cellMeters, dz * cellMeters])
  }
  return out
}

export function accrueOverdriveCharge(state: OverdriveState, gained: number, now: number): OverdriveState {
  if (gained <= 0) return state
  if (isOverdriveActive(state, now) || isOverdriveReady(state, now)) return state
  return { ...state, charge: Math.min(OVERDRIVE_TILES, state.charge + gained) }
}

/** Death / fall: charge drops to 0 and a running star ends. Painted totals are not this state. */
export function resetOverdriveOnDeath(state: OverdriveState): OverdriveState {
  return emptyOverdrive()
}

export function tryActivateOverdrive(state: OverdriveState, now: number): { ok: boolean; state: OverdriveState } {
  if (!isOverdriveReady(state, now)) return { ok: false, state }
  return { ok: true, state: { charge: 0, activeUntil: now + OVERDRIVE_MS } }
}

export function expireOverdrive(state: OverdriveState, now: number): OverdriveState {
  if (state.activeUntil !== 0 && state.activeUntil <= now) return { charge: 0, activeUntil: 0 }
  return state
}

export function overdriveCanTouch(opts: {
  attacker: string
  victim: string
  attackerTeam: number
  victimTeam: number
  distH: number
  distY: number
  lastHitAt: number
  now: number
  attackerActive: boolean
  victimImmune: boolean
}): boolean {
  if (!opts.attackerActive) return false
  if (opts.victimImmune) return false
  if (!opts.attacker || !opts.victim || opts.attacker === opts.victim) return false
  if (opts.attacker.startsWith('bot:')) return false
  if (opts.attackerTeam === opts.victimTeam) return false
  if (opts.distH > OVERDRIVE_TOUCH_RADIUS || opts.distY > OVERDRIVE_TOUCH_MAX_DY) return false
  if (opts.now - opts.lastHitAt < OVERDRIVE_HIT_WINDOW_MS) return false
  return true
}

export function overdriveTouchDir(ax: number, az: number, vx: number, vz: number): { x: number; z: number } {
  const dx = vx - ax, dz = vz - az
  const len = Math.hypot(dx, dz)
  if (len < 1e-3) return { x: 0, z: 1 }
  return { x: dx / len, z: dz / len }
}

export function overdriveFeetFresh(t: number, now: number): boolean {
  return now - t <= OVERDRIVE_FEET_STALE_MS
}
