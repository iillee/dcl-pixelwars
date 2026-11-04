/**
 * Airborne stand-in. The avatar entity is never reparented and its
 * AvatarShape is not rewritten to swap bodies. While the server says the
 * bot is off the ground, the renderer hides that avatar with
 * VisibilityComponent and draws STANDIN_MODEL instead.
 *
 * The Unity explorer ignores VisibilityComponent on a scene AvatarShape, so
 * the hide that actually moves the mesh is a single transform write to
 * AVATAR_PARK on takeoff (and the matching write back to the feet on landing).
 * A finished tween is aimed at that same point so the NPC walker does not
 * stroll the body across the map. AvatarShape is not rewritten. Godot also
 * gets visible:false on that one transition; it does not free the node.
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

/**
 * Where the real avatar waits while the mannequin draws. Outside the arena
 * and below every platform, so a client that ignores VisibilityComponent on
 * AvatarShape still has nothing to render in view.
 */
export const AVATAR_PARK = { x: 8000, y: -400, z: 8000 }

/** How fast the stand-in may change heading, degrees per second. */
export const YAW_DEG_PER_SEC = 240

/**
 * Shortest-arc step toward `target`, capped so a one-frame velocity reversal
 * cannot spin the body 180°.
 */
export function approachYaw(current: number, target: number, maxStep: number): number {
  const wrap = (a: number) => {
    let x = a % 360
    if (x < 0) x += 360
    return x
  }
  let d = wrap(target) - wrap(current)
  if (d > 180) d -= 360
  if (d < -180) d += 360
  if (d > maxStep) d = maxStep
  else if (d < -maxStep) d = -maxStep
  return wrap(current) + d
}

/**
 * In the air for real: rescue, glide, or a knock whose pose is jump, double,
 * fall, or glide. A grounded dash (an 0) or floor slide (an 1) stays the avatar.
 */
export function standInFor(st: number, an: number): boolean {
  if (st === 2 || st === 4) return true
  if (st !== 1) return false
  return an === 2 || an === 3 || an === 4 || an === 5
}

export function stepStandIn(
  showing: boolean,
  groundHeld: number,
  st: number,
  an: number,
  dt: number,
): { showing: boolean; groundHeld: number; changed: boolean } {
  if (standInFor(st, an)) {
    if (showing) return { showing, groundHeld: 0, changed: false }
    return { showing: true, groundHeld: 0, changed: true }
  }
  if (!showing) return { showing: false, groundHeld: 0, changed: false }
  const held = groundHeld + Math.max(0, dt)
  if (held < STANDIN_GROUND_HOLD_S) return { showing: true, groundHeld: held, changed: false }
  return { showing: false, groundHeld: 0, changed: true }
}

/**
 * `an` is shared/botAnim.ts. The first moments of a knock flail; glide and
 * the double jump take over immediately. Rescue (st 2) hangs in the fall.
 */
export function phaseFor(st: number, an: number, airTime: number): AirPhase {
  if (an === 4 || st === 4) return 'glide'
  if (an === 3) return 'double'
  if (airTime < 0.45 && st !== 2) return 'tumble'
  if (an === 2) return 'jump'
  if (an === 5 || st === 2) return 'fall'
  return 'fall'
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
