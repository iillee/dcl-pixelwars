/**
 * verify-bot-body-color.ts — palette, runtime tint wiring, and assets.
 *
 * Run from the scene root: npx tsx scripts/verify-bot-body-color.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { Team, TEAM_HEX, TEAM_RGB, BOT_BODY_PALETTE, DEFAULT_BOT_BODY_THEME, botBodySwatch, botBodySwatchForTeam, hexToRgb01, rgb01ToHex } from '../src/shared/team'

let failed = 0
function fail(msg: string): void {
  failed += 1
  console.error(`FAIL: ${msg}`)
}
function ok(msg: string): void {
  console.log(`ok  ${msg}`)
}
function expect(got: string, want: string, why: string): void {
  if (got.toUpperCase() !== want.toUpperCase()) fail(`${why}: expected ${want}, got ${got}`)
}

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps
}

const root = new URL('..', import.meta.url)
const visual = readFileSync(new URL('../src/client/botVisual.ts', import.meta.url), 'utf8')
const body = readFileSync(new URL('../src/client/botBody.ts', import.meta.url), 'utf8')
const teamSrc = readFileSync(new URL('../src/shared/team.ts', import.meta.url), 'utf8')

// ── Palette defaults ────────────────────────────────────────────────
{
  const pal = BOT_BODY_PALETTE[DEFAULT_BOT_BODY_THEME]
  if (!pal) fail('default theme missing from BOT_BODY_PALETTE')
  else {
    expect(pal.red, '#FF7577', 'default red swatch')
    expect(pal.blue, '#6A99FC', 'default blue swatch')
    expect(pal.balloon, '#6A99FC', 'balloon swatch equals team blue')
    expect(pal.green, '#4FD68C', 'example green swatch')
    expect(pal.balloon, pal.blue, 'balloon is the existing blue-body behaviour')
    expect(TEAM_HEX[Team.Red], pal.red, 'TEAM_HEX red')
    expect(TEAM_HEX[Team.Blue], pal.blue, 'TEAM_HEX blue')
    expect(TEAM_HEX[Team.Green], pal.green, 'TEAM_HEX green')
    expect(TEAM_HEX[Team.Yellow], pal.yellow, 'TEAM_HEX yellow')
    const red = TEAM_RGB[Team.Red]
    const blue = TEAM_RGB[Team.Blue]
    if (!near(red.r, 1) || !near(red.g, 117 / 255) || !near(red.b, 119 / 255)) fail('TEAM_RGB red is not #FF7577')
    if (!near(blue.r, 106 / 255) || !near(blue.g, 153 / 255) || !near(blue.b, 252 / 255)) fail('TEAM_RGB blue is not #6A99FC')
    ok('default palette is red #FF7577, blue #6A99FC, balloon = blue, example green #4FD68C')
  }
}

{
  expect(botBodySwatch('red'), '#FF7577', 'botBodySwatch(red)')
  expect(botBodySwatch('blue'), '#6A99FC', 'botBodySwatch(blue)')
  expect(botBodySwatch('balloon'), '#6A99FC', 'botBodySwatch(balloon)')
  expect(botBodySwatch('green'), '#4FD68C', 'botBodySwatch(green)')
  expect(botBodySwatchForTeam(Team.Red), '#FF7577', 'swatch for red team')
  expect(botBodySwatchForTeam(Team.Blue), '#6A99FC', 'swatch for blue team')
  expect(botBodySwatchForTeam(Team.Green), '#4FD68C', 'swatch for green team')
  expect(botBodySwatchForTeam(Team.Yellow), '#FFE04A', 'swatch for yellow team')
  expect(botBodySwatchForTeam(Team.Red, { balloonNeutral: true }), '#6A99FC', 'balloonNeutral keeps blue')
  expect(botBodySwatchForTeam(Team.Blue, { balloonNeutral: true }), '#6A99FC', 'balloonNeutral on blue team')
  expect(botBodySwatchForTeam(Team.None), '#6A99FC', 'unassigned team falls back to blue')
  expect(botBodySwatch('missing'), '#6A99FC', 'unknown swatch falls back to blue')
  ok('swatch helpers map teams, balloon-neutral, and fallbacks')
}

{
  const c = hexToRgb01('#6A99FC')
  if (!near(c.r, 106 / 255) || !near(c.g, 153 / 255) || !near(c.b, 252 / 255)) fail('hexToRgb01(#6A99FC)')
  expect(rgb01ToHex(c), '#6A99FC', 'rgb01ToHex round-trip')
  expect(rgb01ToHex(hexToRgb01('#4FD68C')), '#4FD68C', 'green hex round-trip')
  expect(rgb01ToHex(hexToRgb01('F00')), '#FF0000', 'short #RGB form')
  ok('hex helpers parse #RRGGBB and #RGB')
}

{
  // A new theme is just an entry; helpers must read it without code changes.
  const saved = BOT_BODY_PALETTE.dark
  BOT_BODY_PALETTE.dark = { red: '#B84A4C', blue: '#3E66DD', balloon: '#3E66DD', green: '#2E8B57' }
  expect(botBodySwatch('blue', 'dark'), '#3E66DD', 'dark theme blue')
  expect(botBodySwatchForTeam(Team.Red, { theme: 'dark' }), '#B84A4C', 'dark theme red team')
  expect(botBodySwatch('purple', 'dark'), '#6A99FC', 'unknown dark swatch falls back to default blue')
  if (saved) BOT_BODY_PALETTE.dark = saved
  else delete BOT_BODY_PALETTE.dark
  ok('adding a theme is a BOT_BODY_PALETTE entry (dark example works)')
}

// ── Runtime override wiring ─────────────────────────────────────────
{
  const checks: Array<[boolean, string]> = [
    [body.includes("export function setBotBodyColor") && body.includes("export function setBotBodyTheme") && body.includes("export function applyBotBodyForTeam") && body.includes("export function clearBotBodyColor"), 'botBody exports setBotBodyColor, setBotBodyTheme, applyBotBodyForTeam, clearBotBodyColor'],
    [body.includes("path") && body.includes("'BotBody'") && body.includes("'Arm_L'") && body.includes("'Arm_R'"), 'override targets mesh nodes BotBody, Arm_L, Arm_R'],
    [!/path:\s*''/.test(body) && !/path:\s*""/.test(body), 'body override does not use a global path: \'\' (so other nodes keep their own material)'],
    [body.includes('albedoColor') && body.includes('BOT_BODY_ALBEDO_SRC') && body.includes('assets/images/bots/body-neutral.png'), 'PBR albedoColor uses the neutral body texture'],
    [body.includes('bumpTexture') && body.includes('assets/images/bots/body-normal.png'), 'override reapplies the normal map'],
    [body.includes('roughness: 1') && body.includes('metallic: 0') && body.includes('specularIntensity: 0'), 'body material is matte (roughness 1, metallic 0, no specular)'],
    [body.includes('MTM_OPAQUE'), 'body material is opaque'],
    [visual.includes("applyBotBodyForTeam") && visual.includes('applyCustomBotBody(root, team)'), 'createBotVisual tints the body after GltfContainer.create'],
    [visual.includes("BOT_MODEL !== 'custom'") && visual.includes('applyBotBodyForTeam'), 'official ghost mesh skips the override'],
    [visual.includes('clearBotBodyColor(rec.root)'), 'destroyBot removes the body modifiers'],
    [visual.includes('applyCustomBotBody(rec.root, b.team)') && !visual.includes('GltfContainer.createOrReplace(rec.root'), 'a team change re-tints in place and does not swap the GLB'],
    [visual.includes('onBotBodyThemeChange') && visual.includes('applyCustomBotBody(rec.root, rec.team)'), 'a theme change recolors live custom bots'],
    [visual.includes("src: 'assets/models/bots/bot-custom-flat.glb'") && !visual.includes('bot-custom-flat-red'), 'botVisual loads only bot-custom-flat.glb'],
    [!visual.includes('CUSTOM_MODEL_SRC_RED') && !visual.includes('CUSTOM_MODEL_SRC_BLUE'), 'red/blue GLB src constants are gone'],
    [teamSrc.includes('BOT_BODY_PALETTE') && teamSrc.includes('balloon'), 'team.ts owns the palette and the balloon entry'],
  ]
  for (const [pass, msg] of checks) {
    if (!pass) fail(msg)
  }
  if (failed === 0) ok('client wiring: one GLB, mesh-path modifiers, theme hook, balloon palette entry')
}

// ── Assets ──────────────────────────────────────────────────────────
{
  const files: Array<[string, number]> = [
    ['assets/models/bots/bot-custom-flat.glb', 200_000],
    ['assets/images/bots/body-neutral.png', 10_000],
    ['assets/images/bots/body-normal.png', 10_000],
  ]
  for (const [rel, min] of files) {
    const path = new URL(rel, root)
    if (!existsSync(path)) { fail(`missing ${rel}`); continue }
    const size = statSync(path).size
    if (size < min) fail(`${rel} is only ${size} bytes`)
    else ok(`${rel} (${size} bytes)`)
  }
  const redGlb = new URL('assets/models/bots/bot-custom-flat-red.glb', root)
  const redSrc = visual.includes('bot-custom-flat-red') || body.includes('bot-custom-flat-red')
  if (redSrc) fail('bot-custom-flat-red.glb is still referenced in client source')
  else ok('bot-custom-flat-red.glb is not referenced in client source' + (existsSync(redGlb) ? ' (file still on disk)' : ' (file removed)'))
}

if (failed) {
  console.error(`${failed} bot-body-color check(s) failed`)
  process.exit(1)
}
console.log('✓ bot body color checks passed')
