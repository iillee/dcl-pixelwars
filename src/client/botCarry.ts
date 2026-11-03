/**
 * When the avatar is parented for an airborne idle. One enter and one leave
 * per knock: a one-frame st=0 on the way down must not unparent, or the
 * explorer fades the AvatarShape in and out.
 */
export const CARRY_GROUND_HOLD_S = 0.3

export function stepCarry(
  carried: boolean,
  groundHeld: number,
  st: number,
  dt: number,
): { carried: boolean; groundHeld: number; parentChanged: boolean } {
  if (st !== 0) {
    if (carried) return { carried, groundHeld: 0, parentChanged: false }
    return { carried: true, groundHeld: 0, parentChanged: true }
  }
  if (!carried) return { carried: false, groundHeld: 0, parentChanged: false }
  const held = groundHeld + Math.max(0, dt)
  if (held < CARRY_GROUND_HOLD_S) return { carried: true, groundHeld: held, parentChanged: false }
  return { carried: false, groundHeld: 0, parentChanged: true }
}
