/**
 * messages.ts — shared WS message schema for Squareoff auth server.
 *
 * Registered from both client and server (identical schema). Follows the
 * flagtag pattern of a single `room` handle returned by registerMessages().
 *
 * Message set: joinRoster/teamAssigned, paintTick (command only),
 * roundReset, updateName, requestLeaderboard.
 *
 * Paint *state* (cell indexes + palette + coverage) syncs exclusively via
 * CRDT components — not paintDelta/snapshot room messages.
 *
 * SATURATION DISCIPLINE (write ONCE, enforce forever):
 *   - Client paintTick: PAINT_TICK_HZ (settings) — well under per-peer inbound cap
 *   - Paint state: one sparse PaintCell CRDT component per painted cell
 * See assets/docs/PHASE_4_PLAN.md for historical WS-delta reasoning; paint
 * state has since moved to granular CRDT components.
 */

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
	// Client → Server
	// Sent once on client boot after PlayerIdentityData is populated.
	// Server appends to roster if new, replies with teamAssigned to the sender.
	joinRoster: Schemas.Map({ userId: Schemas.String }),

	// Server → Client
	// team values match the Team enum in src/shared/team.ts: 1 = Red, 2 = Blue.
	// Assignment is `roster.indexOf(userId) % 2` — stable across rejoin,
	// and guaranteed to alternate (fixes the "two blue players in a row"
	// issue the Phase 3 client hash could produce).
	teamAssigned: Schemas.Map({ team: Schemas.Int }),

	// Client → Server: cells painted by the sender since the last flush.
	// Sent at PAINT_TICK_HZ. Server looks up sender's team from roster,
	// interns the team Color4 into the palette, and writes the palette
	// index into a per-cell PaintCell CRDT component. Not a state-sync channel.
	// WHY ids and not positions: server doesn't have the maze generator (it's
	// client-only for now), so it can't resolve position -> cell. Client
	// authors ids via worldToCellId locally; server trusts them for Phase 4.
	// Anti-cheat (position validation) is deferred to Phase 5 per the plan.
	// Rate limit: server caps ids per message from PAINT_BRUSH_SIZE_CELLS
	// (+ headroom); anything larger is dropped as suspicious.
	paintTick: Schemas.Map({ ids: Schemas.Array(Schemas.String) }),

	// Server → Client (broadcast): UTC round boundary crossed. Carries the
	// authoritative final score of the just-ended round (all clients show
	// the same banner — no more "one player sees red won, another sees
	// tie") plus the seed for the new round. Server has already cleared its
	// paint CRDT chunks before/with this message.
	// finalTotal is server-side painted-cell count; client re-derives the
	// banner denominator from its own walkable-cell count (same math as HUD).
	roundReset: Schemas.Map({
		seed:       Schemas.Int,
		finalRed:   Schemas.Int,
		finalBlue:  Schemas.Int,
		finalTotal: Schemas.Int,
	}),

	// Client → Server: send this player's display name once on join so
	// the leaderboard shows human-readable names instead of wallet hashes.
	// Server captures into its player-name directory and patches existing
	// leaderboard entries in place.
	updateName: Schemas.Map({ name: Schemas.String }),

	// Client → Server: request an immediate fresh copy of the leaderboard.
	// Fires when the player opens the popup mid-round so they see current
	// standings without waiting for the next round boundary broadcast.
	requestLeaderboard: Schemas.Map({}),
}

export const room = registerMessages(Messages)
