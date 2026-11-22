/**
 * feed.ts — short match toasts. The server sends them; this only queues
 * what is still on screen.
 */
import { events } from '../shared/events'

const LIFE_MS = 2800
const MAX = 3

export type FeedLine = {
  id: number
  kind: number
  a: string
  b: string
  team: number
  teamB: number
  until: number
}

let lines: FeedLine[] = []
let seq = 0
let wired = false

function push(kind: number, a: string, b: string, team: number, teamB: number): void {
  if (!a) return
  seq += 1
  lines = [{ id: seq, kind, a, b, team, teamB, until: Date.now() + LIFE_MS }, ...lines].slice(0, MAX)
}

export function liveFeed(): FeedLine[] {
  const now = Date.now()
  if (lines.some(line => line.until <= now)) lines = lines.filter(line => line.until > now)
  return lines
}

export function initFeed(): void {
  if (wired) return
  wired = true
  events.on('feed:line', ({ kind, a, b, team, teamB }) => push(kind, a, b, team, teamB))
  events.on('round:reset', () => { lines = [] })
  events.on('lobby:floor', () => { lines = [] })
}
