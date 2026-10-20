/**
 * touchControls.ts — mobile native on-screen button layout (pattern from
 * dcl-snowdrift src/client/touchControls.ts).
 *
 * Hides the native IA_PRIMARY (E) and IA_SECONDARY (F) buttons on mobile:
 * the scene's own hotbar (client/abilityHotbar.tsx) is the touch surface
 * for Lunge and Paint Bomb, and native buttons would double-trigger.
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
      { inputAction: InputAction.IA_SECONDARY, hide: true },
    ],
    hideJoystick: false,
    hideCrosshair: false,
  })
}
