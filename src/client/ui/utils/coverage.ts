/**
 * coverage.ts — coverage percentage helpers for the HUD.
 */

import { coverage } from 'src/client/paint'


// MARK: coveragePct
/**
 * Return red/blue coverage as percentage strings for the HUD pill.
 */
export function coveragePct(): { red: string; blue: string } {
	const { red, blue, total } = coverage()
	if (total === 0) return { red: '0%', blue: '0%' }
	return {
		red:  `${((red  / total) * 100).toFixed(1)}%`,
		blue: `${((blue / total) * 100).toFixed(1)}%`,
	}
}
