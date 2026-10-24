/**
 * events.ts — typed in-process event bus for the client runtime.
 *
 * Purpose: decouple publishers (network handlers, gameplay code) from
 * subscribers (audio, HUD, VFX, maze rebuild). Publishers `emit`, subscribers
 * `on` — neither knows about the other.
 *
 * Design choices:
 * - Fully typed via the `Events` map below. `on('round:reset', p => …)`
 *   autocompletes `p` and errors if the payload shape is wrong. Adding a
 *   new event = one entry in `Events` + normal type-driven usage.
 * - No wildcards, no priorities, no async. Sync fan-out only. If you need
 *   ordering, wire it in the subscriber (e.g. a `sceneReady` flag).
 * - Snapshot iteration: emit copies the listener array so a subscriber
 *   that unsubscribes itself during dispatch doesn't skip a sibling.
 * - No engine imports — safe to use from any runtime (client, server, tests).
 *
 * Naming convention: `domain:event` — `round:reset`, `paint:delta`, etc.
 * Past-tense verbs read best on the subscriber side ("on round reset, do X").
 *
 * Not a replacement for ECS. Use events for lifecycle / one-shots /
 * cross-cutting notifications. Use components + systems for continuous
 * game state (paint map, player position, timers).
 */

import type { Team } from './team'

// ─── Event map ──────────────────────────────────────────────────────
// Add new events here. Payload types are enforced at every emit and on.
export type Events = {
  // Server → client, translated by clientHandler.
  // Team assignment reply for our joinRoster. Fires exactly once per session.
  'team:assigned': { team: Team }

  // Addressed, just before round:reset: our personal result for the round.
  'round:result': { cells: number; teamCells: number; team: Team }
  'round:owners': { owners: Array<{ id: string; name: string; team: number; cells: number; kos: number; deaths: number; painted: number }> }

  // Broadcast on join / leave / round reset: every active player's team.
  // Subscriber: client/nametags (red/blue plates above avatars).
  'team:roster': { entries: Array<{ userId: string; team: Team }> }

  // 5 Hz broadcast: authoritative paint changes since the last tick, plus
  // the current global coverage counters. Subscribers: paint (apply cells),
  // HUD (update %).
  'paint:delta': {
    changes: Array<{ id: string; team: Team }>
    red: number
    blue: number
    total: number
  }

  // One-shot response to requestSnapshot: full paint map at time of send.
  // Same shape family as paint:delta, but semantically "authoritative
  // full state" rather than "changes since last tick".
  'paint:snapshot': {
    entries: Array<{ id: string; team: Team }>
    red: number
    blue: number
    total: number
  }

  // Round ended (scores only). Subscriber: round.ts banner. Maze stays until round:reset.
  'round:ended': {
    finalRed: number
    finalBlue: number
    finalTotal: number
  }

  // After summary wait: new seed. Subscribers: paint (clear), maze (rebuild), player (teleport).
  'round:reset': {
    seed: number
    finalRed: number
    finalBlue: number
    finalTotal: number
  }


  // 2 Hz broadcast: current bot positions (empty when no bots active).
  // Subscriber: client/botVisual renders one box per entry.
  'bots:positions': {
    bots: Array<{ id: number; team: number; x: number; y: number; z: number }>
  }

  // Broadcast: server accepted a dash hit. Subscriber: client/dash
  // (victim self-applies knockback; everyone shows the impact).
  'dash:impact': { attacker: string; target: string; dx: number; dz: number }

  // Broadcast: a lunge started / an accepted lunge hit. Subscriber: client/lunge.
  'lunge:started': { attacker: string; id: number; dx: number; dz: number; x: number; y: number; z: number }
  'lunge:impact': { attacker: string; id: number; target: string; dx: number; dz: number }

  // Paint Burst. Subscriber: client/paintBurst.
  'burst:fired': { attacker: string; id: number; team: Team; x: number; y: number; z: number; air: number; lx: number; ly: number; lz: number }
  'burst:impact': { attacker: string; id: number; target: string; dx: number; dz: number; air: number }
  // Attacker only: the server applied this burst's footprint. Subscriber: client/paintBurst.
  'burst:painted': { id: number; n: number }
  // Broadcast: Paint Bomb telegraph / detonation. Subscriber: client/paintBomb.
  'bomb:armed': { attacker: string; team: Team; x: number; y: number; z: number }
  'bomb:blast': { attacker: string; team: Team; x: number; y: number; z: number; cells: number }

  // Local: client/player teleported us home (spawn, round reset, fall).
  // Subscriber: client/knockback (brief knockback immunity).
  'player:respawned': { why: string }
}

// ─── Bus implementation ─────────────────────────────────────────────
type EventKey = keyof Events
type Listener<K extends EventKey> = (payload: Events[K]) => void
type Unsubscribe = () => void

function createBus() {
  const listeners: { [K in EventKey]?: Listener<K>[] } = {}

  return {
    on<K extends EventKey>(event: K, listener: Listener<K>): Unsubscribe {
      const arr = (listeners[event] ??= []) as Listener<K>[]
      arr.push(listener)
      return () => {
        const idx = arr.indexOf(listener)
        if (idx !== -1) arr.splice(idx, 1)
      }
    },

    emit<K extends EventKey>(event: K, payload: Events[K]): void {
      const arr = listeners[event] as Listener<K>[] | undefined
      if (!arr || arr.length === 0) return
      // Snapshot: a listener unsubscribing mid-dispatch mustn't skip peers.
      const snapshot = arr.slice()
      for (const fn of snapshot) {
        try {
          fn(payload)
        } catch (err) {
          console.error(`[events] listener for "${event}" threw:`, err)
        }
      }
    },

    // Testing / teardown helper. Rarely needed at runtime.
    clear<K extends EventKey>(event?: K): void {
      if (event) delete listeners[event]
      else for (const k of Object.keys(listeners) as EventKey[]) delete listeners[k]
    },
  }
}

export const events = createBus()
