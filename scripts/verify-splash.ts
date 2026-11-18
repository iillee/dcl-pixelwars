/**
 * Water-fall splash (ripple + droplets + sound slot). Run: npx tsx scripts/verify-splash.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const splashSrc = readFileSync(new URL('../src/client/waterSplash.ts', import.meta.url), 'utf8')
const audioSrc = readFileSync(new URL('../src/client/audio.ts', import.meta.url), 'utf8')
const rescueSrc = readFileSync(new URL('../src/client/fallRescue.ts', import.meta.url), 'utf8')
const indexSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')

if (!indexSrc.includes('initWaterSplash()') || !indexSrc.includes("from './waterSplash'")) {
  console.error('✗ setupClient should start the splash pool')
  process.exit(1)
}
if (!rescueSrc.includes("import { playWaterSplash } from './waterSplash'") || !rescueSrc.includes('playWaterSplash(hold.x, hold.z, true)') || !rescueSrc.includes('playWaterSplash(catchP.x, catchP.z, false)')) {
  console.error('✗ a local trip and a remote rescue:start should each play one splash')
  process.exit(1)
}
const ownFn = (rescueSrc.match(/function onRemoteStart[\s\S]*?^function /m) || [''])[0]
if (!ownFn.includes('isOwnRescue') || ownFn.indexOf('isOwnRescue') > ownFn.indexOf('playWaterSplash')) {
  console.error('✗ the faller must not play a second splash from the rescue:start echo')
  process.exit(1)
}
if (!splashSrc.includes('swellSurfaceY') || !splashSrc.includes('waterVisualSeconds()') || !splashSrc.includes('RING_COUNT = 2') || !splashSrc.includes('BillboardMode.BM_ALL')) {
  console.error('✗ the splash should be two rings on the live swell plus billboard droplets')
  process.exit(1)
}
if (!splashSrc.includes('RING_LIFE_S = 0.85') || !splashSrc.includes('DROP_LIFE_S = 0.9') || !splashSrc.includes('RING_POOL') || !splashSrc.includes('DROP_POOL')) {
  console.error('✗ rings and droplets should be pooled and last about 0.6–1 s')
  process.exit(1)
}
if (!audioSrc.includes("assets/sounds/splash.mp3") || !audioSrc.includes('pitch') || !audioSrc.includes('0.9') || !audioSrc.includes('1.1') || !audioSrc.includes('splashReady') || !audioSrc.includes('LoadingState.FINISHED')) {
  console.error('✗ splash sound should preload splash.mp3, jitter pitch, and stay silent until the clip has loaded')
  process.exit(1)
}
if (!audioSrc.includes('global: false') || !audioSrc.includes('forFaller') || !audioSrc.includes('SPLASH_VOL_SELF')) {
  console.error('✗ the catch should play spatially, with a slightly louder copy for the faller')
  process.exit(1)
}
if (existsSync(fileURLToPath(new URL('../assets/sounds/splash.mp3', import.meta.url)))) {
  console.log('✓ water splash (ripple, droplets, sound slot; splash.mp3 is present)')
} else {
  console.log('✓ water splash (ripple, droplets, sound slot; splash.mp3 not in yet, stays silent)')
}
