/**
 * upgrades.ts — paint-earned, round-long upgrade progression (Overdrive V2).
 * Pure logic: the server is the authority; the client and verify script share this.
 *
 * Charge is separate from the personal tiles-painted total. Thresholds are
 * cumulative. One selection can be pending at a time. Buffs last until the
 * round resets and survive death / rescue / respawn.
 */
import {
  BURST_PAINT_RADIUS_CELLS,
  UPGRADE_CHARGE_ENEMY, UPGRADE_CHARGE_FRIENDLY, UPGRADE_CHARGE_NEUTRAL,
  UPGRADE_HASTE_REDUCTION, UPGRADE_LEVEL_MAX, UPGRADE_MAX,
  UPGRADE_PAINT_AREA_BONUS, UPGRADE_SPEED_BONUS, UPGRADE_THRESHOLDS,
} from './pvp'

export { UPGRADE_LEVEL_MAX, UPGRADE_MAX, UPGRADE_THRESHOLDS } from './pvp'

export const UPGRADE_KINDS = ['speed', 'paint', 'haste'] as const
export type UpgradeKind = typeof UPGRADE_KINDS[number]

export type UpgradeState = {
  charge: number
  earned: number
  pending: boolean
  speed: number
  paint: number
  haste: number
}

export type UpgradeProgress = {
  fill: number
  mode: 'charging' | 'ready' | 'max'
  prev: number
  next: number | null
  charge: number
}

export const UPGRADE_KIND_ID: Record<UpgradeKind, number> = { speed: 1, paint: 2, haste: 3 }

export function upgradeKindFromId(id: number): UpgradeKind | null {
  if (id === 1) return 'speed'
  if (id === 2) return 'paint'
  if (id === 3) return 'haste'
  return null
}

export function emptyUpgrade(): UpgradeState {
  return { charge: 0, earned: 0, pending: false, speed: 0, paint: 0, haste: 0 }
}

/** Neutral +1, enemy +2, friendly 0. `prevTeam` 0 is unpainted. */
export function upgradeChargeFor(prevTeam: number, newTeam: number): number {
  if (prevTeam === newTeam) return UPGRADE_CHARGE_FRIENDLY
  if (!prevTeam) return UPGRADE_CHARGE_NEUTRAL
  return UPGRADE_CHARGE_ENEMY
}

/** Personal paint score: +1 for a neutral or enemy flip, 0 for friendly. */
export function paintedScoreFor(prevTeam: number, newTeam: number): number {
  return prevTeam === newTeam ? 0 : 1
}

/** How many upgrades this charge total has unlocked, capped at UPGRADE_MAX. */
export function unlockedUpgradeCount(charge: number): number {
  let n = 0
  for (const t of UPGRADE_THRESHOLDS) {
    if (charge >= t) n++
    else break
  }
  return Math.min(n, UPGRADE_MAX)
}

/** How many picks are waiting. 0 when nothing is pending. */
export function pendingUpgradeCount(state: UpgradeState): number {
  if (!state.pending) return 0
  return Math.max(1, unlockedUpgradeCount(state.charge) - state.earned)
}

/** Cards still below level III, in SPEED / PAINT / HASTE order. */
export function offeredUpgradeKinds(state: UpgradeState): UpgradeKind[] {
  return UPGRADE_KINDS.filter((kind) => state[kind] < UPGRADE_LEVEL_MAX)
}

/**
 * Falling off the level clears buffs and any pending pick, but keeps charge.
 * `earned` is raised to the number of thresholds already crossed so those
 * unlocks stay spent. The next offer is the next 500 above current charge.
 */
export function stripUpgradesOnFall(state: UpgradeState): UpgradeState {
  const earned = Math.max(state.earned, unlockedUpgradeCount(state.charge))
  return { charge: state.charge, earned, pending: false, speed: 0, paint: 0, haste: 0 }
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(UPGRADE_LEVEL_MAX, Math.floor(n))
}

export function accrueUpgradeCharge(state: UpgradeState, gained: number): UpgradeState {
  if (gained <= 0) return state
  const charge = state.charge + gained
  if (state.earned >= UPGRADE_MAX || offeredUpgradeKinds(state).length === 0) {
    return { ...state, charge, pending: false }
  }
  const pending = state.pending || (unlockedUpgradeCount(charge) > state.earned)
  return { ...state, charge, pending }
}

export function trySelectUpgrade(state: UpgradeState, kind: UpgradeKind): { ok: boolean; state: UpgradeState } {
  if (!state.pending || state.earned >= UPGRADE_MAX) return { ok: false, state }
  if (!UPGRADE_KINDS.includes(kind)) return { ok: false, state }
  const cur = state[kind]
  if (cur >= UPGRADE_LEVEL_MAX) return { ok: false, state }
  const next: UpgradeState = {
    ...state,
    [kind]: cur + 1,
    earned: state.earned + 1,
    pending: false,
  }
  if (
    next.earned < UPGRADE_MAX
    && offeredUpgradeKinds(next).length > 0
    && unlockedUpgradeCount(next.charge) > next.earned
  ) {
    next.pending = true
  }
  return { ok: true, state: next }
}

