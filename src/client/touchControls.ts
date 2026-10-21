/**
 * touchControls.ts — mobile native on-screen button layout (pattern from
 * dcl-snowdrift src/client/touchControls.ts).
 *
 * Hides the native IA_PRIMARY (E) and IA_SECONDARY (F) buttons on mobile:
 * the scene's own hotbar (client/abilityHotbar.tsx) is the touch surface
 * for Lunge and Paint Burst, and native buttons would double-trigger.
 * All other native gamepad buttons (pointer, 1-4) are hidden too; only the
 * joystick and jump remain. No-op on desktop.
 */

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

export function setupTouchControls(): void {
  if (!isMobile()) return
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    touchInputs: [
      { inputAction: InputAction.IA_PRIMARY, hide: true },
      { inputAction: InputAction.IA_SECONDARY, hide: true },
      // Declutter: only the joystick and jump stay native (overview has its own on-screen buttons).
      { inputAction: InputAction.IA_POINTER, hide: true },
      { inputAction: InputAction.IA_ACTION_3, hide: true },
      { inputAction: InputAction.IA_ACTION_4, hide: true },
      { inputAction: InputAction.IA_ACTION_5, hide: true },
      { inputAction: InputAction.IA_ACTION_6, hide: true },
    ],
    hideJoystick: false,
    hideCrosshair: false,
  })
}
