/**
 * sectionHeader.tsx — section title for panels and modals.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, spacing } = UI_THEME


// MARK: SectionHeader
/**
 * Renders a section title using theme typography defaults.
 */
export const SectionHeader = ({
	title,
	fontSize    = fontSizes.sm,
	color       = colors.primary,
	height      = 22,
	uiTransform,
}: {
	title        : string
	fontSize?    : number
	color?       : Color4
	height?      : number
	uiTransform? : UiTransformProps
}) => {
	return (
		<UiEntity
			uiTransform = {{
				width         : '100%',
				height        : height,
				margin        : { bottom: spacing.sm },
				justifyContent: 'center',
				...uiTransform,
			}}
		>
			<Label
				value     = {title}
				fontSize  = {fontSize}
				color     = {color}
				textAlign = "middle-left"
			/>
		</UiEntity>
	)
}
