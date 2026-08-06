/**
 * settings.ts — UI theme constants (colors, type, radii, icon scaffolding).
 *
 * Single source of truth for visual tokens used by UI layers and shared
 * components. Prefer these over hard-coded Color4 / fontSize values.
 */

import { Color4 } from '@dcl/sdk/math'

import { TEAM_COLORS } from 'src/shared/palette'
import { Team } from 'src/shared/team'

import { alpha } from 'src/client/ui/utils/colors'


const BODY_BASE  = Color4.create(0.08, 0.08, 0.08, 1)
const PANEL_BASE = Color4.create(0.1, 0.1, 0.1, 1)


/** Bootstrap-style semantic color roles plus game / surface tokens. */
export const UI_THEME = {
	colors: {
		primary:   Color4.White(),
		secondary: Color4.Gray(),
		light:     Color4.White(),
		body:      BODY_BASE,
		info:      Color4.create(0.25, 0.55, 0.95, 1),
		warning:   Color4.Yellow(),
		success:   Color4.create(0.25, 0.78, 0.40, 1),
		danger:    Color4.create(0.90, 0.25, 0.30, 1),

		/** Team brand colors (shared palette). */
		teamRed:   TEAM_COLORS[Team.Red],
		teamBlue:  TEAM_COLORS[Team.Blue],

		/** Panel / overlay surfaces (alpha applied via utils/colors). */
		countdownBg: alpha(PANEL_BASE, 0.92),
		bannerBg:    alpha(Color4.Black(), 0.55),
		statsBg:     alpha(BODY_BASE, 0.85),
		versionBg:   alpha(BODY_BASE, 0.2),
		versionFg:   alpha(Color4.White(), 0.3),
		divider:     alpha(Color4.White(), 0.12),
	},

	fontSizes: {
		xs:      13,
		sm:      14,
		md:      16,
		lg:      22,
		xl:      28,
		display: 42,
		hero:    96,
		subhead: 32,
	},

	borderRadius: {
		xs:   4,
		sm:   12,
		md:   18,
		lg:   20,
		pill: 18,
	},

	spacing: {
		xs: 2,
		sm: 6,
		md: 12,
		lg: 14,
		xl: 24,
	},

	/** Icon sizes and asset paths — expand as iconography grows. */
	icons: {
		size: {
			sm: 16,
			md: 19,
			lg: 24,
			xl: 32,
		},
		glyphs: {
			star:  '★',
			close: '✕',
		},
		textures: {
			muted:  'assets/images/muted.png',
			unmute: 'assets/images/unmute.png',
			close:  'assets/images/ui/atlas-btn-close.png',
		},
	},
} as const
