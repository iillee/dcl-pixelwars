# Pixelwars — GDD Summary

**Studio:** ile · **Target:** World `pixelwars.dcl.eth` · **Status:** V0 live · **V1 revised 2026-10-01**

Full doc: [`gdd.md`](gdd.md). The 2026-09-09 submission (dual bases + light items) is archived at [`../archive/design/gdd-submit-2026-09-09.md`](../archive/design/gdd-submit-2026-09-09.md).

## The Pitch

Two teams paint the floor of a shifting, multi-level maze. Whoever covers more ground when the 5-minute timer hits wins, then the maze regenerates. Splatoon-style turf on a map that does not sit still, built for a walk-in five-minute visit.

**V1 theme: Strategic Territory & Player Competition.** Do not replace walk-to-paint. Make territory denser, easier to read, and useful during the round.

## Core Loop

1. **Walk** → footsteps paint a patch in your color.
2. **Contest** → walking on enemy paint flips it.
3. **Hold** *(V1)* → your own paint makes you move faster.
4. **Swing** *(V1)* → a Paint Bomb (and at most one other paint power-up) flips a chunk of floor. No aim.
5. **Reposition** → linked teleport orbs.
6. **Score** → round ends; banner shows winner, team %, and your contribution; maze regenerates.

## Pillars

- Coverage is king.
- Fresh maze every round.
- Any minute is a whole game.
- Territory is a tool during the round, not only the final score.

## V1 Scope (4 Weeks)

- **Week 1 — Level, teams & visuals.** Tighter maze for more encounters. Better team balance (no mid-round color swaps). Red/blue SDK name tags. Fix slope paint on mobile. Start block remodel / skin experiments.
- **Week 2 — Strategic territory.** Tune speed on friendly paint. Per-player contribution on the end-of-round breakdown. Keep testing skins against paint readability.
- **Week 3 — Items & solo experiment.** Paint Bomb, plus one paint-focused power-up if a trial earns it. Prototype spreading corruption/wildfire and compare it to the existing ghost bot.
- **Week 4 — Playtest, balance, release.** Multiple player counts, phone and desktop. Balance scale, movement, items, scoring, teams. Ship the skins that worked. Experimental systems ship only if tests support them.

**Top risk:** a tighter maze feels cramped, or friendly-paint speed snowballs. **Fallback:** relax layout toward today’s 5×5 / 2 m maze and turn the speed bonus down or off.

## Explicitly not V1

Combat and projectiles, hide-in-paint, a promised 1 m grid, clans, daily challenges, recently-seen list, weekly in-scene countdown, persistent power, and a large item or bot catalogue. Dual bases are not the pillar. The old “bases unlock V2 weapons” line is retired.

## What V0 already is

11×11 world (176 m). Procedural maze, authoritative paint, 5-minute UTC rounds, teleport orbs, ghost bot for solo play, thumb-safe HUD, all-time painter leaderboard. Spawn is the shared center cross. Teams alternate by join order and can drift when people leave — that is the balance bug V1 fixes. Phones already run the scene; slope paint not drawing is the known mobile hole.

## Why come back (honest)

Short rounds, a new maze every time, and a banner that shows your share of the result. No new retention system in V1. The 29 Sep 2026 playtest set this direction. It did not prove the new mechanics yet.
