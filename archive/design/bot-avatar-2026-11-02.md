# Bot avatar — 2026-11-02

Exploratory. No criterion. Luke does not like the ghost and asked to try an avatar wearing all blue or all red, with the other color as skin.

## Build

- `src/client/botVisual.ts`. The ghost mesh, eyes, hover, bob, and ghost loop are not drawn.
- Red team: `red_tshirt`, `f_red_comfy_pants`, `ruby_red_loafer`, red hair, blue skin (`TEAM_RGB` blue).
- Blue team: `blue_tshirt`, `elegant_blue_trousers`, `sport_blue_shoes`, blue hair, red skin.
- Body is `BaseMale` with `short_hair`, `eyes_00`, `eyebrows_00`, `mouth_00`. No nameplate.
- Feet sit on the server position (`FLOAT_HEIGHT` 0), so lunge and burst still aim at the feet.
- A finished same-point `Tween.Move` is refreshed every frame. The NPC docs say a bare position write is a walk target at about 4 m/s; the tween is there so that walker does not pull the body off the smoothed server position.
- Wearable URNs were taken from the live base-avatars catalog. The component fields match `PBAvatarShape` in this scene's `@dcl/sdk` 7.30.2 and the NPC avatars doc. `sdk-skills` and `sdk7-test-scenes` were not in this environment, so this mechanic is from those docs and the installed component, not from a copied test scene.
- Ghost files (`ghost-red.glb`, `ghost-blue.glb`, `ghostFace.ts`) stay in the repo and are unused.

## Smoke

`npx tsc --noEmit` passed. No Creator Hub preview on this machine.

## Unknown

Whether the body stays on the bot or the built-in walker drags it, whether a walk cycle plays, and whether the swapped skin reads. Those are for a preview pass.
