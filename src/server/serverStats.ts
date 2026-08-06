/**
 * serverStats.ts — rate-limited ServerStats CRDT for the debug HUD.
 *
 * Counters live in memory. At most one CRDT write per second when the
 * snapshot changes. Not used for gameplay.
 */

import { engine, Entity, NetworkEntity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { ServerStats } from 'src/shared/components'
import { paintGridCapacity, STATS_NETWORK_ID } from 'src/shared/paintGrid'
import { paintCellEntityCount } from 'src/shared/paintSync'
import { SERVER_STATS_PUBLISH_HZ } from 'src/shared/settings'

const BUCKET_COUNT = 60

let statsEntity: Entity | null = null
const buckets: number[] = new Array(BUCKET_COUNT).fill(0)
let writeIdx       = 0
let pendingChanges = 0
let totalChanges   = 0
let publishClock   = 0
let lastJson       = ''


// MARK: initServerStats

/** Create + syncEntity the ServerStats singleton. */
export function initServerStats(): void {
	if (statsEntity !== null) return

	const cap = paintGridCapacity()
	statsEntity = engine.addEntity()
	ServerStats.create(statsEntity, {
		tiles:             cap.tiles,
		paintResolution:   cap.paintCellsPerTileAxis,
		activeComponents:  0,
		maxComponents:     cap.cellCapacity,
		paintedCells:      0,
		totalChanges:      0,
		changesLast1s:     0,
		changesLast10s:    0,
		changesLast60s:    0,
	})
	try {
		syncEntity(statsEntity, [ServerStats.componentId], STATS_NETWORK_ID)
	} catch (err) {
		console.error(`[ServerStats] syncEntity@${STATS_NETWORK_ID} failed:`, err)
	}
	console.log(`[ServerStats] init @${STATS_NETWORK_ID}, ${SERVER_STATS_PUBLISH_HZ} Hz`)
}


// MARK: startServerStatsTick

/** Publish at SERVER_STATS_PUBLISH_HZ. Retries syncEntity if boot raced the profile. */
export function startServerStatsTick(getPaintedCells: () => number): void {
	const interval = 1 / SERVER_STATS_PUBLISH_HZ
	engine.addSystem((dt: number) => {
		if (statsEntity === null) return
		if (NetworkEntity.getOrNull(statsEntity) === null) {
			try {
				syncEntity(statsEntity, [ServerStats.componentId], STATS_NETWORK_ID)
			} catch {
				/* id-in-use or profile not ready — retry next tick */
			}
		}

		publishClock += dt
		if (publishClock < interval) return
		publishClock = 0

		buckets[writeIdx] = pendingChanges
		writeIdx          = (writeIdx + 1) % BUCKET_COUNT
		pendingChanges    = 0

		const cap = paintGridCapacity()
		const snapshot = {
			tiles:             cap.tiles,
			paintResolution:   cap.paintCellsPerTileAxis,
			activeComponents:  paintCellEntityCount(),
			maxComponents:     cap.cellCapacity,
			paintedCells:      getPaintedCells(),
			totalChanges,
			changesLast1s:     sumRecent(1),
			changesLast10s:    sumRecent(10),
			changesLast60s:    sumRecent(BUCKET_COUNT),
		}
		const json = JSON.stringify(snapshot)
		if (json === lastJson) return
		lastJson = json
		ServerStats.createOrReplace(statsEntity, snapshot)
	})
}


// MARK: noteComponentChange

/** Record PaintCell CRDT writes (in-memory only). */
export function noteComponentChange(n: number = 1): void {
	if (n <= 0) return
	pendingChanges += n
	totalChanges   += n
}


// MARK: sumRecent

function sumRecent(count: number): number {
	let sum = 0
	for (let i = 0; i < count; i++) {
		sum += buckets[(writeIdx - 1 - i + BUCKET_COUNT) % BUCKET_COUNT]
	}
	return sum
}
