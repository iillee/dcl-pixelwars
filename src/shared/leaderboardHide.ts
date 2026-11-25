/**
 * Wallets left off the persistent wins board. The scene creator tests so
 * often that counting those wins would skew the ranks. Match is
 * case-insensitive. Live and end-of-round scoreboards still show the name.
 */
const EXCLUDED_LEADERBOARD_WALLETS = [
  '0x1e93e534c5e26b01ed242410b43ae23dd0faa52b',
]

export function excludedLeaderboardUser(userId: string): boolean {
  const id = userId.trim().toLowerCase()
  return EXCLUDED_LEADERBOARD_WALLETS.some(w => w === id)
}

/**
 * Kept so an older client filter still compiles. Exclusion is by wallet
 * on the server, so a name check must not hide anyone else.
 */
export function hiddenLeaderboardName(_name: string): boolean {
  return false
}
