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
 * `eventBus` / `ClientEvents` from this module — keeping all audio config in one place.
 */

import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'

const MUSIC_VOLUME = 0.4
const MUSIC_SRC = 'assets/sounds/HomeAgain_Loop.mp3'
const CLICK_SRC = 'assets/sounds/click.wav'
const CLAIM_SRC = 'assets/sounds/pop.mp3'

let musicEnt: Entity = 0 as Entity
let muteClickEnt: Entity = 0 as Entity
let claimSfxEnt: Entity = 0 as Entity
let musicMuted = true
let playStartMs = 0
let pausedPositionSec = 0

export function initAudio(): void {
  muteClickEnt = engine.addEntity()
  Transform.create(muteClickEnt, { parent: engine.CameraEntity })
  claimSfxEnt = engine.addEntity()
  Transform.create(claimSfxEnt, { parent: engine.CameraEntity })
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
 * (paint CRDT apply) already guards against re-walking own tiles,
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
