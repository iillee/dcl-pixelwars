/**
 * infoRow.tsx — label / value row used by stats panels and leaderboards.
 */

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, PositionUnit, UiEntity, UiTransformProps } from '@dcl/sdk/react-ecs'

import { UI_THEME } from 'src/client/ui/theme/settings'


const { colors, fontSizes } = UI_THEME


// MARK: InfoRow
/**
 * One horizontal label/value row. Uses space-between by default (server-stats
 * style); pass `firstColumnWidth` for fixed percentage columns. Optional
 * `leading` adds a fixed-width prefix column (e.g. leaderboard rank).
 */
export const InfoRow = ({
	label,
	value,
	leading,
	leadingColor  = colors.primary,
	leadingWidth  = 45,
	labelColor    = colors.secondary,
	valueColor    = colors.primary,
	fontSize      = fontSizes.xs,
	height        = 20,
	firstColumnWidth,
	labelWidth,
	valueWidth,
	labelAlign    = 'middle-left',
	valueAlign    = 'middle-right',
	uiTransform,
}: {
	label            : string
	value            : string
	leading?         : string
	leadingColor?    : Color4
	leadingWidth?    : number
	labelColor?      : Color4
	valueColor?      : Color4
	fontSize?        : number
	height?          : number
	firstColumnWidth?: number
	labelWidth?      : number
	valueWidth?      : number
	labelAlign?      : 'middle-left' | 'middle-center' | 'middle-right'
	valueAlign?      : 'middle-left' | 'middle-center' | 'middle-right'
	uiTransform?     : UiTransformProps
}) => {
	const usePct = firstColumnWidth !== undefined

	let resolvedLabelWidth: PositionUnit | undefined
	let resolvedValueWidth: PositionUnit | undefined

	if (usePct) {
		resolvedLabelWidth = `${firstColumnWidth}%` as PositionUnit
		resolvedValueWidth = `${100 - (firstColumnWidth as number)}%` as PositionUnit
	} else {
		if (labelWidth !== undefined) resolvedLabelWidth = labelWidth
		if (valueWidth !== undefined) resolvedValueWidth = valueWidth
	}

	const labelTransform: UiTransformProps = resolvedLabelWidth !== undefined
		? { width: resolvedLabelWidth }
		: { flexGrow: 1 }
	const valueTransform: UiTransformProps = resolvedValueWidth !== undefined
		? { width: resolvedValueWidth }
		: {}

	return (
		<UiEntity
			uiTransform = {{
				width         : '100%',
				height        : height,
				flexDirection : 'row',
				alignItems    : 'center',
				justifyContent: usePct ? 'flex-start' : 'space-between',
				...uiTransform,
			}}
		>
			{leading !== undefined && (
				<Label
					value       = {leading}
					fontSize    = {fontSize}
					color       = {leadingColor}
					textAlign   = "middle-left"
					uiTransform = {{ width: leadingWidth }}
				/>
			)}
			<Label
				value       = {label}
				fontSize    = {fontSize}
				color       = {labelColor}
				textAlign   = {labelAlign}
				uiTransform = {labelTransform}
			/>
			<Label
				value       = {value}
				fontSize    = {fontSize}
				color       = {valueColor}
				textAlign   = {valueAlign}
				uiTransform = {valueTransform}
			/>
		</UiEntity>
	)
}
