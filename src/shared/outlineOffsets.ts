/**
 * Evenly spaced UI-pixel offsets on a circle. Used to stroke React-ECS
 * Labels, which in SDK 7.32 have no outlineWidth.
 */
export const OUTLINE_COPIES = 16

export function outlineOffsets(radius: number, copies: number = OUTLINE_COPIES): Array<[number, number]> {
  const r = Math.max(0, radius)
  if (r <= 0 || copies <= 0) return []
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  for (let i = 0; i < copies; i++) {
    const a = (Math.PI * 2 * i) / copies
    const dx = Math.round(Math.cos(a) * r)
    const dy = Math.round(Math.sin(a) * r)
    const key = `${dx},${dy}`
    if (seen.has(key) || (dx === 0 && dy === 0)) continue
    seen.add(key)
    out.push([dx, dy])
  }
  return out
}
