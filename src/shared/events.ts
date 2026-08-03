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

  // UTC round boundary crossed. Server has already zeroed its paint state
  // and rolled the new seed. Subscribers: HUD (banner), paint (clear),
  // maze (rebuild via SeedHolder), player (teleport to center), and
  // eventually audio (fanfare).
  'round:reset': {
    seed: number
    finalRed: number
    finalBlue: number
    finalTotal: number
  }
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
