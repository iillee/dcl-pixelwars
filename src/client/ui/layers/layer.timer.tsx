/**
 * layer.timer.tsx — top-center countdown, mute, leaderboard star, coverage pill.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { isMusicMuted, toggleMusic } from 'src/client/audio'
import { formatMMSS, getCountdownSeconds } from 'src/client/round'
import { ButtonImage } from 'src/client/ui/components'
import { toggleLeaderboard } from 'src/client/ui/layers/layer.leaderboard'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { coveragePct } from 'src/client/ui/utils/coverage'


const { colors, fontSizes, borderRadius, icons, spacing } = UI_THEME


// MARK: TimerLayer
/**
 * Top-center HUD: round countdown, mute toggle, leaderboard star, coverage %.
 */
export function TimerLayer() {
	const secs = getCountdownSeconds()
	const pct  = coveragePct()

	return (
		<UiEntity
			uiTransform = {{
				positionType : 'absolute',
				position     : { top: 10, left: 0 },
				width        : '100%',
				flexDirection: 'row',
				justifyContent: 'center',
				pointerFilter: 'none',
			}}
		>
			<UiEntity uiTransform = {{ width: 200, flexDirection: 'column', alignItems: 'center' }}>
				<UiEntity
					uiTransform = {{
						width        : 200,
						height       : 68,
						justifyContent: 'center',
						alignItems   : 'center',
						borderRadius : borderRadius.md,
					}}
					uiBackground = {{ color: colors.countdownBg }}
				>
					<Label
						value     = {formatMMSS(secs)}
						fontSize  = {fontSizes.display}
						color     = {colors.primary}
						textAlign = "middle-center"
					/>
					{/* Star — opens leaderboard */}
					<UiEntity
						uiTransform = {{
							width        : icons.size.md,
							height       : icons.size.md,
							positionType : 'absolute',
							position     : { top: 25, left: 20 },
							justifyContent: 'center',
							alignItems   : 'center',
							pointerFilter: 'block',
						}}
						onMouseDown = {toggleLeaderboard}
					>
						<Label
							value     = {icons.glyphs.star}
							fontSize  = {fontSizes.lg}
							color     = {colors.primary}
							textAlign = "middle-center"
						/>
					</UiEntity>
					{/* Mute icon docked on the right of the timer panel */}
					<ButtonImage
						id          = "timer_mute"
						width       = {icons.size.md}
						height      = {icons.size.md}
						textureSrc  = {isMusicMuted()
							? icons.textures.muted
							: icons.textures.unmute}
						callback    = {toggleMusic}
						uiTransform = {{
							positionType: 'absolute',
							position    : { top: 25, right: 20 },
						}}
					/>
				</UiEntity>
				<UiEntity
					uiTransform = {{
						width        : 200,
						height       : 36,
						margin       : { top: spacing.sm },
						borderRadius : borderRadius.pill,
						flexDirection: 'row',
						alignItems   : 'center',
						justifyContent: 'center',
					}}
					uiBackground = {{ color: colors.countdownBg }}
				>
					<Label
						value     = {pct.red}
						fontSize  = {fontSizes.md}
						color     = {colors.teamRed}
						textAlign = "middle-center"
					/>
					<Label
						value     = {"  —  "}
						fontSize  = {fontSizes.md}
						color     = {colors.primary}
						textAlign = "middle-center"
					/>
					<Label
						value     = {pct.blue}
						fontSize  = {fontSizes.md}
						color     = {colors.teamBlue}
						textAlign = "middle-center"
					/>
				</UiEntity>
			</UiEntity>
		</UiEntity>
	)
}
