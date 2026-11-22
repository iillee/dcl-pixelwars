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
import { assignTeam, rosterSize, getTeam, markActive, markInactive, activeHumanCount, activeSoloHumanTeam, activeTeamCounts, setTeam, setForcedTeam, assignAllConnected, pruneForNewRound, rosterEntries, connectedCount } from './roster'
import { onLeaveScene } from '@dcl/sdk/players'
import { applyPaint, ownerCounts, coverage, drainDelta, paintWaitMs, getFullState, paintedCount, teamOfCell, sampleEnemyCells, clearAll as clearPaintState, setPaintListener } from './paintState'
import { pickTeamRescueCell } from '../shared/teamRescue'
import { botCount, getBotBroadcast, getBotHitPoints, getBotPositions, getWalkableGraph, hitBot, initBots, rebuildBotGraph, sleepBots, tickBots, botSimTime } from './bots/manager'
import { lungeKnock, burstKnock, spikeKnock } from '../shared/knocks'
import { canSpawnStar, nextStarSpawnAt, overdriveFeetFresh, pickStarSpawn, starPickupWinner, type StarCell } from '../shared/overdrive'
import { OverdriveBook } from './overdriveBook'
import { UpgradeBook } from './upgradeBook'
import { burstPaintRadiusCellsFor, hasteCooldownMult, upgradeChargeFor, upgradeKindFromId } from '../shared/upgrades'
import { RESCUE_TIMES } from '../shared/rescuePath'
import {
  loadFromStorage as loadLeaderboard,
  saveToStorage as saveLeaderboard,
  incrementPaint as leaderboardIncrement,
  updateName as leaderboardUpdateName,
  publish as publishLeaderboard,
  getName as leaderboardGetName,
  recordWin,
} from './leaderboard'
import { initDiscord, bindNameResolver, schedulePlayerJoin, flushPendingJoins } from './discord'

// Round loop constants — single source of truth lives in shared/roundTiming.ts
// so client (src/round.ts) and server share the exact same cadence. Do not
// redefine here; edit the shared module if the cadence changes.
import { getRoundIndex as currentRoundIndex, getRoundEndMs, isRoundActive, setRoundState, ROUND_INTERVAL_MS, SUMMARY_MS } from '../shared/roundTiming'
import {
  lungeEnabledForRound, LUNGE_HITBOX_W, LUNGE_HITBOX_D, LUNGE_HITBOX_FORWARD, LUNGE_HIT_MAX_DY, SERVER_LUNGE_BOT_SLACK,
  burstEnabledForRound, SERVER_MIN_BURST_GAP_S, SERVER_BURST_LAND_WINDOW_S, BURST_RADIUS, BURST_HIT_MAX_DY, BURST_PAINT_MAX_DY,
  AIR_SPIKE_RADIUS, AIR_SPIKE_DEPTH, BOT_AIM_STALE_S,
  STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, STAR_HOVER_Y, STAR_FALL_MS, STAR_PICKUPS_ENABLED, SERVER_MIN_LUNGE_GAP_S,
} from '../shared/pvp'
import { LungeLedger } from '../shared/lunge'
import { BurstLedger, burstFootprint, burstCentre, inAirSpike, inBurst, shockwaveHitsBot, burstBotInRange, burstDir } from '../shared/burst'
import { noteHit, noteAnvilTouch, anvilCredit, noteFell, kosOf, deathsOf, statIds, clearRoundStats } from './roundStats'
import { initAnvils, anvilsMazeChanged, anvilsHit, anvilsRespawnRequest, anvilsPush, anvilsAwake, tryAnvilPlayerStrike } from './anvils'
import { LOBBY_VOTE_MS, assignLobbyTeams, teamIdOf } from '../shared/lobby'
import { clearLobbyVotes, countedTeam, forgetLobbyPlayer, lobbySampleIds, lobbyVerdict, lobbyWho, noteLobbyPos, occupancyTeams, snapshotLobbyChoices, stepLobby, tallyTeams } from './lobbyVote'
import { BURST_KNOCKBACK, LUNGE_KNOCKBACK } from '../shared/pvp'
import { SCENE_SIZE, baseSpawn, baseTeamOfCellId, getPlacedTilesInOrder, placeLobbyLayout } from '../maze/generator'
import { BASE_PAINT_LOCK, SKY_TOP_Y } from '../maze/level'
import { beginLagFrame, endLagFrame, hookRoomSend, noteLagSection } from './lagStats'
import { pvpBotFill, teamCountsTotal, teamName, teamCount, smallestTeam, PLAYING_TEAMS, leadingTeams } from '../shared/team'

// Ingest rate limit: a 13-cell upgraded brush at 10Hz is 130 ids. 260 is
// the generous cap (covers a leftover 5x5 star brush at 250 if re-enabled); anything beyond is either a bug or a cheater and we drop
// the whole message rather than half-apply.
const MAX_IDS_PER_TICK = 260

// Cap on cell changes per paintDelta / snapshot message (see the
// SATURATION DISCIPLINE note in shared/messages.ts).
const MAX_CHANGES_PER_MSG = 200

