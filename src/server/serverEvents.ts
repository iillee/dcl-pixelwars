/**
 * serverEvents.ts — server-runtime event names.
 *
 * Prefer importing via the bus barrel:
 * `import { eventBus, ServerEvents } from 'src/shared/utils/eventBus'`
 *
 * Client code must not use these — use ClientEvents instead.
 */

export enum ServerEvents {
	/** Emitted after the round boundary crossed. Payload: { seed: number } */
	RoundReset = 'server:roundReset',
}
