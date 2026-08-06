/**
 * leaderboard.ts — top-painters board. Server owns the CRDT entity.
 */

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'

import { LeaderboardState } from 'src/shared/components'
import { LEADERBOARD_NETWORK_ID } from 'src/shared/paintGrid'

export interface LeaderboardEntry {
	userId:       string
	name:         string
	cellsPainted: number
}

const entries = new Map<string, LeaderboardEntry>()
const STORAGE_KEY = 'leaderboard-v1'
const TOP_N       = 20

let leaderboardEntity: Entity | null = null


// MARK: ensureLeaderboardEntity

function ensureLeaderboardEntity(): Entity {
	if (leaderboardEntity !== null) return leaderboardEntity

	leaderboardEntity = engine.addEntity()
	LeaderboardState.create(leaderboardEntity, { json: '[]' })
	try {
		syncEntity(leaderboardEntity, [LeaderboardState.componentId], LEADERBOARD_NETWORK_ID)
	} catch (err) {
		console.error(`[Leaderboard] syncEntity@${LEADERBOARD_NETWORK_ID} failed:`, err)
	}
	return leaderboardEntity
}


// MARK: loadFromStorage

export async function loadFromStorage(): Promise<void> {
	ensureLeaderboardEntity()
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
				userId:       e.userId.toLowerCase(),
				name:         typeof e.name === 'string' ? e.name : e.userId.slice(0, 8),
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


// MARK: saveToStorage

export async function saveToStorage(): Promise<void> {
	try {
		const arr = [...entries.values()]
		const ok  = await Storage.set(STORAGE_KEY, JSON.stringify(arr))
		if (!ok) {
			console.error(`[Leaderboard] Storage.set returned false (${arr.length} entries)`)
			return
		}
		console.log(`[Leaderboard] persisted ${arr.length} entries`)
	} catch (err) {
		console.log(`[Leaderboard] save failed: ${err}`)
	}
}


// MARK: incrementPaint

export function incrementPaint(userId: string, count: number): void {
	if (count <= 0) return
	const key = userId.toLowerCase()
	const e   = entries.get(key)
	if (e) {
		e.cellsPainted += count
	} else {
		entries.set(key, {
			userId:       key,
			name:         shortAddress(key),
			cellsPainted: count,
		})
	}
}


// MARK: updateName

export function updateName(userId: string, name: string): void {
	if (!name || typeof name !== 'string') return
	const key     = userId.toLowerCase()
	const trimmed = name.slice(0, 32)
	const e       = entries.get(key)
	if (e) {
		e.name = trimmed
	} else {
		entries.set(key, { userId: key, name: trimmed, cellsPainted: 0 })
	}
}


// MARK: getName

export function getName(userId: string): string | null {
	const e = entries.get(userId.toLowerCase())
	return e && e.name && !e.name.startsWith('0x') && !e.name.includes('…') ? e.name : null
}


// MARK: getTopN

export function getTopN(n: number = TOP_N): LeaderboardEntry[] {
	return [...entries.values()]
		.sort((a, b) => b.cellsPainted - a.cellsPainted)
		.slice(0, n)
}


// MARK: publish

export function publish(): void {
	const entity = ensureLeaderboardEntity()
	LeaderboardState.createOrReplace(entity, {
		json: JSON.stringify(getTopN()),
	})
}


// MARK: shortAddress

function shortAddress(addr: string): string {
	if (addr.length <= 10) return addr
	return addr.slice(0, 6) + '…' + addr.slice(-4)
}
