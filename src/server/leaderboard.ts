/**
 * leaderboard.ts — server-side top-painters leaderboard.
 *
 * Accumulates lifetime cells-painted counts per userId, persists to
 * Storage on round boundaries, and publishes the top-N to a synced
 * component (LeaderboardState) that clients read for the popup UI.
 *
 * Design choices (vs flagtag's leaderboard.ts, which we lightly
 * referenced):
 *   - Single all-time board only. No daily/weekly split — add later
 *     if the game needs seasonal reset.
 *   - Safe parsing (?? []). No strict-recovery path — if the persisted
 *     blob is malformed we log + start fresh. Simpler; acceptable
 *     since paint counts are cumulative and eventually re-earned.
 *   - No serialized mutation queue. Server is single-threaded and only
 *     mutates on paintTick / roundReset — no async races to defend.
 *   - Publish cadence: round boundary (5 min) + on-demand via
 *     requestLeaderboard. Keeps steady-state bandwidth negligible.
 */

import { Storage } from '@dcl/sdk/server'
import { LeaderboardState, leaderboardStateEntity } from '../shared/components'

// ─── State ──────────────────────────────────────────────────────────
export interface LeaderboardEntry {
  userId: string
  name: string
  cellsPainted: number
}

// Lowercased userId → entry. Lowercase avoids duplicate rows when the
// same address arrives with mixed casing (e.g. checksummed vs not).
const entries = new Map<string, LeaderboardEntry>()

const STORAGE_KEY = 'leaderboard-v1'
const TOP_N = 20  // synced payload size cap — keep the broadcast small

// ─── Persistence ────────────────────────────────────────────────────

/** Load persisted leaderboard on server boot. Safe on parse errors. */
export async function loadFromStorage(): Promise<void> {
  try {
    const raw = await Storage.get<string>(STORAGE_KEY)
    if (!raw) {
      console.log('[Leaderboard] no persisted data — starting fresh')
      publish()
      return
    }
    const parsed: LeaderboardEntry[] = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    entries.clear()
    for (const e of parsed) {
      if (typeof e?.userId !== 'string' || typeof e?.cellsPainted !== 'number') continue
      entries.set(e.userId.toLowerCase(), {
        userId: e.userId.toLowerCase(),
        name: typeof e.name === 'string' ? e.name : e.userId.slice(0, 8),
        cellsPainted: Math.max(0, Math.floor(e.cellsPainted)),
      })
    }
    console.log(`[Leaderboard] loaded ${entries.size} entries from storage`)
    publish()
  } catch (err) {
    console.log(`[Leaderboard] load failed (${err}) — starting fresh`)
    entries.clear()
    publish()
  }
}

/** Persist current state. Called on round boundaries. */
export async function saveToStorage(): Promise<void> {
  try {
    const arr = [...entries.values()]
    await Storage.set(STORAGE_KEY, JSON.stringify(arr))
    console.log(`[Leaderboard] persisted ${arr.length} entries`)
  } catch (err) {
    console.log(`[Leaderboard] save failed: ${err}`)
  }
}

// ─── Mutations ──────────────────────────────────────────────────────

/**
 * Increment cellsPainted for a player. Called from the paintTick handler
 * with the number of ids applied this tick. Idempotent per-tick since
 * server dedupes cell writes at the paint layer (last-write-wins).
 */
export function incrementPaint(userId: string, count: number): void {
  if (count <= 0) return
  const key = userId.toLowerCase()
  const e = entries.get(key)
  if (e) {
    e.cellsPainted += count
  } else {
    entries.set(key, {
      userId: key,
      name: shortAddress(key),
      cellsPainted: count,
    })
  }
}

/**
 * Update a player's display name. Client sends this once on join with
 * their PlayerIdentityData.name (or falls back to short address).
 * Creates an empty row if the player hasn't painted anything yet so
 * name capture always succeeds regardless of ordering.
 */
export function updateName(userId: string, name: string): void {
  if (!name || typeof name !== 'string') return
  const key = userId.toLowerCase()
  const trimmed = name.slice(0, 32)  // display cap
  const e = entries.get(key)
  if (e) {
    if (e.name !== trimmed) {
      e.name = trimmed
    }
  } else {
    entries.set(key, { userId: key, name: trimmed, cellsPainted: 0 })
  }
}

// ─── Queries ────────────────────────────────────────────────────────

/** Lookup a player's display name, or null if unknown / unset. Shared with the Discord notifier. */
export function getName(userId: string): string | null {
  const e = entries.get(userId.toLowerCase())
  return e && e.name && !e.name.startsWith('0x') && !e.name.includes('…') ? e.name : null
}

/** Top-N entries sorted by cellsPainted desc. Used for publish + on-demand replies. */
export function getTopN(n: number = TOP_N): LeaderboardEntry[] {
  return [...entries.values()]
    .sort((a, b) => b.cellsPainted - a.cellsPainted)
    .slice(0, n)
}

// ─── Publish to CRDT-synced component ───────────────────────────────

/**
 * Push top-N to LeaderboardState so all connected clients pick it up.
 * Called on boot (after load) and on every round boundary.
 */
export function publish(): void {
  const top = getTopN()
  LeaderboardState.createOrReplace(leaderboardStateEntity, {
    json: JSON.stringify(top),
  })
}

// ─── Helpers ────────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
