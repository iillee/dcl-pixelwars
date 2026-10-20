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
import { assignTeam, rosterSize, getTeam, markActive, markInactive, activeHumanCount, activeSoloHumanTeam, pruneForNewRound, rosterEntries } from './roster'
import { onLeaveScene } from '@dcl/sdk/players'
import { applyPaint, coverage, drainDelta, getFullState, teamOfCell, sampleEnemyCells, clearAll as clearPaintState } from './paintState'
import { initBots, rebuildBotGraph, tickBots, botCount, getBotPositions, punchBot, getWalkableGraph } from './bots/manager'
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
import {
  dashEnabledForRound, SERVER_HIT_WINDOW_S, SERVER_MIN_DASH_GAP_S, SERVER_MAX_HITS_PER_DASH,
  bombEnabledForRound, BOMB_FUSE_S, SERVER_MIN_BOMB_GAP_S,
  lungeEnabledForRound, LUNGE_HITBOX_W, LUNGE_HITBOX_D, LUNGE_HITBOX_FORWARD, LUNGE_HIT_MAX_DY, SERVER_LUNGE_BOT_SLACK,
  LUNGE_BOT_SHOVE, LUNGE_BOT_STUN_S,
  burstEnabledForRound, SERVER_MIN_BURST_GAP_S, BURST_RADIUS, BURST_BOT_SHOVE, BURST_BOT_STUN_S,
} from '../shared/pvp'
import { LungeLedger } from '../shared/lunge'
import { BurstLedger, burstFootprint, burstCentre, inBurst } from '../shared/burst'
import { bombCells, bombFloorY } from './paintBomb'
import { initAnvils, anvilsMazeChanged, anvilsHit, anvilsRespawnRequest } from './anvils'
import { BURST_KNOCKBACK, LUNGE_KNOCKBACK } from '../shared/pvp'
import { SCENE_SIZE, getPlacedTilesInOrder } from '../maze/generator'

// Ingest rate limit: 3x3 footprint at 10Hz = 90 ids max per tick. 100 is
// the generous cap; anything beyond is either a bug or a cheater and we drop
// the whole message rather than half-apply.
const MAX_IDS_PER_TICK = 100

