/**
 * server.ts — Pixelwars authoritative server entry point.
 *
 * Thin orchestrator, flagtag-pattern. Runs in the headless SDK server
 * process (hammurabi-server). No 3D, no ~system/RestrictedActions —
 * pure state + WS message handling.
 *
 * Responsibilities: roster/team assignment, authoritative paint state,
 * 5Hz paintDelta broadcasts, snapshot requests, and UTC-boundary
 * roundReset. See src/shared/messages.ts for the wire schema.
 */

import { engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { LeaderboardState, leaderboardStateEntity } from '../shared/components'
import { room } from '../shared/messages'
import { assignTeam, rosterSize, getTeam } from './roster'
import { applyPaint, coverage, drainDelta, getFullState, teamOfCell, clearAll as clearPaintState } from './paintState'
import { initBots, rebuildBotGraph, tickBots, botCount } from './bots/manager'
import {
  loadFromStorage as loadLeaderboard,
  saveToStorage as saveLeaderboard,
  incrementPaint as leaderboardIncrement,
  updateName as leaderboardUpdateName,
  publish as publishLeaderboard,
  getName as leaderboardGetName,
} from './leaderboard'
import { initDiscord, bindNameResolver, schedulePlayerJoin, flushPendingJoins } from './discord'

// Round loop constants — single source of truth lives in shared/roundTiming.ts
// so client (src/round.ts) and server share the exact same cadence. Do not
// redefine here; edit the shared module if the cadence changes.
import { getRoundIndex as currentRoundIndex } from '../shared/roundTiming'

// Ingest rate limit: 3x3 footprint at 10Hz = 90 ids max per tick. 100 is
// the generous cap; anything beyond is either a bug or a cheater and we drop
// the whole message rather than half-apply.
const MAX_IDS_PER_TICK = 100

export async function setupServer(): Promise<void> {
  console.log('[Server] Starting Pixelwars server...')

  // Load leaderboard from Storage before any paintTicks land, so we don't
  // clobber persisted state with a fresh empty board. loadFromStorage()
  // also publishes to the CRDT-synced LeaderboardState so late-joining
  // clients see it immediately without waiting for a round boundary.
  await loadLeaderboard()

  // Register the LeaderboardState entity on the CRDT sync mesh with a
  // fixed networkId (3001) matching the client. Server mutations to this
  // component now propagate to every connected client.
  syncEntity(leaderboardStateEntity, [LeaderboardState.componentId], 3001)

  // Discord webhook + realm/preview detection. Wire the name resolver so
  // the notifier can pull display names captured via updateName. Silent
  // no-op if DISCORD_PLAYER_JOIN_WEBHOOK isn't set or we're in preview.
  bindNameResolver(leaderboardGetName)
  await initDiscord()

  // Bot subsystem — Phase 5a. Server-side virtual painters that keep the
  // scene alive when human count < TARGET_ACTIVE. Retire gracefully as
  // humans join; never appear on the leaderboard.
  //
  initBots({
    applyPaint,
    paint: { teamOf: teamOfCell },
    humanCount: rosterSize,
  })
  rebuildBotGraph(currentRoundIndex())

  // Roster handler — assign or look up a player's team.
  // Client sends joinRoster once on boot; we reply teamAssigned to that sender only.
  // Idempotent: repeated calls for the same userId return the same team.
  // Trust model: userId comes from context.from (authenticated by hammurabi),
  // NOT from the payload's userId field — payload is redundant but useful
  // for logging early-connect diagnostics.
  room.onMessage('joinRoster', ({ userId }, context) => {
    const from = context?.from
    if (!from) {
      console.log(`[Server] joinRoster rejected: no context.from (payload userId=${userId})`)
      return
    }
    if (from !== userId) {
      // Not an error — client may not have context.from's exact address casing.
      // We ignore the payload and use context.from as authoritative.
      console.log(`[Server] joinRoster payload/from mismatch (payload=${userId}, from=${from}) — using from`)
    }
    const team = assignTeam(from)
    console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()})`)
    room.send('teamAssigned', { team }, { to: [from] })
    // Queue a Discord join notification (debounced 5s to let updateName
    // arrive so we send the real display name, not the wallet hash).
    schedulePlayerJoin(from)
  })

  // Paint ingest — client-authored cell ids, attributed to sender's team.
  // If sender hasn't joined the roster yet (race: paint fires before
  // teamAssigned round-trips), drop silently — client will resend on the
  // next tick as new cells accumulate in its outbox.
  room.onMessage('paintTick', ({ ids }, context) => {
    const from = context?.from
    if (!from) return
    const team = getTeam(from)
    if (team === null) return  // pre-roster paint, retry on next tick
    if (ids.length > MAX_IDS_PER_TICK) {
      console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${MAX_IDS_PER_TICK}`)
      return
    }
    // Count only cells that actually changed team — a player standing
    // still on their own paint re-sends the same 9 cellIds every 100ms;
    // crediting all of them would inflate the leaderboard by ~90/sec.
    let gained = 0
    for (const id of ids) {
      if (applyPaint(id, team)) gained++
    }
    if (gained > 0) leaderboardIncrement(from, gained)
  })

  // Name capture — client sends once on join with PlayerIdentityData.name.
  // Server keeps the map in memory and patches existing leaderboard rows.
  room.onMessage('updateName', ({ name }, context) => {
    const from = context?.from
    if (!from) return
    leaderboardUpdateName(from, name)
  })

  // On-demand leaderboard refresh — client asks when opening the popup.
  // We simply republish the CRDT-synced component; the requesting client
  // (and everyone else, harmlessly) picks up the new snapshot on next
  // engine tick. No addressed reply needed — CRDT delivers to all.
  room.onMessage('requestLeaderboard', (_data, context) => {
    if (!context?.from) return
    publishLeaderboard()
  })

  // Broadcast tick (Phase 4 Step 4). 5Hz — the SATURATION_BUDGET rate
  // from src/shared/messages.ts. Drains accumulated paint changes and
  // sends paintDelta to ALL clients (no `to:`). Coverage rides in every
  // message so HUDs stay in sync without a separate poll. Silent tick
  // (drainDelta returns []) skips the send entirely.
  const BROADCAST_HZ = 5
  const BROADCAST_INTERVAL = 1 / BROADCAST_HZ
  let broadcastClock = 0
  engine.addSystem((dt: number) => {
    broadcastClock += dt
    if (broadcastClock < BROADCAST_INTERVAL) return
    // Tick bots BEFORE draining, so any paint they generate this frame
    // rides out on the same broadcast — no extra latency and no wasted
    // "skip empty" checks.
    tickBots(broadcastClock)
    broadcastClock = 0
    const changes = drainDelta()
    if (changes.length === 0) return
    const c = coverage()
    room.send('paintDelta', { changes, red: c.red, blue: c.blue, total: c.total })
  })

  // Coverage log tick (5s). Kept as a low-frequency health signal;
  // paintDelta is the real-time path.
  let coverageClock = 0
  engine.addSystem((dt: number) => {
    coverageClock += dt
    if (coverageClock < 5) return
    coverageClock = 0
    const c = coverage()
    if (c.total > 0) {
      console.log(`[Server] coverage: red=${c.red} blue=${c.blue} total=${c.total} bots=${botCount()}`)
    }
  })

  // Snapshot handler (Phase 4 Step 5). Late/reloading clients ask once
  // after teamAssigned; we reply with the full paint map addressed to
  // just them. Rate limit: 1 per 5s per sender — a rapid reconnect loop
  // (or a bad actor) can't flood us with big payloads.
  const SNAPSHOT_COOLDOWN_MS = 5000
  const lastSnapshotAt = new Map<string, number>()
  room.onMessage('requestSnapshot', (_data, context) => {
    const from = context?.from
    if (!from) return
    const now = Date.now()
    const last = lastSnapshotAt.get(from) ?? 0
    if (now - last < SNAPSHOT_COOLDOWN_MS) {
      console.log(`[Server] requestSnapshot from ${from} rate-limited (${now - last}ms since last)`)
      return
    }
    lastSnapshotAt.set(from, now)
    const entries = getFullState()
    const c = coverage()
    console.log(`[Server] snapshot → ${from} (${entries.length} cells, red=${c.red} blue=${c.blue})`)
    room.send('snapshot', { entries, red: c.red, blue: c.blue, total: c.total }, { to: [from] })
  })

  // Round loop (Phase 4 Step 6). Server owns the boundary. On crossing:
  // 1) snapshot final coverage BEFORE clearing (banner needs it),
  // 2) broadcast roundReset with authoritative counts + new seed,
  // 3) clear paint state so the new round starts clean.
  // Order matters: broadcast BEFORE clearAll so the message we send
  // carries the ending round's counts, not zeros.
  let lastRoundIndex = 0
  engine.addSystem(() => {
    const idx = currentRoundIndex()
    if (lastRoundIndex === 0) { lastRoundIndex = idx; return }
    if (idx === lastRoundIndex) return
    const c = coverage()
    console.log(`[Server] round boundary: ${lastRoundIndex} → ${idx} (final red=${c.red} blue=${c.blue} total=${c.total})`)
    room.send('roundReset', { seed: idx, finalRed: c.red, finalBlue: c.blue, finalTotal: c.total })
    clearPaintState()
    rebuildBotGraph(idx)
    // Round boundary is our persistence + publish cadence for the
    // leaderboard: 5 min is frequent enough that a server crash loses at
    // most one round of paint credit, infrequent enough that Storage
    // writes are cheap. Fire-and-forget — don't block round advancement
    // on I/O.
    void saveLeaderboard()
    publishLeaderboard()
    lastRoundIndex = idx
  })

  // Discord flush tick — low frequency; the delay is 5s so 1Hz polling
  // gives us more-than-fast-enough drain. Cheap when nothing's pending.
  let discordFlushClock = 0
  engine.addSystem((dt: number) => {
    discordFlushClock += dt
    if (discordFlushClock < 1) return
    discordFlushClock = 0
    flushPendingJoins()
  })

  console.log('[Server] ✅ Ready — listening for joinRoster, paintTick, requestSnapshot; broadcasting paintDelta at 5Hz + roundReset on UTC boundaries.')
}
