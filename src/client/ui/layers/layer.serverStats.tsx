/**
 * layer.serverStats.tsx — bottom-left debug panel from ServerStats CRDT.
 */

import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { InfoRow, SectionHeader } from 'src/client/ui/components'
import { UI_THEME } from 'src/client/ui/theme/settings'
import { formatServerStatsRows, readServerStats } from 'src/client/ui/utils/serverStats'


const { colors, borderRadius, spacing } = UI_THEME


// MARK: ServerStatsLayer
/**
 * Bottom-left debug HUD reading the rate-limited ServerStats CRDT.
 */
export function ServerStatsLayer() {
	const rows = formatServerStatsRows(readServerStats())

	return (
		<UiEntity
			uiTransform = {{
				positionType : 'absolute',
				position     : { top: 156, left: 56 },
				width        : 300,
				padding      : spacing.lg,
				borderRadius : borderRadius.sm,
				flexDirection: 'column',
				alignItems   : 'stretch',
				pointerFilter: 'none',
			}}
			uiBackground = {{ color: colors.statsBg }}
		>
			<SectionHeader title = "SERVER STATS" />
			{rows.map((row) => (
				<InfoRow
					label = {row.label}
					value = {row.value}
				/>
			))}
		</UiEntity>
	)
}
