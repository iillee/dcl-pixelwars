/**
 * buttonText.tsx — text button with hover border styling.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Button, PositionUnit, UiTransformProps } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'
import { darken, lighten } from 'src/client/ui/utils/colors'


const hoverStates  : Map<string, boolean> = new Map()
const pressedStates: Map<string, boolean> = new Map()


// MARK: ButtonText
/**
 * Renders a text button with hover styling and an optional click callback.
 */
export const ButtonText = ({
	textLabel   = 'Button text',
	width       = '100%',
	height      = 64,
	borderWidth = 2,
	borderColor = UI_THEME.colors.primary,
	fontSize    = UI_THEME.fontSizes.sm,
	uiTransform,
	callback,
}: {
	textLabel   : string
	width?      : PositionUnit | 'auto'
	height?     : PositionUnit | 'auto'
	borderWidth?: number
	borderColor?: Color4
	fontSize?   : number
	uiTransform?: UiTransformProps
	callback?   : () => void
}) => {
	const btnId   = textLabel
	const hovered = hoverStates.get(btnId) === true

	return (
		<Button
			key         = {btnId}
			value       = {textLabel}
			fontSize    = {fontSize}
			uiTransform = {{
				width       : width,
				height      : height,
				margin      : 4,
				borderRadius: UI_THEME.borderRadius.xs,
				borderColor : hovered
					? lighten(borderColor, 0.1)
					: darken(borderColor, 0.1),
				borderWidth : borderWidth,
				...uiTransform,
			}}
			uiBackground = {{
				color: borderColor,
			}}
			onMouseEnter = {() => {
				hoverStates.set(btnId, true)
			}}
			onMouseLeave = {() => {
				hoverStates.set(btnId, false)
			}}
			onMouseDown = {() => {
				pressedStates.set(btnId, true)
			}}
			onMouseUp = {() => {
				pressedStates.set(btnId, false)
				if (hoverStates.get(btnId) === true) {
					callback?.()
				}
			}}
		/>
	)
}
