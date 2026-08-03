/**
 * team.ts — shared Team enum.
 *
 * Referenced by both client (paint colors, HUD, local team state) and
 * server (roster assignment, paint state). Wire values are stable:
 *   0 = None (unassigned / guest)
 *   1 = Red
 *   2 = Blue
 * These MUST match the integer values sent on the `teamAssigned` and
 * `paintDelta`/`snapshot` messages in shared/messages.ts.
 */
export enum Team {
  None = 0,
  Red  = 1,
  Blue = 2,
}
