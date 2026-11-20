/**
 * Server-authored world: every client, including a late joiner, builds the
 * same floor (lobby cross or arena maze) from this record. A lower seq is a
 * stale message and must be ignored, so a late match clock cannot grow an
 * arena on top of the lobby, and a peer SeedHolder cannot pick a different seed.
 */
import { generateWithRetry, getPlacedTilesInOrder, placeLobbyLayout, type Placed } from '../maze/generator'

export type WorldLayout = 'lobby' | 'arena'

export type ServerWorld = {
  seq: number
  seed: number
  layout: WorldLayout
  format: string
  phase: string
}

export function isStaleWorld(have: ServerWorld | null, next: ServerWorld): boolean {
  if (!have) return false
  if (next.seq > 0 && have.seq > 0) return next.seq < have.seq
  return false
}

export function shouldRebuildWorld(have: ServerWorld | null, next: ServerWorld): boolean {
  if (isStaleWorld(have, next)) return false
  if (!have) return true
  return have.layout !== next.layout || have.seed !== next.seed
}

export function parseWorldLayout(layout: string | undefined, active?: boolean): WorldLayout {
  if (layout === 'arena' || layout === 'lobby') return layout
  return active ? 'arena' : 'lobby'
}

/** Tiles the GLB platforms and the paint grid must both use for this world. */
export function tilesForWorld(world: Pick<ServerWorld, 'seed' | 'layout'>): { seed: number; tiles: Placed[] } {
  if (world.layout === 'lobby') return { seed: world.seed, tiles: placeLobbyLayout() }
  const winning = generateWithRetry(world.seed)
  return { seed: winning ?? world.seed, tiles: getPlacedTilesInOrder() }
}

export function layoutFingerprint(tiles: Placed[]): string {
  return tiles
    .map(t => `${t.type}:${t.r}:${t.x}:${t.z}:${Math.round(t.y * 1000) / 1000}`)
    .sort()
    .join('|')
}