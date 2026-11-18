/**
 * team.ts — shared Team enum, colors, coverage helpers, and bot body palette.
 *
 * Referenced by both client (paint colors, HUD, local team state, ghost
 * body tint) and server (roster assignment, paint state). Wire values
 * are stable:
 *   0 = None (unassigned / guest)
 *   1 = Red
 *   2 = Blue
 *   3 = Green
 *   4 = Yellow
 * These MUST match the integer values sent on the `teamAssigned` and
 * `paintDelta`/`snapshot` messages in shared/messages.ts.
 *
 * Body tints live here so a new team or a dark-mode theme is just a
 * palette entry. The client applies them with GltfNodeModifiers; this
 * file stays free of ECS so the server can import it safely.
 *
 * Team colours are the four pre-19620a2 lobby pill colours: already
 * distinct on unlit billboards, and yellow stays #FFE04A so it does not
 * read as olive or mustard.
 */
export enum Team {
  None   = 0,
  Red    = 1,
  Blue   = 2,
  Green  = 3,
  Yellow = 4,
}

export const PLAYING_TEAMS = [Team.Red, Team.Blue, Team.Green, Team.Yellow] as const
export type PlayingTeam = (typeof PLAYING_TEAMS)[number]

export const TEAM_IDS = ['red', 'blue', 'green', 'yellow'] as const
export type TeamColorId = (typeof TEAM_IDS)[number]

export function isPlayingTeam(team: number): team is PlayingTeam {
  return team === Team.Red || team === Team.Blue || team === Team.Green || team === Team.Yellow
}

export const TEAM_NAME: Record<PlayingTeam, string> = {
  [Team.Red]: 'RED',
  [Team.Blue]: 'BLUE',
  [Team.Green]: 'GREEN',
  [Team.Yellow]: 'YELLOW',
}

export function teamName(team: number): string {
  return isPlayingTeam(team) ? TEAM_NAME[team] : 'NONE'
}

export function teamColorId(team: number): TeamColorId | 'none' {
  return isPlayingTeam(team) ? TEAM_IDS[team - 1] : 'none'
}

export function teamFromColorId(id: TeamColorId): PlayingTeam {
  return (TEAM_IDS.indexOf(id) + 1) as PlayingTeam
}

export type Rgb01 = { r: number; g: number; b: number }

/** Team palette as 0..1 RGB. Lobby / paint / HUD share these exact hexes. */
export const TEAM_RGB: Record<number, Rgb01> = {
  1: { r: 255 / 255, g: 117 / 255, b: 119 / 255 }, // #FF7577
  2: { r: 106 / 255, g: 153 / 255, b: 252 / 255 }, // #6A99FC
  3: { r:  79 / 255, g: 214 / 255, b: 140 / 255 }, // #4FD68C
  4: { r: 255 / 255, g: 224 / 255, b:  74 / 255 }, // #FFE04A
}

/** Same values as TEAM_RGB, as #RRGGBB. */
export const TEAM_HEX: Record<number, string> = {
  1: '#FF7577',
  2: '#6A99FC',
  3: '#4FD68C',
  4: '#FFE04A',
}

export const DEFAULT_BOT_BODY_THEME = 'default'

/**
 * Body color swatches by theme. Add a team or a dark-mode theme by adding
 * keys here, then call setBotBodyTheme('dark') (or setBotBodyColor with a
 * one-off hex).
 *
 * `balloon` is the Balloon Battle (FFA) body color — same as blue, matching
 * the existing neutral-light rule.
 */
export const BOT_BODY_PALETTE: Record<string, Record<string, string>> = {
  default: {
    red: '#FF7577',
    blue: '#6A99FC',
    balloon: '#6A99FC',
    green: '#4FD68C',
    yellow: '#FFE04A',
  },
}

