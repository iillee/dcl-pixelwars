/**
 * discord.ts — server-side Discord webhook notifier.
 *
 * Fires a message to the configured Discord webhook when a player joins
 * the scene. Modeled on flagtag/src/server/analytics.ts but trimmed to
 * the minimum viable set:
 *   - Env-var webhook (never hardcoded — scene bundles are public).
 *   - Preview-realm suppression (no spam during local testing).
 *   - Debounced send (5s delay) so the player's real name has time to
 *     resolve via updateName before we fire. Falls back to short address
 *     after MAX_WAIT_MS if the name never arrives.
 *   - Joins that arrive before getRealm / EnvVar.get finish stay queued.
 *     They are sent once init reaches 'ready', or dropped with a log if
 *     the realm is a preview or the webhook is missing.
 *   - allowed_mentions.parse = [] so a player named "@everyone" can't
 *     ping the whole Discord server.
 *
 * Setup:
 *   Local dev:  put DISCORD_PLAYER_JOIN_WEBHOOK=... in .env (gitignored).
 *   Production: npx sdk-commands deploy-env DISCORD_PLAYER_JOIN_WEBHOOK --value "..."
 */

import { EnvVar } from '@dcl/sdk/server'
import { getRealm } from '~system/Runtime'

// ─── Module state ───────────────────────────────────────────────────
let webhookUrl = ''
let isPreview = false
/** 'pending' until getRealm + EnvVar.get settle. Joins that arrive early stay queued. */
let phase: 'pending' | 'ready' | 'off' = 'pending'
const NAME_RESOLVE_DELAY_MS = 5000
const NAME_RESOLVE_MAX_WAIT_MS = 15000
/** A hung realm probe must not keep the webhook from loading. Same outcome as a thrown getRealm: assume production. */
const REALM_TIMEOUT_MS = 5000
/** Server-side storage. A hang is logged and pings stay off; join handling does not wait on this. */
const ENV_TIMEOUT_MS = 8000

// userId (lowercase) → pending notification. Named players are pushed as
// soon as their name is available (via notifyNameResolved); everyone else
// falls back to short-address after MAX_WAIT elapses.
interface Pending {
  address: string
  scheduledAt: number
}
const pending = new Map<string, Pending>()

// Player-name directory shared with leaderboard.ts. Wired here rather
// than imported to avoid coupling — server.ts injects it via
// `bindNameResolver`.
let resolveName: (userId: string) => string | null = () => null
export function bindNameResolver(fn: (userId: string) => string | null): void {
  resolveName = fn
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

function turnOff(reason: string): void {
  phase = 'off'
  const queued = pending.size
  pending.clear()
  console.log(`[Discord] init failed (${reason}${queued ? `, dropped ${queued} queued join(s)` : ''})`)
}

// ─── Boot: load webhook + realm mode ────────────────────────────────
export async function initDiscord(): Promise<void> {
  console.log('[Discord] init started')
  try {
    const realm = await withTimeout(getRealm({}), REALM_TIMEOUT_MS, 'getRealm')
    isPreview = realm.realmInfo?.isPreview ?? false
  } catch (err) {
    isPreview = false
    console.log(`[Discord] realm probe failed (${err}) — assuming production`)
  }

  let loaded = ''
  try {
    loaded = (await withTimeout(EnvVar.get('DISCORD_PLAYER_JOIN_WEBHOOK'), ENV_TIMEOUT_MS, 'EnvVar.get')) || ''
  } catch (err) {
    turnOff(`EnvVar.get DISCORD_PLAYER_JOIN_WEBHOOK: ${err}`)
    return
  }
  webhookUrl = loaded
  if (isPreview) {
    phase = 'off'
    const queued = pending.size
    pending.clear()
    console.log(`[Discord] init ok (preview realm, pings off${queued ? `, dropped ${queued} queued join(s)` : ''})`)
    return
  }
  if (!webhookUrl) {
    turnOff('no DISCORD_PLAYER_JOIN_WEBHOOK')
    return
  }
  const hostMatch = /^https?:\/\/([^/?#]+)/i.exec(webhookUrl)
  const host = hostMatch ? (hostMatch[1].split('@').pop() || 'unparsed') : 'unparsed'
  phase = 'ready'
  console.log(`[Discord] init ok (webhook loaded, host ${host}, ${pending.size} join(s) queued)`)
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Schedule a join notification. Called from the roster/join handler.
 * Idempotent per userId — repeated calls just refresh the pending timer.
 * A join before init finishes is queued. A join after init decided pings
 * are off (preview, or no webhook) is skipped.
 */
export function schedulePlayerJoin(userId: string): void {
  if (phase === 'off') {
    console.log(`[Discord] join skipped (${shortAddress(userId)}, pings off)`)
    return
  }
  const key = userId.toLowerCase()
  pending.set(key, { address: userId, scheduledAt: Date.now() })
  if (phase === 'pending') console.log(`[Discord] join queued (${shortAddress(userId)}, init pending)`)
}

/**
 * Drain any pending notifications whose delay has elapsed. Called from a
 * low-frequency server system (every 1s is plenty — the delay is 5s).
 * Fires with the resolved display name when available, or short address
 * after MAX_WAIT.
 */
export function flushPendingJoins(): void {
  if (phase !== 'ready' || pending.size === 0) return
  const now = Date.now()
  for (const [key, p] of pending) {
    const age = now - p.scheduledAt
    if (age < NAME_RESOLVE_DELAY_MS) continue
    const resolved = resolveName(key)
    const timedOut = age >= NAME_RESOLVE_MAX_WAIT_MS
    if (!resolved && !timedOut) continue  // keep waiting

    pending.delete(key)
    const name = resolved || shortAddress(p.address)
    void sendDiscord(name, p.address)
  }
}

// ─── Discord send ───────────────────────────────────────────────────

async function sendDiscord(name: string, address: string): Promise<void> {
  const content = `👋 **${name}** joined Pixelwars (\`${shortAddress(address)}\`)`
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // allowed_mentions: names are player-supplied — a player named
      // "@everyone" must never ping the whole Discord server.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 120)
      console.log(`[Discord] ping failed (${res.status}${detail ? ` ${detail}` : ''})`)
      return
    }
    console.log(`[Discord] ping sent (${res.status})`)
  } catch (err) {
    console.log(`[Discord] ping failed (${err})`)
  }
}

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
