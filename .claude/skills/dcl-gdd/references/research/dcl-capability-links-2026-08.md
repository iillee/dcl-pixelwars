# Decentraland platform capabilities — verified link reference (August 2026)

**Date:** 2026-08-27. Every link below was fetched and returned 200 on that date; none are invented.
**Job:** the lookup table behind playbook.md's standing rule on SDK and capability claims. Check
here before claiming a capability does or doesn't exist — and remember the rule: a link that has
rotted or a feature missing from this list is **not** evidence of absence; the docs move faster
than any model's knowledge.

## SDK7 scene capabilities

Entry points:

- <https://docs.decentraland.org/creator/scenes-sdk7/getting-started/sdk-101> — what building a scene involves at all.
- <https://docs.decentraland.org/creator/scenes-sdk7/designing-the-experience/design-games> — designing games specifically for Decentraland's constraints.

Player movement, input & camera:

- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-avatar> — controlling/restricting the player: InputModifier (freeze movement/jump/run), AvatarModifierArea, hiding avatars and nametags.
- <https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/camera> — VirtualCamera (custom cinematic cameras), CameraModeArea (force 1st/3rd person).
- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/button-events> — available input actions (pointer, primary/secondary, action keys) and click/hold events.
- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-physics> — applying forces/impulses to the player (launch pads, knockback).
- <https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/entity-positioning> — attaching entities to the player or other players (AvatarAttach).
- <https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/trigger-areas> — detecting players/entities entering zones.
- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/touch-screen-controls> — configuring native on-screen touch controls for a scene.

Audio & video:

- <https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/sounds> — AudioSource: spatial vs global sound, looping, pitch.
- <https://docs.decentraland.org/creator/scenes-sdk7/media/audio-streaming> — live audio streams (radio/DJ) in a scene.
- <https://docs.decentraland.org/creator/scenes-sdk7/media/audio-analysis> — AudioAnalysis: real-time amplitude + 8 frequency bands per frame; **desktop client only**; **no built-in beat detection**.
- <https://docs.decentraland.org/creator/scenes-sdk7/media/video-playing> — streaming video onto surfaces in a scene.

Multiplayer & networking:

- <https://docs.decentraland.org/creator/scenes-sdk7/networking/serverless-multiplayer> — syncing state between players for free: MessageBus, syncEntity, isServer/player-authority patterns.
- <https://docs.decentraland.org/creator/scenes-sdk7/networking/authoritative-servers> — a headless authoritative multiplayer server for cheat-sensitive games.

Avatars, NPCs & player data:

- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/npc-avatars> — spawning avatar-shaped NPCs the scene controls.
- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/event-listeners> — reacting to player actions: onEnterScene/leave, emote played (EmoteCommand).
- <https://docs.decentraland.org/creator/scenes-sdk7/interactivity/user-data> — reading the player's name, wallet, and equipped wearables.

Scene UI:

- <https://docs.decentraland.org/creator/scenes-sdk7/2d-ui/onscreen-ui> — HUDs, counters, and on-screen game UI inside a scene.

Project types & limits:

- <https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/smart-wearables> — wearables that carry interactive code.
- <https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/portable-experiences> — experiences that follow the player across scenes (see the affordances research: not currently supported).
- <https://docs.decentraland.org/creator/scenes-sdk7/optimizing/scene-limitations> — hard per-parcel budgets (triangles, entities, materials, file size).

Building for mobile:

- <https://docs.decentraland.org/creator/build-for-mobile/mobile-client/missing-features> — **the single most useful page for capability questions**: an authoritative inventory of desktop features absent on mobile.
- <https://docs.decentraland.org/creator/build-for-mobile/develop/detect-platform> — detecting mobile vs desktop vs web at runtime to degrade gracefully.
- <https://docs.decentraland.org/creator/build-for-mobile/develop/input-on-mobile> — how SDK input actions map to touch.

## Platform features players get for free (Desktop client)

The unity-explorer `docs/` folder (<https://github.com/decentraland/unity-explorer/tree/dev/docs>)
is mostly engine internals (build/CI, rendering, ECS); only the docs below settle player-facing facts.

- **Text chat**: nearby channel, private DMs (online players only), friends list — <https://docs.decentraland.org/in-world/friends-and-chatting> — limitation: DMs not on mobile yet.
- **Chat auto-translation**: incoming messages auto-translated per conversation, plus manual on-demand translation — <https://github.com/decentraland/unity-explorer/blob/dev/docs/chat.md> (section "Chat Auto Translation") — limitation: missing on mobile.
- **Voice chat**: spatial/proximity voice via on-demand LiveKit room, plus private (1:1) and community voice chats — <https://github.com/decentraland/unity-explorer/blob/dev/docs/livekit-networking.md> (section "Voice Chat") and <https://docs.decentraland.org/apis/apis/comms-gatekeeper/private-voice-chat> — limitation: proximity voice chat missing on mobile.
- **Point-At In World**: a player points and a marker is shown to nearby players, synced over the network — no docs page; verified in client source (`Explorer/Assets/DCL/Character/CharacterMotion/Systems/PointAtMarkerSystem.cs`, `RemoteHandPointAtSystem.cs`; visibility toggle in Settings) and named in the mobile gap list above — limitation: not on mobile.
- **Emote wheel, sprint, camera/photo mode, chat commands** (/goto, /reload, /debug) — <https://docs.decentraland.org/in-world/shortcuts-and-chat-commands> — the free social/expression layer every scene inherits.
- **Mobile client controls** (chat, emotes, 1st/3rd-person camera on touch) — <https://docs.decentraland.org/mobile-app/controls> — voice chat not mentioned for mobile.

## Mobile

- <https://github.com/decentraland/godot-explorer> — the mobile client (active repo). Feature parity with desktop is NOT guaranteed — check the missing-features page above before relying on any desktop-only capability. As of 2026-08-27, AudioAnalysis, proximity voice chat, chat auto-translate, Point-At and DMs are all absent on mobile.

## Known rot / gaps (as of 2026-08-27)

- Point-At In World has no creator- or player-docs page — only the mobile gap list, the tracking issue <https://github.com/decentraland/godot-explorer/issues/1736>, and client source.
- The old player-docs voice chat URL (`/player/general/in-world-features/voice-chat/`, cited in the affordances research) now returns 404 — use the comms-gatekeeper API page and the client-repo docs above instead.
- The Friends & Chatting page does not mention voice or translation — don't cite it for those.
- AudioAnalysis provides no beat detection — amplitude + bands only; a rhythm layer still needs an authored beat map.

## Focused follow-up — September 15, 2026

For avatar-held or close-up interaction, check the current
[Player Avatar](https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-avatar),
[Entity Positioning](https://docs.decentraland.org/creator/scenes-sdk7/3d-essentials/entity-positioning)
and [Camera](https://docs.decentraland.org/creator/scenes-sdk7/3d-content-essentials/camera) pages.
Upper-body emotes can coexist with movement; full-body interruption is not a universal emote rule.
Hand-bone attachment and camera-relative geometry solve different presentation problems. Neither
proves natural grip, first-person hand visibility or readable interaction on the target client.
Emote lifecycle events have client/mask limits; check them before using them for game completion.
These are documentation findings, not a tested scene. Prefer current specific APIs to stale overview
claims and verify the smallest interaction before calling its feel established.
