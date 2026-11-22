# Pixelwars

*Current design, 2026-11-22. Describes the game on `main`. The 2026-10-01 proposal is archived at `archive/design/gdd-2026-10-01.md`.*

| | |
|---|---|
| Public experience title | Pixelwars — IP & Content Policy self-check: **clear** |
| Deployment target | World: `pixelwars.dcl.eth` |
| Studio / team name | **ile** |
| Date | 2026-11-22 |
| Contact (Discord + email) | Discord: **ile9466** · email: **lukeeescobar@gmail.com** |

The behaviors below are what the build does. Sentences marked `[agent-decided]` are wording chosen while writing this update, not a new playtest result. This pass did not check what is currently deployed on the world.

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | Pick a color, paint the maze, and knock the other teams off. Most paint at three minutes wins, then the maze is new. `[agent-decided]` |
| **Primary player** | Players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a short match they can drop in and out of. |
| **Current status** | **Built on `main`.** Four teams, a lobby, a three-minute coverage round, Dash and Burst, upgrades, a falling star, bots, and a wins board. Play target: [pixelwars.dcl.eth](https://decentraland.org/jump?realm=pixelwars.dcl.eth&position=5,5) |
| **Requested round** | `[OPEN: postponed]` — no new funding round was set in this update |
| **What you can play** | Stand on a color, then paint a floating maze. Dash and Burst knock people and paint. Charge and a falling star open upgrade picks. The team with the most paint at three minutes wins. |

---

## 1. Player Promise

**One-line promise**

> Pick a color, paint the maze, and knock the other teams off. Most paint at three minutes wins, then the maze is new. `[agent-decided]`

**Why this game**

Four teams claim the floor of a maze that is rebuilt every round. Walking paints. Dash and Burst also paint, and they knock other players and bots off the floor. Painting fills a charge you spend on Speed, Paint, or Haste for that round. A star that falls from the sky opens one extra pick. The score is still who covered the most ground when the clock ends.

---

## 2. First Minutes & How to Play

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You are in the lobby. Stand on a colored arm to join that team. Red is west, blue east, yellow north, green south. |
| **5–10 seconds** | The countdown is 15 seconds from the first person on a color, and it shrinks to 5 seconds once everyone present is standing on one. You then drop into the maze already on that team. |
| **10–60 seconds** | Walking paints the floor. Dash (E) lunges, paints a path, and knocks. Burst (F) paints a circle and knocks. A bar shows the four teams' coverage. |
| **1–3 minutes** | Enemy paint is worth more charge than empty floor. Every 1000 charge you pick Speed, Paint, or Haste, up to nine times. A star falls from the sky and grants one extra pick. A fall clears those buffs. Stars on your name show how many you hold. |
| **End of the round** | At three minutes a banner names the team with the most paint. Only a sole winner is recorded. The maze is replaced and the lobby opens for the next pick. |
| **Natural stopping point** | You can leave after the banner. The next maze will not be this one. |

**Player-facing How to Play**

- Stand on a color to pick your team.
- Paint the floor with Dash and Burst.
- Cover the most ground to win.

The in-game panel also says the gold pill opens upgrades, nametag stars are total strength, and a sole winner gets the win.

---

## 3. Core Loop

| # | Step (verb) | What the player does (input → see/hear → what changes) | Why do it again? |
|---|---|---|---|
| 1 | **Walk** | Move → the floor under you takes your color → your coverage rises | Every step is visible progress |
| 2 | **Contest** | Cross another team's paint → those tiles flip → their share drops and you gain more charge than on empty floor | Ground you leave can be taken back |
| 3 | **Knock** | Dash (E) or Burst (F), or the on-screen buttons → a lunge or a painted circle, and a knock → someone is off the floor and cannot paint until they return | A knock changes who is scoring right now |
| 4 | **Upgrade** | Fill the gold charge, or touch the fallen star → pick Speed, Paint, or Haste → you move faster, paint a wider patch, or reuse Dash and Burst sooner | The same maze plays differently after a pick |
| 5 | **Score** | The 3-minute round ends → a banner names the leader → a new maze and the lobby follow | You see the result, then the map is gone |

| | |
|---|---|
| **One complete loop takes** | 3 minutes, on the UTC clock, after a short lobby. |
| **Decision, challenge, or expression** | Which color to join, where to paint, when to Dash or Burst, and which upgrade to take. `[agent-decided]` |
| **Shortest satisfying visit / typical session** | One round is a complete visit. A longer stay is another lobby and another maze. No measured session length is claimed here. |
| **Why repetition 10 differs from repetition 1** | The maze layout changes with the round. Who else is in the world, and which upgrades you picked, change the fight. The upgrades do not carry into the next round. |

**Pillars** `[agent-decided]`

1. **Coverage decides the round.** Knocks, Dash, Burst, and upgrades all feed paint.
2. **A new maze every round.** Routes do not carry over.
3. **A round is a whole game.** You can leave after the banner.
4. **Strength is for this round.** A fall clears your buffs. Nothing you picked becomes a permanent power.

---

## 4. Why Players Come Back

### 4.1 The next-day sentence

> A player who enjoyed a round comes back because the next maze is a new layout, and a sole win puts their name on a board the lobby can open. `[agent-decided]`

That is a design intent. It is not a measured retention result.

### 4.2 What persists

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | The round result, and a win on the top-wins board if your team was the only leader. Upgrades are gone. | You can join the next lobby immediately. | They saw your color, the banner, and your name on the board if you won. |
| **End of first week** | The same wins board. No gear, level, or clan. | People can recognize a name that keeps winning. | The board lists names, not a rank you spend. |
| **Later** | Same as the first week. | Still no unlock. | The floor is being fought even when bots are filling empty colors. |

### 4.3 The two return hooks

1. **A new maze.** Every round grows a new layout, so the next match is not a replay of the same routes.
2. **The wins board.** A sole team win credits each connected player on that team. Ties credit nobody. Bots are not listed. The lobby can open the top ten.

No XP, gear, clans, dailies, or in-scene event countdown.

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | You pick a color in the lobby. In the maze you paint over other colors and knock people off the floor. A toast names a new sole leader, and another names a KO. The banner ends the round, and the lobby opens again if you stay. |
| **The disappearance test** | With humans on the teams, bots fill the quieter colors up to the busiest human side, at most three bots on a color and nine in the match. Even teams spawn no bots. No humans spawn no bots. Bots paint and knock. They do not take upgrades or the star, and they are not on the wins board. |
| **From strangers to a group** | Team is a choice you make by standing on a color, and it sticks for the round start even if you step off. The signs show who is standing there now. |
| **Recognition & continuity** | During the match your nameplate is your team color, with a star for each upgrade you hold. The wins board keeps names from sole wins. There is no clan. |
| **Quiet hours & player counts** | One human is enough for a match: the other colors can fill with bots. An ideal crowd size was not set in this update. `[OPEN: postponed]` |
| **Drop-in / drop-out** | Between rounds, anyone in the lobby can pick a color. Leaving the world frees that place. |
| **Visible play (the bystander test)** | Four colors spread and shrink on the floor. Dashes, bursts, knocks, and the lead toast are visible without a menu. |
| **Shareable play (the memorable moment)** | A Burst repaints a circle and knocks people off it, or a toast says a color took the lead. |
| **Bring-a-friend** | A friend on your color paints with you, so your side covers ground faster. A friend on another color is someone you can knock off the floor. |

---

## 6. Mobile-First

**Every core-loop verb on touch:**

| Core-loop verb | How it works with touch controls |
|---|---|
| **Walk** | Left joystick. Painting while you move needs no button. |
| **Contest** | Same as walk. |
| **Knock** | On-screen Dash and Burst buttons. No aim. |
| **Upgrade** | Tap the gold pill, then tap a card. The star is picked up by touching it. |
| **Score** | Passive. The round ends on the clock. |

**UI plan.** The match row is the view, mute, timer, score, and the upgrade icons. The four-team bar sits under that row, and the lead and KO toasts sit under the bar. Lobby adds the wins board and How to Play. Dash and Burst sit above the jump button on a phone. Nameplates are in the world, and they hide in the lobby.

**Performance.** Phones stay in scope. This update does not claim a new frame-rate measurement.

**Desktop-only dependencies.** None. Dash is E and Burst is F on a keyboard. The same actions are buttons on touch.

---

## 7. World, Look & Story

**Story / world.** Pixelwars is a floating three-level maze over the sea, redrawn every three-minute round, and four teams claim its floor in paint. There is no lore.

**Visual direction.** The signature is paint spreading in real time. The teams are red `#FF7577`, blue `#6A99FC`, green `#4FD68C`, and yellow `#FFE04A`. Team color has to read on the floor and on a nameplate. Two anvils sit in the maze. Dash or Burst can launch one.

**Layout.** The play area is a 5×5 grid of maze tiles on three levels, over open water, and a new layout is grown each round. The lobby is a cross: red to the west, blue to the east, yellow to the north, green to the south. Falling off returns you to a safe spot and clears your upgrade buffs.

---

## 8. Audience & Comparables

**Primary player + arrival context.**

> For players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a short match they can drop in and out of.

**How the first group arrives.** Through Discover and through Events. One human can still play, because bots fill the other colors when the teams are uneven. The scene does not need a full lobby to start a round.

**Deliberately not for.** Players who want long persistent progression, lore-heavy solo campaigns, or high-precision shooting. Knockback here is a shove, not an aimed weapon.

### Comparables

| | Comparable A — outside DCL: **Splatoon (Nintendo)** | Comparable B — inside DCL: **Flagtag (`flagtag.dcl.eth`)** |
|---|---|---|
| What we observed works | Short rounds and coverage make every second feel like scoring. Matte paint reads at a glance. | Short rounds, team sides, and drop-in play can keep a DCL scene alive when few people are around. |
| What does not fit our audience or context | Aim-based shooting and a fixed map roster. | Holding one objective. Pixelwars wants the floor itself to be the score. |
| What we will do differently | The maze is new every round. Dash and Burst shove people and paint; they are not guns. | Coverage stays the win condition. Knocks change who can paint. They do not replace the paint score. |

---

## 9. Scope

This is the game on `main`, not a new four-week build plan. The October 2026 plan (two teams, a five-minute round, a Paint Bomb, teleport orbs, and a ghost on the other side) is archived. Those systems are not in this version.

**In this version**

- Four-team lobby and a three-minute coverage round on a new maze
- Walk paint, Dash (E), and Burst (F)
- Speed, Paint, and Haste, plus one falling star that opens an extra pick
- Bots that fill uneven teams
- Lead and KO toasts, a wins board, and How to Play
- The sea around the maze, and two anvils you can launch

**Not in this version**

- Balloon Battle, Base Charge, Paint Limit, Bot Invasion, Color Garden, and Pot Hunt
- Paint Bomb, teleport orbs, a paint tank, and depots
- A star that buffs your speed or your look. The star only opens an upgrade pick
- Faster movement on your own paint. The switch exists and is off
- XP, clans, dailies, and an in-scene event countdown

**Top risk** `[agent-decided]`

Knocks plus a paint lead can make a comeback feel impossible before the clock ends.

**Fallback.** Tune knock, charge, or the upgrade bonuses. Do not add another game mode to fix it.

**Next funding or feature round.** `[OPEN: postponed]`
