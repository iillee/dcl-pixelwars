/**
 * What a bot's body is doing, for the client avatar pose.
 *
 * Separate from the movement class on `st` (walk / knock / rescue / wind-up /
 * glide). `st` still decides interpolation. `an` only picks a clip.
 *
 * The numbers match the human clips in assets/emotes/bot_*_emote.glb
 * (explorer locomotion: rise, fall, slide, double jump, glide).
 */
export const BOT_ANIM_LOCO = 0
export const BOT_ANIM_SLIDE = 1
export const BOT_ANIM_JUMP = 2
export const BOT_ANIM_DOUBLE = 3
export const BOT_ANIM_GLIDE = 4
export const BOT_ANIM_FALL = 5

/** The recovery glider pops out only while the bot is actually gliding. */
export function botShowsGlider(an: number): boolean {
  return an === BOT_ANIM_GLIDE
}

export type GhostClip = 'idle' | 'jump' | 'double' | 'glide' | 'fall' | 'slide'

/** Clip baked into ghost-recover.glb for this pose code. */
export function ghostClipForPose(an: number): GhostClip {
  if (an === BOT_ANIM_JUMP) return 'jump'
  if (an === BOT_ANIM_DOUBLE) return 'double'
  if (an === BOT_ANIM_GLIDE) return 'glide'
  if (an === BOT_ANIM_FALL) return 'fall'
  if (an === BOT_ANIM_SLIDE) return 'slide'
  return 'idle'
}

/**
 * Extra yaw (degrees) for a full 360° spin over `durS`, the length of the
 * double-jump clip — the same window the player avatar's double-jump spin uses.
 * 0 before the window and after it completes (360 ≡ 0), so facing yaw is unchanged.
 */
export function doubleJumpSpinDeg(elapsedS: number, durS: number): number {
  if (!(durS > 0) || !(elapsedS >= 0) || elapsedS >= durS) return 0
  return 360 * (elapsedS / durS)
}
