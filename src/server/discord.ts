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
const NAME_RESOLVE_DELAY_MS = 5000
const NAME_RESOLVE_MAX_WAIT_MS = 15000

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

// ─── Boot: load webhook + realm mode ────────────────────────────────
export async function initDiscord(): Promise<void> {
  try {
    const realm = await getRealm({})
    isPreview = realm.realmInfo?.isPreview ?? false
    if (isPreview) {
      console.log('[Discord] preview realm detected — join notifications disabled')
    }
  } catch (err) {
    console.log(`[Discord] realm probe failed (${err}) — assuming production`)
  }

  webhookUrl = (await EnvVar.get('DISCORD_PLAYER_JOIN_WEBHOOK')) || ''
  if (webhookUrl) {
    console.log('[Discord] webhook loaded from env')
  } else {
    console.log('[Discord] no DISCORD_PLAYER_JOIN_WEBHOOK set — join notifications disabled')
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Schedule a join notification. Called from the roster/join handler.
 * Idempotent per userId — repeated calls just refresh the pending timer.
 * Early-returns if the webhook is unset or we're in preview, so no queue
 * memory leak on either.
 */
export function schedulePlayerJoin(userId: string): void {
  if (!webhookUrl || isPreview) return
  const key = userId.toLowerCase()
  pending.set(key, { address: userId, scheduledAt: Date.now() })
}

/**
 * Drain any pending notifications whose delay has elapsed. Called from a
 * low-frequency server system (every 1s is plenty — the delay is 5s).
 * Fires with the resolved display name when available, or short address
 * after MAX_WAIT.
 */
export function flushPendingJoins(): void {
  if (!webhookUrl || isPreview || pending.size === 0) return
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
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // allowed_mentions: names are player-supplied — a player named
      // "@everyone" must never ping the whole Discord server.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    })
    console.log(`[Discord] sent join notification for ${name}`)
  } catch (err) {
    console.log(`[Discord] send failed for ${name}: ${err}`)
  }
}

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
