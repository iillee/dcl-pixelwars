/**
 * index.tsx — UI entry point.
 *
 * Composes distinct HUD layers into a single full-screen root and registers
 * the React-ECS renderer. Import setupUi from 'src/client/ui'.
 */

import ReactEcs, { ReactEcsRenderer, ScreenInsetArea, UiEntity } from '@dcl/sdk/react-ecs'

import { BannerLayer } from 'src/client/ui/layers/layer.banner'
import { LeaderboardLayer } from 'src/client/ui/layers/layer.leaderboard'
import { ServerStatsLayer } from 'src/client/ui/layers/layer.serverStats'
import { TimerLayer } from 'src/client/ui/layers/layer.timer'
import { VersionLayer } from 'src/client/ui/layers/layer.version'
import { BASE_HEIGHT, BASE_WIDTH } from 'src/client/ui/utils/sizing'


// MARK: setupUi
/**
 * Register the main HUD renderer at the virtual 1920×1080 reference size.
 */
export function setupUi() {
	ReactEcsRenderer.setUiRenderer(
		() => (
			<ScreenInsetArea>
				<TimerLayer />
				<LeaderboardLayer />
				<ServerStatsLayer />
				<BannerLayer />
				<VersionLayer />
			</ScreenInsetArea>
		),
		{
			virtualHeight: BASE_HEIGHT,
			virtualWidth : BASE_WIDTH,
		}
	)
}
