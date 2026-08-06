/**
 * palette.ts — team Color4 constants + Color4 canonicalization.
 *
 * Single source of truth for the colors interned into the server palette.
 */

import { Color4 } from '@dcl/sdk/math'

import { Team } from './team'

/** Palette index 0 is always unpainted / white. */
export const PALETTE_NONE = 0

/** Reserved after boot seed — match Team.Red / Team.Blue wire values. */
export const PALETTE_RED  = 1
export const PALETTE_BLUE = 2

export const MAX_PALETTE_INDEX = 255


export const TEAM_COLORS: Record<Team, Color4> = {
	[Team.None]: Color4.create(1, 1, 1, 1),
	[Team.Red]:  Color4.create(255 / 255, 117 / 255, 119 / 255, 1), // #FF7577
	[Team.Blue]: Color4.create(106 / 255, 153 / 255, 252 / 255, 1), // #6A99FC
}


/** Exact-match key for palette interning (component-wise float equality). */
export function colorKey(c: Color4): string {
	return `${c.r},${c.g},${c.b},${c.a}`
}


/** Map a Team enum to its Color4. */
export function teamColor(team: Team): Color4 {
	return TEAM_COLORS[team] ?? TEAM_COLORS[Team.None]
}


/** Map Team → reserved palette index (valid after seedTeamPalette). */
export function teamPaletteIndex(team: Team): number {
	if (team === Team.Red)  return PALETTE_RED
	if (team === Team.Blue) return PALETTE_BLUE
	return PALETTE_NONE
}
