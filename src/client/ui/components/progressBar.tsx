/**
 * progressBar.tsx — filled progress track with optional overlay children.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { darken } from 'src/client/ui/utils/colors'


const { colors, borderRadius } = UI_THEME


// MARK: ProgressBar
/**
 * Renders a progress bar. `setRatio` should return 0–100 (percent filled).
 */
export const ProgressBar = ({
	setRatio     = (): number => 0,
	uiTransform  = {},
	children     = [],
	isHorizontal = true,
	fillColor    = colors.primary,
	trackColor   = darken(colors.primary, 0.05),
}: {
	setRatio?    : () => number
	uiTransform? : UiTransformProps
	children?    : ReactEcs.JSX.Element[]
	isHorizontal?: boolean
	fillColor?   : Color4
	trackColor?  : Color4
}) => {
	const ratio = Math.max(0, Math.min(100, setRatio()))

	return (
		<UiEntity
			key         = {`ui_ProgressBar_outer`}
			uiTransform = {{
				width         : 420,
				height        : 90,
				borderRadius  : borderRadius.pill,
				overflow      : 'hidden',
				flexDirection : isHorizontal ? 'row' : 'column',
				justifyContent: 'flex-start',
				borderColor   : trackColor,
				borderWidth   : 5,
				alignItems    : 'center',
				positionType  : 'relative',
				...uiTransform,
			}}
		>
			<UiEntity
				key         = {`ui_ProgressBar_fill`}
				uiTransform = {{
					height: isHorizontal ? '100%'        : `${ratio}%`,
					width : isHorizontal ? `${ratio}%`   : '100%',
				}}
				uiBackground = {{
					color: fillColor,
				}}
			/>
			<UiEntity
				key         = {`ui_ProgressBar_overlay`}
				uiTransform = {{
					width        : '100%',
					height       : '100%',
					positionType : 'absolute',
					alignSelf    : 'center',
					alignContent : 'center',
					flexDirection: 'row',
					justifyContent: 'center',
					alignItems   : 'center',
				}}
			>
				{children}
			</UiEntity>
		</UiEntity>
	)
}
