# Pixelwars

*Revised 2026-10-01 after the 2026-09-29 Creator Success playtest. Supersedes the 2026-09-09 “dual bases + light items” V1 plan (`archive/design/gdd-submit-2026-09-09.md`).*

| | |
|---|---|
| Public experience title | Pixelwars — IP & Content Policy self-check: **clear** |
| Deployment target | World: `pixelwars.dcl.eth` |
| Studio / team name | **ile** |
| Date | 2026-10-01 |
| Contact (Discord + email) | Discord: **ile9466** · email: **lukeeescobar@gmail.com** |

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes. |
| **Primary player** | Players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of. |
| **Current status** | **V0 vertical slice — live.** Play now: [pixelwars.dcl.eth](https://decentraland.org/jump?realm=pixelwars.dcl.eth&position=5,5) · Gameplay video: [youtu.be/Mocy6Xly7D4](https://youtu.be/Mocy6Xly7D4) |
| **Requested round** | V1 (4-week scope) — Strategic Territory & Player Competition, with credit for the shipped V0 slice |
| **Live at end of the round** | Walk into `pixelwars.dcl.eth`, get a balanced red or blue team with that color on your name tag, and play a tighter 5-minute coverage round. Painting is still how you score. Holding your own paint helps you move. A Paint Bomb (and one other paint-focused power-up, if the trial picks one) can swing territory. When the clock hits zero you see who won and what you personally painted. Solo play still works — the ghost bot remains unless a corruption/wildfire experiment proves better. The maze still regenerates, and the blocks wear the visual direction that read clearly with the paint. |

**V1 theme.** Make the walk-to-paint contest denser, more legible, and more consequential. Every V1 feature should change where, when, or how players paint.

The 29 Sep 2026 session produced this direction. It did not validate the new mechanics. Those are what the four weeks test.

---

## 1. Player Promise

**One-line promise**

> You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes.

**Why this game**

V0 is already deployed and playable: procedural maze, paint pipeline, authoritative server, teleport orbs, ghost bot, and a synced leaderboard. Pixelwars asks the Splatoon question Decentraland can actually host — *what if the map itself refused to sit still?* — inside a five-minute walk-in round. V1 does not replace that loop with combat. It makes territory worth holding while the clock is still running.

---

## 2. First Minutes & How to Play

V1 intended experience. V0 today still drops everyone on the shared center cross, with no name tags and no movement benefit on owned paint.

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You are on a team. Your name tag is red or blue, and so are the other players you can see. The floor under you starts taking your color as you step. |
| **5–10 seconds** | Every step paints a patch in your color. A pill shows live coverage % for red vs blue. The goal reads immediately: cover more floor than them. |
| **10–60 seconds** | The maze is tight enough that other players are close. Crossing their paint flips it. Crossing your own paint moves you faster — holding ground is how you get around, not only how you score. |
| **1–3 minutes** | You push a corridor, drop a Paint Bomb into a junction, or take a teleport orb into fresh ground. You can tell allies from enemies by name-tag color without opening a menu. |
| **3–10 minutes** | The round ends on the UTC boundary. A banner shows the winner, the final %, and what you personally painted. The maze regenerates. The next round starts. |
| **Natural stopping point** | You leave knowing the next round starts on the next 5-minute UTC mark, on a maze nobody has seen yet, and you know whether you carried your team. |

**Player-facing How to Play**

- Walk to paint the floor your color
- Highest coverage at five minutes wins
- Two teams; enemies flip your paint back

The speed-on-own-paint rule and the Paint Bomb are learned by doing them, not by a rules panel. Intro copy stays these three lines.

---

## 3. Core Loop

| # | Step (verb) | What the player does (input → see/hear → what changes) | Why do it again? |
|---|---|---|---|
| 1 | **Walk** | Move (joystick / WASD) → the patch under your feet flips to your color; a soft paint sound plays → coverage % ticks up | Every step is visible progress |
| 2 | **Contest** | Cross enemy paint → those tiles flip back → their % drops as yours rises | Territory is never safe while the clock runs |
| 3 | **Hold** | Stay on your own paint → you move faster there → a painted route is a path, not just a score | Owning ground changes how you play this round, not only the final % |
| 4 | **Swing** | Pick up a Paint Bomb (or the second paint power-up) and trigger it with no aim → a chunk of floor flips → the coverage pill jumps | One decision can reopen a stalled map |
| 5 | **Reposition** | Walk into a teleport orb → you land at the linked orb → new ground to paint | A way out of a dead corridor on a tight map |
| 6 | **Score** | The 5-minute UTC round ends → banner shows winner, team %, and your contribution → maze regenerates | You see the team result and your part in it |

| | |
|---|---|
| **One complete loop takes** | 5 minutes — one UTC-aligned round. Earlier payoff is every step: tiles flip, and from V1 the ground you hold also changes your movement. |
| **Decision, challenge, or expression** | Where to paint, whether to defend a route you can sprint, and when to spend a paint item. In a group, roles can fall out of that (push, hold a lane, bomb a junction) without a class system. |
| **Shortest satisfying visit / typical session** | ~5 min / ~15 min (one round / three rounds). Drop-in still counts. A satisfying visit includes the end banner so you see the result and your contribution. |
| **Why repetition 10 differs from repetition 1** | The maze regenerates every round, so routes do not carry over. Who else is in the world decides if the round is a rout, a stalemate, or a comeback. V1 adds a second kind of difference: how hard you personally pushed, visible at the banner. |

**Pillars**

1. **Coverage is king.** Painting the floor is the whole game. Speed, items, and solo threats all answer to paint.
2. **Fresh maze every round.** No memorized map. Every 5 minutes the terrain is new.
3. **Any minute is a whole game.** A round is a complete loop. Drop-in and drop-out never break it.
4. **Territory is a tool, not only a score.** From V1, ground you hold changes movement during the round.

---

## 4. Why Players Come Back

### 4.1 The next-day sentence

> A player who enjoyed a round comes back because the next maze is new, the matches are five minutes, and the banner told them how much of the result was theirs — so another round is a short, personal rematch, not a grind.

That is a design intent, not a measured retention result. The 29 Sep session did not validate a return hook.

### 4.2 What V1 does and does not add

V1 does not add XP, gear, unlocks, daily challenges, clans, a recently-seen list, or a weekly-event countdown. Those were discussed on 29 Sep and in the older GDD. They are not this round.

What persists in V1:

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | A round result that includes your own paint, plus the existing all-time painter leaderboard from V0. | You can play the next round immediately. No new power. | They saw your name tag color and, if they stayed for the banner, your contribution. |
| **End of first week** | Repeated name recognition in a small scene, if the same people overlap. No mechanical advantage. | Informal rivals. Still no unlock. | They recognize the name and the color they fought. |
| **Week 3+** | Same as week 1, plus whatever solo mode survived the Week 3 comparison. | You can play a full round alone if the scene is quiet. | The floor is being fought over even when the lobby is thin. |

The V0 leaderboard (cells captured, persisted on the server) stays. V1 does not turn it into a daily, weekly, or farming system. Per-round contribution is a round result, not a new meta-progression track.

### 4.3 Return hooks that are not V1

The September draft promised two hooks: a Friday peak-match countdown in the HUD, and a “recently seen” list of the last ~5 names. Neither is in the revised scope. Scheduled play can still happen as a Discord or Decentraland Event organized outside the scene. The scene will not grow an appointment pill or a presence list in V1.

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | You join and get a team. Someone on the other color paints over you. The coverage pill moves for everyone. The round ends, the banner shows the team and your share, and the next maze starts if you stay. |
| **The disappearance test** | With one human, V0 spawns a ghost bot on the other team. V1 keeps that path and, in Week 3, prototypes an environmental threat (corruption / wildfire spreading across paint) to compare against the bot. The experiment ships only if it is the better solo round. |
| **From strangers to a group** | Auto team assignment on join. V1 adds red/blue SDK name tags so team is visible on the avatar, and a balance pass so leaves do not quietly stack one color. A newcomer can see which color to hunt without a menu. |
| **Recognition & continuity** | Names on name tags, the end-of-round contribution line, and the existing leaderboard. No clan identity and no recently-seen list in V1. |
| **Quiet hours & player counts** | Quiet hours: ghost bot, unless the solo experiment replaces it. Social threshold: **2 humans**. Ideal: **4–6**. V1 playtest target: up to **10 (5v5)**. A second human still replaces the need for a bot. |
| **Drop-in / drop-out** | Late arrivals get the current maze and paint and join mid-round. Leaving frees the roster. V1 balance work must not flip someone who is already playing onto the other team mid-round. |
| **Visible play (the bystander test)** | Two colors spreading and shrinking on the floor, plus matching name tags. A spectator can see the fight without joining it. |
| **Shareable play (the memorable moment)** | A Paint Bomb flips a junction. The coverage pill spikes. That is the clip, if the item survives playtest. |
| **Bring-a-friend** | A teammate paints in parallel, so the pill moves faster. The contribution line also makes it obvious who pushed and who did not. |

**Team balance, as it works in V0.** Teams alternate by join order and stay put on rejoin, including a one-time coin flip for which color is first. That alternation drifts when people leave: the next joiner fills the next slot, not the smaller team. Players in the 29 Sep session could not tell who was on which side. V1 fixes identity with name tags and fixes the drift with a balance pass. It does not add a separate “players per team” panel unless that falls out of the name-tag work for free.

---

## 6. Mobile-First

**Every core-loop verb on touch:**

| Core-loop verb | How it works with touch controls |
|---|---|
| **Walk** | Left joystick. Painting is passive. No aim. |
| **Contest** | Same as walk. |
| **Hold** | Same as walk. Speed on your own paint is automatic. No button. |
| **Swing** | Paint Bomb and the second power-up are proximity or place-and-trigger. No projectile aim. |
| **Reposition** | Walk into a teleport orb. |
| **Score** | Passive. The round ends on the UTC boundary. |

**UI plan.** Keep the V0 thumb-safe pills (mute, coverage %, countdown) and the end-of-round banner. V1 adds contribution to that banner. Name tags are world-space, not another HUD panel. Do not pin new UI to the top-left (minimap and chat live there) or over the mobile action buttons.

**Known V0 mobile bug.** On 29 Sep, play on a phone was described as smooth except that paint on sloped tiles did not appear. Fixing slope paint is Week 1 work, not a new feature.

**Performance.** V0 target remains a playable phone and desktop client at the densities we already ship (2 m paint cells). Formal FPS checks at the V1 player cap happen in Week 4, on a phone, after the density pass. Shrinking the maze is allowed. Moving the paint grid to 1 m is not a V1 promise: an earlier 1 m stress test (~15k cell entities) lagged the WebGL client by several seconds.

**Desktop-only dependencies.** None. V1 does not add aim.

---

## 7. World, Look & Story

**Story / world.** Pixelwars is a procedurally generated multi-level labyrinth that redraws itself every five minutes. Two teams claim its floor in paint. There is no lore.

**Visual direction.** The signature is paint spreading in real time: matte red (`#FF7577`) and blue (`#6A99FC`) on grey slab floors. Team color has to read across a corridor and on a name tag. UI stays out of the world.

**V1 visual work.** The six modular blocks (end, straight, turn, fork, cross, ramp) get a remodeling and skin experiment. The goal is one stronger identity that still lets paint read, not a catalogue of six finished themes. Week 4 ships the variants that survived that test. Seasonal skin rotation is a later content idea, not a V1 deliverable.

**Layout today.** 11×11 parcels (176 m × 176 m). The generator builds a 5×5 maze of 32 m tiles inside that, with an 8 m border. Paint cells are 2 m. Everyone respawns on the center cross. V1’s density pass may shrink this. It does not add team bases as the point of the round.

---

## 8. Audience & Comparables

**Primary player + arrival context.**

> For players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of.

**How the first group arrives.** Through Discover and through Events promoted on Discord. Two humans is already a game, so the scene does not need a full lobby to function. Quiet hours fall back to the ghost bot or, if it wins the comparison, the solo corruption mode.

**Deliberately not for.** Players who want long persistent progression, lore-heavy solo campaigns, or high-precision shooting.

### Comparables

| | Comparable A — outside DCL: **Splatoon (Nintendo)** | Comparable B — inside DCL: **Flagtag (`flagtag.dcl.eth`)** |
|---|---|---|
| What we observed works | Turf War’s short rounds and coverage % make every second feel like scoring. Matte paint reads at a glance. | Short rounds, auto teams, and drop-in play can keep a DCL scene alive at low concurrency. |
| What does not fit our audience or context | Aim-based shooting, twitch reflexes, and a fixed map roster. DCL rounds have to tolerate latency, phones, and walk-in play. | Flag-capture rewards sitting on an objective. Pixelwars wants every step to score. |
| What we will do differently | The maze resets with the round, so learned routes do not carry over. V1 borrows Splatoon’s “your ink is also your road” idea as a movement bonus, not as weapons. | Coverage stays continuous. Items swing paint; they do not become a combat kit. |

---

## 9. 4 Week Plan (V1 scope)

**V1 theme: Strategic Territory & Player Competition.**

The old pillar — dual bases plus a speed-boost pickup and a Paint Bomb — is retired. Bases may still appear as plain orientation if the density pass needs spawn landmarks. They are not the feature. The movement idea is “faster on your own paint,” not a generic speed pickup.

| Week | What is playable / done |
|---|---|
| **1 — Level, teams & visual development** | Tighter procedural layout aimed at more encounters. Team balance improved without mid-round color swaps. Red/blue SDK name tags. Slope paint visible on mobile, plus the other known V0 mobile fixes that show up. First block remodel / skin experiments. |
| **2 — Strategic territory** | Movement bonus on friendly paint, prototyped and tuned. Per-player contribution tracked and shown in the end-of-round breakdown. Skin experiments checked against the paint: if a skin hides team color, it loses. |
| **3 — Items & solo experiment** | Small item set. Paint Bomb first. One more paint-focused power-up chosen in the build, not from a catalogue. Solo prototype: corruption or wildfire that spreads and must be contained, played against the existing ghost bot. |
| **4 — Playtest, balance & release** | Multiplayer and mobile sessions at more than one player count. Balance pass on maze scale, paint-speed, items, scoring, and teams. Final block art from the experiments that worked. Bugfix, polish, deploy. Experimental systems ship only if the tests support them. |

### Committed vs experimental

| Committed | Experimental — ship only if it holds up |
|---|---|
| Level scale / density tuning | Exact friendly-paint speed and whether it stays |
| Team balancing that does not flip a live player’s color | Which second paint power-up, if any |
| Red/blue SDK name tags | Corruption / wildfire, and whether it replaces the ghost bot |
| Slope paint and the other known V0 mobile fixes | Which block skins and geometry actually ship |
| Personal contribution on the end-of-round breakdown | Extra mechanics that show up in playtests |
| Block remodel / skin exploration | |
| A small item system starting with Paint Bomb | |
| Playtest, balance, polish, deploy of whatever survived | |

### What keeps the experience changing after launch

- The maze still regenerates every 5 minutes even if no update ships.
- A new or returning player can score on the first step. V1 adds no veteran power gap.
- After the visual pass, further skins are content, not a second gameplay track.
- The Week 3 solo comparison decides the next solo investment: environment, ghost bot, or neither upgraded further.

### Not building in V1

1. **Paint weapons / combat.** Projectiles, damage, aim, hit registration, and combat respawns stay future work. Paint Bomb is an area of paint, not a gun. The flagtag projectile fights are why this stays out.
2. **Hide-in-paint / squid-swim.** Future, and only interesting if something exists to hide from.
3. **1 m paint grid** as a promised result. Smaller cells may be tried while tuning density. They ship only if the phone client holds up.
4. **Persistent power, clans, dailies, recently-seen, weekly in-scene countdown.** Discussed in the playtest and the old GDD. Not this round.
5. **A large item, trap, or bot-AI catalogue.** One Paint Bomb, at most one more paint power-up, and a single solo experiment beside the bot that already exists.

### Top risk + fallback

The density pass can make the maze feel cramped, or the friendly-paint speed can snowball so the leading team becomes unreachable. Either one fights the “every step still matters” pillar.

**Fallback:** if Week 2 play shows a dead stomp or a map with nowhere to go, relax the layout back toward the current 5×5 / 2 m maze and turn the speed bonus down or off. Items and name tags can stay. The solo experiment is allowed to lose to the ghost bot and be cut. Cost of the revert is a tuning pass, not a new architecture.

### Playtest notes that set this scope (29 Sep 2026)

Pixelwars only. Golf feedback from the same call is ignored.

- Team identity was missing. Name tags with team color were the agreed direction (Vitaly), over shoes or floating markers.
- Join-order teams drift when people leave (Luke). Balance is in scope. A live headcount was asked (Ludmila) and is not a separate deliverable.
- Solo play with one ghost is thin (Matt / Big Yellow Fishes, Ludmila). Luke’s counter-proposal — spreading ooze or wildfire, in the vein of Snowdrift — is the Week 3 experiment, not a commitment to replace the bot.
- Holding paint should matter during the round. Luke’s proposal, backed in the notes: move faster on your own color.
- The level felt large. Tom asked for a smaller maze and faster territorial turnover. That is the Week 1 density work.
- Slope paint invisible on mobile (Tom). Week 1 bugfix. The rest of mobile play in that session was described as smooth.
- End-of-round personal contribution (Tom, repeated in chat). Week 2.
- Paint Bomb and a larger paint radius were offered as item ideas. Paint Bomb is the starting item. A second paint-focused item is chosen while building. Radius, jump-landing splashes, traps, and repulsors are not in the committed list.
- Clans, daily challenges, async farming, and persistent progression were suggested (Bay, Vitaly, Pravus) and are explicitly not V1.

---

## 10. Future exploration (not V1)

Kept so the old roadmap is not mistaken for the current plan.

- Projectile paint weapons, damage-in-enemy-paint, and respawn-at-base combat.
- Hide-in-paint and fast travel on your own color beyond the simple speed bonus.
- A 1 m paint grid, if a later client can afford the entities.
- Team bases as identity landmarks, including any later unlock that lives at a base. Not a V1 foundation and not a weapon-unlock track we are building now.
- Clans / community colors, in-scene event countdown, recently-seen presence, daily challenges.
- Personal pixel stamps, pattern bonuses, and jump-landing splashes from the 29 Sep brainstorm.

---

## 11. V0 facts this plan does not reopen

- Red vs blue. Walk to paint. Enemy paint can be repainted. Highest coverage when the 5-minute UTC round ends wins.
- The maze is procedural and changes with the round. Seed is shared so everyone sees the same layout.
- Authoritative server owns paint, teams, and the round clock. Clients render.
- Linked teleport orbs and a ghost bot already exist.
- There is already an all-time painter leaderboard. V1 does not rebuild it into a meta-game.
- The core verb stays walk-to-paint. Phones stay in scope.
