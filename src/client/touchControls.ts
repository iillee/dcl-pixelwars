/**
 * touchControls.ts — mobile native on-screen button layout (pattern from
 * dcl-snowdrift src/client/touchControls.ts).
 *
 * Hides the native IA_PRIMARY (E) button on mobile: the scene's own hotbar
 * (client/abilityHotbar.tsx) is the touch surface for Punch, and a native
 * button would double-trigger. (IA_SECONDARY was hidden for Paint Bomb;
 * re-hide it if the bomb comes back.)
 * Native IA_ACTION_3 (1, overview toggle) and IA_ACTION_6 (4, overview
 * rotate) are left at their defaults. No-op on desktop.
 */

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

export function setupTouchControls(): void {
  if (!isMobile()) return
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    touchInputs: [
      { inputAction: InputAction.IA_PRIMARY, hide: true },
    ],
    hideJoystick: false,
    hideCrosshair: false,
  })
}
