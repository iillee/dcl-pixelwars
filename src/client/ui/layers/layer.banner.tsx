/**
 * layer.banner.tsx — full-screen round-end winner banner.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'

import { getBanner } from 'src/client/round'
import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes } = UI_THEME


// MARK: bannerColor
function bannerColor(): Color4 {
	const b = getBanner()
	if (b.winner === 'RED')  return colors.teamRed
	if (b.winner === 'BLUE') return colors.teamBlue
	return colors.primary
}


// MARK: bannerHeadline
function bannerHeadline(): string {
	const b = getBanner()
	return b.winner === 'TIE' ? "IT'S A TIE" : `${b.winner} WINS`
}


// MARK: bannerSubline
function bannerSubline(): string {
	const b = getBanner()
	return `RED ${b.redPct.toFixed(1)}%    —    BLUE ${b.bluePct.toFixed(1)}%`
}


// MARK: BannerLayer
/**
 * Centered full-screen round-end overlay. Hidden while the banner is inactive.
 */
export function BannerLayer() {
	if (!getBanner().visible) return null

	return (
		<UiEntity
			uiTransform={{
				width:           '100%',
				height:          '100%',
				positionType:    'absolute',
				position:        { top: 0, left: 0 },
				justifyContent:  'center',
				alignItems:      'center',
				flexDirection:   'column',
			}}
			uiBackground={{ color: colors.bannerBg }}
		>
			<Label
				value     = {bannerHeadline()}
				fontSize  = {fontSizes.hero}
				color     = {bannerColor()}
				textAlign = "middle-center"
			/>
			<Label
				value     = {bannerSubline()}
				fontSize  = {fontSizes.subhead}
				color     = {colors.primary}
				textAlign = "middle-center"
			/>
		</UiEntity>
	)
}
