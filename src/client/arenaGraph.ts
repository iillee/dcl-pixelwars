/**
 * arenaGraph.ts — one client copy of the walkable floor graph.
 *
 * Burst ripples and the local bot-knock predictor both need this graph.
 * Building the floor is cheap (~30 ms); we still share one so a Burst that
 * also hits a bot does not build it twice. Air links stay lazy in
 * buildWalkableGraph and are not touched here.
 */
import { getPlacedTilesInOrder, type Placed } from '../maze/generator'
import { TILES } from '../maze/tiles'
import { buildWalkableGraph, type WalkableGraph } from '../shared/mazeGraph'
import { getCurrentSeed, isLobbyLayout, isRebuilding } from '../maze/rebuild'

let cached: { key: string; graph: WalkableGraph; tiles: Placed[] } | null = null

function mazeKey(tiles: Placed[]): string {
  const first = tiles[0], last = tiles[tiles.length - 1]
  return `${getCurrentSeed()}:${isLobbyLayout() ? 'lobby' : 'arena'}:${tiles.length}:${first.x},${first.z},${first.y}:${last.x},${last.z},${last.y}`
}

export function clientArenaGraph(): { graph: WalkableGraph; tiles: Placed[]; rampTiles: Placed[] } | null {
  if (isRebuilding()) {
    if (!cached) return null
    return { graph: cached.graph, tiles: cached.tiles, rampTiles: cached.tiles.filter(t => TILES[t.type].isRamp) }
  }
  const tiles = getPlacedTilesInOrder()
  if (!tiles.length) return null
  const key = mazeKey(tiles)
  if (!cached || cached.key !== key) cached = { key, graph: buildWalkableGraph(tiles), tiles }
  return { graph: cached.graph, tiles: cached.tiles, rampTiles: cached.tiles.filter(t => TILES[t.type].isRamp) }
}

export function clearClientArenaGraph(): void { cached = null }
