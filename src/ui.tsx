import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"
import { toggleMusic, isMusicMuted } from "./index"
import { coverage, Team } from "./paint"

export function setupUi() {
    ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

const PILL_BG = Color4.create(0, 0, 0, 0.5)
const RED_COLOR  = Color4.create(255/255, 117/255, 119/255, 1) // pallet.jpeg #FF7577
const BLUE_COLOR = Color4.create(106/255, 153/255, 252/255, 1) // pallet.jpeg #6A99FC

function coveragePct(): { red: string; blue: string } {
  const { red, blue, total } = coverage()
  if (total === 0) return { red: '0%', blue: '0%' }
  return {
    red:  `${((red  / total) * 100).toFixed(1)}%`,
    blue: `${((blue / total) * 100).toFixed(1)}%`,
  }
}

// Top-center hint banner with a translucent rounded pill background,
// plus a circular button of matching color to its right.
export const uiMenu = () => (
    <UiEntity
        uiTransform={{
            width: '100%',
            height: 40,
            positionType: 'absolute',
            position: { top: 16, left: 0 },
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'row',
        }}
    >
        <UiEntity
            uiTransform={{
                height: 40,
                padding: { top: 8, bottom: 8, left: 20, right: 20 },
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 20,
            }}
            uiBackground={{ color: PILL_BG }}
        >
            <Label
                value="pull the lever at 0,0 to regenerate labyrinth"
                fontSize={18}
                color={Color4.White()}
                textAlign="middle-center"
            />
        </UiEntity>
        <UiEntity
            uiTransform={{
                width: 40,
                height: 40,
                margin: { left: 8 },
                borderRadius: 20,
                justifyContent: 'center',
                alignItems: 'center',
            }}
            uiBackground={{ color: PILL_BG }}
            onMouseDown={toggleMusic}
        >
            <UiEntity
                uiTransform={{ width: 20, height: 20 }}
                uiBackground={{
                    textureMode: 'stretch',
                    texture: { src: isMusicMuted() ? 'assets/images/muted.png' : 'assets/images/unmute.png' },
                }}
            />
        </UiEntity>

        {/* Coverage pill: red % — blue %. Reads live from paint.ts every frame. */}
        <UiEntity
            uiTransform={{
                height: 40,
                padding: { top: 8, bottom: 8, left: 16, right: 16 },
                margin: { left: 8 },
                borderRadius: 20,
                flexDirection: 'row',
                alignItems: 'center',
            }}
            uiBackground={{ color: PILL_BG }}
        >
            <Label value={coveragePct().red}  fontSize={18} color={RED_COLOR}  textAlign="middle-center" />
            <Label value="  —  "                fontSize={18} color={Color4.White()} textAlign="middle-center" />
            <Label value={coveragePct().blue} fontSize={18} color={BLUE_COLOR} textAlign="middle-center" />
        </UiEntity>
    </UiEntity>
)
