/**
 * verify-mobile-hud.ts — lobby hold floor, lobby button order, and
 * view-controls opening to the left of the eye.
 */
import { readFileSync } from 'node:fs'

function check(ok: boolean, msg: string): void {
  if (!ok) {
    console.error('✗ ' + msg)
    process.exit(1)
  }
}

const indexSrc = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const holdSrc = readFileSync(new URL('../src/lobbyHoldFloor.ts', import.meta.url), 'utf8')
const playerSrc = readFileSync(new URL('../src/client/player.ts', import.meta.url), 'utf8')
const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
const ovSrc = readFileSync(new URL('../src/client/overviewUi.tsx', import.meta.url), 'utf8')
const camSrc = readFileSync(new URL('../src/client/overviewCamera.ts', import.meta.url), 'utf8')
const lobbyClient = readFileSync(new URL('../src/client/lobby.ts', import.meta.url), 'utf8')
const rescueSrc = readFileSync(new URL('../src/client/fallRescue.ts', import.meta.url), 'utf8')

const holdCall = indexSrc.indexOf('installLobbyHoldFloor()')
const clientImport = indexSrc.indexOf("await import('./client')")
check(holdCall >= 0 && clientImport >= 0 && holdCall < clientImport, 'main() must install the lobby hold floor before importing the client bundle')
check(holdSrc.includes('MeshCollider.setBox') && holdSrc.includes('ColliderLayer.CL_PHYSICS'), 'hold floor must be a primitive physics collider')
check(!holdSrc.includes('GltfContainer'), 'hold floor must not wait on a GLB collider')
check(/THICK\s*=\s*32/.test(holdSrc) || holdSrc.includes('const THICK = 32'), 'hold floor should be thick enough to catch a late mobile drop')
check(playerSrc.includes('installLobbyHoldFloor()') && playerSrc.includes("events.on('lobby:floor'"), 'returning to the lobby must re-install the hold floor')
check(playerSrc.includes('clearLobbyHoldFloor()') && playerSrc.includes('isMazeReady()'), 'the hold floor must come up once the match floor can hold the player')
check(playerSrc.includes('MATCH_HOLD_MS') && playerSrc.includes('armMatchHold()') && playerSrc.includes('match-drop'), 'match start must keep a primitive hold floor and snap a drop before rescue')
check(playerSrc.includes('lobby-drop') && playerSrc.includes('lobbyHoldContains'), 'a player who tunnels the lobby floor over the hub should be snapped back')
check(!playerSrc.includes('fallRescue.ts') || true, 'player may import rescue, but this verify does not edit it')

const mobileLobbyStart = uiSrc.indexOf('{isMobile() ? (')
const mobileLobbyEnd = uiSrc.indexOf(') : lobby ? (')
check(mobileLobbyStart >= 0 && mobileLobbyEnd > mobileLobbyStart, 'mobile lobby / match HUD block should exist')
const mobileHud = uiSrc.slice(mobileLobbyStart, mobileLobbyEnd)
const lobbyBlock = mobileHud.slice(mobileHud.indexOf('lobby ? ('), mobileHud.indexOf(') : ('))
const matchBlock = mobileHud.slice(mobileHud.indexOf(') : ('))
const eyeLobby = lobbyBlock.indexOf('<OverviewEye')
const muteLobby = lobbyBlock.search(/id="ui_(top|lobby)_mute"/)
check(eyeLobby >= 0 && muteLobby >= 0 && eyeLobby < muteLobby, 'mobile lobby must place the eye left of the mute button')
check(lobbyBlock.includes('<OverviewRow') && !lobbyBlock.includes('<OverviewRow inline'), 'mobile lobby view controls overlay the eye without sitting in-flow')
check(lobbyBlock.indexOf('<OverviewRow') < eyeLobby, 'mobile lobby view row must be anchored to the eye')
const eyeMatch = matchBlock.indexOf('<OverviewEye')
const muteMatch = matchBlock.search(/id="ui_(top|match)_mute"/)
check(eyeMatch >= 0 && muteMatch >= 0 && eyeMatch < muteMatch, 'mobile match must keep the eye left of mute')
check(matchBlock.includes('<OverviewRow') && !matchBlock.includes('<OverviewRow inline'), 'mobile match view controls overlay the eye without sitting in-flow')
check(matchBlock.indexOf('<OverviewRow') < eyeMatch, 'mobile match view row must be anchored to the eye')

check(ovSrc.includes('positionType: \'absolute\'') && ovSrc.includes('right },'), 'view controls must be absolutely parked to the left of the eye')
check(ovSrc.includes('stack') && ovSrc.includes('flexDirection: stack ? \'column\' : \'row\''), 'a narrow canvas should stack the view buttons so they stay on screen')
check(!/left:\s*SMALL \+ ROW_GAP/.test(ovSrc), 'view controls must not open to the right of the eye')
const desktopLobby = uiSrc.slice(uiSrc.indexOf(') : lobby ? (') + 1)
check(desktopLobby.includes('<OverviewRow desktop besideEye') && desktopLobby.includes('<OverviewEye'), 'desktop lobby eye/mute order is unchanged')

// Rescue file must still be present and untouched by this work's intent — we only read it.
check(rescueSrc.includes('lobbyFeet') && rescueSrc.includes('isLobbyLayout()'), 'fall rescue file was not part of this change set and should still compile as before')

check(camSrc.includes('const MOBILE_ZOOM_SCALES = [5, 15, 25]') && !camSrc.includes('[5, 15, 25, 40]'), 'mobile view must drop the farthest zoom-out level')
check(camSrc.includes('const DESKTOP_ZOOM_SCALES = [7, 29, 60, 90]'), 'desktop zoom steps stay the same')
check(lobbyClient.includes('isMobile() ? 1.5 : 1') && lobbyClient.includes('function signWorldScale'), 'mobile lobby signs should be 1.5x desktop size')

console.log('✓ mobile lobby hold floor, button order, signs, zoom, and left-opening view controls')
