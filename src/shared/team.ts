/**
 * team.ts — shared Team enum.
 *
 * Referenced by both client (paint colors, HUD, local team state) and
 * server (roster assignment, paint state). Wire values are stable:
 *   0 = None (unassigned / guest)
 *   1 = Red
 *   2 = Blue
 *   3 = Corruption (PvE ooze tiles — not a player team)
 * These MUST match the integer values sent on the `teamAssigned` and
 * `paintDelta`/`snapshot` messages in shared/messages.ts.
 */
export enum Team {
  None = 0,
  Red  = 1,
  Blue = 2,
  Corruption = 3,
}

/** Team palette as 0..1 RGB (pallet.jpeg: red #FF7577, blue #6A99FC).
 *  Corruption: near-black purple so it reads as “wrong” paint on the floor.
 *  Plain numbers so the server runtime can import this file safely. */
export const TEAM_RGB: Record<number, { r: number; g: number; b: number }> = {
  1: { r: 255 / 255, g: 117 / 255, b: 119 / 255 },
  2: { r: 106 / 255, g: 153 / 255, b: 252 / 255 },
  3: { r: 28 / 255, g: 8 / 255, b: 36 / 255 },
}
