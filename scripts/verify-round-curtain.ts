/**
 * Round-end lobby curtain. Run: npx tsx scripts/verify-round-curtain.ts
 */
import { readFileSync } from 'node:fs'
import {
  CURTAIN_COVER_MIN_S,
  CURTAIN_DOWN_S,
  CURTAIN_NEUTRAL_RGB,
  CURTAIN_READY_CAP_S,
  CURTAIN_UP_S,
  abortRoundCurtain,
  advanceCurtain,
  curtainDrop,
  curtainDropAt,
  curtainFillRgbs,
  curtainPhase,
  easeCurtain,
  isCurtainBlockingDismiss,
  isCurtainCovering,
  isCurtainIdle,
  isCurtainOpaque,
  resetCurtain,
  startRoundCurtain,
} from '../src/shared/roundCurtain'
import { Team, TEAM_RGB } from '../src/shared/team'

function fail(msg: string): never {
  console.error('✗ ' + msg)
  process.exit(1)
}

function sameRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

const redFill = curtainFillRgbs([Team.Red])
if (redFill.length !== 1 || !sameRgb(redFill[0], TEAM_RGB[Team.Red])) fail('a red win should fill with TEAM_RGB red')
const blueFill = curtainFillRgbs([Team.Blue])
if (blueFill.length !== 1 || !sameRgb(blueFill[0], TEAM_RGB[Team.Blue])) fail('a blue win should fill with TEAM_RGB blue')
const greenFill = curtainFillRgbs([Team.Green])
if (greenFill.length !== 1 || !sameRgb(greenFill[0], TEAM_RGB[Team.Green])) fail('a green win should fill with TEAM_RGB green')
const yellowFill = curtainFillRgbs([Team.Yellow])
if (yellowFill.length !== 1 || !sameRgb(yellowFill[0], TEAM_RGB[Team.Yellow])) fail('a yellow win should fill with TEAM_RGB yellow')
const tieFill = curtainFillRgbs([Team.Red, Team.Blue])
if (tieFill.length !== 2 || !sameRgb(tieFill[0], TEAM_RGB[Team.Red]) || !sameRgb(tieFill[1], TEAM_RGB[Team.Blue])) {
  fail('a two-way tie should split the curtain into the leading team colours')
}
const fourFill = curtainFillRgbs([Team.Red, Team.Blue, Team.Green, Team.Yellow])
if (fourFill.length !== 4) fail('a four-way tie should stripe every team colour')
const fallback = curtainFillRgbs([])
if (fallback.length !== 1 || !sameRgb(fallback[0], CURTAIN_NEUTRAL_RGB)) fail('no leaders should fall back to the original dark ink')

resetCurtain()
const t0 = 1_000_000
if (curtainDropAt('idle', t0, t0) !== 0) fail('idle drop should be 0')
if (curtainDropAt('cover', t0, t0 + 5000) !== 1) fail('cover drop should be 1')
if (curtainDropAt('down', t0, t0) !== 0) fail('down at 0 should be 0')
if (curtainDropAt('down', t0, t0 + CURTAIN_DOWN_S * 1000) !== 1) fail('down at end should be 1')
const mid = curtainDropAt('down', t0, t0 + (CURTAIN_DOWN_S * 1000) / 2)
if (mid < 0.45 || mid > 0.55) fail(`down midpoint should be ~0.5 (smoothstep), got ${mid}`)
if (easeCurtain(0.5) !== 0.5) fail('easeCurtain(0.5) should be 0.5')
if (curtainDropAt('up', t0, t0) !== 1) fail('up at 0 should be 1')
if (curtainDropAt('up', t0, t0 + CURTAIN_UP_S * 1000) !== 0) fail('up at end should be 0')

startRoundCurtain(t0)
if (curtainPhase() !== 'down') fail('start should enter down')
if (isCurtainIdle() || isCurtainCovering() || !isCurtainBlockingDismiss()) fail('down should block dismiss')
startRoundCurtain(t0 + 10)
if (curtainPhase() !== 'down') fail('start during down should be idempotent')
if (advanceCurtain(t0 + CURTAIN_DOWN_S * 1000 - 1, false) !== null) fail('should stay down until DOWN_S')
if (advanceCurtain(t0 + CURTAIN_DOWN_S * 1000, false) !== 'opaque') fail('should become opaque at DOWN_S')
if (curtainPhase() !== 'cover' || !isCurtainOpaque() || !isCurtainCovering()) fail('cover should be opaque')
const coverAt = t0 + CURTAIN_DOWN_S * 1000
advanceCurtain(coverAt + CURTAIN_COVER_MIN_S * 1000, false)
if (curtainPhase() !== 'cover') fail('should wait for lobby ready (or the cap)')
advanceCurtain(coverAt + CURTAIN_COVER_MIN_S * 1000, true)
if (curtainPhase() !== 'up') fail('should retract once the lobby is ready after the min hold')
const upAt = coverAt + CURTAIN_COVER_MIN_S * 1000
if (advanceCurtain(upAt + CURTAIN_UP_S * 1000, true) !== 'done' || !isCurtainIdle()) {
  fail('should finish retract after UP_S')
}

