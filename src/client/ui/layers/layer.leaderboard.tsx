/**
 * layer.leaderboard.tsx — centered top-painters modal toggled from the timer star.
 */

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { room } from 'src/shared/messages'

import { playUiClick } from 'src/client/audio'
import { ButtonImageClose, Divider, InfoRow, SectionHeader } from 'src/client/ui/components'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { readLeaderboard } from 'src/client/ui/utils/leaderboard'


const { colors, fontSizes, borderRadius, icons, spacing } = UI_THEME

// Popup open/close state — module-local, driven by star-button clicks.
// React-ECS re-renders every frame so a plain variable is enough.
let leaderboardOpen = false


// MARK: toggleLeaderboard
/**
 * Toggle the leaderboard modal; request a fresh snapshot when opening.
 */
export function toggleLeaderboard(): void {
	playUiClick()
	leaderboardOpen = !leaderboardOpen
	if (leaderboardOpen) {
		// Ask server for the freshest snapshot when opening; response arrives
		// as a CRDT update to LeaderboardState within a frame or two.
		room.send('requestLeaderboard', {})
	}
}


// MARK: LeaderboardLayer
/**
 * Centered modal listing top painters. Renders only while open.
 */
export function LeaderboardLayer() {
	if (!leaderboardOpen) return null

	const rows = readLeaderboard()

	return (
		<UiEntity
			uiTransform = {{
				width         : '100%',
				height        : '100%',
				positionType  : 'absolute',
				position      : { top: 0, left: 0 },
				justifyContent: 'center',
				alignItems    : 'center',
			}}
			uiBackground = {{ color: colors.bannerBg }}
			onMouseDown  = {toggleLeaderboard}
		>
			{/* Modal card. Any click anywhere (card, X, backdrop) closes —
			    no stop-propagation, so the outer overlay handles it. */}
			<UiEntity
				uiTransform = {{
					width        : 520,
					height       : 640,
					borderRadius : borderRadius.lg,
					padding      : spacing.xl,
					flexDirection: 'column',
					alignItems   : 'stretch',
				}}
				uiBackground = {{ color: colors.body }}
				onMouseDown  = {toggleLeaderboard}
			>
				<UiEntity uiTransform = {{
					width         : '100%',
					height        : 48,
					flexDirection : 'row',
					alignItems    : 'center',
					justifyContent: 'space-between',
				}}>
					<SectionHeader
						title       = {`${icons.glyphs.star} TOP PAINTERS`}
						fontSize    = {fontSizes.xl}
						height      = {48}
						uiTransform = {{ width: 'auto', margin: { bottom: 0 }, flexGrow: 1 }}
					/>
					<ButtonImageClose
						id       = "leaderboard_close"
						callback = {toggleLeaderboard}
					/>
				</UiEntity>

				<Divider margin = {{ top: spacing.md, bottom: spacing.sm, left: 0, right: 0 }} />

				<InfoRow
					leading      = "#"
					label        = "PLAYER"
					value        = "CELLS"
					leadingWidth = {40}
					labelWidth   = {340}
					valueWidth   = {90}
					fontSize     = {fontSizes.sm}
					height       = {28}
					labelColor   = {colors.secondary}
					valueColor   = {colors.secondary}
					leadingColor = {colors.secondary}
				/>

				{rows.length === 0 ? (
					<UiEntity uiTransform = {{
						width         : '100%',
						height        : 60,
						margin        : { top: spacing.md },
						justifyContent: 'center',
						alignItems    : 'center',
					}}>
						<Label
							value     = "No painters yet — be the first!"
							fontSize  = {fontSizes.md}
							color     = {colors.secondary}
							textAlign = "middle-center"
						/>
					</UiEntity>
				) : rows.map((r, i) => (
					<InfoRow
						leading      = {`${i + 1}`}
						label        = {r.name}
						value        = {r.cellsPainted.toLocaleString()}
						leadingWidth = {40}
						labelWidth   = {340}
						valueWidth   = {90}
						fontSize     = {fontSizes.md}
						height       = {26}
						labelColor   = {colors.primary}
						valueColor   = {colors.primary}
						leadingColor = {i < 3 ? colors.warning : colors.primary}
						uiTransform  = {{
							margin: { top: spacing.xs },
						}}
					/>
				))}
			</UiEntity>
		</UiEntity>
	)
}
