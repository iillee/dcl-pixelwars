/**
 * roundStats.ts — per-round KOs and deaths for the round-end summary.
 *
 * Death = a player crossed the fall line (client reports playerFell on the trip, before the rescue
 * drops them at base). Bots walk the graph and can't fall, so they never die (and can't be KO'd).
 * KO = the enemy who last hit that player (dash / lunge / burst impact, or an anvil they hit or
 * pushed that launched the player) within KO_WINDOW_MS before the fall. Cleared every round.
 */
const KO_WINDOW_MS = 4000
const ANVIL_CREDIT_MS = 4000

const lastHit = new Map<string, { by: string; at: number }>()
const anvilToucher = new Map<number, { by: string; at: number }>()
const kos = new Map<string, number>()
const deaths = new Map<string, number>()
const lastFell = new Map<string, number>()

/** Accepted hit of `victim` by enemy `attacker` (both lower-case ids as the server uses them). */
export function noteHit(attacker: string, victim: string, now = Date.now()): void {
  if (attacker && victim && attacker !== victim) lastHit.set(victim, { by: attacker, at: now })
}

/** Someone hit or pushed anvil i: they get credit if it launches an enemy soon after. */
export function noteAnvilTouch(i: number, by: string, now = Date.now()): void {
  anvilToucher.set(i, { by, at: now })
}

/** Victim's client says anvil i launched them; returns the credited player (or null). */
export function anvilCredit(i: number, now = Date.now()): string | null {
  const t = anvilToucher.get(i)
  return t && now - t.at <= ANVIL_CREDIT_MS ? t.by : null
}

/** Player fell / respawned. Rate-limited to one death per 1.5 s. Returns the KO credit, if any. */
export function noteFell(victim: string, now = Date.now()): string | null {
  if (now - (lastFell.get(victim) ?? 0) < 1500) return null
  lastFell.set(victim, now)
  deaths.set(victim, (deaths.get(victim) ?? 0) + 1)
  const h = lastHit.get(victim)
  lastHit.delete(victim)
  if (!h || now - h.at > KO_WINDOW_MS) return null
  kos.set(h.by, (kos.get(h.by) ?? 0) + 1)
  return h.by
}

export function kosOf(id: string): number { return kos.get(id) ?? 0 }
export function deathsOf(id: string): number { return deaths.get(id) ?? 0 }
export function statIds(): string[] { return [...new Set([...kos.keys(), ...deaths.keys()])] }

export function clearRoundStats(): void {
  lastHit.clear(); anvilToucher.clear(); kos.clear(); deaths.clear(); lastFell.clear()
}
