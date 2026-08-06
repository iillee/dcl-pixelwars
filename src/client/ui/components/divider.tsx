/**
 * divider.tsx — horizontal rule between panel sections.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { PositionUnit, UiEntity } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, spacing } = UI_THEME


// MARK: Divider
/**
 * Thin horizontal separator; defaults to the theme divider color.
 */
export const Divider = ({
	color     = colors.divider,
	margin    = { top: spacing.md, bottom: spacing.md, left: 0, right: 0 },
	thickness = 1,
	width     = '100%',
}: {
	color?    : Color4
	margin?   : { top?: number, bottom?: number, left?: number, right?: number }
	thickness?: number
	width?    : PositionUnit | 'auto'
}) => {
	return (
		<UiEntity
			uiTransform = {{
				width : width,
				height: thickness,
				margin: margin,
			}}
			uiBackground = {{
				color: color,
			}}
		/>
	)
}
