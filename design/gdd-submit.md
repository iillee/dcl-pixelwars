# Pixelwars

| | |
|---|---|
| Public experience title | Pixelwars — IP & Content Policy self-check: **clear** |
| Deployment target | World: `pixelwars.dcl.eth` |
| Studio / team name | **ile** |
| Date | 2026-09-09 |
| Contact (Discord + email) | Discord: **ile9466** · email: **lukeeescobar@gmail.com** |

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes. |
| **Primary player** | Players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of. |
| **Current status** | **Vertical slice in a World — live and tested.** Play now: [pixelwars.dcl.eth](https://decentraland.org/jump?realm=pixelwars.dcl.eth&position=5,5) · Gameplay video: [youtu.be/Mocy6Xly7D4](https://youtu.be/Mocy6Xly7D4) |
| **Requested round** | v1 (4-week scope) — with retroactive credit sought for the shipped V0 vertical slice |
| **Live at end of the round** | Walk into `pixelwars.dcl.eth` alone or with a friend, get auto-assigned to a team, spawn at your team's base, and play a full 5-minute round of tile-coverage warfare against humans (or a ghost bot if you're solo) on a procedurally-generated maze that regenerates every round — with two power-up items in play and a recently-seen HUD list showing who else has been on today. |

---

## 1. Player Promise

**One-line promise**

> You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes.

**Why this game**

V0 is already deployed, tested, and fun — and the shipped generator, paint pipeline, and authoritative-server stack give a rare foundation to build depth on rather than reinvent. Pixelwars is my chance to answer the question every Splatoon fan asks — *what if the map itself refused to sit still?* — inside Decentraland, where a five-minute round is exactly the shape of a walk-in social game.

---

## 2. First Minutes & How to Play

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You spawn at your team's base. Half the floor around you is red, half blue; the tile under you flips to your color as you step off. |
| **5–10 seconds** | Every step paints a 3×3 patch in your color. A pill shows live coverage % for red vs blue. The goal reads immediately: cover more floor than them. |
| **10–60 seconds** | You push into unpainted corridors, flipping enemy paint back to your color. A round timer counts down from five minutes. Nearby players leave color wakes behind them. |
| **1–3 minutes** | You find a teleport orb (linked pair, respawns each round) and drop across the maze into fresh territory. |
| **3–10 minutes** | Round ends on the UTC boundary; a banner shows winner and final %. You respawn at base, the maze regenerates from a new seed, next round begins. |
| **Natural stopping point** | You leave knowing the next round starts on the next 5-minute UTC mark, on a maze nobody has seen yet. |

**Player-facing How to Play**

- Walk to paint the floor your color
- Highest coverage at five minutes wins
- Two teams; enemies flip your paint back

---

## 3. Core Loop

| # | Step (verb) | What the player does (input → see/hear → what changes) | Why do it again? |
|---|---|---|---|
| 1 | **Walk** | Move (WASD/joystick) → the 3×3 tile footprint under your feet flips to your color; a soft paint sound plays → coverage % ticks up for your team | Every step is instant visible progress |
| 2 | **Contest** | Cross into enemy paint → tiles you walk over flip back to your color → the enemy's % drops as yours rises | Territory is never permanent while the clock runs |
| 3 | **Reposition** | Enter a teleport orb → you're dropped at the linked orb across the maze → new unpainted ground | Cheap way to break out of a contested zone into fresh territory |
| 4 | **Score** | 5-minute UTC round ends → banner shows winner + final % → you respawn at your team's base | You know exactly when the next round starts |
| 5 | **Regenerate** | Maze rebuilds from a new seed → new corridor layout, new ramps, new orb pair | The battleground itself is different next round |

