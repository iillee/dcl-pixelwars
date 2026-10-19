# Decentraland platform facts — the check-against sheet (August 2026)

**Date:** snapshot 2026-08 (mobile launch fact dated 2026-03-31). The platform moves: every status
below is "as of the date above" — when a line is load-bearing for a design, verify it against the
source index at the bottom before quoting it as current. SDK and scene-capability claims are a
different sheet: [dcl-capability-links-2026-08.md](dcl-capability-links-2026-08.md). Full research
with rationale and examples lives in the source repo under `research/`, not bundled with the skill.

## What the platform gives a scene

- **Identity.** Players arrive as themselves: a scene reads (`getPlayer()`) name, userId, `isGuest`,
  worn wearables, emotes, body shape and colours, face/body snapshots; `AvatarEquippedData` fires on
  outfit change, other players' too. A scene can never *change* what a player wears; it can hide
  avatars and nametags, swap in an NPC double, and restrict locomotion.
- **Rewards.** The Foundation Rewards service grants wearables/emotes straight from a scene over
  HTTP — it batches transactions, pays gas, and carries anti-abuse (captcha, per-address limits,
  Catalyst presence check); recommended only for items EPIC or rarer (≤100 copies). An earned
  wearable is visible in every other scene and sellable — the platform's only cross-scene progress.
  Reference case: WonderMine (crafting wearable NFTs since 2020, alive in SDK7).
- **Events.** Anyone can list on events.decentraland.org, no LAND needed (Foundation moderation,
  hours of delay); RSVP → in-world alert at start; Events tab and live markers on the Explorer map;
  recurring events supported. The calendar is the creator's only push channel, and players earn
  Marketplace Credits partly by attending events.
- **Publishing fork.** Genesis City LAND: foot traffic, neighbours, full Places listing, POI via
  DAO vote. World (tied to a NAME, 100 MANA): own island entered by link or `/world name.dcl.eth`,
  ≤**100 concurrent players**, storage 100 MB per NAME (+100 MB per LAND, +100 MB per 2000 MANA);
  in Places a Foundation-hosted World is listed **only if the NAME owner holds or rents LAND** —
  otherwise all traffic must be brought (events, Communities, streamers, links).
- **Places.** Likes count only from users with ≥100 voting power; title/description/thumbnail come
  from scene metadata; the place UUID survives redeploys only while the base parcel is unchanged —
  "significant changes" mint a new ID and reset likes and favourites.
- **Social graph.** Friends with online status, one-click jump-in to a friend mid-session, DMs.
  Communities (since 2025-09): group chat, community-bound events, community voice chat with
  owner/moderator/member roles and request-to-speak — a game can run its community on-platform.
- **Voice and text.** Proximity voice is always on (players clustered into comms "islands");
  private calls; community voice. Nearby text chat, DMs, chat bubbles. A scene can also accept a
  live RTMP video stream.
- **NAMEs and economy.** A NAME (100 MANA) gives a verified player name, a World, and a
  `name.dcl.eth` wallet. Marketplace Credits (seasonal, up to 8/week for weekly goals including
  event attendance) are spendable on Polygon primary sales only — a creator's events can be
  someone's weekly goal, and players' credits are demand for the creator's collection.
- **Progression infrastructure.** Profile Badges; Foundation quest campaigns (getting featured is
  the main one-off traffic source for a new scene); Exploration Games API (leaderboards, missions,
  player progress). API existence does not establish access or suitability for a studio's game:
  verify registration/admin permissions, score validation and integration before promising reuse
  or no backend work. The old quests-client is archived (2025-08-01) — no stock quest framework;
  choose progression storage after checking those needs.

## Hard noes and defaults a design must live with

- **Smart wearables / portable experiences are not supported** — a core loop resting on them
  cannot ship (the preflight hard stop, P9 in review-lens.md).
- **No push notifications.** Reaching a lapsed player: event RSVP alerts, opt-in platform emails,
  Community chat, external channels — nothing else.
- **Explorer UI and locomotion are global**: map, chat, backpack, jump, run, double jump and glide
  are the same in every scene. A platformer that ignores glide is broken by default; overriding
  standard controls is expensive.
- **Concurrency is unpredictable.** Worlds cap at 100; Genesis City splits players into proximity
  islands, so "500 at the festival" never means "everyone sees everyone". The base state of most
  scenes is 0–3 players: the loop must work solo, with multiplayer as an event-time amplifier.
- **Mobile Explorer**: Android launch recorded as 2026-03-31; iOS availability needs a current
  check. Plan for touch and device limits; choose visit length from the intended play, not a
  promotional phrase or another platform's timing target.
- **Guests** (`isGuest`) cannot receive NFT rewards or keep purchases — the guest path needs its
  own motivation, not a "connect wallet" wall.
- **Moderation.** Scene ratings T/A/R in scene.json; adult content only gated and flagged; event
  listings pass manual review (hours — plan ahead).
- **Neighbours aren't chosen** (LAND): sound and visual bleed, their rating and traffic are outside
  your control; rented LAND adds the lease term as a scene lifetime limit.

## Source index (fetched 2026-08; docs move — a rotted link is not evidence of absence)

- Player data / avatar modifiers: <https://docs.decentraland.org/creator/development-guide/sdk7/user-data/> ·
  <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-avatar.md>
- Rewards: <https://docs.decentraland.org/creator/rewards/overview.md>
- Events: <https://docs.decentraland.org/faqs/posting-events.md> ·
  <https://docs.decentraland.org/in-world/finding-events.md>
- Worlds and Places: <https://docs.decentraland.org/apis/apis/worlds/overview.md> ·
  <https://docs.decentraland.org/faqs/places.md>
- Friends, Communities, voice: <https://docs.decentraland.org/in-world/friends-and-chatting.md> ·
  <https://decentraland.org/blog/announcements/introducing-communities-in-decentraland> ·
  <https://docs.decentraland.org/player/general/in-world-features/voice-chat/>
- Credits, badges, campaigns: <https://docs.decentraland.org/in-world/earning-rewards.md> ·
  <https://decentraland.org/blog/announcements/marketplace-credits-earn-weekly-rewards-to-power-up-your-look> ·
  <https://docs.decentraland.org/apis/apis/exploration-games/overview> ·
  <https://docs.decentraland.org/apis/apis/exploration-games/progress>
- Dead features: <https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/portable-experiences.md> ·
  <https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/smart-wearables.md>
- Mobile launch (2026-03-31): Epic Games Store + Android press release; same avatar and social
  activity cross-device.

Reliability notes: Worlds limits (100 users, the 100 MB formula) are confirmed by secondary
sources and may shift; Credits numbers (8/week) are from the season-1 announcement — recheck the
current season before quoting.
