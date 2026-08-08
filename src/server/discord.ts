/**
 * discord.ts — server-side Discord webhook notifier.
 *
 * Fires a message when a player joins. No ~system/Runtime imports — those
 * are client-only and can crash hammurabi on boot (exit code 1).
 *
 * Preview spam: leave DISCORD_PLAYER_JOIN_WEBHOOK unset locally.
 */

import { EnvVar } from '@dcl/sdk/server'

const NAME_RESOLVE_DELAY_MS    = 5000
const NAME_RESOLVE_MAX_WAIT_MS = 15000

let webhookUrl = ''

interface Pending {
	address:     string
	scheduledAt: number
}
const pending = new Map<string, Pending>()

let resolveName: (userId: string) => string | null = () => null


// MARK: bindNameResolver

export function bindNameResolver(fn: (userId: string) => string | null): void {
	resolveName = fn
}


// MARK: initDiscord

/** Load webhook URL from EnvVar. Safe when unset (404 / throw). */
export async function initDiscord(): Promise<void> {
	try {
		webhookUrl = (await EnvVar.get('DISCORD_PLAYER_JOIN_WEBHOOK')) || ''
	} catch (err) {
		webhookUrl = ''
		console.log(`[Discord] EnvVar.get failed (${err}) — join notifications disabled`)
	}
	if (webhookUrl) {
		console.log('[Discord] webhook loaded from env')
	} else {
		console.log('[Discord] no DISCORD_PLAYER_JOIN_WEBHOOK set — join notifications disabled')
	}
}


// MARK: schedulePlayerJoin

/** Schedule a join notification. No-op when webhook is unset. */
export function schedulePlayerJoin(userId: string): void {
	if (!webhookUrl) return
	const key = userId.toLowerCase()
	pending.set(key, { address: userId, scheduledAt: Date.now() })
}


// MARK: flushPendingJoins

/** Drain pending notifications whose delay has elapsed. */
export function flushPendingJoins(): void {
	if (!webhookUrl || pending.size === 0) return
	const now = Date.now()
	for (const [key, p] of pending) {
		const age = now - p.scheduledAt
		if (age < NAME_RESOLVE_DELAY_MS) continue
		const resolved = resolveName(key)
		const timedOut = age >= NAME_RESOLVE_MAX_WAIT_MS
		if (!resolved && !timedOut) continue

		pending.delete(key)
		const name = resolved || shortAddress(p.address)
		void sendDiscord(name, p.address)
	}
}


// MARK: sendDiscord

async function sendDiscord(name: string, address: string): Promise<void> {
	const content = `**${name}** joined PixelWars (\`${shortAddress(address)}\`)`
	try {
		await fetch(webhookUrl, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body:    JSON.stringify({ content, allowed_mentions: { parse: [] } }),
		})
		console.log(`[Discord] sent join notification for ${name}`)
	} catch (err) {
		console.log(`[Discord] send failed for ${name}: ${err}`)
	}
}


// MARK: shortAddress

function shortAddress(addr: string): string {
	if (addr.length <= 10) return addr
	return addr.slice(0, 6) + '…' + addr.slice(-4)
}
