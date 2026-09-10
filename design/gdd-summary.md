# Pixelwars — GDD Summary

**Studio:** ile · **Target:** World `pixelwars.dcl.eth` · **Status:** V0 vertical slice live and tested

## The Pitch
Two teams spread paint across the floor of a shifting, multi-level maze. Whoever covers more ground when the 5-minute timer hits wins — then the maze regenerates from a new seed and the next round starts. Think **Splatoon Turf War** meets a **map that refuses to sit still**, tuned for Decentraland's walk-in, mobile-first, 5-minute-session reality.

## Core Loop (5 min per round, UTC-aligned)
1. **Walk** → your footsteps paint a 3×3 tile patch in your color.
2. **Contest** → walking over enemy paint flips it back to yours.
3. **Reposition** → teleport orbs (linked pairs) drop you into fresh territory.
4. **Score** → round ends, banner shows winner + final coverage %.
5. **Regenerate** → new maze seed, new layout, next round.

Every step is instant visible progress on the coverage pill. No aim, no combat in V1 — pure territorial pressure.

## Three Pillars
- **Coverage is king** — painting is the whole game.
- **Fresh maze every round** — no memorization possible.
- **Any minute is a whole game** — drop-in/out never breaks the loop.

## Why Players Come Back
Progression is **social, not mechanical** — no XP, no unlocks. You become a recognized name in the community. Two return hooks:
1. **Weekly peak-match slot** (e.g. Friday 20:00 UTC) announced via DCL Events + Discord, surfaced in-scene as a countdown pill.
2. **"Recently seen" HUD list** — on entry you see the last ~5 named players and when they were last around, so you learn roughly when to log in to catch specific opponents.

## Social Design
- **Auto team assignment** on arrival; team color is visible on every tile.
- **Ghost bot** fills the opposite team during quiet hours so solo play works.
- **Social threshold:** 2 humans (1v1). **Ideal:** 4–6 (2v3–3v3). **Tested max:** 10 (5v5).
- **Bystander test passes:** two colors visibly spreading and shrinking reads instantly.

## Mobile-First
All core verbs work on touch (walk = paint, walk = contest, walk into orb = reposition, scoring is passive). HUD is three thumb-safe pills (mute, coverage %, timer). Perf target: 60fps desktop / 30fps on Pixel 9a at 5v5.

## Look & World
Procedurally-generated multi-level labyrinth. Matte red (`#FF7577`) and blue (`#6A99FC`) paint on grey slabs, readable from anywhere thanks to open sightlines and stacked ramps. Zero lore by design.

## Audience
Fans of short competitive team games (Splatoon, Fall Guys, Rocket League), arriving alone or with a friend from Discover or Events. **Not for:** long-progression, lore-heavy, or high-precision-shooter players.

## V1 Scope (4 Weeks)
**Chosen pillar: dual bases + light items pass** (foundation for V2's alt-weapon unlocks).
- **W1:** Two seed tiles at opposite maze ends; team spawns at own base; visual base markers.
- **W2:** Bases as spawn + identity anchors. Mandatory 1v1 playtest — does directional play emerge?
- **W3:** Items ship — **speed boost** + **paint bomb**, server-timed, mobile proximity pickup.
- **W4:** 5v5 mobile playtest, balancing pass, capture 3–4 gameplay clips, public repo, live.

**Top risk:** dual bases might encourage base-camping and kill the "every step scores" pillar. **Fallback:** demote bases to pure spawn points and reposition teleport orbs to force movement (~4h revert).

**Explicitly deferred to V2:** paint weapons/combat (needs higher server tick), hide-in-paint (gated on weapons landing), 1m paint grid (WebGL perf).

## Post-Launch Freshness (Cheap)
- Rotate 6 tile-block skins seasonally.
- Shuffle item spawn locations daily.
- Procedural regen keeps variance high even if no updates ship.

---

**Bottom line:** A shipped V0 foundation (generator, paint pipeline, authoritative server, ghost bot, synced leaderboard) with a focused 4-week V1 that adds team identity via bases and two items — while deliberately deferring the risky weapons/combat pillar to V2.
