# Handoff — bot avatar look (2026-11-03)

Luke is done with the previous agent. Pass this to the next one. He has not given a verdict on the avatars.

## Where the work lives

| Item | Value |
|---|---|
| Repo | `github.com/iillee/dcl-pixelwars` |
| Branch | `cursor/bot-avatar-look-0774` (off `main`) |
| Tip | `e65c305` — Bots: team avatars with the other color as skin (8:34 PM ET, Nov 2) |
| PR | https://github.com/iillee/dcl-pixelwars/pull/11 (base `main`, not merged) |
| `main` | `590adea` — red/blue Pac-Man ghosts. Does **not** contain the avatar. |
| World | `pixelwars.dcl.eth` |
| Scene folder Luke deploys from | `C:\Users\luke\AppData\Roaming\creator-hub\scenes\dcl-pixelwars` |
| His git remote name for GitHub | `dcl-pixelwars` (not `origin`). See `docs/HANDOFF-PVP.md` §1. |
| Design note | `design/bot-avatar-2026-11-02.md` |

## What he asked for

He does not like the ghost. He asked for an avatar wearing all blue or all red, with the other color as skin.

## What is built

`src/client/botVisual.ts` only. `npx tsc --noEmit` passed. No one on the agent side has seen it in Explorer.

- Red team: `red_tshirt`, `f_red_comfy_pants`, `ruby_red_loafer`, red hair, blue skin (`TEAM_RGB` blue, `#6A99FC`).
- Blue team: `blue_tshirt`, `elegant_blue_trousers`, `sport_blue_shoes`, blue hair, red skin (`TEAM_RGB` red, `#FF7577`).
- Body `BaseMale`, `short_hair`, `eyes_00`, `eyebrows_00`, `mouth_00`. `name: ''` so there is no NPC nameplate.
- `FLOAT_HEIGHT` is `0`. The avatar origin is the feet, same as a player. Lunge and burst import that constant and subtract it, so hits aim at the feet.
- Hover, bob, scale pulse, ghost eyes, and the looping `ghost.mp3` are gone. The lunge wind-up squash and the eye expressions went with them. There is no replacement tell.
- Ghost files are still in the repo and unused: `assets/models/bots/ghost.glb`, `ghost-red.glb`, `ghost-blue.glb`, `src/client/ghostFace.ts`.

Movement is still the old 10 Hz lerp. Every frame the code writes `Transform.position` and a finished same-point `Tween.Move`. That tween is a guess. The NPC docs say a bare position write is a walk target at about 4 m/s, and bots jog/run at about 8–10 m/s, so a walker that actually runs would drag the body off the server position and the server would reject hits. Whether the tween stops that, and whether a walk cycle plays, is unknown.

URNs were checked against the live base-avatars catalog. Fields match `PBAvatarShape` in this scene's `@dcl/sdk` 7.30.2 and the NPC avatars doc. `sdk-skills` and `sdk7-test-scenes` were not available. Do not treat the tween as a verified pattern.

## What is live

Checked 9:43 AM ET, Nov 3, against the content server.

`pixelwars.dcl.eth` was published at **9:39 AM ET, Nov 3** (`2026-11-03T14:39:37.583Z`). Entity `bafkreidxz35fp6d7rzoyvdp3cjp7upd7ugp65ldg4vag6avkb7mipmjrui`.

That `bin/index.js` contains `red_tshirt`, `blue_tshirt`, `f_red_comfy_pants`, and `elegant_blue_trousers`. It does not reference `ghost.glb`, `ghost-red.glb`, or `ghost-blue.glb`. The three glb files are still in the upload because they sit in the scene folder. The running code is the avatar file.

Earlier the same morning the world was still the 8:57 PM ET Nov 2 ghost upload. Luke had said deploys were not picking up bot edits. Something published the avatar bundle at 9:39. He has not said what he sees.

GitHub `main` is still the ghost. The world and `main` do not match. Do not merge PR #11 unless he asks.

## What is still open

1. **Look.** Do the clothes and the swapped skin read as two teams? Hair is the clothing color. Face, arms, and hands are the other color. He may want hair flipped, a stronger skin color, or a female body. Change wearables in `paintAvatar` only.
2. **Body vs sim.** Stand next to a moving bot. If the avatar lags, slides, or T-poses while hits land somewhere else, the tween lock failed. Fix that before any more costume work. Hits are client-detected and then range-checked on the server against the server position (`hitBot` in `src/server/server.ts`), so a body that is not on the smoothed server position will miss.
3. **Wind-up.** The ghost crouched and squinted before a lunge (`st === 3`). Avatars do not. A position write cancels an `expressionTriggerId` emote, so a tell has to survive the per-frame position write.
4. **Local loop.** Cloud agents edit GitHub. Creator Hub deploys the folder on his PC, and that folder does not update when GitHub does. He is tired of copying files. A worker is connected on that folder (`b2643728-24b7-5d08-ad48-1d39b058ce17`, DESKTOP-2R9CTJF, shared, idle as of 9:37 AM ET). This session could not place a subagent on it: Task `machine.type` only accepted `same_machine` or `new_cloud_vm`. Run the next agent on that machine if the tool allows it. Otherwise `git fetch dcl-pixelwars` and fast-forward in that folder. Do not `git reset --hard` or `git clean`. Preview dirties `main.crdt`, `package.json`, and the thumbnail.
5. **Do not ask him to download raw files again.**

## Files

| Path | Role |
|---|---|
| `src/client/botVisual.ts` | Avatar, lerp, feet position, `FLOAT_HEIGHT` |
| `src/client/lunge.ts`, `src/client/paintBurst.ts` | Import `FLOAT_HEIGHT` as the feet offset |
| `src/client/ghostFace.ts` | Unused eye rig from the ghost pass |
| `scripts/build-ghost-glbs.mjs` | Regenerates the unused ghost glbs |
| `design/bot-avatar-2026-11-02.md` | Short exploratory note |
