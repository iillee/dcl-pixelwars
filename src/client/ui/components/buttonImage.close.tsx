/**
 * buttonImage.close.tsx — shared close control matching project HUD style.
 *
 * Uses the theme close glyph (no atlas asset required) so it matches the
 * existing leaderboard / modal chrome.
 */

import ReactEcs, { Label, UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, icons } = UI_THEME


// MARK: ButtonImageClose
/**
 * Renders the shared close control; invokes `callback` on click.
 */
export const ButtonImageClose = ({
	id          = 'ui_close',
	callback,
	uiTransform = {},
}: {
	id?         : string
	callback?   : () => void
	uiTransform?: UiTransformProps
}) => {
	return (
		<UiEntity
			key         = {`ui_ButtonImageClose_${id}`}
			uiTransform = {{
				width         : icons.size.xl,
				height        : icons.size.xl,
				justifyContent: 'center',
				alignItems    : 'center',
				pointerFilter : 'block',
				...uiTransform,
			}}
			onMouseDown = {() => {
				callback?.()
			}}
		>
			<Label
				value     = {icons.glyphs.close}
				fontSize  = {fontSizes.lg}
				color     = {colors.primary}
				textAlign = "middle-center"
			/>
		</UiEntity>
	)
}
