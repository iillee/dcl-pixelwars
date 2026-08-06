/**
 * atlas.ts — UV helpers for icon atlas textures.
 */

// MARK: getUVsForIconAtlasNumber
/**
 * Fetch UVs for a number glyph from the icon atlas (0–12 supported).
 */
export function getUVsForIconAtlasNumber(number: number): number[] {
	var y = 0.5
	if (number >= 8) {
		y = 0
		number = number - 8
	}
	return [
		number * 0.125, y,
		number * 0.125, y + 0.5,
		(number + 1) * 0.125, y + 0.5,
		(number + 1) * 0.125, y,
	]
}


// MARK: getUVsForIconAtlasRow
/**
 * Fetch UVs for a full row in an icon atlas strip.
 */
export function getUVsForIconAtlasRow(
	number:  number,
	maxRows: number = 8,
): number[] {
	const ROW_HEIGHT = 1 / maxRows

	return [
		0, number * ROW_HEIGHT,
		0, (number + 1) * ROW_HEIGHT,
		1, (number + 1) * ROW_HEIGHT,
		1, number * ROW_HEIGHT,
	]
}
