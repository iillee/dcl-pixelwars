/**
 * verify-world-sync.ts — two clients must share the server's floor.
 *
 * Simulates PIXELWARS -> BALLOON BATTLE -> PAINT LIMIT -> BASE CHARGE,
 * with a return to the lobby after each match, a late joiner, and a stale
 * match clock after a lobby reset. Both clients' "GLB" layout (the same
 * tile list the paint grid uses) must match the server after every catch-up.
 *
 * Run: npx tsx scripts/verify-world-sync.ts
 */
import {
  ServerWorld, isStaleWorld, shouldRebuildWorld, tilesForWorld, layoutFingerprint,
} from '../src/shared/worldState'
import { emptyCounts, pickWinner } from '../src/shared/lobby'

class Client {
  have: ServerWorld | null = null
  fp = ''
  seed = 0

  apply(next: ServerWorld): void {
    if (isStaleWorld(this.have, next)) return
    const rebuild = shouldRebuildWorld(this.have, next)
    this.have = next
    if (rebuild) {
      const built = tilesForWorld(next)
      this.seed = built.seed
      this.fp = layoutFingerprint(built.tiles)
    }
  }
}

function serverTiles(world: ServerWorld): { seed: number; fp: string } {
  const built = tilesForWorld(world)
  return { seed: built.seed, fp: layoutFingerprint(built.tiles) }
}

function assertSame(label: string, server: ServerWorld, ...clients: Client[]): void {
  const expect = serverTiles(server)
  for (const c of clients) {
    if (c.have === null || isStaleWorld(c.have, server) === false && (c.have.layout !== server.layout || c.have.seed !== server.seed || c.fp !== expect.fp)) {
      if (c.fp !== expect.fp || c.have?.layout !== server.layout || c.have?.seed !== server.seed) {
        console.error(`✗ ${label}: client layout=${c.have?.layout}/${c.have?.seed} fp=${c.fp.slice(0, 60)}… server layout=${server.layout}/${server.seed}`)
        process.exit(1)
      }
    }
  }
}

let seq = 0
function world(layout: ServerWorld['layout'], seed: number, format: string, phase: string): ServerWorld {
  seq += 1
  return { seq, seed, layout, format, phase }
}

const a = new Client()
const b = new Client()

// Boot: both start in the lobby. B is a late joiner and only hears the current world.
const lobby1 = world('lobby', 100, 'pvp', 'idle')
a.apply(lobby1)
b.apply(lobby1)
assertSame('boot lobby', lobby1, a, b)
if (!a.fp.includes('cross') && a.fp.split('|').length !== 5) {
  // 5 lobby tiles: 1 cross + 4 ends (or fewer if a mode is parked)
  const n = a.fp ? a.fp.split('|').length : 0
  if (n < 3 || n > 5) {
    console.error(`✗ lobby should be the voting cross, got ${n} tiles`)
    process.exit(1)
  }
}

const modes: Array<{ format: string; seed: number }> = [
  { format: 'pvp', seed: 201 },
  { format: 'balloon', seed: 202 },
  { format: 'prototype', seed: 203 },
  { format: 'bases', seed: 204 },
]

for (const m of modes) {
  const match = world('arena', m.seed, m.format, 'match')
  a.apply(match)
  // Late join mid-match: B missed earlier packets and only gets the live world.
  const late = new Client()
  late.apply(match)
  b.apply(match)
  assertSame(`match ${m.format}`, match, a, b, late)
  if (a.fp.split('|').length < 20) {
    console.error(`✗ arena ${m.format} should be a full maze, got ${a.fp.split('|').length} tiles`)
    process.exit(1)
  }

  const lobby = world('lobby', m.seed, m.format, 'idle')
  a.apply(lobby)
  // Stale match clock from the round that just ended must not rebuild the arena.
  a.apply(match)
  b.apply(lobby)
  late.apply(lobby)
  late.apply(match)
  if (a.have?.layout !== 'lobby' || b.have?.layout !== 'lobby' || late.have?.layout !== 'lobby') {
    console.error(`✗ stale match clock after ${m.format} pulled a client out of the lobby`)
    process.exit(1)
  }
  assertSame(`lobby after ${m.format}`, lobby, a, b, late)
}

// Reconnect mid-transition: A already has the new arena, B still in lobby, then catch-up.
const mid = world('arena', 305, 'bases', 'match')
a.apply(mid)
const reconnect = new Client()
reconnect.apply({ seq: mid.seq - 1, seed: 204, layout: 'lobby', format: 'bases', phase: 'idle' })
if (reconnect.have?.layout !== 'lobby') {
  console.error('✗ a mid-transition client should keep its last applied world until catch-up')
  process.exit(1)
}
reconnect.apply(mid)
assertSame('reconnect mid BASE CHARGE', mid, a, reconnect)

// A lobby vote tie is broken with the world-sync seq so every client agrees.
const tieVotes = emptyCounts()
tieVotes.pvp = 2
tieVotes.balloon = 2
const tieSeq = 7
const serverPick = pickWinner(tieVotes, tieSeq)
const clientA = pickWinner(tieVotes, tieSeq)
const clientB = pickWinner(tieVotes, tieSeq)
if (serverPick !== 'balloon' || clientA !== serverPick || clientB !== serverPick) {
  console.error(`✗ a tied vote must pick the same mode from the world seq on every client, got server=${serverPick} a=${clientA} b=${clientB}`)
  process.exit(1)
}
if (pickWinner(tieVotes, tieSeq + 1) !== 'pvp') {
  console.error('✗ a different world seq should be able to pick the other tied mode')
  process.exit(1)
}

console.log('✓ two clients, late join, stale clocks, and mode cycles stay on the server floor')
