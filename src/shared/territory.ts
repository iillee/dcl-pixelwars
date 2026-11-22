/**
 * Cell ordering and idle feet timing used by paint and bots.
 * The Prototype paint tank lived here and has been removed.
 */

/** Tile-column plane of a cell id, so two cells on neighbouring tiles still sort. */
export function cellPlane(id: string): { x: number; z: number } | null {
  const colon = id.indexOf(':')
  if (colon < 0) return null
  const head = id.slice(0, colon).split(',')
  const tail = id.slice(colon + 1).split(',')
  const tx = Number(head[0])
  const tz = Number(head[1])
  const col = Number(tail[0])
  const row = Number(tail[1])
  if (![tx, tz, col, row].every(n => Number.isFinite(n))) return null
  return { x: tx * 16 + col, z: tz * 16 + row }
}

/** Unique ids, nearest to `origin` first. No origin keeps the input order. Ties break on the id. */
export function orderNearest(ids: readonly string[], origin: string | null): string[] {
  const seen = new Set<string>()
  const uniq: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    uniq.push(id)
  }
  const o = origin ? cellPlane(origin) : null
  if (!o) return uniq
  return uniq.sort((a, b) => {
    const pa = cellPlane(a)
    const pb = cellPlane(b)
    const da = pa ? Math.hypot(pa.x - o.x, pa.z - o.z) : Infinity
    const db = pb ? Math.hypot(pb.x - o.x, pb.z - o.z) : Infinity
    if (da !== db) return da - db
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** How often an idle feet sample should go out when the player has not moved cells. */
export const FEET_IDLE_MS = 500

/** True when an idle feet sample should go out. Real paint ids always send. */
export function feetDue(cell: string, lastCell: string, lastMs: number, now: number, hasIds: boolean): boolean {
  if (hasIds) return true
  if (!cell) return false
  if (cell !== lastCell) return true
  return now - lastMs >= FEET_IDLE_MS
}
