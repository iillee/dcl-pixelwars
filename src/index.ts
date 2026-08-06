/**
 * index.ts — thin entry-point router for Squareoff.
 *
 * IMPORTANT: do NOT use the sync `isServer()` from `@dcl/sdk/network` here.
 * That helper starts as `false` until an async EngineApi call resolves. If
 * main() races it, the headless server takes the client branch, imports
 * ~system/RestrictedActions, and hammurabi exits with code 1.
 */

import { isServer as queryIsServer } from '~system/EngineApi'

// Shared modules MUST be static imports so defineComponent / registerMessages
// run before main() seals the engine.
import './shared/messages'
import './shared/components'

export async function main() {
	const { isServer } = await queryIsServer({})

	if (isServer) {
		console.log('[Main] SERVER MODE')
		try {
			const { setupServer } = await import('./server/server')
			await setupServer()
		} catch (err) {
			console.error('[Main] SERVER STARTUP FAILED:', err)
		}
		return
	}

	console.log('[Main] CLIENT MODE')
	const { setupClient } = await import('./client')
	await setupClient()
}
