/**
 * verify-spawns.ts — every team stands on solid floor at spawn and respawn.
 * Run: npx tsx scripts/verify-spawns.ts
 */
import {
  BASE_Y, CELL, MAZE_ORIGIN, STEP, generateWithRetry, getPlacedTilesInOrder,
  layFallback, lastLayoutUsedFallback, baseSpawn, spawnAnchor, Placed,
} from '../src/maze/generator'
import { TILES } from '../src/maze/tiles'
import { PLAYING_TEAMS, teamName } from '../src/shared/team'
import { buildWalkableGraph } from '../src/shared/mazeGraph'
import { graphFloorAt } from '../src/shared/anvilSim'

let failed = 0
function fail(msg: string): void { console.error('✗ ' + msg); failed++ }
function ok(msg: string): void { console.log('✓ ' + msg) }

const SPAWN_FEET = 1.5
const SEEDS = [1, 7, 13, 21, 34, 55, 89, 144, 233, 377, 610, 7919]

function tileUnder(placed: Placed[], x: number, z: number): Placed | undefined {
  const tx = Math.floor((x - MAZE_ORIGIN) / CELL)
  const tz = Math.floor((z - MAZE_ORIGIN) / CELL)
  let best: Placed | undefined
  for (const p of placed) {
    if (p.x !== tx || p.z !== tz) continue
    if (!best || p.y > best.y) best = p
  }
  return best
}

function checkLayout(label: string): void {
  const placed = getPlacedTilesInOrder()
  const ramps = placed.filter(p => TILES[p.type].isRamp)
  const graph = buildWalkableGraph(placed)
  for (const team of PLAYING_TEAMS) {
    const first = baseSpawn(team).pos
    const again = baseSpawn(team).pos
    const name = teamName(team)
    const anchor = spawnAnchor(team)
    if (Math.hypot(first.x - again.x, first.y - again.y, first.z - again.z) > 1e-6) {
      fail(`${label} ${name} respawn moved from ${fmt(first)} to ${fmt(again)}`)
      continue
    }
    const tile = tileUnder(placed, first.x, first.z)
    if (!tile) {
      fail(`${label} ${name} spawn ${fmt(first)} is not on a placed tile (anchor ${anchor})`)
      continue
    }
    if (tile.bridge) {
      fail(`${label} ${name} spawn sits on a bridge slab at (${tile.x},${tile.z}) — base/spawn cells must stay solid pillars`)
      continue
    }
    if (placed.some(p => p.x === tile.x && p.z === tile.z && p.bridge)) {
      fail(`${label} ${name} spawn cell (${tile.x},${tile.z}) has a stacked bridge — base/spawn cells must not be underpasses`)
      continue
    }
    if (Math.abs(first.y - (tile.y + SPAWN_FEET)) > 0.01) {
      fail(`${label} ${name} feet y=${first.y.toFixed(2)} but tile is at ${tile.y.toFixed(2)} (want tile+y ${(tile.y + SPAWN_FEET).toFixed(2)})`)
      continue
    }
    // The old bug: always BASE_Y+1.5, so a raised or lowered corner dropped them through.
    if (Math.abs(tile.y - BASE_Y) > 0.01 && Math.abs(first.y - (BASE_Y + SPAWN_FEET)) < 0.01) {
      fail(`${label} ${name} still uses L0 height over a tile at y=${tile.y.toFixed(2)}`)
      continue
    }
    const floor = graphFloorAt(graph, ramps, first.x, first.z, first.y, CELL * 0.4, 0.2)
    if (floor === null) {
      fail(`${label} ${name} has no walkable support under ${fmt(first)}`)
      continue
    }
    const gap = first.y - floor
    if (gap < 0 || gap > 2) {
      fail(`${label} ${name} support gap ${gap.toFixed(2)}m at ${fmt(first)} (floor ${floor.toFixed(2)})`)
      continue
    }
    ok(`${label} ${name} on ${tile.type} at (${tile.x},${tile.z}) y=${tile.y.toFixed(1)} feet=${first.y.toFixed(1)} gap=${gap.toFixed(2)}m`)
  }
}

function fmt(p: { x: number; y: number; z: number }): string {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`
}

layFallback()
checkLayout('fallback' + (lastLayoutUsedFallback() ? '' : ' (live)'))

let layouts = 1
for (const start of SEEDS) {
  const seed = generateWithRetry(start, 40)
  if (seed === null) {
    fail(`no valid layout from seed ${start}`)
    continue
  }
  layouts++
  checkLayout(`seed ${seed}`)
}

if (failed) { console.error(`\n${failed} spawn check(s) failed`); process.exit(1) }
console.log(`\n✓ ${layouts} layouts, all four teams spawn and respawn on solid floor`)
