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

/** Full 360° double-jump spin, seconds. Faster than the clip so the turn reads as a snap, with ease-out. */
export const DOUBLE_JUMP_SPIN_DUR_S = 0.38

function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

/**
 * Extra yaw (degrees) for a full 360° spin over `durS` with ease-out.
 * 0 before the window and after it completes (360 ≡ 0), so facing yaw is unchanged.
 */
export function doubleJumpSpinDeg(elapsedS: number, durS: number = DOUBLE_JUMP_SPIN_DUR_S): number {
  if (!(durS > 0) || !(elapsedS >= 0) || elapsedS >= durS) return 0
  return 360 * easeOutCubic(elapsedS / durS)
}

/** Squash / stretch / settle window on a jump or double jump, seconds. */
export const JUMP_POP_S = 0.40
export const JUMP_SQUASH_S = 0.10
export const JUMP_STRETCH_S = 0.10

export type JumpPop = { y: number; sx: number; sy: number; sz: number }

/** Visual-only hop flourish (metres and scale multipliers). Settles to identity. */
export function jumpPop(elapsedS: number): JumpPop {
  const rest: JumpPop = { y: 0, sx: 1, sy: 1, sz: 1 }
  if (!(elapsedS >= 0) || elapsedS >= JUMP_POP_S) return rest
  if (elapsedS < JUMP_SQUASH_S) {
    const s = Math.sin((elapsedS / JUMP_SQUASH_S) * Math.PI)
    return { y: -0.05 * s, sx: 1 + 0.16 * s, sy: 1 - 0.22 * s, sz: 1 + 0.16 * s }
  }
  const stretchEnd = JUMP_SQUASH_S + JUMP_STRETCH_S
  if (elapsedS < stretchEnd) {
    const s = Math.sin(((elapsedS - JUMP_SQUASH_S) / JUMP_STRETCH_S) * Math.PI)
    return { y: 0.12 * s, sx: 1 - 0.12 * s, sy: 1 + 0.20 * s, sz: 1 - 0.12 * s }
  }
  return rest
}
