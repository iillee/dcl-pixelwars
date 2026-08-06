/**
 * leaderboard.ts — read the server-owned LeaderboardState CRDT.
 */

import { engine } from '@dcl/sdk/ecs'

import { LeaderboardState } from 'src/shared/components'


export interface LbEntry {
	userId:       string
	name:         string
	cellsPainted: number
}


// MARK: readLeaderboard

/** Parse LeaderboardState from whatever replica is present. */
export function readLeaderboard(): LbEntry[] {
	for (const [, s] of engine.getEntitiesWith(LeaderboardState)) {
		if (!s.json) continue
		try {
			const arr = JSON.parse(s.json)
			return Array.isArray(arr) ? arr : []
		} catch {
			console.log('ui/utils/leaderboard: readLeaderboard: failed to parse json')
			return []
		}
	}
	return []
}
