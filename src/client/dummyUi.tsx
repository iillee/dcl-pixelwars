/**
 * dummyUi.tsx — "RESPAWN DUMMY" chip for the Lunge test dummies
 * (LUNGE_TEST_DUMMY). Top-centre, just under the timer + coverage pill
 * (ui.tsx: timer top 10 + 68 high, pill +6 + 36 → bottom edge at 120 px),
 * so it clears the bottom hotbar, the right-edge overview column and the
 * Explorer's own corner HUD. Desktop also has key 2 (client/lungeDummy).
 */
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { isDummyEnabled, respawnDummy } from './lungeDummy'

const CHIP_BG = Color4.create(0.1, 0.1, 0.1, 0.92) // = COUNTDOWN_BG in ui.tsx
const BORDER = Color4.create(1, 1, 1, 0.5)

export function DummyUi() {
  if (!isDummyEnabled()) return null
  const mobile = isMobile()
  return (
    <UiEntity
      key="ui_dummy_row"
      uiTransform={{
        positionType: 'absolute', position: { top: 128, left: 0 }, width: '100%',
        flexDirection: 'row', justifyContent: 'center', pointerFilter: 'none',
      }}
    >
      <UiEntity
        key="ui_dummy_chip"
        uiTransform={{
          height: mobile ? 56 : 30, padding: { left: 14, right: 14 },
          borderRadius: mobile ? 16 : 14, borderWidth: 1, borderColor: BORDER,
          justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
        }}
        uiBackground={{ color: CHIP_BG }}
        onMouseDown={respawnDummy}
      >
        <Label value={mobile ? 'RESPAWN DUMMY' : 'RESPAWN DUMMY (2)'} fontSize={mobile ? 22 : 13} color={Color4.White()} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}
