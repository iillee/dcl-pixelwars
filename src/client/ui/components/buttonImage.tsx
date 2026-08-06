/**
 * buttonImage.tsx — clickable image button with optional atlas state rows.
 */

import ReactEcs, { PositionUnit, UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'

import { getUVsForIconAtlasRow } from 'src/client/ui/utils/atlas'


enum ButtonIndex {
	DISABLED = 0,
	PRESS    = 1,
	HOVER    = 2,
	DEFAULT  = 3,
}

const hoverStates  : Map<string, boolean> = new Map()
const pressedStates: Map<string, boolean> = new Map()


// MARK: ButtonImage
/**
 * Renders a textured button. When `atlasRows` is set, UVs switch between
 * disabled / press / hover / default rows in the atlas strip.
 */
export const ButtonImage = ({
	id          = 'uiid',
	width       = 64,
	height      = 64,
	textureSrc,
	atlasRows,
	disabled    = false,
	uiTransform = {},
	callback,
}: {
	id          : string
	width?      : PositionUnit | 'auto'
	height?     : PositionUnit | 'auto'
	textureSrc  : string
	atlasRows?  : number
	disabled?   : boolean
	uiTransform?: UiTransformProps
	callback?   : () => void
}) => {
	const isHover   = hoverStates.get(id)   === true
	const isPressed = pressedStates.get(id) === true

	let index = ButtonIndex.DEFAULT
	if (disabled)        index = ButtonIndex.DISABLED
	else if (isPressed)  index = ButtonIndex.PRESS
	else if (isHover)    index = ButtonIndex.HOVER

	return (
		<UiEntity
			key         = {`ui_ButtonImage_${id}`}
			uiTransform = {{
				width         : width,
				height        : height,
				justifyContent: 'center',
				alignItems    : 'center',
				pointerFilter : 'block',
				...uiTransform,
			}}
			uiBackground = {{
				textureMode: 'stretch',
				texture    : { src: textureSrc },
				...(atlasRows !== undefined
					? { uvs: getUVsForIconAtlasRow(index, atlasRows) }
					: {}),
			}}
			onMouseEnter = {() => {
				if (!disabled) hoverStates.set(id, true)
			}}
			onMouseLeave = {() => {
				hoverStates.set(id, false)
				pressedStates.set(id, false)
			}}
			onMouseDown = {() => {
				if (!disabled) pressedStates.set(id, true)
			}}
			onMouseUp = {() => {
				pressedStates.set(id, false)
				if (!disabled && hoverStates.get(id) === true) {
					callback?.()
				}
			}}
		/>
	)
}