| | |
|---|---|
| **One complete loop takes** | 5 minutes — one UTC-aligned round. Earlier payoff every ~1 second: every step you take flips tiles visible on the coverage pill. |
| **Decision, challenge, or expression** | You choose *where* to paint: chase the highest-yield unpainted corridor, defend a chokepoint, or push into enemy paint to flip contested ground. In a bigger group you coordinate roles informally. |
| **Shortest satisfying visit / typical session** | ~5 min / ~15 min (one full round / three rounds). Drop-in works from the first frame so shorter visits still contribute paint; a satisfying visit is at least one full round to see winner + maze regenerate. |
| **Why repetition 10 differs from repetition 1** | The maze regenerating from a fresh seed every round is the intended source of freshness — no two rounds share terrain. On top of that, opponents on the current server dictate whether a round is a rout, a stalemate, or a comeback. |

**Pillars**

1. **Coverage is king.** Painting the floor is the whole game; every feature answers to it.
2. **Fresh maze every round.** No memorization; every 5 minutes the terrain is new.
3. **Any minute is a whole game.** A 5-minute round is a complete satisfying loop; drop-in / drop-out never breaks it.

---

## 4. Why Players Come Back

### 4.1 The next-day (D1) sentence

> A player who enjoyed their first session returns the next day (D1) because **Hook 2 (recently-seen presence)** shows them the named players they want to play against — and roughly when to be here to catch them.

### 4.2 The progression chain

Pixelwars V1's progression is **social and reputational, not mechanical**: no unlockable capabilities, no gear, no XP. Your "progress" is becoming a recognised name in this community.

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | Your name in the "recently seen" list; a leaderboard rank if you scored high. | Nothing new mechanically — you can play the next round. | Your name appears in their HUD list on join. |
| **End of first week** | A recognisable name — regulars start to notice you; leaderboard position if you've been consistent. | Informal rival relationships; showing up at the Friday peak slot is now a thing you do. | Regulars recognise your name; you're on the weekly leaderboard. |
| **Week 3+** | Established regular; known style of play; the friends and rivals you've made. | You're one of the people others check for when they log in. | Others say hi; you have people to play against without arranging it. |

**End-of-first-week scene.** You log in on Sunday, glance at the HUD's recently-seen list, and see two names you played against on Tuesday. The Friday peak-match slot is on the countdown pill — you already know you'll be there. Between now and then you'll drop into a round or two whenever the list shows someone worth catching.

**Currency / tradable rewards.** None in V1. The brief's V2 alt-weapon unlock (returning players unlock at their base) is the planned mechanical progression, deliberately deferred.

### 4.3 Two return hooks

