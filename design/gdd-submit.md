# Pixelwars

| | |
|---|---|
| Public experience title | Pixelwars — IP & Content Policy self-check: **clear** |
| Deployment target | World: `pixelwars.dcl.eth` |
| Studio / team name | **ile** |
| Date | 2026-10-01 (V1 scope revised) · original draft 2026-09-09 |
| Contact (Discord + email) | Discord: **ile9466** · email: **lukeeescobar@gmail.com** |

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes. |
| **Primary player** | Players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of. |
| **Current status (V0)** | **Vertical slice live and tested.** Walk-to-paint turf war, auto teams, ghost bot for solo, teleport orbs, synced leaderboard, 5-minute UTC rounds. Play now: [pixelwars.dcl.eth](https://decentraland.org/jump?realm=pixelwars.dcl.eth&position=5,5) · Gameplay video: [youtu.be/Mocy6Xly7D4](https://youtu.be/Mocy6Xly7D4) |
| **Requested round** | V1 (4-week scope) — with retroactive credit sought for the shipped V0 vertical slice |
| **V1 theme** | **Strategic Territory & Player Competition** — make owned territory matter during the round, raise player density/interaction, improve team/solo readability, and develop a stronger maze visual identity. Walk-to-paint core stays intact. |
| **Acceptance at end of V1** | Tighter, denser rounds; clear red/blue team ID (SDK name tags); friendly-paint movement benefit; individual contribution in end-of-round results; Paint Bomb + one paint-focused power-up; level-block visual pass from successful skin experiments; stable deploy. Solo corruption/wildfire ships only if playtests beat the existing ghost bot. |

---

## 1. Player Promise

**One-line promise**

> You are one of two teams in a shifting maze. You paint the floor to outclaim the enemy, while the maze resets every five minutes.

**One familiar comparison.** Think **Splatoon Turf War** meets a **map that refuses to sit still**. Closest in-platform cousin: **Flagtag** (`flagtag.dcl.eth`).

**Why this game**

V0 is already deployed, tested, and fun — and the shipped generator, paint pipeline, and authoritative-server stack give a rare foundation to build depth on rather than reinvent. Pixelwars answers the question every Splatoon fan asks — *what if the map itself refused to sit still?* — inside Decentraland, where a five-minute round is exactly the shape of a walk-in social game. V1 deepens territory strategy without replacing the simple walk-to-paint verb.

---

## 2. First Minutes & How to Play

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You spawn into the maze (V0: center rally). The tile under you flips to your color as you step off. V1 adds clearer red/blue team ID via SDK name tags and a denser layout so other players are nearby sooner. |
| **5–10 seconds** | Every step paints a 3×3 patch in your color. A pill shows live coverage % for red vs blue. The goal reads immediately: cover more floor than them. |
| **10–60 seconds** | You push into unpainted corridors, flipping enemy paint back to your color. A round timer counts down from five minutes. Nearby players leave color wakes behind them. V1: friendly paint begins to feel useful as traversal. |
| **1–3 minutes** | You find a teleport orb (linked pair, respawns each round) and drop across the maze into fresh territory. V1: Paint Bomb / power-up pickups create sudden territorial swings. |
| **3–10 minutes** | Round ends on the UTC boundary; a banner shows winner and final %. V1: banner also breaks down individual contribution. Maze regenerates from a new seed; next round begins. |
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
| 4 | **Score** | 5-minute UTC round ends → banner shows winner + final % (+ V1: personal contribution) → next round prep | You know exactly when the next round starts |
| 5 | **Regenerate** | Maze rebuilds from a new seed → new corridor layout, new ramps, new orb pair | The battleground itself is different next round |

| | |
|---|---|
| **One complete loop takes** | 5 minutes — one UTC-aligned round. Earlier payoff every ~1 second: every step you take flips tiles visible on the coverage pill. |
| **Decision, challenge, or expression** | You choose *where* to paint: chase the highest-yield unpainted corridor, defend a chokepoint, or push into enemy paint to flip contested ground. V1 adds: hold friendly paint as traversal infrastructure; time Paint Bomb / power-ups for territorial swings. |
| **Shortest satisfying visit / typical session** | ~5 min / ~15 min (one full round / three rounds). Drop-in works from the first frame so shorter visits still contribute paint; a satisfying visit is at least one full round to see winner + maze regenerate. |
| **Why repetition 10 differs from repetition 1** | The maze regenerating from a fresh seed every round is the intended source of freshness — no two rounds share terrain. Opponents on the current server dictate whether a round is a rout, a stalemate, or a comeback. |

**Pillars**

1. **Coverage is king.** Painting the floor is the whole game; every feature answers to it.
2. **Fresh maze every round.** No memorization; every 5 minutes the terrain is new.
3. **Any minute is a whole game.** A 5-minute round is a complete satisfying loop; drop-in / drop-out never breaks it.

**V1 design test:** every V1 feature should strengthen the importance of *where, when, and how* players paint territory — not replace the walk-to-paint core.

---

## 4. Why Players Come Back

### 4.1 The next-day (D1) sentence

> A player who enjoyed their first session returns the next day because the five-minute loop was satisfying, the maze feels different every round, and V1 makes each visit more competitively readable — clearer teams, personal contribution on the results screen, and territory that helps you move when you own it.

### 4.2 The progression chain

Pixelwars V1 progression stays **social and reputational, not mechanical**: no unlockable capabilities, no gear, no XP that grants combat power. Your "progress" is becoming a recognised name and seeing your personal contribution improve.

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | A feel for the loop; a personal contribution number on the end-of-round banner (V1); optional leaderboard rank if you scored high. | Play the next round with clearer goals. | Name on leaderboard / end-round breakdown. |
| **End of first week** | A recognisable play style; informal rivalries if the same people overlap. | Showing up for group play when the scene is busy. | Regulars recognise your name. |
| **Week 3+** | Established regular; friends and rivals you've made. | You're one of the people others look for when they log in. | Others say hi; you have people to play against without arranging it. |

**Currency / tradable rewards.** None in V1. Mechanical progression (alt weapons, persistent unlocks) is explicitly deferred.

### 4.3 Retention note (not V1 commitments)

V0 already ships a synced all-time leaderboard. Scheduled weekly peak-match UI and a “recently seen” HUD list remain promising retention ideas but are **not V1 deliverables**. V1 retention work is gameplay density, contribution feedback, and clearer team identity.

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | Player A joins a team on arrival (auto-assigned) → Player B on the opposite team paints over A's tiles → the coverage pill shifts live for both of them → the 5-minute round settles who won, and both stick around for the next. |
| **The disappearance test** | With no other humans in the scene, a **ghost bot** fills the opposite team — the game stays playable solo. V1 experiment: prototype environmental corruption/wildfire the player must contain, and compare vs ghost bot before choosing what to keep. |
| **From strangers to a group** | Auto team assignment on join; team color visible on every tile you paint. V1: stronger red/blue identification via SDK name tags + team balancing improvements. |
| **Recognition & continuity** | Player names are shown; the leaderboard and (V1) individual contribution breakdown are the recognition surfaces. |
| **Quiet hours & player counts** | Quiet hours: ghost bot (shipped V0). Social threshold: **2 humans (1v1)**. Ideal group: **4–6 humans**. V1 tested maximum: **10 humans (5v5)**. V1 also tunes level scale so fewer players still create encounters. |
| **Drop-in / drop-out** | Late arrival gets maze snapshot + paint state and joins mid-round. |
| **Visible play (the bystander test)** | Two teams' colors spreading and shrinking on the floor reads at a glance. |
| **Shareable play (the memorable moment)** | V1 target: a Paint Bomb detonates in a cross-junction — a screen-filling splash of your team's color. Until then, orb drops + contested paint churn are the clip. |
| **Bring-a-friend** | More teammates → more map turns your color per minute; additive coverage. |

---

## 6. Mobile-First

**Every core-loop verb on touch:**

| Core-loop verb | How it works with touch controls |
|---|---|
| **Walk** | Left joystick — standard DCL mobile locomotion. Painting is passive on step, no aim required. |
| **Contest** | Same as walk — no separate input needed. |
| **Reposition** | Walk into the teleport orb — proximity-triggered, no button press. |
| **Score** | Passive — the round ends on the UTC boundary. |
| **Items (V1)** | Proximity pickup — no aim required. |

**UI plan.** V0 HUD: three compact pills (mute, coverage %, round countdown) + end-of-round banner. V1 extends the banner with individual contribution; keeps thumb-safe.

**Performance.** Targets: 60fps desktop / 30fps on **Google Pixel 9a** at up to 10 humans (5v5). Formal fps measurement lands during Week 4 playtests. V1 Week 1 also fixes known V0/mobile issues including paint visibility on sloped tiles.

**Desktop-only dependencies.** None. V1 adds no aiming weapons — combat remains deferred.

---

## 7. World, Look & Story

**Story / world.** Pixelwars is set in a procedurally-generated multi-level labyrinth that redraws itself every five minutes; two teams claim its floor in paint.

**Visual direction.** Signature: *paint spreading across a maze in real time* — matte red and blue on modular floors, readable from open sightlines and stacked ramps. Team color reads at a glance; UI stays out of the world.

Visual reference: `assets/images/subdivisions.jpg` (grid layout), team palette `assets/images/pallet.jpeg` (red `#FF7577`, blue `#6A99FC`).

**V1 visual work.** Experiment with remodeling/skinning the six modular procedural blocks. Treat this as visual development and a readability test with the paint system — not a promise of six finished themes. Week 4 ships a pass based on the most successful experiments.

---

## 8. Audience & Comparables

**Primary player + arrival context.**

> For players who already enjoy short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or an Event, looking for a five-minute match they can drop in and out of.

**How the first group arrives.** The first group arrives through Decentraland's Discover feed and one-off Events promoted on Discord. Because the round loop is 5 minutes and drop-in works from the first frame, the funnel is tolerant of low overlap — 2 humans is a game.

**Deliberately not for.** Players who want long persistent progression, lore-heavy solo play, or high-precision competitive shooting.

### Comparables

| | Comparable A — outside DCL: **Splatoon (Nintendo)** | Comparable B — inside DCL: **Flagtag (`flagtag.dcl.eth`)** |
|---|---|---|
| What we observed works | Turf War's short rounds and *coverage %* scoreboard make every second feel like scoring; matte paint is instantly readable. | Short rounds + auto-teams + drop-in play sustain a live scene despite low concurrent counts. |
| What does not fit our audience or context | Aim-based shooting, twitch reflexes, and platform lock-in — off the table for DCL mobile-first walk-in play. | Flagtag's flag-capture rewards long defensive holds; that pacing conflicts with paint-every-second feedback. |
| What we will do differently | No persistent map meta — every round starts on a maze nobody has seen. V1: friendly paint as traversal (not squid-swim combat mobility). | Coverage is continuous and passive; V1 makes owned territory useful mid-round, not only at score time. |

---

## 9. 4 Week Plan (V1 scope)

**V1 north star: Strategic Territory & Player Competition.**

Playtest feedback (Sep. 29 session) suggests the main problem is not a lack of mechanics — it is making the existing territory contest denser, more legible, and more consequential. This plan supersedes the previous V1 pillar (“dual bases + light items pass”). Dual bases are no longer the headline feature.

| Week | What is playable / done |
|---|---|
| **1 — Level, Teams & Visual Development** | Adjust procedural level scale/layout to increase player density and interaction. Improve team balancing. Add clear red/blue team identification using SDK name tags. Fix known V0/mobile issues, including paint visibility on sloped tiles. Begin remodeling/skinning modular level blocks for stronger visual identity. |
| **2 — Strategic Territory** | Prototype/tune gameplay benefits for controlling territory, starting with increased movement speed on your team's paint. Add individual player contribution tracking and improve end-of-round results breakdown. Continue level-block modeling/skin experiments; test how they read with paint. |
| **3 — Items & Solo Play Experimentation** | Small item/power-up system: Paint Bomb + one additional paint-focused power-up. Prototype improved solo experience (e.g. corruption/wildfire the player must contain) and compare vs existing ghost bot. |
| **4 — Playtest, Balance & Release** | MP + mobile playtests across player counts. Balance level scale, territory movement, items, scoring, team behavior. Final visual/level-block pass from successful skin experiments. Bug fix, polish, deploy stable V1. Experimental systems only ship if playtesting supports them. |

**Committed vs experimental.** Level density, team balancing, name tags, mobile/slope fixes, contribution tracking, block-skin exploration, Paint Bomb + small item system, and stable deploy are expected. Exact speed values, second power-up choice, corruption/wildfire solo, and final skins ship only if validated.

**What keeps the experience changing after launch.**

- Rotate successful tile-block skins; procedural regen every 5 minutes continues.
- Shuffle item spawn locations once items are stable.
- Progression remains social/reputational — no power gap for newcomers.

**Not building in V1.**

1. **Paint weapons / combat** — projectile weapons, health, aiming, hit registration, combat bot AI. Deferred pending higher server tick / prediction work.
2. **Hide-in-paint / quick-move** — may revisit later; not a V1 commitment.
3. **1 m paint grid** — stay at 2 m unless density/performance work specifically warrants a limited test. Not a promised outcome.
4. Dual bases as V1 pillar; recently-seen HUD; weekly peak-match countdown; clans; daily challenges; persistent mechanical progression; large item catalogues.

**Top risk + fallback.** Denser levels + friendly-paint speed could still feel empty if players spread out, or speed-on-paint could snowball steamrolls. Fallback: loosen density toward prior scale; tone speed bonus toward mild assist; keep Paint Bomb as the primary swing tool; retain ghost bot if corruption/wildfire underperforms.
