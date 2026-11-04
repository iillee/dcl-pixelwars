/**
 * Airborne stand-in. The avatar entity is never reparented and its
 * AvatarShape is not rewritten to swap bodies. While the server says the
 * bot is off the ground, the renderer hides that avatar with
 * VisibilityComponent and draws the existing ghost instead.
 *
 * VisibilityComponent is the hide. The Godot explorer tags the AvatarShape
 * node as the entity's own visual and only sets that node's `visible` flag
 * when the component is dirty, so the avatar mesh is not freed and does not
 * play its fade-in. Scale 0 is not a hide: that explorer clamps a zero scale
 * to a speck, and a transform rewrite is what faded the mesh on the parent
 * experiment. Write the visibility flag only when it changes.
 *
 * The ghost is the Pac-Man body in assets/models/bots/ghost-red.glb and
 * ghost-blue.glb (crown 1.56 m, +Z forward). Motion is on the entity:
 * a spin and tilt on a hit, a bob and sway in the air, a forward lean
 * while gliding. The glider is a separate model with no Armature_Prop node.
 * Wind-up (st 3) stays the avatar: that pose is standing on the floor.
 */
export const STANDIN_GHOST = {
  red: 'assets/models/bots/ghost-red.glb',
  blue: 'assets/models/bots/ghost-blue.glb',
} as const

/** Renamed copy of the glider. The source file's armature node is Armature_Prop, which the explorer binds as an emote prop. */
export const GLIDER_MODEL = 'assets/models/bot_glider.glb'

/** Crown height of ghost-red.glb / ghost-blue.glb (scripts/build-ghost-glbs.mjs). */
export const GHOST_CROWN_M = 0.2 + 0.88 + 0.48
/** Scale the ghost so the crown matches a player. */
export const STANDIN_SCALE = 1.8 / GHOST_CROWN_M
/**
 * Glider mesh sits about 2.1 m up in its own file. This drop puts the wing
 * just over the scaled crown. No extra yaw: the ghost and the wing both face +Z.
 */
export const GLIDER_DROP_M = 0.34

/** Nose-down lean, degrees, held for the whole glide. */
export const GLIDE_PITCH_DEG = 18

/** Grounded this long before the avatar comes back, so a one-frame st=0 does not flap. */
export const STANDIN_GROUND_HOLD_S = 0.3

export type AirPhase = 'tumble' | 'jump' | 'fall' | 'glide'

export function standInModel(team: number): string {
  return team === 2 ? STANDIN_GHOST.blue : STANDIN_GHOST.red
}

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

/** `an` is shared/botAnim.ts. Rescue (st 2) uses the fall motion. */
export function phaseFor(st: number, an: number): AirPhase {
  if (an === 4 || st === 4) return 'glide'
  if (an === 2 || an === 3) return 'jump'
  if (an === 5 || st === 2) return 'fall'
  return 'tumble'
}

export type GhostPose = { pitch: number; roll: number; yawExtra: number; bob: number }

/** Code motion. Pitch, roll, and yawExtra are degrees. Bob is metres. */
export function ghostPose(phase: AirPhase, age: number, time: number): GhostPose {
  const t = Math.max(0, time)
  const bob = Math.sin(t * 3.2) * 0.07
  const sway = Math.sin(t * 2.1) * 7
  if (phase === 'glide') {
    return { pitch: GLIDE_PITCH_DEG, roll: sway * 0.35, yawExtra: 0, bob: Math.sin(t * 2.2) * 0.05 }
  }
  if (phase === 'jump') {
    const u = Math.min(1, Math.max(0, age) / 0.35)
    return { pitch: -14 * Math.sin(Math.PI * u), roll: sway * 0.4, yawExtra: 0, bob: bob + 0.14 * Math.sin(Math.PI * u) }
  }
  if (phase === 'fall') return { pitch: 10, roll: sway, yawExtra: 0, bob }
  const u = Math.min(1, Math.max(0, age) / 0.6)
  return { pitch: 20 * Math.sin(Math.PI * u), roll: 360 * u, yawExtra: 40 * Math.sin(Math.PI * u), bob }
}