| Selected hook | Exact trigger or timing | What the player anticipates | Reminder channel + no-reminder fallback |
|---|---|---|---|
| **1. Scheduled events** *(weekly / D7)* | Fixed weekly peak-match slot (e.g. Friday 20:00 UTC), plus one-off tournaments announced in Discord. The 5-min UTC round boundary makes this cheap — an "event" is just people co-arriving on the same round mark. | Knowing named others will be there at the same time — a shared appointment, not a solo grind. | **Reminder:** Decentraland Events listing + Discord announcements. **No-reminder fallback:** an in-scene countdown pill next to the round timer, visible the moment they walk in. |
| **2. "Who's around" presence** *(D1-capable)* | On scene entry, the HUD surfaces the last ~5 named players and when they were last seen. The intent is passive social presence, not a gamified rivalry prompt. | The specific person they want to play against — seeing that person was on 2 hours ago tells them roughly when to come back. | **Reminder:** none — the pull is memory, not notification. **No-reminder fallback:** the list surfaces automatically on scene entry. |

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | Player A joins a team on arrival (auto-assigned) → Player B on the opposite team paints over A's tiles → the coverage pill shifts live for both of them → the 5-minute round settles who won, and both stick around for the next. |
| **The disappearance test** | With no other humans in the scene, a **ghost bot** spawns to fill the opposite team — the game stays playable solo, with the bot as visible-social evidence. |
| **From strangers to a group** | Auto team assignment on join (roster order, alternating), team color visible on every tile you paint. A newcomer knows within one step which side they're on and which color to hunt. |
| **Recognition & continuity** | Player names are shown; the leaderboard and the **recently-seen HUD list** (§4 Hook 2) are the recognition surfaces. Between returning players: name recognition, informal rivalries, and knowing who plays at what hour — the social layer *is* the progression (§4.2). |
| **Quiet hours & player counts** | Quiet hours: a ghost bot fills the opposite team so solo play works (shipped V0). Social threshold: **2 humans (1v1)** — the moment a second human replaces the bot, coverage is person-vs-person. Ideal group: **4–6 humans (2v3 to 3v3)** — enough for informal role emergence without saturating the maze. V1 tested maximum: **10 humans (5v5)**, well inside the program's 20-player baseline. Solo-to-social bridge: a joining human replaces the bot on their team side. |
| **Drop-in / drop-out** | A late arrival gets the current maze snapshot + paint state and joins mid-round; leaves free up the roster and the next join alternates as normal. |
| **Visible play (the bystander test)** | A spectator sees two teams' colors spreading and shrinking on the floor of a maze in real time — the game reads at a glance. |
| **Shareable play (the memorable moment)** | A paint bomb detonates in a cross-junction — a screen-filling splash of your team's color, the coverage pill spikes, the map briefly reads as yours from every angle. The clip writes itself. |
| **Bring-a-friend** | The more teammates in the scene, the more of the map turns your color per minute — a friend on your team is straightforwardly additive to coverage. Two humans painting in parallel move the coverage pill visibly faster than one. |

---

## 6. Mobile-First

**Every core-loop verb on touch:**

| Core-loop verb | How it works with touch controls |
|---|---|
| **Walk** | Left joystick — standard DCL mobile locomotion. Painting is passive on step, no aim required. |
| **Contest** | Same as walk — no separate input needed. |
| **Reposition** | Walk into the teleport orb — proximity-triggered, no button press. |
| **Score** | Passive — the round ends on the UTC boundary. |

**UI plan.** V0's HUD is three compact pills in the top corners (mute, coverage %, round countdown) plus a full-screen end-of-round banner — designed thumb-safe and readable at phone width.

**Performance.** Targets: 60fps on recommended desktop / 30fps on **Google Pixel 9a** (Decentraland mobile client), both at the v1 tested maximum of 10 humans (5v5) from §5. V0 already runs smoothly on the desktop client, mobile client, and three.js client; the formal fps measurement on Pixel 9a lands in the Week 2 playtest.

**Desktop-only dependencies.** None known — V0 uses only walk-based input, and painting is proximity, not pointer. If V1 adds a weapon system (see §9), aim-on-touch design becomes the top mobile risk — see §9 top risk.

---

## 7. World, Look & Story

**Story / world.** Pixelwars is set in a procedurally-generated multi-level labyrinth that redraws itself every five minutes; two teams claim its floor in paint.

**Visual direction.** The signature is *paint spreading across a maze in real time*: matte red and blue on grey slab floors, seen from anywhere on the level thanks to open sightlines and stacked ramps. Team color reads at a glance from across the maze; UI stays out of the world.

Visual reference: `assets/images/subdivisions.jpg` (grid layout), team palette `assets/images/pallet.jpeg` (red `#FF7577`, blue `#6A99FC`).

---

## 8. Audience & Comparables

**Primary player + arrival context.**

> For players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of.

**How the first group arrives.** The first group arrives through Decentraland's Discover feed (a game genuinely designed for the platform ranks well) and one-off Events promoted on Discord. Because the round loop is 5 minutes and drop-in works from the first frame, the funnel is tolerant of low overlap — 2 humans is a game, so the social threshold is reachable any time a second person walks in.

**Deliberately not for.** Players who want long persistent progression, lore-heavy solo play, or high-precision competitive shooting.

### Comparables

