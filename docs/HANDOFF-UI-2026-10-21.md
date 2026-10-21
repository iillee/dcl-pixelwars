# Pixelwars — Handoff: rounds, round-end summary, HUD restyle, mobile (2026-10-21)

Branch `cursor/pvp-dash-b679` (remote `dcl-pixelwars`). Nothing deployed. Feature reference with tunables and file locations: [`docs/HANDOFF-PVP.md` §8](HANDOFF-PVP.md).

## Current state
- Builds clean (`npm run build`: "Type checking completed without errors"); `scripts/verify-lunge.ts`, `verify-burst.ts`, `verify-daynight.ts` all pass at the tip.
- 3-minute rounds with day/night per round; per-player ownership + KO/death stats; round-end summary screen; live team lists from the score bar; light "key-tile" HUD style everywhere; separate desktop and mobile top bars; mobile Lunge/Burst circles above jump; mobile starts in overhead view.
- Most of the UI and all mobile layout were built from screenshots without an in-world check; see "Untested" below.

## Commits (2026-10-20 19:51 → 2026-10-21 00:32 EDT, oldest → newest)
- 7cf99ad Day/night cycle on the round clock (even round day, odd night)
- 1cf8659 Robustness: per-system try/catch, bounded anvil substeps and path walks, log dropped messages
- 443dcbb Round-end summary: score bar grows into a red|blue square
- 4ae08d5 Summary: three regions (red | unpainted | blue)
- c81a8a1 Summary: per-painter ownership (server tracks last painter per cell, roundOwners)
- 4c849c4 Anvil slow push (client intent, server-moved)
- 43add60 Rounds: 3 minutes (was 5)
- 1f32cb3 Overview camera: 0° yaw (later reverted)
- fef7185 Summary: per-player bands horizontal, big % outside
- a30c35c Overview: restore 45° yaw
- 8409639 Summary: wide framed panel per mockup, screen-relative size
- da92ef3 Summary reference draft: title, territory pill, team cards (territory/KOs/deaths + MVP); KO/death tracking; 10 s hold, click to close
- ac36706 Summary: hotbar look
- db84b91 Summary: simplify (title, bar, two tables), TILES column, phone stacking
- 63ae3a0 Summary: single-line headers, fake-bold, borderless cards, title spacing
- 540404e Score bar click opens live team lists (requestStandings/standings)
- 3a14453 Team tables top-aligned
- c63d0c2 Round clock: hotbar style
- 8eb44a2 Title floats over scene; one shared PANEL_LIGHT; clock without outline
- bd50ff1 Clock key-tile frame; title back to 72 px plain labels
- 36507d7 Clock: 6 px dark ring; star/eye/mute balanced
- 523e68f Top painters: hotbar/summary style
- f0a7185 Overview buttons: key-tile frame, drawn +/−/rotate glyphs, darker active eye
- 2b6f475 Live lists: score bar enlarges into the territory pill
- e752759 Title: one line at any size; subtitle in flow
- 54908af Territory pill: % pinned to bar ends; pill width = tables width
- 4b55ea5 Top painters: fixed rows, centred ranks, tighter
- c97fe85 Territory pill: 1–2 decimals when sides read equal
- 979cd6f Mobile: Lunge/Burst stacked right; hide native pointer + 1–4
- 5146a43 Top bar split buttons; top painters scroll; no round-end backdrop
- 3410f2c Burst emote: one-shot flash (0.3 s hold, stopEmote)
- 1792b24 Desktop clock single panel again (split buttons mobile-only); drag scrollbar; plain title
- 87f2209 Mobile: timer/star fixes, bar spans row, Lunge/Burst circles above jump
- 74d7b4e Mobile circles retune (closer, right, smaller)
- 011e643 Mobile top painters: top 10, no scrollbar/backdrop
- 5098cce Mobile overview zoom 5/15/25
- b422a4b Mobile circles: 70 px right, 60 px lower, bigger icons
- d5b1622 Mobile top row: star | mute | timer | eye; overview controls grow right
- f550581 Mobile burst icon solid black (burst_solid.png)
- 8bd60ed Mobile: auto-start overview, resume after respawn; rotate first

## Untested in-world / on phone
- Desktop top painters drag scrollbar (PrimaryPointerInfo drag; px→UI conversion assumes height/1080; release detection; thumb press not closing the board).
- Mobile Lunge/Burst circle positions vs the real jump button (`JUMP_*` are estimates); burst_solid.png edge quality.
- Burst 0.3 s movement hold: does the punch show while running on desktop, does stopEmote release cleanly on mobile, does the pause feel OK.
- Mobile auto-overview on load (brief normal-camera flash?), 1 s resume after respawn/round reset, staying off after the player turns it off.
- Round-end title fit on narrow phones; subtitle fallback; tie decimals.
- Live team lists (enlarged pill under the clock, stacked/side-by-side, click to close).
- Mobile top row layout/centering; desktop clock identical to 36507d7.
- Mobile overview zoom level 5 framing; rotate-first order.
- KO/death attribution in real matches; per-cell painter counts with bots.
- Hidden native buttons (pointer, 1–4) on phones.

## Open decisions for Luke
- Burst 0.3 s movement pause (`BURST_EMOTE_FREEZE_S`; 0 = no pause but the emote gets cancelled while running).
- LUNGE/BURST labels: only when ready (now) vs always; desktop side for BURST.
- Mobile zoom 5 may be too close (e.g. 10/20/30).
- Team colour in the top painters list needs the server to send each player's team.
- Round-end backdrop removed everywhere (desktop too) — keep or bring back on desktop.
- Rotate glyph is drawn from boxes (ring + nub); a proper icon image would read better.
- The earlier 0% / TIE round (server reported 0 painted cells): root cause not reproduced; watch the dropped-paintTick logs.
- KO rules (4 s last-hit window, anvil toucher credit) and whether to add a crown/MVP by KOs.

## Next steps
1. Phone pass: tune `JUMP_*` / `CIRCLE_*`, check the top row, auto-overview, top painters, summary.
2. Desktop pass: drag scrollbar, clock, live lists, burst emote while running.
3. Decide the open items above; then a real multi-player round to check KOs/deaths and ownership numbers.
4. Before release: `LUNGE_TEST_DUMMY` / debug flags off.

## Never commit
`main.crdt`, `assets/scene/entity-names.ts`, `thumbnails/`, `assets/images/autogenerated-thumbnail.png`, `assets/docs/`, `dclcontext/*`, `package.json` line-ending noise (`git checkout -- package.json` after builds), `assets/sketchup/`, `assets/models/bomb/Bomb_red.glb`, `assets/models/bomb/Bomb_blue.glb`. Never deploy or merge without Luke.
