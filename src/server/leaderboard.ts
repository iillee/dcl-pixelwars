/**
 * leaderboard.ts — server-side wins leaderboard.
 *
 * Accumulates lifetime round wins per userId (paint cells stay on the
 * row for the paint credit path), persists to Storage on round
 * boundaries, and publishes the top 10 by wins to LeaderboardState.
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
 *   - Publish cadence: round boundary (ROUND_LENGTH_MINUTES) + on-demand via
 *     requestLeaderboard. Keeps steady-state bandwidth negligible.
 */

import { Storage } from '@dcl/sdk/server'
import { LeaderboardState, leaderboardStateEntity } from '../shared/components'
import { hiddenLeaderboardName } from '../shared/leaderboardHide'

// ─── State ──────────────────────────────────────────────────────────
export interface LeaderboardEntry {
  userId: string
  name: string
  cellsPainted: number
  wins: number
}

// Lowercased userId → entry. Lowercase avoids duplicate rows when the
// same address arrives with mixed casing (e.g. checksummed vs not).
const entries = new Map<string, LeaderboardEntry>()
/** In-memory names for the live and end-of-round scoreboards (and Discord).
 *  Kept even when that name is left off the persisted wins board. */
const displayNames = new Map<string, string>()
/** User ids that joined under a hidden display name. Wins must not recreate the row. */
const hiddenIds = new Set<string>()

const STORAGE_KEY = 'leaderboard-v1'
const TOP_N = 10

/** Bots (`bot:<id>`) are live/round scoreboard only. Never store or publish them. */
function isBotId(userId: string): boolean {
  return userId.toLowerCase().startsWith('bot:')
}

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
    let dropped = 0
    for (const e of parsed) {
      if (typeof e?.userId !== 'string') continue
      if (typeof e?.cellsPainted !== 'number' && typeof e?.wins !== 'number') continue
      if (isBotId(e.userId)) continue
      const key = e.userId.toLowerCase()
      const name = typeof e.name === 'string' ? e.name : e.userId.slice(0, 8)
      if (name) displayNames.set(key, name)
      if (hiddenLeaderboardName(name)) {
        hiddenIds.add(key)
        dropped++
        continue
      }
      entries.set(key, {
        userId: key,
        name,
        cellsPainted: typeof e.cellsPainted === 'number' ? Math.max(0, Math.floor(e.cellsPainted)) : 0,
        wins: typeof e.wins === 'number' ? Math.max(0, Math.floor(e.wins)) : 0,
      })
    }
    console.log(`[Leaderboard] loaded ${entries.size} entries from storage`)
    if (dropped > 0) {
      console.log(`[Leaderboard] dropped ${dropped} hidden name(s)`)
      await saveToStorage()
    }
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
    for (const key of [...entries.keys()]) if (isBotId(key)) entries.delete(key)
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
  if (count <= 0 || isBotId(userId)) return
  const key = userId.toLowerCase()
  if (hiddenIds.has(key)) return
  const e = entries.get(key)
  if (e && hiddenLeaderboardName(e.name)) {
    hiddenIds.add(key)
    entries.delete(key)
    return
  }
  if (e) {
    e.cellsPainted += count
  } else {
    entries.set(key, {
      userId: key,
      name: shortAddress(key),
      cellsPainted: count,
      wins: 0,
    })
  }
}

/**
 * Capture a player's display name. Client sends this once on join with
 * their avatar name (or falls back to a short address). The name is
 * always kept for the live and end-of-round scoreboards. A hidden name
 * is left off the persisted wins board and is not recreated later.
 */
export function updateName(userId: string, name: string): void {
  if (!name || typeof name !== 'string' || isBotId(userId)) return
  const key = userId.toLowerCase()
  const trimmed = name.slice(0, 32)  // display cap
  displayNames.set(key, trimmed)
  if (hiddenLeaderboardName(trimmed)) {
    hiddenIds.add(key)
    if (entries.delete(key)) publish()
    return
  }
  if (hiddenIds.has(key)) return
  const e = entries.get(key)
  if (e) {
    if (e.name !== trimmed) {
      e.name = trimmed
    }
  } else {
    entries.set(key, { userId: key, name: trimmed, cellsPainted: 0, wins: 0 })
  }
}

/** One round win. Bots never get a row. A missing name falls back to a short address. */
export function recordWin(userId: string): void {
  if (!userId || isBotId(userId)) return
  const key = userId.toLowerCase()
  if (hiddenIds.has(key)) return
  const e = entries.get(key)
  if (e && hiddenLeaderboardName(e.name)) {
    hiddenIds.add(key)
    entries.delete(key)
    return
  }
  if (e) e.wins += 1
  else entries.set(key, { userId: key, name: shortAddress(key), cellsPainted: 0, wins: 1 })
}

// ─── Queries ────────────────────────────────────────────────────────

/** Display name for live/round scoreboards and Discord, or null if unknown. */
export function getName(userId: string): string | null {
  const key = userId.toLowerCase()
  const n = displayNames.get(key) ?? entries.get(key)?.name ?? null
  return n && !n.startsWith('0x') && !n.includes('…') ? n : null
}

/** Top players who have at least one win, highest first. Hidden names stay off this board. */
export function getTopN(n: number = TOP_N): LeaderboardEntry[] {
  return [...entries.values()]
    .filter(e => !isBotId(e.userId) && e.wins > 0 && !hiddenIds.has(e.userId) && !hiddenLeaderboardName(e.name))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
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