| | Comparable A — outside DCL: **Splatoon (Nintendo)** | Comparable B — inside DCL: **Flagtag (`flagtag.dcl.eth`)** |
|---|---|---|
| What we observed works | Turf War's 3-minute rounds and *coverage %* scoreboard make every second feel like scoring; matte paint is instantly readable at a glance. | Short rounds + auto-teams + drop-in play sustain a live scene in DCL despite low concurrent counts; my own prior scene. |
| What does not fit our audience or context | Splatoon's aim-based shooting, twitch reflexes, and Nintendo Online are all off the table for DCL — mobile-first, latency-tolerant, walk-in play is the constraint. | Flagtag's flag-capture core loop rewards long defensive holds; that pacing conflicts with the paint-every-second feedback Pixelwars wants. |
| What we will do differently | No persistent map meta: Splatoon's audience memorizes a fixed map roster, but every Pixelwars round starts on a maze nobody has seen — the round reset and the maze reset are the same event, so learned routes never carry over. | Coverage is continuous and passive (every step counts) instead of discrete objective-holding; every second is scoring, not waiting. |

---

## 9. 4 Week Plan (v1 scope)

**V1 pillar: dual bases + light items pass.** Foundational for the brief's V2 alt-weapon-unlock system; no new networking risk; brief's own difficulty analysis rates this low-to-medium.

| Week | What is playable / done |
|---|---|
| **1 — Prototype definition** | Generator places two seed tiles at opposite ends of the maze (red base / blue base). Team spawn switches to own base on join. Base tiles visually distinct (color-tinted floor decal, base marker). |
| **2 — Core interaction + first-group test** | Bases fully functional as spawn + team identity anchor. **Mandatory Week 2 playtest** at 2 humans (1v1) — measure: does directional play (front line / home territory) emerge, or is it still free-for-all? |
| **3 — Core systems refinement** | Items pass — **speed boost** and **paint bomb** shipped. Server-side spawn timing, round-reset cleanup, mobile proximity pickup (no aim required). |
| **4 — Playable prototype, final design direction** | Mobile playtest on a named device at 5v5. Balancing pass on base spacing and item spawn rates. Capture 3–4 gameplay clips for Discover card / trailer / social. Public repo + live in World. |

**What keeps the experience changing after launch.**

- Without building a new level, we can **rotate the 6 tile-block skins** (seasonal / partner themes) and **shuffle item spawn locations** daily.
- If an update is skipped, **procedural maze regen every 5 minutes** still creates variation.
- Progression is social, not mechanical (§4.2) — a returning or new player can contribute meaningfully within ~0 minutes; no power gap.
- One player behaviour that would change what we build next: **whether item pickups create fights** — if yes, that validates combat as the v2 pillar; if no, v2 leans into hide-in-paint instead.

**Not building in v1.**

1. **Paint weapons / combat.** Pushed to v2. The brief flags the 5 Hz server-tick as too coarse for projectile-vs-player hit registration, which needs its own resolution (raise ticks or add client-side prediction) plus a full combat-tuning cycle. **First back in v2.**
2. **Hide-in-paint / quick-move.** Pushed to v2, gated on a timeboxed spike after weapons land — weapons make hiding *matter* by giving something to hide from.
3. **1 m paint grid.** Stay at 2 m. Brief notes the WebGL client couldn't sustain 1 m in stress-testing; the resolution bump is a v2+ effort once stom's material optimisation is ported.

**Top risk + fallback.** The pillar risk is that **dual bases break the "every step scores" pillar** (§3) by encouraging base-camping and defensive stalemates, turning the middle of the maze into a low-coverage dead zone. **Fallback:** if the Week 2 playtest shows base-camping stalling coverage, reduce bases to pure spawn points (no team-identity function, no defensive value) and reposition teleport orbs to force movement into contested territory. Base tiles remain for v2's alt-weapon-unlock system but carry no gameplay weight in V1. Cost: ~4 hours of scope revert.
