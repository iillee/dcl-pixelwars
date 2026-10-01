# Pixelwars — GDD Summary

**Studio:** ile · **Target:** World `pixelwars.dcl.eth` · **Status:** **V0 live** · **V1 planned** (Strategic Territory & Player Competition)

## The Pitch
Two teams spread paint across the floor of a shifting, multi-level maze. Whoever covers more ground when the 5-minute timer hits wins — then the maze regenerates from a new seed and the next round starts. Think **Splatoon Turf War** meets a **map that refuses to sit still**, tuned for Decentraland's walk-in, mobile-first, 5-minute-session reality.

## Core Loop (5 min per round, UTC-aligned)
1. **Walk** → your footsteps paint a 3×3 tile patch in your color.
2. **Contest** → walking over enemy paint flips it back to yours.
3. **Reposition** → teleport orbs (linked pairs) drop you into fresh territory.
4. **Score** → round ends, banner shows winner + final coverage % (V1: + personal contribution).
5. **Regenerate** → new maze seed, new layout, next round.

Every step is instant visible progress on the coverage pill. No aim, no combat in V1 — pure territorial pressure. Walk-to-paint core stays intact.

## Three Pillars
- **Coverage is king** — painting is the whole game.
- **Fresh maze every round** — no memorization possible.
- **Any minute is a whole game** — drop-in/out never breaks the loop.

**V1 design test:** every feature strengthens *where, when, and how* players paint territory.

## Why Players Come Back
Progression is **social/reputational, not mechanical** — no XP unlocks that grant power. V1 leans on denser competition, clearer teams, and personal contribution feedback. Scheduled peak-match UI and “recently seen” lists are **future ideas**, not V1 commitments.

## Social Design
- **Auto team assignment** on arrival; team color visible on every tile.
- **Ghost bot** fills the opposite team during quiet hours (V0). V1 prototypes corruption/wildfire solo and compares.
- **Social threshold:** 2 humans. **Ideal:** 4–6. **Tested max:** 10 (5v5).
- **V1:** SDK name tags for red/blue ID + better team balancing.

## Mobile-First
All core verbs work on touch (walk = paint; proximity = items/orbs). HUD stays thumb-safe. Perf target: 60fps desktop / 30fps on Pixel 9a at 5v5. Week 1 includes known mobile/sloped-tile paint visibility fixes.

## Look & World
Procedurally-generated multi-level labyrinth. Matte red (`#FF7577`) and blue (`#6A99FC`) paint. V1 experiments with remodeling/skinning the six modular blocks — ship a visual pass from successful experiments, not six guaranteed finished themes.

## Audience
Fans of short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or Events. **Not for:** long-progression, lore-heavy, or high-precision-shooter players.

## V1 Scope (4 Weeks)

**North star: Strategic Territory & Player Competition** (supersedes dual bases + light items).

| Week | Focus |
|---|---|
| **1** | Level density/scale · team balancing · SDK name tags · mobile/slope paint fixes · start block remodel/skin experiments |
| **2** | Friendly-paint movement speed · individual contribution + end-round breakdown · continue block skins vs paint readability |
| **3** | Paint Bomb + one paint-focused power-up · corruption/wildfire solo prototype vs ghost bot |
| **4** | MP + mobile playtests · balance · final visual pass · polish · deploy stable V1 (experiments only if validated) |

**Top risks:** density still feels sparse; friendly-paint speed snowballs. **Fallback:** loosen scale, tone speed, keep Paint Bomb as primary swing, keep ghost bot if PvE solo underperforms.

**Explicitly deferred:** combat/weapons, hide-in-paint, 1 m grid as a promise, dual-bases-as-pillar, recently-seen / weekly peak UI, clans, persistent mechanical progression, large item catalogues.

---

**Bottom line:** Shipped V0 foundation (generator, paint, authoritative server, ghost bot, leaderboard) plus a focused V1 that makes territory strategically meaningful, denser, and more readable — without replacing the simple walk-to-paint core.
