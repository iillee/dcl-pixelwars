/** Display names left off the wins board. Match is trimmed and case-insensitive. */
const HIDDEN_LEADERBOARD_NAMES = ['ile']

export function hiddenLeaderboardName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return HIDDEN_LEADERBOARD_NAMES.some(h => h === n)
}
