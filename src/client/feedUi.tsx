/**
 * feedUi.tsx — small toasts under the territory bar.
 * Lead: "GREEN TAKES THE LEAD". KO: "ALICE KO'D BOB".
 */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { liveFeed } from './feed'
import { inLobby } from './phase'
import { getSummaryProgress } from '../round'
import { TEAM_RGB } from '../shared/team'

const CHIP = Color4.create(0.1, 0.1, 0.1, 0.92)
const WHITE = Color4.White()

function tint(team: number): Color4 {
  const c = TEAM_RGB[team]
  return c ? Color4.create(c.r, c.g, c.b, 1) : WHITE
}

function textW(text: string, font: number): number {
  // Bold caps run wider than the regular 0.62 estimate. A short box lets
  // YELLOW and GREEN paint over the gap before the next word.
  return Math.ceil(text.length * font * 0.72) + 2
}

export function FeedToasts() {
  if (inLobby() || getSummaryProgress() >= 0) return null
  const rows = liveFeed()
  if (!rows.length) return null
  const font = isMobile() ? 13 : 15
  const h = font + 14
  const gap = Math.max(6, Math.round(font * 0.45))
  return (
    <UiEntity uiTransform={{ margin: { top: 8 }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      {rows.map(row => {
        const mid = row.kind === 1 ? 'TAKES THE LEAD' : "KO'D"
        const aW = textW(row.a, font)
        const midW = textW(mid, font)
        const bW = row.kind === 2 ? textW(row.b, font) : 0
        const gaps = row.kind === 2 ? gap * 2 : gap
        return (
          <UiEntity
            key={`ui_feed_${row.id}`}
            uiTransform={{
              width: aW + midW + bW + gaps + 24,
              height: h,
              margin: { top: 4 },
              padding: { left: 12, right: 12 },
              borderRadius: h / 2,
              flexDirection: 'row',
              alignItems: 'center',
              pointerFilter: 'none',
            }}
            uiBackground={{ color: CHIP }}
          >
            <Label value={`<b>${row.a}</b>`} fontSize={font} font="sans-serif" color={tint(row.team)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: aW, height: h }} />
            <Label value={`<b>${mid}</b>`} fontSize={font} font="sans-serif" color={WHITE} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: midW, height: h, margin: { left: gap } }} />
            {row.kind === 2
              ? <Label value={`<b>${row.b}</b>`} fontSize={font} font="sans-serif" color={tint(row.teamB)} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: bW, height: h, margin: { left: gap } }} />
              : null}
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}
