/**
 * audio.ts — background music + UI click sound.
 *
 * Music is parented to the camera so it stays at ear-level anywhere in
 * the 160m scene. Starts muted so the scene loads quietly; the HUD mute
 * pill toggles it via toggleMusic().
 *
 * Playback position is tracked across pause/resume so the loop continues
 * where it left off instead of restarting each unmute. Pattern borrowed
 * from flagtag's boomboxState: the SDK reads currentTime on the
 * playing:false → true transition, so we must seek BEFORE flipping playing.
 *
 * Future SFX (paint hits, round-end fanfare) will register subscribers on
 * `shared/events` from this module — keeping all audio config in one place.
 */

import { AssetLoad, AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'
import { events } from '../shared/events'
import { AIR_SPIKE_DIVE_VOL, AIR_SPIKE_HIT_VOL, AIR_SPIKE_STAMP_VOL } from '../shared/pvp'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
const CLICK_SRC = 'assets/sounds/click.wav'
const CLAIM_SRC = 'assets/sounds/pop.mp3'
/** flagtag's swoosh.mp3 — dash wind whoosh. */
export const DASH_SRC = 'assets/sounds/swoosh.mp3'
export const DASH_HIT_SRC = 'assets/sounds/pop.mp3'

let musicEnt: Entity = 0 as Entity
let muteClickEnt: Entity = 0 as Entity
let claimSfxEnt: Entity = 0 as Entity
let dashSfxEnt: Entity = 0 as Entity
let dashHitSfxEnt: Entity = 0 as Entity
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0

export function initAudio(): void {
  muteClickEnt = engine.addEntity()
  Transform.create(muteClickEnt, { parent: engine.CameraEntity })
  claimSfxEnt = engine.addEntity()
  Transform.create(claimSfxEnt, { parent: engine.CameraEntity })
  initLungeSfx()
  initBurstSfx()
  initAirSpikeSfx()
  initFlagtagSfx()
  initRescueSfx()
  dashSfxEnt = engine.addEntity()
  Transform.create(dashSfxEnt, { parent: engine.CameraEntity })
  dashHitSfxEnt = engine.addEntity()
  Transform.create(dashHitSfxEnt, { parent: engine.CameraEntity })
  musicEnt = engine.addEntity()
  Transform.create(musicEnt, { parent: engine.CameraEntity })
  AudioSource.create(musicEnt, {
    audioClipUrl: MUSIC_SRC,
    playing: !musicMuted,
    loop: true,
    volume: MUSIC_VOLUME,
    global: true,
  })
  playStartMs = Date.now()
}

export function isMusicMuted(): boolean {
  return musicMuted
}

/**
 * Play the shared UI click SFX. Fire from any button that wants the same
 * feedback as the mute toggle — star, popup close, etc. Reuses the same
 * entity as the mute click so we don't leak audio sources per-button.
 */
export function playUiClick(): void {
  if (!muteClickEnt) return
  AudioSource.createOrReplace(muteClickEnt, {
    audioClipUrl: CLICK_SRC,
    playing: true, loop: false, volume: 0.5, global: true,
  })
}

/**
 * Play the tile-claim SFX for the local player only (camera-parented,
 * global=true so no 3D falloff). Fires once per new claim — caller
 * (noteLocalPaintCandidate) already guards against re-walking own tiles,
 * so no additional throttle needed. Low volume so continuous painting
 * reads as a soft rhythmic sparkle, not a machine gun.
 */
export function playClaimSfx(): void {
  if (!claimSfxEnt) return
  AudioSource.createOrReplace(claimSfxEnt, {
    audioClipUrl: CLAIM_SRC,
    playing: true, loop: false, volume: 0.15, global: true,
  })
}

/** Dash prototype: wind whoosh (flagtag swoosh.mp3) when the local player dashes. */
export function playDashSfx(): void {
  if (!dashSfxEnt) return
  AudioSource.createOrReplace(dashSfxEnt, {
    audioClipUrl: DASH_SRC,
    playing: true, loop: false, volume: 0.85, global: true,
  })
}

/** Lunge start: Luke's takes split from one WAV. WAV (not mp3): no encoder
 *  priming silence; trimmed to ~3 ms lead-in. */
export const LUNGE_SRCS = [1, 2, 3, 4, 5, 6].map(n => `assets/sounds/lunge_0${n}.wav`)
let lastLungeIdx = -1
const lungeSfxEnts: Entity[] = []
/** Random take index, never the same one twice in a row. */
function pickLungeIdx(): number {
  const n = LUNGE_SRCS.length
  let i = Math.floor(Math.random() * (lastLungeIdx < 0 ? n : n - 1))
  if (lastLungeIdx >= 0 && i >= lastLungeIdx) i++
  lastLungeIdx = i
  return i
}
export function pickLungeSrc(): string { return LUNGE_SRCS[pickLungeIdx()] }

/** Startup: download the takes (AssetLoad) and give each its own camera-parented
 *  AudioSource with the clip already bound, so a press only flips playing. */
function initLungeSfx(): void {
  const pre = engine.addEntity()
  // click.wav is the recovery-brace tick (lunge.ts). Preload so the first charge's lock isn't silent.
  AssetLoad.create(pre, { assets: [...LUNGE_SRCS, 'assets/sounds/click.wav'] })
  for (const src of LUNGE_SRCS) {
    const e = engine.addEntity()
    Transform.create(e, { parent: engine.CameraEntity })
    AudioSource.create(e, { audioClipUrl: src, playing: false, loop: false, volume: 0.9, global: true })
    lungeSfxEnts.push(e)
  }
}

/** Local player's lunge start: called on the input frame, before any network send. */
export function playLungeSfx(): void {
  if (lungeSfxEnts.length === 0) return
  const e = lungeSfxEnts[pickLungeIdx()]
  // Same clip on the same entity: createOrReplace restarts it from 0 without a reload.
  AudioSource.createOrReplace(e, { audioClipUrl: LUNGE_SRCS[lungeSfxEnts.indexOf(e)], playing: true, loop: false, volume: 0.9, global: true, currentTime: 0 })
}

/** Dash prototype: hit thud for the attacker (on contact) and the victim (on knockback). */
export function playDashHitSfx(): void {
  if (!dashHitSfxEnt) return
  AudioSource.createOrReplace(dashHitSfxEnt, {
    audioClipUrl: DASH_HIT_SRC,
    playing: true, loop: false, volume: 1, global: true,
  })
}

export function toggleMusic(): void {
  playUiClick()
  const a = AudioSource.getMutableOrNull(musicEnt) as
    { volume: number; playing: boolean; currentTime?: number } | null
  if (!a) return
  if (!musicMuted) {
    // Pause: bank the elapsed play time and stop.
    pausedPositionSec += (Date.now() - playStartMs) / 1000
    a.playing = false
    musicMuted = true
  } else {
    // Resume: seek first, THEN flip playing on.
    a.currentTime = pausedPositionSec
    a.playing = true
    playStartMs = Date.now()
    musicMuted = false
  }
}

/** Paint Burst shockwave (synthesized by scripts/make-burst-sfx.py: low thump + whoosh + click).
 *  Preloaded at startup; the local burst plays it from a camera-parented source,
 *  remote bursts play it positionally (client/paintBurst.ts). */
export const BURST_SFX_SRC = 'assets/sounds/burst_impact.wav'
let burstSfxEnt: Entity | null = null
function initBurstSfx(): void {
  const pre = engine.addEntity()
  AssetLoad.create(pre, { assets: [BURST_SFX_SRC] })
  burstSfxEnt = engine.addEntity()
  Transform.create(burstSfxEnt, { parent: engine.CameraEntity })
  AudioSource.create(burstSfxEnt, { audioClipUrl: BURST_SFX_SRC, playing: false, loop: false, volume: 1, global: true })
}
/** Local player's Paint Burst: on the input frame. */
export function playBurstSfx(): void {
  if (!burstSfxEnt) return
  AudioSource.createOrReplace(burstSfxEnt, { audioClipUrl: BURST_SFX_SRC, playing: true, loop: false, volume: 1, global: true, currentTime: 0 })
}

/** Aerial Burst cues. Distinct from the grounded shockwave (burst_impact.wav).
 *  Dive = press, hit = player connect, stamp = feet meet the floor (no paint). */
export const AIR_DIVE_SRC = 'assets/sounds/air_spike_dive.wav'
export const AIR_HIT_SRC = 'assets/sounds/air_spike_hit.wav'
export const AIR_STAMP_SRC = 'assets/sounds/air_spike_stamp.wav'
let airDiveEnt: Entity | null = null
let airHitEnt: Entity | null = null
let airStampEnt: Entity | null = null
function initAirSpikeSfx(): void {
  const pre = engine.addEntity()
  AssetLoad.create(pre, { assets: [AIR_DIVE_SRC, AIR_HIT_SRC, AIR_STAMP_SRC] })
  const make = (src: string) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: engine.CameraEntity })
    AudioSource.create(e, { audioClipUrl: src, playing: false, loop: false, volume: 1, global: true })
    return e
  }
  airDiveEnt = make(AIR_DIVE_SRC)
  airHitEnt = make(AIR_HIT_SRC)
  airStampEnt = make(AIR_STAMP_SRC)
}
function playGlobal(ent: Entity | null, src: string, volume: number): void {
  if (!ent) return
  AudioSource.createOrReplace(ent, { audioClipUrl: src, playing: true, loop: false, volume, global: true, currentTime: 0 })
}
export function playAirDiveSfx(): void {
  playGlobal(airDiveEnt, AIR_DIVE_SRC, AIR_SPIKE_DIVE_VOL)
}
export function playAirHitSfx(): void {
  playGlobal(airHitEnt, AIR_HIT_SRC, AIR_SPIKE_HIT_VOL)
}
export function playAirStampSfx(): void {
  playGlobal(airStampEnt, AIR_STAMP_SRC, AIR_SPIKE_STAMP_VOL)
}

