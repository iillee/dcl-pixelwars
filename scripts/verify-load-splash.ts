/**
 * Load splash logo on initial load. Run: npx tsx scripts/verify-load-splash.ts
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SPLASH_SRC = 'assets/images/splash.png'
const SPLASH_AR = 16 / 9
const SPLASH_SCALE = 0.5

function splashImageSize(canvasW = 1920, canvasH = 1080): { w: number; h: number } {
  const w = canvasW > 0 ? canvasW : 1920
  const h = canvasH > 0 ? canvasH : 1080
  const full = w / h > SPLASH_AR ? { w: h * SPLASH_AR, h } : { w, h: w / SPLASH_AR }
  return { w: full.w * SPLASH_SCALE, h: full.h * SPLASH_SCALE }
}

function fail(msg: string): never {
  console.error('✗ ' + msg)
  process.exit(1)
}
function ok(msg: string): void { console.log('✓ ' + msg) }

const splashSrc = readFileSync(new URL('../src/client/splash.tsx', import.meta.url), 'utf8')
const uiSrc = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')
const imgPath = fileURLToPath(new URL('../' + SPLASH_SRC, import.meta.url))

if (!existsSync(imgPath)) fail(SPLASH_SRC + ' is missing')
const bytes = statSync(imgPath).size
if (bytes > 300 * 1024) fail(SPLASH_SRC + ' is ' + bytes + ' bytes; keep it well under 300 KB')
ok('splash logo is present and ' + bytes + ' bytes')

if (!splashSrc.includes("export const SPLASH_SRC = 'assets/images/splash.png'")) fail('splash should point at assets/images/splash.png')
if (splashSrc.includes('value="pixelwars"')) fail('the text "pixelwars" label should be replaced by the logo')
if (!splashSrc.includes("Color4.create(1, 1, 1, alpha)")) fail('the splash backdrop should stay white so the logo blends')
if (!splashSrc.includes('export function splashImageSize') || !splashSrc.includes('SPLASH_AR = 16 / 9')) fail('the logo should be contained at 16:9')
if (!splashSrc.includes('SPLASH_SCALE = 0.5')) fail('the logo should render at half the contained frame')
ok('splash UI uses the logo on a white cover')

if (!uiSrc.includes('<SplashScreen />') || !uiSrc.includes('from "./client/splash"')) fail('ui.tsx should still mount SplashScreen last')
ok('SplashScreen is still the top-most load layer')

const wide = splashImageSize(2560, 1080)
const tall = splashImageSize(1080, 1920)
const hd = splashImageSize(1920, 1080)
if (Math.abs(hd.w / hd.h - SPLASH_AR) > 0.02 || hd.w !== 960 || hd.h !== 540) fail('16:9 canvas should show a half-size 16:9 logo')
if (Math.abs(wide.w / wide.h - SPLASH_AR) > 0.02) fail('ultrawide should keep the logo at 16:9')
if (wide.h !== 540 || wide.w !== 960) fail('ultrawide should letterbox a half-size logo on white')
if (Math.abs(tall.w / tall.h - SPLASH_AR) > 0.02) fail('portrait should keep the logo at 16:9')
if (tall.w !== 540 || Math.abs(tall.h - 540 * 9 / 16) > 1) fail('portrait should letterbox the half-size logo above and below')
ok('logo stays 16:9 at half scale on 16:9, ultrawide, and portrait')

console.log('✓ load-splash checks passed')
