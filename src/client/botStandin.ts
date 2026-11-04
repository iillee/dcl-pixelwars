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
 * The model is one rigged mannequin (scripts/build-air-standin.py). Team
 * color is a material override, not a second file. Clips are tumble, jump,
 * double, fall, glide. Code on the entity adds a hit spin, a jump stretch,
 * a double-jump flip, and the glide lean. The glider is a separate model
 * with no Armature_Prop node, shown only while the glide clip plays.
 * Wind-up (st 3) stays the avatar: that pose is standing on the floor.
 */
export const STANDIN_MODEL = 'assets/models/bots/air-standin.glb'

export const STANDIN_CLIPS = ['tumble', 'jump', 'double', 'fall', 'glide'] as const
export type AirPhase = typeof STANDIN_CLIPS[number]

/** Crossfade between skeletal clips. */
export const STANDIN_BLEND_S = 0.12

/** Renamed copy of the glider. The source file's armature node is Armature_Prop, which the explorer binds as an emote prop. */
export const GLIDER_MODEL = 'assets/models/bot_glider.glb'

/**
 * Glide hands land near glTF (y 1.66, z 0.61). The glider mesh sits near
 * y 2.14, so this offset puts the wing on those hands, nose toward +Z.
 */
export const GLIDER_OFFSET = { x: 0, y: -0.48, z: 0.4 }

/** Nose-down lean, degrees, held for the whole glide. */
export const GLIDE_PITCH_DEG = 18

/** Grounded this long before the avatar comes back, so a one-frame st=0 does not flap. */
export const STANDIN_GROUND_HOLD_S = 0.3

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

/** `an` is shared/botAnim.ts. Rescue (st 2) plays the fall clip. */
export function phaseFor(st: number, an: number): AirPhase {
  if (an === 3) return 'double'
  if (an === 2) return 'jump'
  if (an === 4 || st === 4) return 'glide'
  if (an === 5 || st === 2) return 'fall'
  return 'tumble'
}

export type StandPose = { pitch: number; roll: number; yawExtra: number; bob: number; stretch: number }

/** Extra root motion on top of the clip. Pitch, roll, and yawExtra are degrees. */
export function standPose(phase: AirPhase, age: number, time: number): StandPose {
  const t = Math.max(0, time)
  const bob = Math.sin(t * 3.2) * 0.06
  const sway = Math.sin(t * 2.1) * 6
  if (phase === 'glide') {
    return { pitch: GLIDE_PITCH_DEG, roll: sway * 0.25, yawExtra: 0, bob: Math.sin(t * 2.2) * 0.04, stretch: 1 }
  }
  if (phase === 'jump') {
    const u = Math.min(1, Math.max(0, age) / 0.28)
    return {
      pitch: -10 * Math.sin(Math.PI * Math.min(1, age / 0.35)),
      roll: sway * 0.3,
      yawExtra: 0,
      bob,
      stretch: u >= 1 ? 1 : 1 + 0.32 * Math.sin(Math.PI * u),
    }
  }
  if (phase === 'double') {
    const u = Math.min(1, Math.max(0, age) / 0.42)
    return { pitch: 360 * u, roll: 0, yawExtra: 0, bob, stretch: 1 }
  }
  if (phase === 'fall') return { pitch: 8, roll: sway, yawExtra: 0, bob, stretch: 1 }
  const u = Math.min(1, Math.max(0, age) / 0.6)
  return { pitch: 18 * Math.sin(Math.PI * u), roll: 360 * u, yawExtra: 30 * Math.sin(Math.PI * u), bob, stretch: 1 }
}
