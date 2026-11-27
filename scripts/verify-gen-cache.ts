/**
 * verify-gen-cache.ts — the lobby's time-sliced arena build (startGenJob)
 * must give exactly what generateWithRetry gives for the same start seed,
 * and must leave the live grid (the lobby cross) untouched between slices.
 *
 * Run: npx tsx scripts/verify-gen-cache.ts
 */
import { startGenJob, generateWithRetry, getPlacedTilesInOrder, placeLobbyLayout, lastLayoutUsedFallback, applyPlacedTiles, Placed } from '../src/maze/generator'

const sig = (ts: Placed[]) => JSON.stringify(ts.map(t => [t.type, t.r, t.x, t.z, t.y, t.order]))
let fail = 0
for (const seed of [1, 2, 7, 42, 1234]) {
  const lobby = sig(placeLobbyLayout())
  const job = startGenJob(seed)
  let res = null
  let guard = 0
  while (!res && !job.dead && guard++ < 100000) {
    res = job.step(3)
    if (sig(getPlacedTilesInOrder()) !== lobby) { console.error(`FAIL seed ${seed}: lobby grid changed between slices`); fail++; break }
  }
  if (!res) { console.error(`FAIL seed ${seed}: job did not finish (dead=${job.dead})`); fail++; continue }
  const t0 = Date.now()
  const winning = generateWithRetry(seed)
  const syncMs = Date.now() - t0
  const fb = lastLayoutUsedFallback()
  const want = sig(getPlacedTilesInOrder())
  const got = sig(res.tiles)
  const ok = res.winning === winning && res.fallback === fb && got === want
  console.log(`${ok ? 'ok  ' : 'FAIL'} seed ${seed}: winning ${res.winning}/${winning} fallback ${res.fallback}/${fb} tiles ${res.tiles.length} sliced=${res.ms}ms in ${res.slices} slices, sync=${syncMs}ms`)
  if (!ok) fail++
  placeLobbyLayout()
  applyPlacedTiles(res.tiles, res.fallback)
  if (sig(getPlacedTilesInOrder()) !== want) { console.error(`FAIL seed ${seed}: applyPlacedTiles grid differs`); fail++ }
}
if (fail) { console.error(`verify-gen-cache: ${fail} failure(s)`); process.exit(1) }
console.log('verify-gen-cache: all passed')