/** Parse #RGB or #RRGGBB (with or without '#'). Falls back to team blue. */
export function hexToRgb01(hex: string): Rgb01 {
  const raw = hex.trim().replace(/^#/, '')
  const h = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { ...TEAM_RGB[Team.Blue] }
  const n = parseInt(h, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export function rgb01ToHex(c: Rgb01): string {
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0').toUpperCase()
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`
}

/** Look up a named swatch in a theme, falling back to the default theme, then blue. */
export function botBodySwatch(name: string, theme = DEFAULT_BOT_BODY_THEME): string {
  const pal = BOT_BODY_PALETTE[theme]
  const fallback = BOT_BODY_PALETTE[DEFAULT_BOT_BODY_THEME]
  return pal?.[name] ?? fallback?.[name] ?? fallback.blue
}

const TEAM_SWATCH_NAME: Record<PlayingTeam, string> = {
  [Team.Red]: 'red',
  [Team.Blue]: 'blue',
  [Team.Green]: 'green',
  [Team.Yellow]: 'yellow',
}

/** Team body color for the current (or given) theme. Balloon Battle passes balloonNeutral. */
export function botBodySwatchForTeam(
  team: number,
  opts?: { theme?: string; balloonNeutral?: boolean },
): string {
  const theme = opts?.theme ?? DEFAULT_BOT_BODY_THEME
  if (opts?.balloonNeutral) return botBodySwatch('balloon', theme)
  if (isPlayingTeam(team)) return botBodySwatch(TEAM_SWATCH_NAME[team], theme)
  return botBodySwatch('blue', theme)
}

// ─── Coverage / scoring ─────────────────────────────────────────────

export type TeamCounts = { red: number; blue: number; green: number; yellow: number }

export type TeamCoverage = TeamCounts & { total: number }

export function emptyTeamCounts(): TeamCounts {
  return { red: 0, blue: 0, green: 0, yellow: 0 }
}

export function teamCountsTotal(c: Partial<TeamCounts>): number {
  return (c.red ?? 0) + (c.blue ?? 0) + (c.green ?? 0) + (c.yellow ?? 0)
}

export function emptyCoverage(): TeamCoverage {
  return { red: 0, blue: 0, green: 0, yellow: 0, total: 0 }
}

export function teamCount(counts: Partial<TeamCounts> | TeamCoverage, team: number): number {
  if (team === Team.Red) return counts.red ?? 0
  if (team === Team.Blue) return counts.blue ?? 0
  if (team === Team.Green) return counts.green ?? 0
  if (team === Team.Yellow) return counts.yellow ?? 0
  return 0
}

export function addTeamCount(counts: TeamCounts, team: number, n = 1): void {
  if (team === Team.Red) counts.red += n
  else if (team === Team.Blue) counts.blue += n
  else if (team === Team.Green) counts.green += n
  else if (team === Team.Yellow) counts.yellow += n
}

/** Tally a list of team ids into a coverage object. `total` is the list length
 *  (painted cells). Callers that want walkable-cell totals overwrite `total`. */
export function coverageFromTeams(teams: Iterable<number>, total?: number): TeamCoverage {
  const c = emptyCoverage()
  let n = 0
  for (const t of teams) {
    addTeamCount(c, t)
    n++
  }
  c.total = total ?? n
  return c
}

export function coveragePct(c: TeamCoverage, team: number): number {
  if (c.total <= 0) return 0
  return Math.round(100 * teamCount(c, team) / c.total)
}

export function coveragePcts(c: TeamCoverage): TeamCounts {
  return {
    red: coveragePct(c, Team.Red),
    blue: coveragePct(c, Team.Blue),
    green: coveragePct(c, Team.Green),
    yellow: coveragePct(c, Team.Yellow),
  }
}

/** Teams tied for the highest cell count. Empty coverage → all four tied at 0. */
export function leadingTeams(c: TeamCoverage | TeamCounts): PlayingTeam[] {
  let max = -1
  const out: PlayingTeam[] = []
  for (const t of PLAYING_TEAMS) {
    const n = teamCount(c, t)
    if (n > max) { max = n; out.length = 0; out.push(t) }
    else if (n === max) out.push(t)
  }
  return out
}

/** Highest coverage first; ties break by team id (red, blue, green, yellow). */
export function rankedTeams(c: TeamCoverage | TeamCounts): PlayingTeam[] {
  return PLAYING_TEAMS.slice().sort((a, b) => {
    const d = teamCount(c, b) - teamCount(c, a)
    return d !== 0 ? d : a - b
  })
}

/** End-of-round title. One winner, a two-way named tie, or a generic tie. */
export function winnerHeadline(c: TeamCoverage | TeamCounts): string {
  const leaders = leadingTeams(c)
  if (leaders.length === 1) return `${TEAM_NAME[leaders[0]]} WINS!`
  if (leaders.length === 2) return `${TEAM_NAME[leaders[0]]} & ${TEAM_NAME[leaders[1]]} TIE!`
  return 'IT\'S A TIE!'
}

/** Smallest of the playing teams. Ties prefer the lower team id (red first). */
export function smallestTeam(counts: Partial<TeamCounts>, teams: readonly PlayingTeam[] = PLAYING_TEAMS): PlayingTeam {
  let best = teams[0]
  let n = Infinity
  for (const t of teams) {
    const v = teamCount(counts, t)
    if (v < n) { n = v; best = t }
  }
  return best
}

/** PvP bot fill: even each team up to max(1, largest human side), then cap
 *  per team and total so a lopsided lobby does not flood the server. */
export const PVP_MAX_BOTS = 9
export const PVP_MAX_BOTS_PER_TEAM = 3

export function pvpBotFill(humans: Partial<TeamCounts>): TeamCounts {
  const h: TeamCounts = {
    red: humans.red ?? 0,
    blue: humans.blue ?? 0,
    green: humans.green ?? 0,
    yellow: humans.yellow ?? 0,
  }
  const out = emptyTeamCounts()
  if (h.red + h.blue + h.green + h.yellow === 0) return out
  let target = Math.max(1, h.red, h.blue, h.green, h.yellow)
  target = Math.min(target, PVP_MAX_BOTS_PER_TEAM)
  const fill = (tgt: number): TeamCounts => ({
    red: Math.max(0, tgt - h.red),
    blue: Math.max(0, tgt - h.blue),
    green: Math.max(0, tgt - h.green),
    yellow: Math.max(0, tgt - h.yellow),
  })
  const total = (b: TeamCounts) => b.red + b.blue + b.green + b.yellow
  while (target > 0 && total(fill(target)) > PVP_MAX_BOTS) target--
  return fill(target)
}