export function upgradeProgress(state: UpgradeState): UpgradeProgress {
  const charge = state.charge
  if (state.earned >= UPGRADE_MAX && !state.pending) {
    const last = UPGRADE_THRESHOLDS[UPGRADE_THRESHOLDS.length - 1]
    return { fill: 1, mode: 'max', prev: last, next: null, charge }
  }
  if (state.pending) {
    const idx = Math.min(state.earned, UPGRADE_THRESHOLDS.length - 1)
    const next = UPGRADE_THRESHOLDS[idx]
    const prev = idx === 0 ? 0 : UPGRADE_THRESHOLDS[idx - 1]
    return { fill: 1, mode: 'ready', prev, next, charge }
  }
  const idx = Math.min(state.earned, UPGRADE_THRESHOLDS.length - 1)
  const next = UPGRADE_THRESHOLDS[idx]
  const prev = idx === 0 ? 0 : UPGRADE_THRESHOLDS[idx - 1]
  const span = Math.max(1, next - prev)
  const fill = Math.max(0, Math.min(1, (charge - prev) / span))
  return { fill, mode: 'charging', prev, next, charge }
}

export function speedMoveMult(level: number): number {
  return 1 + (UPGRADE_SPEED_BONUS[clampLevel(level)] ?? 0)
}

export function paintAreaMult(level: number): number {
  return 1 + (UPGRADE_PAINT_AREA_BONUS[clampLevel(level)] ?? 0)
}

/** Multiplier applied to Dash / Burst cooldown duration on future activations. */
export function hasteCooldownMult(level: number): number {
  return Math.max(0.01, 1 - (UPGRADE_HASTE_REDUCTION[clampLevel(level)] ?? 0))
}

/**
 * Burst paint radius in cells for a given Paint level.
 * Area scales with r², so a +20% area bonus is sqrt(1.20) on the radius
 * (a +20% radius would overshoot by much more). Fractional values are OK:
 * burstFootprint already tests cell centres against r * cell metres.
 */
export function burstPaintRadiusCellsFor(level: number): number {
  return BURST_PAINT_RADIUS_CELLS * Math.sqrt(paintAreaMult(level))
}

/**
 * Movement / dash-trail brush offsets whose tile count is close to
 * 9 * areaMult. 3×3 is the base (9 tiles). Extra tiles are added from a
 * fixed cardinal ring so the footprint stays compact:
 *   +20% → 11 tiles (3×3 + N/S)
 *   +35% → 13 tiles (3×3 + N/E/S/W, 1 tile over a 12-tile target;
 *                    a 12th tile would be lopsided)
 *   +45% → 13 tiles (exact)
 */
export function upgradePaintTileCount(areaMult: number): number {
  const target = Math.max(9, Math.round(9 * areaMult))
  if (target >= 12) return 13
  if (target >= 11) return 11
  return 9
}

export function upgradePaintBrushOffsets(cellMeters: number, areaMult: number): Array<[number, number]> {
  const target = upgradePaintTileCount(areaMult)
  const cells: Array<[number, number]> = []
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) cells.push([dx, dz])
  }
  // North/south first (11), then east/west (13). Always added as opposite pairs.
  const extras: Array<[number, number]> = [[0, -2], [0, 2], [2, 0], [-2, 0]]
  for (const [dx, dz] of extras) {
    if (cells.length >= target) break
    cells.push([dx, dz])
  }
  return cells.map(([dx, dz]) => [dx * cellMeters, dz * cellMeters])
}

export function bonusPct(kind: UpgradeKind, level: number): number {
  const lv = clampLevel(level)
  if (kind === 'speed') return Math.round((UPGRADE_SPEED_BONUS[lv] ?? 0) * 100)
  if (kind === 'paint') return Math.round((UPGRADE_PAINT_AREA_BONUS[lv] ?? 0) * 100)
  return Math.round((UPGRADE_HASTE_REDUCTION[lv] ?? 0) * 100)
}

export const UPGRADE_LABEL: Record<UpgradeKind, string> = {
  speed: 'SPEED',
  paint: 'PAINT',
  haste: 'HASTE',
}

export const UPGRADE_DESCRIPTION: Record<UpgradeKind, string> = {
  speed: 'Faster jogging and running.',
  paint: 'Wider movement, Dash, and Burst paint.',
  haste: 'Shorter Dash and Burst cooldowns.',
}

export const UPGRADE_BONUS_UNIT: Record<UpgradeKind, string> = {
  speed: 'movement speed',
  paint: 'paint area',
  haste: 'cooldowns',
}

/** One-line offer for the card picker, e.g. "+15% movement speed". */
export function upgradeOfferLine(kind: UpgradeKind, currentLevel: number): string {
  const maxed = currentLevel >= UPGRADE_LEVEL_MAX
  const shown = maxed ? currentLevel : Math.min(UPGRADE_LEVEL_MAX, currentLevel + 1)
  const pct = bonusPct(kind, shown)
  const sign = kind === 'haste' ? '−' : '+'
  return `${sign}${pct}% ${UPGRADE_BONUS_UNIT[kind]}`
}

/** Flat black-and-white silhouettes used on the coloured upgrade cards and HUD buff tiles. */
export const UPGRADE_CARD_ICON_SRC: Record<UpgradeKind, string> = {
  speed: 'assets/images/ui/upgrade-card-speed.png',
  paint: 'assets/images/ui/upgrade-card-paint.png',
  haste: 'assets/images/ui/upgrade-card-haste.png',
}

export const UPGRADE_ROMAN = ['', 'I', 'II', 'III'] as const