export async function setupServer(): Promise<void> {
  hookRoomSend(room)
  console.log(`[Server] Starting Pixelwars server... scene=${SCENE_SIZE}m parcels=${(SCENE_SIZE / 16) * (SCENE_SIZE / 16)}`)

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
  // the notifier can pull display names captured via updateName. Joins that
  // arrive before this settles are queued inside discord.ts; they are not
  // dropped, and joinRoster does not wait on getRealm or EnvVar.get.
  bindNameResolver(leaderboardGetName)
  void initDiscord().catch((err) => console.log(`[Discord] init failed (${err})`))

  // Players' own feet positions (client botAim, ~5 Hz while a ghost is in the
  // round), so ghost bots can aim. Keyed by lower-case address.
  const botAim = new Map<string, { x: number; y: number; z: number; t: number }>()
  room.onMessage('botAim', ({ x, y, z }, context) => {
    const from = context?.from
    if (!from || ![x, y, z].every(n => typeof n === 'number' && isFinite(n))) return
    botAim.set(from.toLowerCase(), { x, y, z, t: Date.now() })
  })

  // Per-player cells flipped this round. Bots use `bot:<id>` and are cleared
  // with the round. Same 'gained' count humans get; bots are not persisted.
  const roundCells = new Map<string, number>()
  const dirtyPaintScores = new Set<string>()
  const lastSentPaintScore = new Map<string, number>()
  const addRoundCells = (id: string, n: number): void => {
    if (n <= 0) return
    roundCells.set(id, (roundCells.get(id) ?? 0) + n)
    if (!id.startsWith('bot:')) dirtyPaintScores.add(id)
  }
  const overdrive = new OverdriveBook()
  const upgrades = new UpgradeBook()
  let starRoundStart = 0
  let starNextAt = 0
  const starLandAt = new Map<number, number>()
  const overdriveFeet = (id: string, now: number): { x: number; y: number; z: number } | null => {
    if (id.startsWith('bot:')) {
      const bid = parseInt(id.slice(4), 10)
      const b = getBotHitPoints().find(p => p.id === bid)
      return b ? { x: b.x, y: b.y, z: b.z } : null
    }
    const f = botAim.get(id.toLowerCase())
    if (!f || !overdriveFeetFresh(f.t, now)) return null
    return f
  }
  const starCells = (): StarCell[] => {
    const g = getWalkableGraph()
    if (!g) return []
    const out: StarCell[] = []
    for (const [id, p] of g.worldPos) out.push({ id, x: p[0], y: p[1], z: p[2] })
    return out
  }
  const starAvoid = (now: number): Array<{ x: number; z: number }> => {
    const avoid: Array<{ x: number; z: number }> = []
    for (const f of botAim.values()) {
      if (overdriveFeetFresh(f.t, now)) avoid.push({ x: f.x, z: f.z })
    }
    for (const b of getBotHitPoints()) avoid.push({ x: b.x, z: b.z })
    return avoid
  }
  const scheduleNextStar = (now: number): void => {
    starNextAt = matchLive()
      ? nextStarSpawnAt(now, STAR_SPAWN_MIN_MS, STAR_SPAWN_MAX_MS, Math.random)
      : 0
  }
  const clearStars = (): void => {
    for (const o of overdrive.clearRound()) room.send('starDespawn', { i: o.i })
    starRoundStart = 0
    starNextAt = 0
    starLandAt.clear()
  }
  const armStarRound = (now: number): void => {
    clearStars()
    starRoundStart = now
    starNextAt = now
  }
  const sendStarSnapshotTo = (id: string, now = Date.now()): void => {
    if (!id || id.startsWith('bot:')) return
    for (const o of overdrive.liveOrbs()) {
      room.send('starSpawn', { i: o.i, x: o.x, y: o.y, z: o.z, fall: Math.max(0, (starLandAt.get(o.i) ?? 0) - now) }, { to: [id] })
    }
  }
  const tryPickupStars = (now: number): void => {
    if (!matchLive()) return
    for (const orb of overdrive.liveOrbs()) {
      const touches: Array<{ id: string; isBot: boolean; distH: number; distY: number }> = []
      for (const e of rosterEntries()) {
        const vid = e.userId.toLowerCase()
        const ft = overdriveFeet(vid, now)
        if (!ft) continue
        touches.push({ id: vid, isBot: false, distH: Math.hypot(ft.x - orb.x, ft.z - orb.z), distY: Math.abs(ft.y - orb.y) })
      }
      if ((starLandAt.get(orb.i) ?? 0) > now) continue
      const winner = starPickupWinner(touches)
      if (!winner) continue
      if (!overdrive.removeOrb(orb.i)) continue
      starLandAt.delete(orb.i)
      room.send('starDespawn', { i: orb.i })
      scheduleNextStar(now)
      const granted = upgrades.grantBonus(winner)
      if (granted) sendUpgradeTo(winner)
      console.log('[Server] star pickup ' + winner.slice(0, 8) + ' upgrade=' + (granted ? '1' : '0'))
    }
  }
  const trySpawnStar = (now: number): void => {
    if (!STAR_PICKUPS_ENABLED || !matchLive()) return
    if (!canSpawnStar({
      now, roundStartAt: starRoundStart, nextAt: starNextAt,
      activeOrbs: overdrive.orbCount(),
    })) return
    const cell = pickStarSpawn(starCells(), starAvoid(now))
    if (!cell) { starNextAt = now + 2000; return }
    const orb = overdrive.addOrb({ x: cell.x, y: cell.y + STAR_HOVER_Y, z: cell.z, cell: cell.id })
    starLandAt.set(orb.i, now + STAR_FALL_MS)
    room.send('starSpawn', { i: orb.i, x: orb.x, y: orb.y, z: orb.z, fall: STAR_FALL_MS })
    console.log('[Server] star spawn ' + orb.i + ' cell=' + orb.cell)
  }
  const tickOverdrive = (now: number): void => {
    tryPickupStars(now)
    trySpawnStar(now)
  }
  const flushPaintScores = (): void => {
    for (const id of dirtyPaintScores) {
      const n = roundCells.get(id) ?? 0
      if (lastSentPaintScore.get(id) === n) continue
      lastSentPaintScore.set(id, n)
      room.send('paintScore', { n }, { to: [id] })
    }
    dirtyPaintScores.clear()
    flushUpgrades()
  }
  const sendPaintScoreTo = (id: string): void => {
    if (!id || id.startsWith('bot:')) return
    const n = roundCells.get(id) ?? 0
    lastSentPaintScore.set(id, n)
    room.send('paintScore', { n }, { to: [id] })
  }
  const sendUpgradeTo = (id: string): void => {
    if (!id || id.startsWith('bot:')) return
    room.send('upgradeState', upgrades.ownerState(id), { to: [id] })
  }
  const sendUpgradeBuffs = (id: string): void => {
    if (!id || id.startsWith('bot:')) return
    room.send('upgradeBuffs', { reset: 0, entries: [upgrades.buffOf(id)] })
  }
  const sendUpgradeBuffsSnapshot = (to?: string): void => {
    const payload = { reset: 1, entries: upgrades.buffEntries() }
    if (to) room.send('upgradeBuffs', payload, { to: [to] })
    else room.send('upgradeBuffs', payload)
  }
  const flushUpgrades = (): void => {
    for (const id of upgrades.takeDirty()) sendUpgradeTo(id)
  }
  const clearUpgradesAndNotify = (): void => {
    const ids = upgrades.clearRound()
    for (const id of ids) sendUpgradeTo(id)
    room.send('upgradeBuffs', { reset: 1, entries: [] })
  }
  const abilityGapS = (id: string, base: number, _now: number): number => {
    return base * hasteCooldownMult(upgrades.level(id, 'haste'))
  }
  const clearRoundCellsAndNotify = (): void => {
    const ids = new Set<string>()
    for (const id of lastSentPaintScore.keys()) if (!id.startsWith('bot:')) ids.add(id)
    for (const id of roundCells.keys()) if (!id.startsWith('bot:')) ids.add(id)
    roundCells.clear()
    dirtyPaintScores.clear()
    for (const id of ids) room.send('paintScore', { n: 0 }, { to: [id] })
    lastSentPaintScore.clear()
    clearStars()
    clearUpgradesAndNotify()
  }
  /** Team of each `bot:<id>` seen this round, including bots retired after scoring. */
  const botTeams = new Map<string, number>()
  // Bot paint: live/round scoreboard only. Never leaderboardIncrement (that map is persisted).
  const applyBotPaint = (cellId: string, team: number, painter: string): boolean => {
    const gained = paintCells(painter, team, [cellId], cellId, false)
    if (gained > 0) {
      addRoundCells(painter, gained)
      botTeams.set(painter, team)
    }
    return gained > 0
  }

  // Bots fill the active-human gap on the short team only. Paint is credited
  // to `bot:<id>` on the live scoreboard; the persisted top-painters board
  // stays human-only.
  initBots({
    rescuePaintedHome: (team, from, occupied, painted) => paintedRescueHome(team, from, occupied, painted),
    paintedCells: getFullState,
    applyPaint: applyBotPaint,
    paint: {
      teamOf: teamOfCell,
      // Enables the bot's enemy-hunter target tier (bot.ts ENEMY_BIAS).
      // Without this the ghost only chases neutral cells and plays
      // pure defense — easy to counter by camping its trail.
      sampleEnemy: sampleEnemyCells,
    },
    // Active = roster idle rule (60s). Humans only; AFK humans drop out and a bot fills.
    activeHumans: activeTeamCounts,
    // A knocked-off ghost rides the same cloud a player does: every client
    // flies it along the shared path (mobile 1) while the bot body follows it.
    onFell: (id, at, base) => {
      const who = `bot:${id}`
      const by = noteFell(who)
      room.send('rescueStart', { who, x: at.x, y: at.y, z: at.z, bx: base.x, by: base.y, bz: base.z, mobile: 1, ...RESCUE_TIMES })
      if (by) announceKo(by, who)
      console.log(`[Server] ghost ${id} fell${by ? ` — KO by ${by.slice(0, 10)}` : ''}`)
    },
    onRescueEnd: id => {
      room.send('rescueEnd', { who: `bot:${id}` })
    },
    // Combat: bots attack with players' broadcasts; each victim's client judges
    // the hit on its own screen and knocks itself, as against a player.
    humans: () => {
      const now = Date.now()
      const out: Array<{ id: string; team: number; x: number; y: number; z: number }> = []
      for (const e of rosterEntries()) {
        const a = botAim.get(e.userId.toLowerCase())
        if (a && now - a.t <= BOT_AIM_STALE_S * 1000) out.push({ id: e.userId.toLowerCase(), team: e.team, x: a.x, y: a.y, z: a.z })
      }
      return out
    },
    abilities: () => ({ lunge: lungeEnabledForRound(currentRoundIndex()), burst: burstEnabledForRound(currentRoundIndex()) }),
    onLunge: (id, lungeId, dx, dz, at) => {
      room.send('lungeStarted', { attacker: `bot:${id}`, id: lungeId, dx, dz, x: at.x, y: at.y, z: at.z, dry: 0 })
    },
    onBurst: (id, burstId, team, at, air = 0, _fx = 0, _fz = 1) => {
      const by = `bot:${id}`
      const now = Date.now()
      room.send('burstFired', { attacker: by, id: burstId, team, x: at.x, y: at.y, z: at.z, air, lx: 0, ly: 0, lz: 0, dry: 0 })
      if (air) {
        // The victim's client knocks itself from this broadcast. Stats only, here.
        for (const e of rosterEntries()) {
          const a = botAim.get(e.userId.toLowerCase())
          if (a && e.team !== team && now - a.t <= BOT_AIM_STALE_S * 1000 && inAirSpike(at, a)) noteHit(by, e.userId)
        }
        return
      }
      const graph = getWalkableGraph()
      const centre = graph ? burstCentre(graph, '', at) : null
      const fp = graph && centre ? burstFootprint(graph, centre) : []
      for (const cid of fp) applyBotPaint(cid, team, by)
      for (const e of rosterEntries()) {
        const a = botAim.get(e.userId.toLowerCase())
        if (a && e.team !== team && now - a.t <= BOT_AIM_STALE_S * 1000 && inBurst(at, a)) noteHit(by, e.userId)
      }
    },
    onBurstLand: (id, burstId, team, at, fx, fz) => {
      const graph = getWalkableGraph()
      const centre = graph ? burstCentre(graph, '', at) : null
      const fp = graph && centre ? burstFootprint(graph, centre) : []
      const by = `bot:${id}`
      for (const cid of fp) applyBotPaint(cid, team, by)
      room.send('burstFired', { attacker: by, id: burstId, team, x: at.x, y: at.y, z: at.z, air: 0, lx: 0, ly: 0, lz: 0, dry: 0 })
      const now = Date.now()
      for (const e of rosterEntries()) {
        const a = botAim.get(e.userId.toLowerCase())
        if (a && e.team !== team && now - a.t <= BOT_AIM_STALE_S * 1000 && inBurst(at, a)) noteHit(by, e.userId)
      }
      console.log(`[Server] ghost ${id} spike landed, footprint=${fp.length} face=${fx.toFixed(2)},${fz.toFixed(2)}`)
    },
    onBotHit: (id, target, kind = 'lunge', dx = 0, dz = 1) => {
      const attacker = `bot:${id}`
      noteHit(attacker, target)
      // A ghost hitting a player is stats only. A ghost hitting a ghost never
      // broadcast an impact, so clients never played the hit.
      if (!target.startsWith('bot:')) return
      if (kind === 'lunge') room.send('lungeImpact', { attacker, id: 0, target, dx, dz })
      else room.send('burstImpact', { attacker, id: 0, target, dx, dz, air: kind === 'spike' ? 1 : 0 })
    },
    onSpawn: (id, team) => { botTeams.set(`bot:${id}`, team) },
    format: () => roundFormat,
  })
  // Stay on the lobby cross until a vote starts a match. Generating the
  // arena here left the server grid on a different floor than the clients.
  placeLobbyLayout()
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

  const SNAPSHOT_COOLDOWN_MS = 5000
  const lastSnapshotAt = new Map<string, number>()

  const lunges = new LungeLedger()
  // Paint Burst: last accepted burst per player (cooldown) + hit dedupe.
  const lastBurstAt = new Map<string, number>()
  const bursts = new BurstLedger()
  // Players whose fall-rescue cloud other clients should be showing.
  const rescueRiders = new Set<string>()
  const rescueStartAt = new Map<string, number>()

  let roundFormat: 'pvp' = 'pvp'
  /** Returns how many cells changed team, and credits upgrade charge for those flips. */
  const paintCells = (painter: string, team: number, ids: string[], _origin: string | null, _notify: boolean): number => {
    let gained = 0
    let charge = 0
    for (const id of ids) {
      const prev = teamOfCell(id)
      if (!applyPaint(id, team, painter)) continue
      gained++
      charge += upgradeChargeFor(prev, team)
    }
    if (charge > 0) upgrades.gain(painter, charge)
    return gained
  }

  /** Round-on-join state → one client (to) or everyone. `format` lets a late joiner show the splash.
   *  In the lobby each player gets their own copy so `mine` is that player's counted mode. */
  function sendRoundClock(to?: string): void {
    if (!to && intermission === 'lobby') {
      const ids = presentIds()
      if (ids.length === 0) { deliverRoundClock(undefined); return }
      for (const id of ids) deliverRoundClock(id)
      return
    }
    deliverRoundClock(to)
  }
  function deliverRoundClock(to?: string): void {
    const now = Date.now()
    const voteMs = countdownEnds > now ? Math.max(0, countdownEnds - now) : 0
    const phase = isRoundActive() ? 'match'
      : intermission === 'lobby' ? (voteMs > 0 ? 'lobby' : 'idle')
      : 'idle'
    const verdict = lobbyVerdict(presentIds(), now)
    const msg = {
      idx: currentRoundIndex(),
      remainingMs: Math.max(0, Math.round(getRoundEndMs() - now)),
      active: isRoundActive(),
      format: roundFormat,
      phase,
      voteMs,
      winner: '',
      votes: (() => {
        const teams = occupancyTeams(presentIds(), now)
        return [{ id: 'red', n: teams.red }, { id: 'blue', n: teams.blue }, { id: 'green', n: teams.green }, { id: 'yellow', n: teams.yellow }]
      })(),
      present: presentIds().length,
      feet: lobbySampleIds().length,
      srvZone: verdict.zone,
      why: verdict.why,
      mine: to ? (teamIdOf(countedTeam(to)) || '') : '',
      seed: currentRoundIndex(),
      layout: worldLayout(),
      seq: worldSeq,
    }
    if (to) room.send('roundClock', msg, { to: [to] }); else room.send('roundClock', msg)
  }

  // Presence for round-on-join: last presencePing per player (clients ping every 5 s). More reliable than
  // the roster's connected set, which any straggler message re-adds via markActive() after onLeaveScene.
  const PRESENCE_TIMEOUT_MS = 15000
  const lastPingAt = new Map<string, number>()
  const presentCount = (): number => presentIds().length
  const presentIds = (): string[] => {
    const now = Date.now()
    const ids: string[] = []
    for (const [uid, t] of lastPingAt) {
      if (now - t <= PRESENCE_TIMEOUT_MS) ids.push(uid)
      else lastPingAt.delete(uid)
    }
    return ids
  }

  // ─── Intermission ───────────────────────────────────────────────────
  // The win screen is client-only. The floor becomes the lobby the moment
  // the round ends. A match starts only when a vote picks a mode.
  type IntermissionPhase = 'idle' | 'lobby'
  let intermission: IntermissionPhase = 'idle'
  // Scores held from round end until the arena regen (after the vote).
  let pendingFinal = { red: 0, blue: 0, green: 0, yellow: 0, total: 0 }
  let pendingNextIdx = 0
  let lobbyOpen = false
  /** Bumps on every lobby/arena floor change. Clients ignore a lower seq. */
  let worldSeq = 0
  const bumpWorld = () => ++worldSeq
  const worldLayout = (): 'arena' | 'lobby' => isRoundActive() ? 'arena' : 'lobby'
  const worldFields = () => ({
    seed: currentRoundIndex(),
    layout: worldLayout(),
    seq: worldSeq,
    format: roundFormat,
    phase: isRoundActive() ? 'match' : intermission === 'lobby' ? 'lobby' : 'idle',
  })
  /** Set after a summary. The vote still waits for the first live sample. */
  let wantFull = false
  let readyAt = 0
  let countdownEnds = 0
  let hadVotes = false
  let emptySince = 0
  let lobbyLogAt = 0

  function sendLobbyLayout(to?: string): void {
    const msg = {
      seed: currentRoundIndex(),
      finalRed: pendingFinal.red, finalBlue: pendingFinal.blue, finalGreen: pendingFinal.green ?? 0, finalYellow: pendingFinal.yellow ?? 0, finalTotal: pendingFinal.total,
      format: roundFormat,
      layout: 'lobby',
      seq: worldSeq,
    }
    if (to) room.send('roundReset', msg, { to: [to] })
    else room.send('roundReset', msg)
  }

  /** Swap the arena for the voting cross. Does not start a match or touch bots' graph. */
  function openLobby(fromSummary: boolean): void {
    intermission = 'lobby'
    wantFull = fromSummary
    readyAt = Date.now()
    countdownEnds = 0
    hadVotes = false
    emptySince = 0
    setRoundState(currentRoundIndex(), Date.now(), false)
    sleepBots()
    placeLobbyLayout()
    anvilsAwake(false)
    clearStars()
    clearUpgradesAndNotify()
    if (!lobbyOpen) {
      lobbyOpen = true
      clearLobbyVotes()
      bumpWorld()
      sendLobbyLayout()
      console.log(`[Lobby] open ${fromSummary ? 'after summary, idle until a vote' : 'idle until a vote'}`)
    }
    sendRoundClock()
  }

  /** Paint, hits, and knockback. Lobby abilities still broadcast their own movement and VFX. */
  function matchLive(): boolean { return isRoundActive() }
  /** Sole territory leader. 0 while tied, empty, or between rounds. */
  let soleLead = 0
  function feedName(id: string): string {
    const key = (id || '').toLowerCase()
    const raw = key.startsWith('bot:')
      ? `BOT ${key.slice(4)}`
      : (leaderboardGetName(key) ?? leaderboardGetName(id) ?? (key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key))
    const clipped = raw.length > 14 ? raw.slice(0, 13) + '…' : raw
    return clipped.toUpperCase()
  }
  function feedTeamOf(id: string): number {
    const key = (id || '').toLowerCase()
    if (key.startsWith('bot:')) {
      const bid = parseInt(key.slice(4), 10)
      const b = getBotPositions().find(p => p.id === bid)
      if (b) return b.team
      return botTeams.get(key) ?? 0
    }
    return getTeam(key) ?? getTeam(id) ?? 0
  }
  function sendFeed(kind: number, a: string, b: string, team: number, teamB: number): void {
    room.send('feed', { kind, a, b, team, teamB })
  }
  function announceKo(attacker: string, victim: string): void {
    if (!attacker || !victim || !matchLive()) return
    sendFeed(2, feedName(attacker), feedName(victim), feedTeamOf(attacker), feedTeamOf(victim))
  }
  function noteLead(): void {
    if (!matchLive()) {
      soleLead = 0
      return
    }
    const c = coverage()
    const leaders = leadingTeams(c)
    const sole = leaders.length === 1 ? leaders[0] : 0
    if (sole === soleLead) return
    soleLead = sole
    if (!sole || teamCount(c, sole) <= 0) return
    sendFeed(1, teamName(sole), 'TAKES THE LEAD', sole, 0)
  }
  function vfxLive(): boolean { return isRoundActive() || intermission === 'lobby' }

  function closeCountdown(): void {
    countdownEnds = 0
    hadVotes = false
    wantFull = false
    emptySince = 0
    sendRoundClock()
  }

  function resolveVote(): void {
    const now = Date.now()
    const present = presentIds()
    const teams = tallyTeams(present, now)
    countdownEnds = 0
    hadVotes = false
    wantFull = false
    emptySince = 0
    if (present.length === 0 && teams.red + teams.blue + teams.green + teams.yellow === 0) {
      console.log('[Lobby] no players → idle')
      sendRoundClock()
      return
    }
    console.log(`[Lobby] starting Pixelwars red=${teams.red} blue=${teams.blue} green=${teams.green} yellow=${teams.yellow}`)
    startNextRound()
  }

  /** A sole winning team credits each connected human on that team. Ties credit nobody. */
  const creditRoundWins = (cov: { red: number; blue: number; green: number; yellow: number }) => {
    const leaders = leadingTeams(cov)
    const winTeam = leaders.length === 1 ? leaders[0] : 0
    if (!winTeam) return
    for (const row of rosterEntries()) if (row.team === winTeam) recordWin(row.userId)
  }
  setPaintListener(() => { noteLead() })

  /** Apply lobby team picks, rebuild the maze, and start the clock. */
  function startNextRound(): void {
    roundFormat = 'pvp'
    const seed = pendingNextIdx > 0 ? pendingNextIdx : currentRoundIndex()
    const c = pendingFinal
    const pruned = pruneForNewRound()
    if (pruned > 0) console.log(`[Server] roster: pruned ${pruned} inactive player(s) at round start`)
    // Everyone still connected in the lobby counts as present for bot fill.
    // The 60s paint-activity window often expires while choosing a team.
    for (const e of rosterEntries()) markActive(e.userId)
    setForcedTeam(null)
    const ids: string[] = []
    const seen = new Set<string>()
    for (const id of [...presentIds(), ...rosterEntries().map(e => e.userId)]) {
      const key = id.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      ids.push(id)
    }
    const assigned = assignLobbyTeams(ids, snapshotLobbyChoices())
    for (const { userId, team } of assigned) {
      setTeam(userId, team)
      room.send('teamAssigned', { team }, { to: [userId] })
    }
    const counts = activeTeamCounts()
    const plannedBots = teamCountsTotal(pvpBotFill(counts))
    console.log(`[Server] lobby teams: ${assigned.map(s => `${s.userId.slice(0, 8)}=${teamName(s.team)}`).join(' ') || '(none)'} (bots=${plannedBots})`)
    lobbyOpen = false
    intermission = 'idle'
    setRoundState(seed, Date.now() + ROUND_INTERVAL_MS, true)
    anvilsAwake(true)
    bumpWorld()
    room.send('roundReset', { seed, finalRed: c.red, finalBlue: c.blue, finalGreen: c.green ?? 0, finalYellow: c.yellow ?? 0, finalTotal: c.total, format: roundFormat, layout: 'arena', seq: worldSeq })
    clearPaintState()
    broadcastRoster('reset')
    rebuildBotGraph(seed)
    anvilsMazeChanged()
    void saveLeaderboard()
    publishLeaderboard()
    pendingNextIdx = 0
    pendingFinal = { red: 0, blue: 0, green: 0, yellow: 0, total: 0 }
    console.log(`[Server] round ${seed} started bots=${plannedBots} (activeHumans=${activeHumanCount()})`)
    sendRoundClock()
    armStarRound(Date.now())
  }

  room.onMessage('lagPing', ({ t }, context) => {
    const from = context?.from
    if (!from || typeof t !== 'number' || !Number.isFinite(t)) return
    room.send('lagPong', { t }, { to: [from] })
  })

  room.onMessage('presencePing', (_d, context) => {
    const from = context?.from
    if (!from) return
    lastPingAt.set(from, Date.now())
    // A ping only proves someone is here. It does not start a match, and it
    // does not refresh the 60s play window that bots use to fill a side.
  })

  room.onMessage('lobbyPos', ({ x, y, z }, context) => {
    const from = context?.from
    if (!from) return
    // A match owns the floor. The win screen does not: the lobby is already
    // up, and a sample on an end tile counts even while that screen is showing.
    if (isRoundActive()) return
    if (intermission !== 'lobby') openLobby(false)
    lastPingAt.set(from, Date.now())
    const accepted = noteLobbyPos(from, x, y, z, Date.now())
    if (accepted && intermission === 'lobby') sendRoundClock()
    const pick = countedTeam(from)
    if (pick && getTeam(from) !== pick) {
      setTeam(from, pick)
      room.send('teamAssigned', { team: pick }, { to: [from] })
    }
  })

  room.onMessage('lobbyReady', (_d, context) => {
    // The floor being walkable does not start the countdown. stepLobby starts
    // LOBBY_VOTE_MS when the first team is chosen.
    if (!context?.from) return
  })


  onLeaveScene((userId: string) => {
    lastPingAt.delete(userId)
    forgetLobbyPlayer(userId)
    markInactive(userId)
    // Clear snapshot cooldown so a fast rejoin gets a fresh snapshot
    // instead of being rate-limited into a blank map.
    lastSnapshotAt.delete(userId)
    lunges.forget(userId)
    bursts.forget(userId)
    lastBurstAt.delete(userId)
    const left = userId.toLowerCase()
    upgrades.forget(left)
    room.send('upgradeBuffs', { reset: 0, entries: [{ id: left, speed: 0, paint: 0, haste: 0 }] })
    if (rescueRiders.delete(left)) {
      rescueStartAt.delete(left)
      room.send('rescueEnd', { who: left })
      console.log(`[Server] rescueEnd ${left.slice(0, 10)} (left)`)
    }
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
    let team = assignTeam(from)
    // PvP and Prototype. Rejoiner kept the same colour as the only other active human: flip
    // them so the sides even out and the fill bots retire on the next tick. New
    // joiners already take the side with fewer active humans (humans only, not bots).
    // PvB skips this — assignTeam already put them on the human colour.
    // Mid-match only. A lobby join keeps the team they already have until the vote starts a round.
    if (isRoundActive()) {
      const other = activeSoloHumanTeam(from)
      if (other !== null && team === other) { team = smallestTeam({ red: 0, blue: 0, green: 0, yellow: 0 }, PLAYING_TEAMS.filter(t => t !== other)); setTeam(from, team); console.log(`[Server] joinRoster ${from.slice(0, 10)} flipped to ${teamName(team)} (1v1 vs the other human)`) }
    }
    markActive(from) // count them as present immediately; paint activity will refresh it
    lastPingAt.set(from, Date.now())
    if (isRoundActive()) {
      sendRoundClock(from)
    } else if (lobbyOpen) {
      // A joinRoster retry must not rebuild the cross. The first join sends it.
      if (!isRepeat) sendLobbyLayout(from)
      sendRoundClock(from)
    } else {
      openLobby(false)
      sendRoundClock(from)
    }
    team = getTeam(from) ?? team
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
  // Throttled log for messages we drop silently (≤ 1 line per sender+type per 5 s).
  const dropLogAt = new Map<string, number>()
  const logDrop = (from: string, type: string, why: string) => {
    const k = from + type, now = Date.now()
    if (now - (dropLogAt.get(k) ?? 0) < 5000) return
    dropLogAt.set(k, now)
    console.log(`[Server] ${type} from ${from.slice(0, 10)} dropped: ${why}`)
  }

  room.onMessage('paintTick', ({ ids, at, y, g }, context) => {
    const from = context?.from
    if (!from) return
    if (!matchLive()) { logDrop(from, 'paintTick', 'round inactive (intermission/idle)'); return }
    const team = getTeam(from)
    if (team === null) { logDrop(from, 'paintTick', 'no team (not in roster)'); return }  // pre-roster paint
    if (ids.length > MAX_IDS_PER_TICK) {
      console.log(`[Server] paintTick from ${from} dropped: ${ids.length} ids > cap ${MAX_IDS_PER_TICK}`)
      return
    }
    // Count only cells that actually changed team — a player standing
    // still on their own paint re-sends the same 9 cellIds every 100ms;
    // crediting all of them would inflate the leaderboard by ~90/sec.
    // Always go through paintCells so walking also grants upgrade charge.
    // PIXELWARS has the paint-economy tank off; the old applyPaint-only
    // branch tallied flips for the pill but never called upgrades.gain,
    // so the first upgrade lagged far behind the number on screen.
    const gained = paintCells(from, team, ids, at || null, true)
    // Even if nothing changed team (walking on own paint), the paintTick
    // itself is proof the player is real — mark them active so scraper
    // bots that never send paintTick are filtered out.
    markActive(from)
    if (typeof at === 'string' && at) {
      const pos = getWalkableGraph()?.worldPos.get(at)
      if (pos) botAim.set(from.toLowerCase(), { x: pos[0], y: typeof y === 'number' && isFinite(y) ? y : pos[1], z: pos[2], t: Date.now() })
    }
    if (gained > 0) {
      leaderboardIncrement(from, gained)
      addRoundCells(from, gained)
    }
  })

  // Name capture — client sends once on join with PlayerIdentityData.name.
  // Server keeps the map in memory and patches existing leaderboard rows.
  room.onMessage('upgradeSelect', ({ kind }, context) => {
    const from = context?.from
    if (!from || !matchLive()) return
    const k = upgradeKindFromId(typeof kind === 'number' ? kind : -1)
    if (!k) return
    if (!upgrades.trySelect(from, k)) return
    sendUpgradeTo(from)
    sendUpgradeBuffs(from)
    console.log('[Server] upgradeSelect ' + from.slice(0, 8) + ' ' + k + ' earned=' + upgrades.stateOf(from).earned)
  })

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
  // Bots run every server frame (registered before the drain below, so a
  // frame's bot paint rides out on that frame's broadcast). Ticking them only
  // at 5 Hz made the 10 Hz botPositions repeat every other packet: knocked and
  // rescued ghosts lurched and stopped.
  engine.addSystem((dt: number) => {
    beginLagFrame(dt)
    const tBots = Date.now()
    if (isRoundActive()) tickBots(dt)
    tickOverdrive(Date.now())
    noteLagSection('bots', tBots)
  })
  // Incoming comms are processed after the system loop (see safeSystems.ts).
  // A burst handled at the end of a turn used to wait until the next engine
  // tick to flush paintDelta. On a slow host tick that is a full gap later,
  // so combat paint now flushes from the handler in the same turn.
  const flushPaintNow = () => {
    const queued = paintWaitMs()
    const t0 = Date.now()
    const changes = drainDelta()
    const work = Date.now() - t0
    if (changes.length === 0) { flushPaintScores(); noteLagSection('paint', t0); return }
    console.log(`[Server] paintFlush n=${changes.length} wait=${queued}ms work=${work}ms`)
    const c = coverage()
    // Saturation discipline (shared/messages.ts): ≤ MAX_CHANGES_PER_MSG per
    // message. Every chunk carries the same coverage counters.
    for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_MSG) {
      room.send('paintDelta', { changes: changes.slice(i, i + MAX_CHANGES_PER_MSG), red: c.red, blue: c.blue, green: c.green ?? 0, yellow: c.yellow ?? 0, total: c.total })
    }
    flushPaintScores()
    noteLagSection('paint', t0)
  }
  engine.addSystem((dt: number) => {
    broadcastClock += dt
    if (broadcastClock < BROADCAST_INTERVAL) return
    broadcastClock = 0
    flushPaintNow()
  })

  // Bot position broadcast (10 Hz). One batched `botPositions` message for the
  // whole pool (not one message per bot). 15 bots × ~9 numbers is still a
  // small frame; clients lerp between updates.
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
  const sendBotPositionsNow = () => {
    const tNet = Date.now()
    const positions = getBotBroadcast()
    if (positions.length === 0 && lastBotCount === 0) { noteLagSection('net', tNet); return }
    lastBotCount = positions.length
    room.send('botPositions', { bots: positions, t: botSimTime() })
    noteLagSection('net', tNet)
  }
  engine.addSystem((dt: number) => {
    botPosClock += dt
    if (botPosClock < BOT_POS_INTERVAL) return
    botPosClock = 0
    sendBotPositionsNow()
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
      console.log(`[Server] coverage: red=${c.red} blue=${c.blue} green=${c.green} yellow=${c.yellow} total=${c.total} bots=${botCount()}`)
    }
  })

  // Lunge (shared/pvp.ts LUNGE_*, shared/lunge.ts, client/lunge.ts).
  // lungeStart: cooldown + team gate, rebroadcast so all clients show it.
  // lungeHit: the attacker's client detected contact (the server can't see
  // avatars, so player range is client-trusted; the ghost is range-checked
  // here). Accepted once per (attacker, lunge id, target) and only within
  // SERVER_LUNGE_HIT_WINDOW_S of the accepted start.
  room.onMessage('lungeStart', ({ id, dx, dz, x, y, z }, context) => {
    const from = context?.from
    if (!from || !lungeEnabledForRound(currentRoundIndex()) || !vfxLive()) return
    if (getTeam(from) === null) return
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3 || ![x, y, z].every(isFinite)) return
    if (!lunges.start(from, id, Date.now(), abilityGapS(from, SERVER_MIN_LUNGE_GAP_S, Date.now()))) {
      console.log(`[Server] lungeStart ${from.slice(0, 8)} rejected: cooldown`)
      return
    }
    if (matchLive()) markActive(from)
    room.send('lungeStarted', { attacker: from, id, dx: dx / len, dz: dz / len, x, y, z, dry: 0 })
  })

  room.onMessage('lungeHit', ({ id, target, dx, dz, x, y, z }, context) => {
    const from = context?.from
    if (!from || !matchLive() || !lungeEnabledForRound(currentRoundIndex())) return
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
      if (!hitBot(parseInt(victimId.slice(4), 10), x, y, z, Math.hypot(LUNGE_HITBOX_FORWARD + LUNGE_HITBOX_D, LUNGE_HITBOX_W / 2) + 2 + SERVER_LUNGE_BOT_SLACK,
        LUNGE_HIT_MAX_DY + SERVER_LUNGE_BOT_SLACK, () => lungeKnock(ux, uz))) return
    }
    console.log(`[Server] lungeImpact ${from.slice(0, 8)} #${id} → ${victimId.slice(0, 8)}`)
    noteHit(from, victimId)
    room.send('lungeImpact', { attacker: from, id, target: victimId, dx: ux, dz: uz })
  })

  // ─── Paint Burst (shared/pvp.ts BURST_*, shared/burst.ts) ─────────
  // burstUse: server-enforced cooldown (SERVER_MIN_BURST_GAP_S), shared by ground and air.
  // air 0: radial paint + radial bot shove. air 1: spike now; the landing paints once via burstLand
  // and, on the first accepted sample, opens the same radial knock (players via burstHit, bots here).
  // burstHit: attacker client found a player; accepted once per (attacker, burst id, target).
  // Same centre, footprint, applyPaint, and score credit as a grounded burstUse. Once.
  // Same radius and direction as the client shockwave. Slack matches the old inline bot check.
  const radialBotShock = (from: string, id: number, team: number, origin: { x: number; y: number; z: number }, fx: number, fz: number, now: number, footprint: readonly string[]) => {
    const painted = new Set(footprint)
    let shoved = false
    for (const b of getBotHitPoints()) {
      if (b.team === team) continue
      const key = `bot:${b.id}`
      // A spike that already connected this bot must not shove it again when the miss lands.
      if (bursts.hasHit(from, id, key)) continue
      const feet = { x: b.x, y: b.y, z: b.z }
      if (!shockwaveHitsBot(origin, feet, painted.has(b.cell))) continue
      const d = burstDir(origin, feet, fx, fz)
      // Limits stay at least as wide as shockwaveHitsBot so a footprint hit is not rejected here.
      if (hitBot(b.id, origin.x, origin.y, origin.z, BURST_RADIUS + SERVER_LUNGE_BOT_SLACK, BURST_HIT_MAX_DY + 3, () => burstKnock(d.x, d.z))) {
        bursts.hit(from, id, key, now)
        noteHit(from, key)
        room.send('burstImpact', { attacker: from, id, target: key, dx: d.x, dz: d.z, air: 0 })
        shoved = true
      }
    }
    if (shoved) sendBotPositionsNow()
  }
  const paintBurstFootprint = (from: string, team: number, cell: string, x: number, y: number, z: number): string[] => {
    const graph = getWalkableGraph()
    const centre = graph ? burstCentre(graph, cell, { x, y, z }) : null
    const r = burstPaintRadiusCellsFor(upgrades.level(from, 'paint'))
    const fp = graph && centre ? burstFootprint(graph, centre, undefined, r) : []
    const gained = paintCells(from, team, fp, centre, true)
    if (gained > 0) {
      leaderboardIncrement(from, gained)
      addRoundCells(from, gained)
    }
    return fp
  }
  const commitBurstPaint = (from: string, id: number, fp: string[], ct: number, sin: number) => {
    // Empty centre is not a paint. The client retries with a later grounded sample.
    if (fp.length === 0 || !bursts.commitPaint(from, id)) return
    bursts.rememberCells(from, id, fp)
    sendPainted(from, id, fp.length, ct, sin)
    flushPaintNow()
  }
  const sendPainted = (from: string, id: number, n: number, ct: number, sin: number) => {
    const sout = Date.now()
    room.send('burstPainted', { id, n, ct, sin, sout }, { to: [from] })
    console.log(`[Server] burstPainted #${id} n=${n} proc=${sout - sin}ms`)
  }
  room.onMessage('burstUse', ({ id, cell, x, y, z, fx, fz, air, ct }, context) => {
    const sin = Date.now()
    const from = context?.from
    console.log(`[Server] burstUse recv #${id} air=${air ?? 0} ct=${ct || 0} sin=${sin}`)
    if (!from || !burstEnabledForRound(currentRoundIndex())) return
    const team = getTeam(from)
    if (team === null || ![x, y, z].every(isFinite)) { logDrop(from, 'burstUse', team === null ? 'no team' : 'bad position'); return }
    if (!vfxLive()) return
    if (!matchLive()) {
      // Lobby: the shockwave plays for everyone. It does not paint or hit.
      if (!bursts.matches(from, id)) {
        const now = Date.now()
        if (now - (lastBurstAt.get(from) ?? 0) < (abilityGapS(from, SERVER_MIN_BURST_GAP_S, now)) * 1000) return
        lastBurstAt.set(from, now)
        const airborne = air !== 0
        bursts.start(from, id, now, airborne ? 1 : 0, fx, fz)
        bursts.place(from, id, { x, y, z })
        room.send('burstFired', { attacker: from, id, team, x, y, z, air: airborne ? 1 : 0, lx: 0, ly: 0, lz: 0, dry: 0 })
      }
      sendPainted(from, id, 0, ct || 0, sin)
      return
    }
    const now = Date.now()
    // Same id is the shockwave retrying its paint. Cooldown must not drop it, and
    // it must not broadcast or punch a second time.
    if (bursts.matches(from, id)) {
      if (bursts.mode(from, id) === 0 && !bursts.hasPaint(from, id)) {
        const fp = paintBurstFootprint(from, team, cell, x, y, z)
        console.log(`[Server] burstUse ${from.slice(0, 8)} #${id} replay footprint=${fp.length} pos=${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`)
        commitBurstPaint(from, id, fp, ct || 0, sin)
      }
      return
    }
    if (now - (lastBurstAt.get(from) ?? 0) < (abilityGapS(from, SERVER_MIN_BURST_GAP_S, now)) * 1000) {
      console.log(`[Server] burstUse ${from.slice(0, 8)} rejected: cooldown`)
      return
    }
    const airborne = air !== 0
    lastBurstAt.set(from, now)
    markActive(from)
    bursts.start(from, id, now, airborne ? 1 : 0, fx, fz)
    const origin = { x, y, z }
    bursts.place(from, id, origin)
    // Broadcast first so remotes see FX / ImpactGate start ASAP (paint loop used to delay this).
    room.send('burstFired', { attacker: from, id, team, x, y, z, air: airborne ? 1 : 0, lx: 0, ly: 0, lz: 0, dry: 0 })
    // Paint the circle whenever a walkable cell resolves under the feet, even if
    // the client tagged the press air. burstCentre's window is BURST_PAINT_MAX_DY+1
    // (2.5 m). A real jump above that waits for burstLand. commitPaint runs once.
    const graphNow = getWalkableGraph()
    const centreNow = graphNow ? burstCentre(graphNow, cell, origin) : null
    const centreY = centreNow ? graphNow!.worldPos.get(centreNow)?.[1] : undefined
    const dy = centreY === undefined ? Infinity : Math.abs(centreY - y)
    const nearFloor = centreNow !== null && dy <= BURST_PAINT_MAX_DY + 1
    const fp = nearFloor || !airborne ? paintBurstFootprint(from, team, cell, x, y, z) : []
    const rampIds = fp.filter(c => getPlacedTilesInOrder().some(t => t.type === 'ramp' && c.startsWith(`${t.x},${t.z},${t.y}:`))).length
    const reason = !graphNow ? 'no-graph' : fp.length === 0 && airborne ? 'air-above-floor' : fp.length === 0 ? 'no-centre' : airborne ? 'near-floor' : 'ground'
    console.log(`[Burst] server footprint=${fp.length} reason=${reason} dy=${Number.isFinite(dy) ? dy.toFixed(2) : 'na'} air=${airborne ? 1 : 0} cell=${cell || '(none)'} ramps=${rampIds}`)
    if (!airborne || nearFloor) {
      commitBurstPaint(from, id, fp, ct || 0, sin)
      radialBotShock(from, id, team, origin, fx, fz, now, fp)
    }
    if (airborne && !nearFloor) {
      let spiked = false
      for (const b of getBotPositions()) {
        if (b.team === team || !inAirSpike(origin, { x: b.x, y: b.y, z: b.z })) continue
        let dx = b.x - x, dz = b.z - z
        const l = Math.hypot(dx, dz)
        if (l < 0.2) { dx = fx; dz = fz } else { dx /= l; dz /= l }
        const dl = Math.hypot(dx, dz) || 1
        if (hitBot(b.id, x, y, z, AIR_SPIKE_RADIUS + 1, AIR_SPIKE_DEPTH + 1, grounded => spikeKnock(dx / dl, dz / dl, grounded))) {
          bursts.hit(from, id, `bot:${b.id}`, now)
          noteHit(from, `bot:${b.id}`)
          room.send('burstImpact', { attacker: from, id, target: `bot:${b.id}`, dx: dx / dl, dz: dz / dl, air: 1 })
          spiked = true
        }
      }
      if (spiked) sendBotPositionsNow()
    }
  })

  // Landing of an airborne burst: one ground-Burst footprint at the feet.
  // Movement paint may already own the 3×3 under the player; applyPaint does not
  // re-credit those cells, so the score matches a single grounded burst.
  // The first accepted sample also opens the ground shockwave: same bot shove,
  // and a burstFired (air 0) so victims anticipate exactly as they do for a press.
  // Player hits arrive as burstHit after this message and share that validation.
  room.onMessage('burstLand', ({ id, cell, x, y, z, ct }, context) => {
    const sin = Date.now()
    const from = context?.from
    console.log(`[Server] burstLand recv #${id} ct=${ct || 0} sin=${sin} cell=${cell || '(none)'}`)
    if (!from || !burstEnabledForRound(currentRoundIndex()) || !vfxLive()) return
    const team = getTeam(from)
    if (team === null || ![x, y, z].every(isFinite)) return
    const now = Date.now()
    if (!matchLive()) {
      if (bursts.openLanding(from, id, now, SERVER_BURST_LAND_WINDOW_S)) {
        bursts.place(from, id, { x, y, z })
        room.send('burstFired', { attacker: from, id, team, x, y, z, air: 0, lx: 0, ly: 0, lz: 0, dry: 0 })
      }
      sendPainted(from, id, 0, ct || 0, sin)
      return
    }
    const why = bursts.landBlock(from, id, now, SERVER_BURST_LAND_WINDOW_S)
    if (why) {
      if (why === 'already-painted') {
        const cells = bursts.paintedCells(from, id)
        sendPainted(from, id, cells.length, ct || 0, sin)
      }
      console.log(`[Server] burstLand ${from.slice(0, 8)} #${id} rejected: ${why}`)
      return
    }
    markActive(from)
    const origin = { x, y, z }
    // Before paint, and before the burstHits queued behind this message.
    // An empty footprint still opens the knock; the client already played the shockwave.
    // A later retry paints without shoving or broadcasting again.
    if (bursts.openLanding(from, id, now, SERVER_BURST_LAND_WINDOW_S)) {
      const face = bursts.facing(from, id)
      bursts.place(from, id, origin)
      room.send('burstFired', { attacker: from, id, team, x, y, z, air: 0, lx: 0, ly: 0, lz: 0, dry: 0 })
      const graph = getWalkableGraph()
      const centre = graph ? burstCentre(graph, cell, origin) : null
      const preview = graph && centre ? burstFootprint(graph, centre, undefined, burstPaintRadiusCellsFor(upgrades.level(from, 'paint'))) : []
      radialBotShock(from, id, team, origin, face.x, face.z, now, preview)
    }
    const fp = paintBurstFootprint(from, team, cell, x, y, z)
    console.log(`[Server] burstLand ${from.slice(0, 8)} #${id} footprint=${fp.length} cell=${cell || '(none)'} pos=${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`)
    if (fp.length === 0) {
      console.log(`[Server] burstLand ${from.slice(0, 8)} #${id} no-centre pos=${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`)
      return
    }
    commitBurstPaint(from, id, fp, ct || 0, sin)
  })

  // Shared anvils: the attacker's client detected the hit; same ledgers (once per lunge/burst id
  // per anvil, within the window) as player hits, then the server knocks the anvil.
  room.onMessage('anvilHit', ({ kind, id, i, dx, dz, ct }, context) => {
    const sin = Date.now()
    const from = context?.from
    if (!from || !matchLive() || ![dx, dz].every(isFinite)) return
    const len = Math.hypot(dx, dz)
    if (len < 1e-3) return
    const book = kind === 1 ? bursts : lunges
    const verdict = book.hit(from, id, `anvil:${i}`, Date.now())
    const proc = Date.now() - sin
    if (verdict !== 'ok') {
      const live = book.liveId(from)
      console.log(`[Server] anvilHit ${from.slice(0, 8)} #${id} anvil ${i} rejected: ${verdict} live=${live === null ? 'none' : '#' + live} ct=${ct || 0} proc=${proc}ms`)
      return
    }
    console.log(`[Server] anvilHit #${id} anvil ${i} ok proc=${proc}ms ct=${ct || 0}`)
    noteAnvilTouch(i, from)
    anvilsHit(i, dx / len, dz / len, kind === 1 ? BURST_KNOCKBACK / LUNGE_KNOCKBACK : 1, from)
  })
  room.onMessage('anvilPush', ({ i, dx, dz, x, z, run }, context) => { if (context?.from && matchLive()) { noteAnvilTouch(i, context.from); anvilsPush(context.from, i, dx, dz, x, z, run === 1) } })
  // Victim reports contact with a launched anvil. Server checks speed, window, range, once-per-launch,
  // and hitter immunity, then broadcasts the knock. The victim applies it on anvilImpact.
  room.onMessage('anvilStrike', ({ i, x, y, z }, context) => {
    const from = context?.from
    if (!from || !matchLive() || ![x, y, z].every(isFinite)) return
    const hit = tryAnvilPlayerStrike(from, i, x, y, z)
    if (!hit) return
    if (hit.attacker && hit.attacker !== from && getTeam(hit.attacker) !== null && getTeam(hit.attacker) !== getTeam(from)) {
      noteHit(hit.attacker, from)
    }
    room.send('anvilImpact', { i, attacker: hit.attacker, target: from.toLowerCase(), dx: hit.dx, dz: hit.dz })
    console.log(`[Server] anvil ${i} launched ${from.slice(0, 8)} by ${hit.attacker.slice(0, 8) || '?'}`)
  })
  // Round stats (server/roundStats.ts): the victim's client reports an anvil launch and its own falls.
  room.onMessage('anvilLaunched', ({ i }, context) => {
    const from = context?.from
    if (!from) return
    const by = anvilCredit(i)
    if (by && by !== from && getTeam(by) !== null && getTeam(by) !== getTeam(from)) noteHit(by, from)
  })
  room.onMessage('playerFell', (_m, context) => {
    const from = context?.from
    if (!from || !matchLive() || getTeam(from) === null) return
    const by = noteFell(from)
    if (upgrades.loseBuffsOnFall(from)) {
      sendUpgradeTo(from)
      sendUpgradeBuffs(from)
    }
    if (by) announceKo(by, from)
    console.log(`[Server] playerFell ${from.slice(0, 10)}${by ? ` — KO by ${by.slice(0, 10)}` : ''}`)
  })
  // Relay the rider's cloud so every other client can show it. who is the
  // authenticated sender, not the payload. Timings are clamped so a bad
  // client cannot pin a cloud up.
  /** Nearest safe team-coloured cell, or null when paint revival does not apply. */
  function paintedRescueHome(team: number, from: { x: number; y: number; z: number }, occupied?: Set<string>, painted?: Array<{ id: string; team: number }>): { x: number; y: number; z: number } | null {
    if (!matchLive()) return null
    const g = getWalkableGraph()
    if (!g) return null
    return pickTeamRescueCell(team, from, painted ?? getFullState(), g, occupied)?.pos ?? null
  }
  const clampRescueT = (v: number) => Math.min(8, Math.max(0.05, v))
  const rescuePosOk = (x: number, y: number, z: number) =>
    [x, y, z].every(n => typeof n === 'number' && isFinite(n)) &&
    x >= -40 && z >= -40 && x <= SCENE_SIZE + 40 && z <= SCENE_SIZE + 40 && y >= -80 && y <= 260
  room.onMessage('rescueStart', (m, context) => {
    const from = context?.from
    if (!from) return
    const team = getTeam(from)
    if (team === null) return
    if (!rescuePosOk(m.x, m.y, m.z)) return
    if (![m.grab, m.rise, m.cruise, m.descend].every(n => typeof n === 'number' && isFinite(n))) return
    const who = from.toLowerCase()
    const now = Date.now()
    if (now - (rescueStartAt.get(who) ?? 0) < 400) return
    rescueStartAt.set(who, now)
    rescueRiders.add(who)
    const catchAt = { x: m.x, y: m.y, z: m.z }
    const painted = paintedRescueHome(team, catchAt)
    const hinted = rescuePosOk(m.bx, m.by, m.bz) ? { x: m.bx, y: m.by, z: m.bz } : null
    const home = painted ?? hinted ?? baseSpawn(team).pos
    const msg = {
      who,
      x: m.x, y: m.y, z: m.z,
      bx: home.x, by: home.y, bz: home.z,
      mobile: m.mobile ? 1 : 0,
      grab: clampRescueT(m.grab), rise: clampRescueT(m.rise), cruise: clampRescueT(m.cruise), descend: clampRescueT(m.descend),
    }
    room.send('rescueStart', msg)
    console.log(`[Server] rescueStart ${who.slice(0, 10)} mobile=${msg.mobile} catch=${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)}`)
  })
  room.onMessage('rescueEnd', (_m, context) => {
    const from = context?.from
    if (!from) return
    const who = from.toLowerCase()
    rescueRiders.delete(who)
    rescueStartAt.delete(who)
    room.send('rescueEnd', { who })
  })
  room.onMessage('anvilRespawn', (_m, context) => { if (context?.from && matchLive()) anvilsRespawnRequest(context.from) })

  room.onMessage('burstHit', ({ id, target, dx, dz }, context) => {
    const from = context?.from
    if (!from || !matchLive() || !burstEnabledForRound(currentRoundIndex())) return
    const len = Math.hypot(dx, dz)
    if (!isFinite(len) || len < 1e-3) return
    const attackerTeam = getTeam(from)
    if (attackerTeam === null) return
    const want = target.toLowerCase()
    if (want.startsWith('bot:')) {
      const bid = parseInt(want.slice(4), 10)
      const bot = getBotHitPoints().find(b => b.id === bid)
      if (!bot || bot.team === attackerTeam) return
      const origin = bursts.origin(from, id)
      if (!origin) { console.log(`[Server] burstHit ${from.slice(0, 8)} #${id} bot ${bid} rejected: no origin`); return }
      const feet = { x: bot.x, y: bot.y, z: bot.z }
      const spike = bursts.impactAir(from, id) !== 0
      // Rendered feet (what the attacker swung at) vs the server body. Same slack as a lunge.
      if (!burstBotInRange(origin, feet, spike)) {
        console.log(`[Server] burstHit ${from.slice(0, 8)} #${id} bot ${bid} rejected: range`)
        return
      }
      const key = `bot:${bid}`
      // Claim before the knock so a spike and the landing shockwave cannot both land.
      if (bursts.hit(from, id, key, Date.now()) !== 'ok') return
      const ux = dx / len, uz = dz / len
      const reach = (spike ? AIR_SPIKE_RADIUS : BURST_RADIUS) + SERVER_LUNGE_BOT_SLACK
      const maxDy = (spike ? AIR_SPIKE_DEPTH : BURST_HIT_MAX_DY) + 2
      if (!hitBot(bid, origin.x, origin.y, origin.z, reach, maxDy, grounded =>
        spike ? spikeKnock(ux, uz, grounded) : burstKnock(ux, uz))) return
      noteHit(from, key)
      room.send('burstImpact', { attacker: from, id, target: key, dx: ux, dz: uz, air: spike ? 1 : 0 })
      return
    }
    const victim = rosterEntries().find(e => e.userId.toLowerCase() === want)
    if (!victim || victim.team === attackerTeam || victim.userId === from) return
    const verdict = bursts.hit(from, id, victim.userId, Date.now())
    if (verdict !== 'ok') { console.log(`[Server] burstHit ${from.slice(0, 8)} #${id} rejected: ${verdict}`); return }
    noteHit(from, victim.userId)
    const spike = bursts.impactAir(from, id) !== 0
    room.send('burstImpact', { attacker: from, id, target: victim.userId, dx: dx / len, dz: dz / len, air: spike ? 1 : 0 })
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
    console.log(`[Server] snapshot → ${from} (${entries.length} cells, red=${c.red} blue=${c.blue} green=${c.green} yellow=${c.yellow})`)
    // Chunked like paintDelta. The client applies each chunk independently
    // (same path as paint:delta), so order and count don't matter. An empty
    // round still sends one empty chunk so the client sees the server alive.
    for (let i = 0; i === 0 || i < entries.length; i += MAX_CHANGES_PER_MSG) {
      room.send('snapshot', { entries: entries.slice(i, i + MAX_CHANGES_PER_MSG), red: c.red, blue: c.blue, green: c.green ?? 0, yellow: c.yellow ?? 0, total: c.total, ...worldFields() }, { to: [from] })
    }
    sendRoundClock(from) // late joiners: current round + time left (or idle)
    sendPaintScoreTo(from)
    sendUpgradeTo(from)
    sendUpgradeBuffsSnapshot(from)
    sendStarSnapshotTo(from)
  })

  // Round loop (Phase 4 Step 6). Server owns the boundary. On crossing:
  // 1) snapshot final coverage BEFORE clearing (banner needs it),
  // 2) broadcast roundReset with authoritative counts + new seed,
  // 3) clear paint state so the new round starts clean.
  // Order matters: broadcast BEFORE clearAll so the message we send
  // carries the ending round's counts, not zeros.
  // Standings rows (round end: roundOwners; mid-round: requestStandings → standings).
  function buildStandings(painted: Map<string, number>) {
    // Per-painter owned cells for the summary square's shades. Top 60 keeps the message well under the 12 KB cap.
    const ROUND_OWNER_NAME_MAX = 16
    // One row per painter / roster player / bot: owned cells, KOs, deaths, cells painted this round.
    const rows = new Map<string, { id: string; team: number; cells: number }>()
    for (const o of ownerCounts()) {
      const r = rows.get(o.id)
      if (r) r.cells += o.cells; else rows.set(o.id, { id: o.id, team: o.team, cells: o.cells })
    }
    for (const { userId, team } of rosterEntries()) if (!rows.has(userId)) rows.set(userId, { id: userId, team, cells: 0 })
    for (const b of getBotPositions()) if (!rows.has(`bot:${b.id}`)) rows.set(`bot:${b.id}`, { id: `bot:${b.id}`, team: b.team, cells: 0 })
    // Retired bots are gone from getBotPositions. Keep a row when they still have
    // paint, KOs, or deaths this round (botTeams holds the colour). Zero-score
    // retirees are omitted. Humans resolve through the roster.
    for (const id of [...statIds(), ...painted.keys()]) {
      if (rows.has(id)) continue
      const t = id.startsWith('bot:') ? (botTeams.get(id) ?? null) : getTeam(id)
      if (t !== null) rows.set(id, { id, team: t, cells: 0 })
    }
    const owners = [...rows.values()].sort((a, b) => b.cells - a.cells).slice(0, 60).map(o => {
      const raw = o.id.startsWith('bot:') ? `Bot ${o.id.slice(4)}`
        : leaderboardGetName(o.id) ?? (o.id.length > 10 ? `${o.id.slice(0, 6)}…${o.id.slice(-4)}` : o.id)
      return { ...o, name: raw.length > ROUND_OWNER_NAME_MAX ? raw.slice(0, ROUND_OWNER_NAME_MAX - 1) + '…' : raw,
        kos: kosOf(o.id), deaths: deathsOf(o.id), painted: painted.get(o.id) ?? 0 }
    })
    return owners
  }

  // Live standings for the score-bar popup: addressed reply, ≤ 1 per player per second.
  const lastStandingsAt = new Map<string, number>()
  room.onMessage('requestStandings', (_m, context) => {
    const from = context?.from
    if (!from) return
    const now = Date.now()
    if (now - (lastStandingsAt.get(from) ?? 0) < 1000) return
    lastStandingsAt.set(from, now)
    room.send('standings', { owners: buildStandings(roundCells) }, { to: [from] })
  })

  // Periodic roundClock rebroadcast so clients that applied a late message (mobile load stalls) re-sync.
  const ROUND_CLOCK_RESYNC_S = 5
  let resyncClock = 0
  engine.addSystem((dt: number) => {
    resyncClock += dt
    const lobby = intermission === 'lobby'
    if (resyncClock < (lobby ? 1 : ROUND_CLOCK_RESYNC_S)) return
    resyncClock = 0
    if (isRoundActive() || lobby) sendRoundClock()
  })

  // Round end → lobby floor immediately, win screen stays on the client, vote, arena.
  engine.addSystem(() => {
    const now = Date.now()

    if (intermission === 'lobby') {
      const present = presentIds()
      if (now - lobbyLogAt >= 1000) {
        lobbyLogAt = now
        const who = lobbyWho(present.length ? present : lobbySampleIds(), now)
        const fmt = (n: number) => Number.isFinite(n) ? n.toFixed(0) : 'na'
        const bits = who.map(w => `${w.id.slice(0, 8)} raw=${fmt(w.rawX)},${fmt(w.y)},${fmt(w.rawZ)} scene=${fmt(w.x)},${fmt(w.z)} frame=${w.frame} cell=${w.cell} zone=${w.zone}`).join(' | ')
        const verdict = lobbyVerdict(present, now)
        console.log(`[Lobby] present=${present.length} pvp=${verdict.counts.pvp} pvb=${verdict.counts.pvb} prototype=${verdict.counts.prototype} srvZone=${verdict.zone} why=${verdict.why} ${bits || '(no feet)'}`)
      }
      const step = stepLobby({ wantFull, countdownEnds, hadVotes, readyAt, emptySince }, present, now)
      wantFull = step.next.wantFull
      countdownEnds = step.next.countdownEnds
      hadVotes = step.next.hadVotes
      readyAt = step.next.readyAt
      emptySince = step.next.emptySince
      if (step.log === 'start') {
        const left = Math.max(0, Math.round((countdownEnds - now) / 1000))
        console.log(`[Lobby] first vote → ${left}s`)
        sendRoundClock()
      } else if (step.log === 'shorten') {
        console.log('[Lobby] everyone ready → 5s')
        sendRoundClock()
      } else if (step.log === 'close') {
        console.log('[Lobby] votes left → idle')
        sendRoundClock()
      } else if (step.log === 'resolve') {
        resolveVote()
      }
      return
    }

    if (!isRoundActive() || now < getRoundEndMs()) return
    if (intermission !== 'idle') return // already ending

    // Round timer hit zero.
    const lastRoundIndex = currentRoundIndex()
    const idx = lastRoundIndex + 1
    const present = presentCount() > 0
    const c = coverage()
    console.log(`[Server] round ${lastRoundIndex} ended (final red=${c.red} blue=${c.blue} green=${c.green} yellow=${c.yellow} total=${c.total}) present=${present}`)

    // Personal results + owners BEFORE summary UI.
    const teamCells: Record<number, number> = { 1: 0, 2: 0 }
    for (const [uid, n] of roundCells) {
      const t = uid.startsWith('bot:') ? (botTeams.get(uid) ?? null) : getTeam(uid)
      if (t !== null) teamCells[t] = (teamCells[t] ?? 0) + n
    }
    for (const { userId, team } of rosterEntries()) {
      room.send('roundResult', { cells: roundCells.get(userId) ?? 0, teamCells: teamCells[team] ?? 0, team }, { to: [userId] })
    }
    const painted = new Map(roundCells)
    clearRoundCellsAndNotify()
    const owners = buildStandings(painted)
    botTeams.clear()
    soleLead = 0
    clearRoundStats()
    room.send('roundOwners', { owners })
    console.log(`[Server] roundOwners: ${owners.length} painter(s)`)

    // Freeze the round clock. The win screen is the client's banner (SUMMARY_MS).
    // The floor swaps now: lobby tiles, no paint, no anvils, no bots.
    setRoundState(lastRoundIndex, now, false)
    pendingNextIdx = idx
    pendingFinal = { red: c.red, blue: c.blue, green: c.green ?? 0, yellow: c.yellow ?? 0, total: c.total }
    room.send('roundEnded', {
      finalRed: c.red,
      finalBlue: c.blue,
      finalGreen: c.green ?? 0,
      finalYellow: c.yellow ?? 0,
      finalTotal: c.total,
      kind: 'paint',
      victor: '',
      victorName: '',
    })
    clearPaintState()
    creditRoundWins({ red: c.red, blue: c.blue, green: c.green ?? 0, yellow: c.yellow ?? 0 })
    void saveLeaderboard()
    publishLeaderboard()
    openLobby(false)
    console.log(`[Server] round ${lastRoundIndex} ended → lobby now; win screen stays ${SUMMARY_MS / 1000}s on clients`)
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

  engine.addSystem(() => { endLagFrame(paintedCount(), botCount()) })

  // Cold start is the lobby, not a match and not a quiet idle. Joiners get
  // the cross from sendLobbyLayout; nobody has to wait for a round to end.
  openLobby(false)
  console.log('[Server] ✅ Ready — lobby open; joinRoster, paintTick; paintDelta 5Hz; roundEnded → lobby floor, win screen stays up.')
}