resetCurtain()
startRoundCurtain(t0)
advanceCurtain(t0 + CURTAIN_DOWN_S * 1000, false)
const capAt = t0 + CURTAIN_DOWN_S * 1000
advanceCurtain(capAt + CURTAIN_READY_CAP_S * 1000 - 1, false)
if (curtainPhase() !== 'cover') fail('should stay covered until the cap if the floor is not ready')
advanceCurtain(capAt + CURTAIN_READY_CAP_S * 1000, false)
if (curtainPhase() !== 'up') fail('the cap should lift the curtain even if the floor is not ready')

resetCurtain()
startRoundCurtain(t0)
abortRoundCurtain()
if (!isCurtainIdle() || curtainDrop(t0) !== 0 || isCurtainBlockingDismiss()) fail('abort should clear the curtain immediately')

const rebuild = readFileSync(new URL('../src/maze/rebuild.ts', import.meta.url), 'utf8')
for (const s of [
  'armLobbySwapDeferral',
  'flushPendingLobbyWorld',
  'hasPendingLobbyWorld',
  'isLobbyFloorReady',
  'pendingLobbyWorld',
  'lobbySwapDeferral',
  'startRoundCurtain()',
  'abortRoundCurtain()',
  'isCurtainCovering()',
  'holdOutgoing',
]) {
  if (!rebuild.includes(s)) fail(`rebuild.ts should include ${s}`)
}
if (!rebuild.includes("next.layout === 'lobby' && layoutKind === 'arena' && lobbySwapDeferral")) {
  fail('arena→lobby should defer until the curtain is opaque')
}
if (!rebuild.includes('lobbyFloorEntities')) fail('lobby floor entities should be tracked for readiness')

const curtainCli = readFileSync(new URL('../src/client/roundCurtain.ts', import.meta.url), 'utf8')
if (!curtainCli.includes('armLobbySwapDeferral()') || !curtainCli.includes("events.on('round:ended'")) {
  fail('initRoundCurtain should arm deferral and start on round end')
}
if (!curtainCli.includes('isCurtainCovering()') || !curtainCli.includes('flushPendingLobbyWorld()')) {
  fail('the tick should flush the lobby rebuild only once the curtain is covering')
}

const index = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
if (!index.includes('initRoundCurtain()')) fail('setupClient should init the curtain before messages arrive')

const round = readFileSync(new URL('../src/round.ts', import.meta.url), 'utf8')
if (!round.includes('startRoundCurtain()') || !round.includes('isCurtainBlockingDismiss()')) {
  fail('the banner should start the curtain and block dismiss during the swap')
}
if (!round.includes('SUMMARY_GROW_S * 1000')) fail('the summary should open fully formed so it can ride the curtain')

const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
if (!ui.includes('RoundCurtainMask') || !ui.includes('summarySlideY')) {
  fail('ui.tsx should compose the mask and slide the summary with it')
}

const mask = readFileSync(new URL('../src/client/roundCurtainUi.tsx', import.meta.url), 'utf8')
if (!mask.includes('CURTAIN_BLEED') || !mask.includes('pointerFilter:')) {
  fail('the mask should bleed past phone safe areas and block pointers')
}
if (mask.includes('SUMMARY_TITLE_BG')) fail('keep the mask color local so verify-summary stays valid')
if (!mask.includes('curtainFillRgbs') || !mask.includes('CURTAIN_LIP') || !mask.includes('Color4.White()')) {
  fail('the mask should use curtainFillRgbs and keep the white lip')
}
if (!ui.includes('RoundCurtainMask teams={leaders}') || !ui.includes('isCurtainIdle()') || !ui.includes('SUMMARY_INK')) {
  fail('the title should go dark on the team-colored curtain, and the mask should receive the leaders')
}

const server = readFileSync(new URL('../src/server/server.ts', import.meta.url), 'utf8')
if (server.includes('summaryWait') || server.includes('CURTAIN_DOWN_S')) {
  fail('the server must still open the lobby immediately; the curtain is client-only')
}

console.log('✓ round-end curtain timings, deferral, and source contracts')
