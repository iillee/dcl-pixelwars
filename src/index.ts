/**
 * index.ts — thin entry-point router for Pixelwars.
 *
 * Runs in TWO runtimes:
 *   - Client (browser QuickJS): renders the maze, painting, UI, audio.
 *   - Server (headless hammurabi-server): authoritative game state, no 3D.
 *
 * We branch on isServer() at the top of main() and dynamic-import the
 * appropriate module. Static imports of client-only modules would crash
 * the server (they pull in ~system/RestrictedActions, ~system/Runtime,
 * @dcl/sdk/players, etc. — none of which exist in the server runtime).
 * Same pattern as flagtag/src/index.ts.
 *
 * Shared modules (src/shared/*) are safe to import from either side and
 * are imported statically by both the client and server modules.
 */

import { isServer } from '@dcl/sdk/network'

// Shared modules MUST be static imports so their component/message
// registrations run BEFORE the engine seals (which happens as soon as main()
// begins). Dynamic-importing them from inside main() throws
// "Engine is already sealed. No components can be added at this stage".
// Same pattern as flagtag/src/index.ts.
import './shared/messages'
import './shared/components'

export async function main() {
  if (isServer()) {
    console.log('[Main] ⚙️  SERVER MODE')
    try {
      const { setupServer } = await import('./server/server')
      await setupServer()
    } catch (err) {
      console.error('[Main] ❌ SERVER STARTUP FAILED:', err)
      throw err
    }
    return
  }

  console.log('[Main] 🎮 CLIENT MODE')
  const { setupClient } = await import('./client')
  await setupClient()
}
