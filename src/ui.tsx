import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from "@dcl/sdk/react-ecs"
import { Color4 } from "@dcl/sdk/math"

export function setupUi() {
    ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

// Top-center hint banner with a translucent rounded pill background.
export const uiMenu = () => (
    <UiEntity
        uiTransform={{
            width: '100%',
            height: 40,
            positionType: 'absolute',
            position: { top: 16, left: 0 },
            justifyContent: 'center',
            alignItems: 'center',
        }}
    >
        <UiEntity
            uiTransform={{
                height: 40,
                padding: { top: 8, bottom: 8, left: 20, right: 20 },
                justifyContent: 'center',
                alignItems: 'center',
            }}
            uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        >
            <Label
                value="reload scene to regenerate labyrinth"
                fontSize={18}
                color={Color4.White()}
                textAlign="middle-center"
            />
        </UiEntity>
    </UiEntity>
)
