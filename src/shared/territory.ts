/**
 * Paint tank for the Prototype lobby mode. Numbers and pure ordering only.
 * The server spends. Bot Fight and Team Fight do not read this.
 *
 * A flip is a neutral or enemy cell becoming yours. A cell you already own
 * is free. Area paints that cost more than the tank take the nearest flips
 * first and leave the rest unchanged. Combat does not consult the tank.
 */

export const PAINT_CAPACITY = 80

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

export type TankOp = { id: string; flip: boolean }

/**
 * One pass. `flip` is computed before any of these cells change.
 * Non-flips are kept (they are free). Flips past an empty tank are denied.
 */
export function applyTank(ops: readonly TankOp[], tank: number): { taken: string[]; denied: string[]; tank: number } {
  const taken: string[] = []
  const denied: string[] = []
  let left = tank
  for (const op of ops) {
    if (!op.flip) { taken.push(op.id); continue }
    if (left <= 0) { denied.push(op.id); continue }
    left -= 1
    taken.push(op.id)
  }
  return { taken, denied, tank: left }
}