// Cap on cell changes per paintDelta / snapshot message (see the
// SATURATION DISCIPLINE note in shared/messages.ts).
const MAX_CHANGES_PER_MSG = 200

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
    paint: {
      teamOf: teamOfCell,
      // Enables the bot's enemy-hunter target tier (bot.ts ENEMY_BIAS).
      // Without this the ghost only chases neutral cells and plays
      // pure defense — easy to counter by camping its trail.
      sampleEnemy: sampleEnemyCells,
    },
    // "Active" = has painted (or joined) within the last 60s. Filters out
    // invisible scraper accounts that connect but never touch the ground.
    humanCount: activeHumanCount,
    soloHumanTeam: activeSoloHumanTeam,
  })
  rebuildBotGraph(currentRoundIndex())
  initAnvils()
  anvilsMazeChanged()

  // Snapshot rate-limit map, hoisted so onLeaveScene can clear a user's
  // entry on disconnect. Without this, a rejoin within SNAPSHOT_COOLDOWN_MS
  // gets its requestSnapshot silently dropped and the client stays blank
  // (no paint history). The cooldown still protects against in-session
  // snapshot floods from a single connected client.
  // Full team roster broadcast — drives client name tags. Small payload
  // (≤ ~10 players), sent only on join / leave / round reset.
  const broadcastRoster = (why: string) => {
    const entries = rosterEntries()
    console.log(`[Server] teamRoster (${why}) → ${entries.length} player(s): ${entries.map(e => `${e.userId.slice(0, 8)}=${e.team === 1 ? 'R' : 'B'}`).join(' ')}`)
    room.send('teamRoster', { entries })
  }

  // Per-player contribution this round (cells flipped to their team).
  // Same 'gained' count the leaderboard uses. Cleared at each boundary.
  const roundCells = new Map<string, number>()

  const SNAPSHOT_COOLDOWN_MS = 5000
  const lastSnapshotAt = new Map<string, number>()

  // Dash hit-window state per attacker (see the dashHit handler).
  const dashWindowStart = new Map<string, number>()
  const dashWindowTargets = new Map<string, Set<string>>()
  // Paint Bomb: last accepted drop per bomber + bombs waiting on their fuse.
  const lastBombAt = new Map<string, number>()
  const lunges = new LungeLedger()
  // Paint Burst: last accepted burst per player (cooldown) + hit dedupe.
  const lastBurstAt = new Map<string, number>()
  const bursts = new BurstLedger()
  const pendingBombs: Array<{ from: string; team: number; x: number; y: number; z: number; at: number }> = []

  // Detect real disconnects so the bot respawns immediately when a
  // second player leaves (instead of waiting up to 60s for the activity
  // window to expire). markInactive() keeps the roster slot for rejoin
  // stability — only the activity timestamp is cleared.
  onLeaveScene((userId: string) => {
    markInactive(userId)
    // Clear snapshot cooldown so a fast rejoin gets a fresh snapshot
    // instead of being rate-limited into a blank map.
    lastSnapshotAt.delete(userId)
    dashWindowStart.delete(userId)
    dashWindowTargets.delete(userId)
    lastBombAt.delete(userId)
    lunges.forget(userId)
    bursts.forget(userId)
    lastBurstAt.delete(userId)
    broadcastRoster('leave')
    console.log(`[Server] onLeaveScene ${userId} → marked inactive (active now ${activeHumanCount()})`)
  })

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
    const isRepeat = getTeam(from) !== null && rosterEntries().some(e => e.userId === from)
    const team = assignTeam(from)
    markActive(from) // count them as present immediately; paint activity will refresh it
    console.log(`[Server] joinRoster ${from} → team ${team === 1 ? 'RED' : 'BLUE'} (roster size ${rosterSize()}, active ${activeHumanCount()})`)
    room.send('teamAssigned', { team }, { to: [from] })
    broadcastRoster('join')
    // Queue a Discord join notification (debounced 5s to let updateName
    // arrive so we send the real display name, not the wallet hash).
    // Client retries joinRoster until teamAssigned lands; notify Discord once.
    if (!isRepeat) schedulePlayerJoin(from)
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
    // Even if nothing changed team (walking on own paint), the paintTick
    // itself is proof the player is real — mark them active so scraper
    // bots that never send paintTick are filtered out.
    markActive(from)
    if (gained > 0) {
      leaderboardIncrement(from, gained)
      roundCells.set(from, (roundCells.get(from) ?? 0) + gained)
    }
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
    // Saturation discipline (shared/messages.ts): ≤ MAX_CHANGES_PER_MSG per
    // message. Every chunk carries the same coverage counters.
    for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_MSG) {
      room.send('paintDelta', { changes: changes.slice(i, i + MAX_CHANGES_PER_MSG), red: c.red, blue: c.blue, total: c.total })
    }
  })

  // Bot position broadcast (10 Hz). Payload trivial — 3 bots × ≈20 bytes
  // = ~600 bytes/sec. Clients Tween between updates (100ms per segment)
  // for continuous walking motion.
  //
  // Rate history: 2Hz teleport-hop -> 4Hz Tweened (visible aliasing between
  // bot step cadence and broadcast cadence, uneven segment lengths) -> 10Hz
  // Tweened. Higher than 10Hz adds no value: bots only step 4x/sec, so any
  // faster broadcast just re-sends the same position (Tween no-ops).
  const BOT_POS_HZ = 10
  const BOT_POS_INTERVAL = 1 / BOT_POS_HZ
  let botPosClock = 0
  // Track prev count so we can emit ONE final empty payload on the
  // n→0 transition. Without this, clients never learn a bot retired
  // (their reap loop only fires when a botPositions message arrives),
  // so the ghost freezes in place after a 2nd human joins.
  let lastBotCount = 0
  engine.addSystem((dt: number) => {
    botPosClock += dt
    if (botPosClock < BOT_POS_INTERVAL) return
    botPosClock = 0
    const positions = getBotPositions()
    if (positions.length === 0 && lastBotCount === 0) return
    lastBotCount = positions.length
    room.send('botPositions', { bots: positions })
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

  // Dash PvP prototype (shared/pvp.ts). The attacker's client judged the
  // contact; we check teams, round mode and rate, then broadcast so the
  // victim's client can push itself. Positions are not visible here, so
  // distance can't be validated (anti-cheat deferred, see design doc).
  room.onMessage('dashHit', ({ target, dx, dz }, context) => {
    const from = context?.from
    if (!from) return
    if (!dashEnabledForRound(currentRoundIndex())) return
    const attackerTeam = getTeam(from)
    const want = target.toLowerCase()
    const victim = rosterEntries().find(e => e.userId.toLowerCase() === want)
    if (attackerTeam === null || !victim || victim.team === attackerTeam || victim.userId === from) {
      console.log(`[Server] dashHit ${from.slice(0, 8)} → ${target.slice(0, 8)} rejected: team check`)
      return
    }
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3) return
    const now = Date.now()
    const start = dashWindowStart.get(from)
    if (start === undefined || now - start >= SERVER_MIN_DASH_GAP_S * 1000) {
      dashWindowStart.set(from, now)
      dashWindowTargets.set(from, new Set())
    } else if (now - start > SERVER_HIT_WINDOW_S * 1000) {
      console.log(`[Server] dashHit ${from.slice(0, 8)} rejected: outside hit window (${now - start}ms)`)
      return
    }
    const hits = dashWindowTargets.get(from)!
    if (hits.has(victim.userId) || hits.size >= SERVER_MAX_HITS_PER_DASH) return
    hits.add(victim.userId)
    markActive(from)
    console.log(`[Server] dashImpact ${from.slice(0, 8)} → ${victim.userId.slice(0, 8)}`)
    room.send('dashImpact', { attacker: from, target: victim.userId, dx: dx / len, dz: dz / len })
  })

  // Lunge (shared/pvp.ts LUNGE_*, shared/lunge.ts, client/lunge.ts).
  // lungeStart: cooldown + team gate, rebroadcast so all clients show it.
  // lungeHit: the attacker's client detected contact (the server can't see
  // avatars, so player range is client-trusted; the ghost is range-checked
  // here). Accepted once per (attacker, lunge id, target) and only within
  // SERVER_LUNGE_HIT_WINDOW_S of the accepted start.
  room.onMessage('lungeStart', ({ id, dx, dz, x, y, z }, context) => {
    const from = context?.from
    if (!from || !lungeEnabledForRound(currentRoundIndex())) return
    if (getTeam(from) === null) return
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3 || ![x, y, z].every(isFinite)) return
    if (!lunges.start(from, id, Date.now())) {
      console.log(`[Server] lungeStart ${from.slice(0, 8)} rejected: cooldown`)
      return
    }
    markActive(from)
    room.send('lungeStarted', { attacker: from, id, dx: dx / len, dz: dz / len, x, y, z })
  })

  room.onMessage('lungeHit', ({ id, target, dx, dz, x, y, z }, context) => {
    const from = context?.from
    if (!from || !lungeEnabledForRound(currentRoundIndex())) return
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3 || ![x, y, z].every(isFinite)) return
    const ux = dx / len, uz = dz / len
    const attackerTeam = getTeam(from)
    if (attackerTeam === null) return
    let victimId = target
    if (target.startsWith('bot:')) {
      const bid = parseInt(target.slice(4), 10)
      const bot = getBotPositions().find(b => b.id === bid)
      if (!bot || bot.team === attackerTeam) return
    } else {
      const want = target.toLowerCase()
      const victim = rosterEntries().find(e => e.userId.toLowerCase() === want)
      if (!victim || victim.team === attackerTeam || victim.userId === from) {
        console.log(`[Server] lungeHit ${from.slice(0, 8)} → ${target.slice(0, 8)} rejected: team check`)
        return
      }
      victimId = victim.userId
    }
    const verdict = lunges.hit(from, id, victimId, Date.now())
    if (verdict !== 'ok') {
      console.log(`[Server] lungeHit ${from.slice(0, 8)} #${id} rejected: ${verdict}`)
      return
    }
    if (victimId.startsWith('bot:')) {
      if (!punchBot(parseInt(victimId.slice(4), 10), x, y, z, ux, uz, Math.hypot(LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D, LUNGE_HITBOX_W / 2) + 2 + SERVER_LUNGE_BOT_SLACK,
        LUNGE_HIT_MAX_DY + SERVER_LUNGE_BOT_SLACK, LUNGE_BOT_SHOVE, LUNGE_BOT_STUN_S * 1000)) return
    }
    console.log(`[Server] lungeImpact ${from.slice(0, 8)} #${id} → ${victimId.slice(0, 8)}`)
    room.send('lungeImpact', { attacker: from, id, target: victimId, dx: ux, dz: uz })
  })

  // ─── Paint Burst (shared/pvp.ts BURST_*, shared/burst.ts) ─────────
  // burstUse: server-enforced cooldown (SERVER_MIN_BURST_GAP_S),
  // rebroadcast burstFired; opponent ghost bots in range are shoved here.
  // burstHit: attacker client found a player in range + LOS; accepted once
  // per (attacker, burst id, target) within SERVER_BURST_HIT_WINDOW_S.
  // One-time paint: burstUse paints the whole footprint around the player's cell immediately.
  room.onMessage('burstUse', ({ id, cell, x, y, z, fx, fz }, context) => {
    const from = context?.from
    if (!from || !burstEnabledForRound(currentRoundIndex())) return
    const team = getTeam(from)
    if (team === null || ![x, y, z].every(isFinite)) return
    const now = Date.now()
    if (now - (lastBurstAt.get(from) ?? 0) < SERVER_MIN_BURST_GAP_S * 1000) {
      console.log(`[Server] burstUse ${from.slice(0, 8)} rejected: cooldown`)
      return
    }
    lastBurstAt.set(from, now)
    markActive(from)
    bursts.start(from, id, now)
    // Paint the footprint once (same score credit as normal paint).
    const graph = getWalkableGraph()
    const centre = graph ? burstCentre(graph, cell, { x, y, z }) : null
    let gained = 0
    if (graph && centre) for (const cid of burstFootprint(graph, centre)) if (applyPaint(cid, team)) gained++
    if (gained > 0) {
      leaderboardIncrement(from, gained)
      roundCells.set(from, (roundCells.get(from) ?? 0) + gained)
    }
    // TEMP (ramp paint debug): reported cell vs resolved centre, footprint size, ramp cells in it.
    const fp = graph && centre ? burstFootprint(graph, centre) : []
    const rampIds = fp.filter(c => getPlacedTilesInOrder().some(t => t.type === 'ramp' && c.startsWith(`${t.x},${t.z},${t.y}:`))).length
    console.log(`[Server] burst ${from.slice(0, 8)} #${id} painted ${gained} cells | cell=${cell || '(none)'} centre=${centre ?? 'null'} pos=${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} footprint=${fp.length} rampCells=${rampIds}`)
    room.send('burstFired', { attacker: from, id, team, x, y, z })
    for (const b of getBotPositions()) {
      if (b.team === team || !inBurst({ x, y, z }, { x: b.x, y: b.y, z: b.z }, BURST_RADIUS + 1)) continue
      let dx = b.x - x, dz = b.z - z
      const l = Math.hypot(dx, dz)
      if (l < 0.2) { dx = fx; dz = fz } else { dx /= l; dz /= l }
      const dl = Math.hypot(dx, dz) || 1
      if (punchBot(b.id, x, y, z, dx / dl, dz / dl, BURST_RADIUS + 2, BURST_RADIUS, BURST_BOT_SHOVE, BURST_BOT_STUN_S * 1000)) {
        bursts.hit(from, id, `bot:${b.id}`, now)
        room.send('burstImpact', { attacker: from, id, target: `bot:${b.id}`, dx: dx / dl, dz: dz / dl })
      }
    }
  })

  // Shared anvils: the attacker's client detected the hit; same ledgers (once per lunge/burst id
  // per anvil, within the window) as player hits, then the server knocks the anvil.
  room.onMessage('anvilHit', ({ kind, id, i, dx, dz }, context) => {
    const from = context?.from
    if (!from || ![dx, dz].every(isFinite)) return
    const len = Math.hypot(dx, dz)
    if (len < 1e-3) return
    const verdict = (kind === 1 ? bursts : lunges).hit(from, id, `anvil:${i}`, Date.now())
    if (verdict !== 'ok') { console.log(`[Server] anvilHit ${from.slice(0, 8)} #${id} anvil ${i} rejected: ${verdict}`); return }
    anvilsHit(i, dx / len, dz / len, kind === 1 ? BURST_KNOCKBACK / LUNGE_KNOCKBACK : 1)
  })
  room.onMessage('anvilRespawn', (_m, context) => { if (context?.from) anvilsRespawnRequest(context.from) })

  room.onMessage('burstHit', ({ id, target, dx, dz }, context) => {
    const from = context?.from
    if (!from || !burstEnabledForRound(currentRoundIndex())) return
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3) return
    const attackerTeam = getTeam(from)
    if (attackerTeam === null) return
    const want = target.toLowerCase()
    const victim = rosterEntries().find(e => e.userId.toLowerCase() === want)
    if (!victim || victim.team === attackerTeam || victim.userId === from) return
    const verdict = bursts.hit(from, id, victim.userId, Date.now())
    if (verdict !== 'ok') { console.log(`[Server] burstHit ${from.slice(0, 8)} #${id} rejected: ${verdict}`); return }
    room.send('burstImpact', { attacker: from, id, target: victim.userId, dx: dx / len, dz: dz / len })
  })

  // Paint Bomb (shared/pvp.ts). Position is the bomber's own report (the
  // server can't see avatars); everything else is decided here: cooldown,
  // floor snap, the painted circle (from the bot walkable graph, base lock
  // via applyPaint) and the blast broadcast. Opponents knock themselves back.
  room.onMessage('bombDrop', ({ x, y, z }, context) => {
    const from = context?.from
    if (!from) return
    if (!bombEnabledForRound(currentRoundIndex())) return
    const team = getTeam(from)
    if (team === null) return
    if (![x, y, z].every(isFinite) || x < 0 || z < 0 || x > SCENE_SIZE || z > SCENE_SIZE || y < -50 || y > 200) {
      console.log(`[Server] bombDrop from ${from.slice(0, 8)} rejected: bad position`)
      return
    }
    const now = Date.now()
    const last = lastBombAt.get(from) ?? 0
    if (now - last < SERVER_MIN_BOMB_GAP_S * 1000) {
      console.log(`[Server] bombDrop from ${from.slice(0, 8)} rejected: cooldown (${now - last}ms)`)
      return
    }
    lastBombAt.set(from, now)
    markActive(from)
    const by = bombFloorY(x, y, z) ?? y
    pendingBombs.push({ from, team, x, y: by, z, at: now + BOMB_FUSE_S * 1000 })
    room.send('bombArmed', { attacker: from, team, x, y: by, z })
  })

  engine.addSystem(() => {
    if (pendingBombs.length === 0) return
    const now = Date.now()
    for (let i = pendingBombs.length - 1; i >= 0; i--) {
      const b = pendingBombs[i]
      if (now < b.at) continue
      pendingBombs.splice(i, 1)
      let gained = 0
      for (const id of bombCells(b.x, b.y, b.z)) {
        if (applyPaint(id, b.team)) gained++
      }
      if (gained > 0) {
        leaderboardIncrement(b.from, gained)
        roundCells.set(b.from, (roundCells.get(b.from) ?? 0) + gained)
      }
      console.log(`[Server] bombBlast ${b.from.slice(0, 8)} at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)} → ${gained} cells`)
      room.send('bombBlast', { attacker: b.from, team: b.team, x: b.x, y: b.y, z: b.z, cells: gained })
    }
  })

  // Snapshot handler (Phase 4 Step 5). Late/reloading clients ask once
  // after teamAssigned; we reply with the full paint map addressed to
  // just them. Rate limit: 1 per 5s per sender — a rapid reconnect loop
  // (or a bad actor) can't flood us with big payloads.
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
    // Chunked like paintDelta. The client applies each chunk independently
    // (same path as paint:delta), so order and count don't matter. An empty
    // round still sends one empty chunk so the client sees the server alive.
    for (let i = 0; i === 0 || i < entries.length; i += MAX_CHANGES_PER_MSG) {
      room.send('snapshot', { entries: entries.slice(i, i + MAX_CHANGES_PER_MSG), red: c.red, blue: c.blue, total: c.total }, { to: [from] })
    }
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
    // Personal results go out BEFORE roundReset so the client already has
    // its line when the banner opens. teamCells = sum of every teammate's
    // contribution this round, so shares within a team add up to 100%.
    const teamCells: Record<number, number> = { 1: 0, 2: 0 }
    for (const [uid, n] of roundCells) {
      const t = getTeam(uid)
      if (t !== null) teamCells[t] = (teamCells[t] ?? 0) + n
    }
    for (const { userId, team } of rosterEntries()) {
      room.send('roundResult', { cells: roundCells.get(userId) ?? 0, teamCells: teamCells[team] ?? 0, team }, { to: [userId] })
    }
    roundCells.clear()
    // A bomb armed in the old round would paint stale cell ids.
    pendingBombs.length = 0
    room.send('roundReset', { seed: idx, finalRed: c.red, finalBlue: c.blue, finalTotal: c.total })
    clearPaintState()
    // Drop team assignments of players who left, so a later rejoin is
    // balanced against the current lobby. Active players keep their team.
    const pruned = pruneForNewRound()
    if (pruned > 0) console.log(`[Server] roster: pruned ${pruned} inactive player(s) at round boundary`)
    broadcastRoster('reset')
    rebuildBotGraph(idx)
    anvilsMazeChanged()
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
