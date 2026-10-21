/**
 * safeSystems.ts — wrap every engine system in try/catch (client AND server).
 *
 * @dcl/ecs runs systems in a plain loop inside engine.update() and only flushes CRDT /
 * network transports (which is also where incoming comms messages are processed) AFTER the
 * loop. One system that throws therefore aborts the whole frame — every frame, if the bad
 * state persists: later systems stop, and the scene sends and receives nothing over comms
 * while systems registered earlier keep running. Catching per system keeps the loop and
 * comms alive and logs the culprit (first few times, then every 500th).
 * Must be imported before anything registers a system (first import in src/index.ts).
 */
import { engine } from '@dcl/sdk/ecs'

type SystemFn = (dt: number) => void
const wrapped = new Map<SystemFn, SystemFn>()
const origAdd = engine.addSystem.bind(engine)
const origRemove = engine.removeSystem.bind(engine)
let seq = 0

;(engine as any).addSystem = (fn: SystemFn, priority?: number, name?: string) => {
  const label = name || fn.name || `system#${++seq}`
  let errors = 0
  const safe: SystemFn = (dt: number) => {
    try {
      fn(dt)
    } catch (e) {
      errors++
      if (errors <= 3 || errors % 500 === 0) {
        console.error(`[SafeSystems] ${label} threw (${errors}x):`, e, (e as any)?.stack ?? '')
      }
    }
  }
  wrapped.set(fn, safe)
  return origAdd(safe, priority, name)
}

;(engine as any).removeSystem = (selector: string | SystemFn) => {
  if (typeof selector === 'function') {
    const safe = wrapped.get(selector)
    wrapped.delete(selector)
    return origRemove(safe ?? selector)
  }
  return origRemove(selector)
}
