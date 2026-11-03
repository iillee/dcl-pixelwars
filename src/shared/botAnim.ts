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
