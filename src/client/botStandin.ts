/**
 * Airborne stand-in. The avatar entity is never reparented and its
 * AvatarShape is not rewritten to swap bodies. While the server says the
 * bot is off the ground, the renderer hides that avatar with
 * VisibilityComponent and draws STANDIN_MODEL instead.
 *
 * VisibilityComponent is the hide. The Godot explorer tags the AvatarShape
 * node as the entity's own visual and only sets that node's `visible` flag
 * when the component is dirty, so the avatar mesh is not freed and does not
 * play its fade-in. Scale 0 is not a hide: that explorer clamps a zero scale
 * to a speck, and a transform rewrite is what faded the mesh on the parent
 * experiment. Write the visibility flag only when it changes.
 *
 * Swap STANDIN_MODEL for another rig later. Clips must keep these names.
 * Wind-up (st 3) stays the avatar: that pose is standing on the floor.
 */
export const STANDIN_MODEL = 'assets/models/bots/air-standin.glb'

export const STANDIN_CLIPS = ['tumble', 'jump', 'double', 'fall', 'glide'] as const
export type StandClip = typeof STANDIN_CLIPS[number]

/** Grounded this long before the avatar comes back, so a one-frame st=0 does not flap. */
export const STANDIN_GROUND_HOLD_S = 0.3
/** Crossfade between clips. */
export const STANDIN_BLEND_S = 0.12

const STRETCH_S = 0.28
const FLIP_S = 0.42
const SPIN_S = 0.55
/** Nose-down pitch, degrees, held for the whole glide. */
export const GLIDE_PITCH_DEG = 22

export type MotionKind = 'none' | 'stretch' | 'flip' | 'spin' | 'pitch'

/** Knocked / rescued / gliding. Not the lunge wind-up. */
export function standInFor(st: number): boolean {
  return st === 1 || st === 2 || st === 4
}

export function stepStandIn(
  showing: boolean,
  groundHeld: number,
  st: number,
  dt: number,
): { showing: boolean; groundHeld: number; changed: boolean } {
  if (standInFor(st)) {
    if (showing) return { showing, groundHeld: 0, changed: false }
    return { showing: true, groundHeld: 0, changed: true }
  }
  if (!showing) return { showing: false, groundHeld: 0, changed: false }
  const held = groundHeld + Math.max(0, dt)
  if (held < STANDIN_GROUND_HOLD_S) return { showing: true, groundHeld: held, changed: false }
  return { showing: false, groundHeld: 0, changed: true }
}

/** `an` is shared/botAnim.ts. Rescue (st 2) hangs in the fall pose. */
export function clipFor(st: number, an: number): StandClip {
  if (an === 3) return 'double'
  if (an === 2) return 'jump'
  if (an === 4 || st === 4) return 'glide'
  if (an === 5 || st === 2) return 'fall'
  return 'tumble'
}

export function motionFor(clip: StandClip): MotionKind {
  if (clip === 'jump') return 'stretch'
  if (clip === 'double') return 'flip'
  if (clip === 'tumble') return 'spin'
  if (clip === 'glide') return 'pitch'
  return 'none'
}

export function puffOnClip(clip: StandClip): boolean {
  return clip === 'jump' || clip === 'double'
}

/** Extra root motion on top of the clip. Pitch and roll are degrees. Stretch is a Y scale. */
export function gesturePose(kind: MotionKind, age: number): { pitch: number; roll: number; stretch: number } {
  const t = Math.max(0, age)
  if (kind === 'stretch') {
    const u = Math.min(1, t / STRETCH_S)
    return { pitch: 0, roll: 0, stretch: u >= 1 ? 1 : 1 + 0.32 * Math.sin(Math.PI * u) }
  }
  if (kind === 'flip') {
    const u = Math.min(1, t / FLIP_S)
    return { pitch: 360 * u, roll: 0, stretch: 1 }
  }
  if (kind === 'spin') {
    const u = Math.min(1, t / SPIN_S)
    return { pitch: 0, roll: 360 * u, stretch: 1 }
  }
  if (kind === 'pitch') return { pitch: GLIDE_PITCH_DEG, roll: 0, stretch: 1 }
  return { pitch: 0, roll: 0, stretch: 1 }
}