/** flagtag sounds (copied verbatim from flagtag/assets/sounds): death.mp3 is the old instant-fall cue
 *  (kept, unused by the rescue) and trumpets.mp3 when the round ends / summary starts (round:ended), for every client (flagtag: global, volume 0.8).
 *  Camera-parented 2D sources, preloaded so the first play isn't late. */
const DEATH_SRC = 'assets/sounds/death.mp3'
const TRUMPET_SRC = 'assets/sounds/trumpets.mp3'
let deathSfxEnt: Entity | null = null
let trumpetSfxEnt: Entity | null = null
function initFlagtagSfx(): void {
  const pre = engine.addEntity()
  AssetLoad.create(pre, { assets: [DEATH_SRC, TRUMPET_SRC] })
  deathSfxEnt = engine.addEntity()
  Transform.create(deathSfxEnt, { parent: engine.CameraEntity })
  AudioSource.create(deathSfxEnt, { audioClipUrl: DEATH_SRC, playing: false, loop: false, volume: 1, global: true })
  trumpetSfxEnt = engine.addEntity()
  Transform.create(trumpetSfxEnt, { parent: engine.CameraEntity })
  AudioSource.create(trumpetSfxEnt, { audioClipUrl: TRUMPET_SRC, playing: false, loop: false, volume: 0.8, global: true })
  events.on('round:ended', () => playTrumpetSfx())
}
export function playDeathSfx(): void {
  if (!deathSfxEnt) return
  AudioSource.createOrReplace(deathSfxEnt, { audioClipUrl: DEATH_SRC, playing: true, loop: false, volume: 1, global: true, currentTime: 0 })
}
export function playTrumpetSfx(): void {
  if (!trumpetSfxEnt) return
  AudioSource.createOrReplace(trumpetSfxEnt, { audioClipUrl: TRUMPET_SRC, playing: true, loop: false, volume: 0.8, global: true, currentTime: 0 })
}

/** Fall-rescue trip: swoosh, quieter than the old death sting. Preloaded so the first fall isn't late. */
const RESCUE_SRC = DASH_SRC
const RESCUE_VOL = 0.45
let rescueSfxEnt: Entity | null = null
function initRescueSfx(): void {
  const pre = engine.addEntity()
  AssetLoad.create(pre, { assets: [RESCUE_SRC] })
  rescueSfxEnt = engine.addEntity()
  Transform.create(rescueSfxEnt, { parent: engine.CameraEntity })
  AudioSource.create(rescueSfxEnt, { audioClipUrl: RESCUE_SRC, playing: false, loop: false, volume: RESCUE_VOL, global: true })
}
export function playFallRescueSfx(): void {
  if (!rescueSfxEnt) return
  AudioSource.createOrReplace(rescueSfxEnt, { audioClipUrl: RESCUE_SRC, playing: true, loop: false, volume: RESCUE_VOL, global: true, currentTime: 0 })
}
