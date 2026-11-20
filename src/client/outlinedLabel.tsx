/**
 * outlinedLabel.tsx — a readable dark outline around UI text.
 *
 * SDK 7.32 UiText / React-ECS Label has no outlineWidth (that field exists
 * only on 3D TextShape). A few axis+diagonal label copies make a square
 * outline with visible lumps, especially at large sizes. These copies sit
 * on a circle instead, densely enough that the stroke stays even.
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { outlineOffsets } from '../shared/outlineOffsets'

export { outlineOffsets, OUTLINE_COPIES } from '../shared/outlineOffsets'

export function OutlinedLabel(props: {
  value: string
  fontSize: number
  color: Color4
  outlineColor: Color4
  outline: number
  font?: 'sans-serif' | 'serif' | 'monospace'
  width?: number | `${number}%`
  height?: number | `${number}%`
  margin?: { top?: number; right?: number; bottom?: number; left?: number }
  flexShrink?: number
}) {
  const {
    value, fontSize, color, outlineColor, outline,
    font = 'sans-serif', width = '100%', height = '100%', margin, flexShrink = 0,
  } = props
  const dirs = outlineOffsets(outline)
  return (
    <UiEntity uiTransform={{
      width, height, margin, flexShrink, justifyContent: 'center', alignItems: 'center',
      pointerFilter: 'none',
    }}>
      {dirs.map(([dx, dy]) => (
        <Label
          value={value}
          fontSize={fontSize}
          color={outlineColor}
          font={font}
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ positionType: 'absolute', position: { top: dy, left: dx }, width: '100%', height: '100%' }}
        />
      ))}
      <Label
        value={value}
        fontSize={fontSize}
        color={color}
        font={font}
        textAlign="middle-center"
        textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%' }}
      />
    </UiEntity>
  )
}
