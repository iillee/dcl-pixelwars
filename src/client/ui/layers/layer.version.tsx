/**
 * layer.version.tsx — bottom-right build version label from shared/data/version.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { VERSION } from 'src/shared/data/version'

import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes, borderRadius } = UI_THEME


// MARK: VersionLayer
/**
 * Compact version chip pinned to the bottom-right of the screen.
 */
export function VersionLayer() {
	return (
		<UiEntity
			key         = {`ui_Version_root`}
			uiTransform = {{
				width       : 'auto',
				height      : '24',
				positionType: 'absolute',
				position    : { bottom: 8, right: 8 },
				borderRadius: borderRadius.sm,
				padding     : { right: 4, left: 4 },
			}}
			uiText = {{
				value    : VERSION,
				fontSize : fontSizes.md,
				color    : colors.versionFg,
				textAlign: 'middle-center',
			}}
			uiBackground = {{
				color: colors.versionBg,
			}}
		/>
	)
}
