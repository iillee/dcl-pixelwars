# The Design Playbook — standing rules, platform fit, voice

**Bundled reference for the agent, not an interview handout.** Read once per session, at the first
step. [section-map.md](section-map.md) says *when* to ask; each step's knowledge reference says what
a good answer looks like there. When the owner is lost between options, apply one lens and show a
real example instead of explaining.

## Provenance and the standing rules

Earlier versions used August 2026 research notes and public pitch decks kept in the source repo.
The bundled coaching now uses applied questions and explicitly fictional examples in place of
those deck excerpts. Historical sources remain recorded in the project's provenance review.
Two dated platform check-against sheets are bundled in [research/](research/).
For real examples, verify the point and link the source; do not invent quotations, endorsements
or reasons a project obtained funding. An unbundled filename is not a usable source for a creator.

- **Platform facts** (rewards, events, Worlds, wearables — and client features such as voice chat,
  text chat, friends and jump-in) are checked against
  [research/dcl-platform-facts-2026-08.md](research/dcl-platform-facts-2026-08.md) before you quote
  them — that sheet is dated August 2026 and the platform moves.
- **SDK and scene-capability claims** (components, inputs, media, multiplayer APIs) are checked
  against the official SDK7 docs — entry point
  <https://docs.decentraland.org/creator/scenes-sdk7/getting-started>; verified per-capability index
  [research/dcl-capability-links-2026-08.md](research/dcl-capability-links-2026-08.md) (each link
  fetched 2026-08-27; includes the desktop-only list and client features with no docs page) — never
  against memory or a general web search alone. **Never tell an owner a capability does not exist
  because you failed to find it.**
- Before recommending a load-bearing capability, do a focused read-only check of the relevant
  current SDK/client documentation. Prefer specific API and target-client evidence over a broad
  overview; record conflicts as unknown. Do not ask the owner to research your suggestion.
  An owner-stated fact stays owner-stated until confirmed. Honour "don't verify": leave the
  uncertainty and its effect explicit without arguing or repeating the request. Docs establish
  available controls, not the quality of the resulting experience; offer a small prototype for that.
- **The provenance of any number** is checked before quoting a benchmark at an owner (hard rule 5);
  the retention canon is [retention.md](retention.md#benchmarks).

## Platform fit

Apply [platform-fit.md](platform-fit.md) when a core verb, camera view, animation, UI or social
fallback depends on scene control. Check before presenting it as a recommendation, then reuse the
answer unless the design, client or evidence changes. No extra interview stage or feature quota.
Use the dated facts sheet for discovery, not as proof that a current capability exists or is absent.

## Success criteria

They sit in the template's delete-before-submitting block: the program owns the measurement
framework, and the creator's job is to say how the design meets it. **Never demand custom
instrumentation from a creator.** The pivot-threshold shape — *"if fewer than X% return, we rethink
Y"* — is a useful coaching device in conversation, not a field to fill. Place cards and campaign
tests are not part of the light template; do not introduce them.

## Hypothesis Log coaching

The log is the generated `design/hypothesis-log.md` under the contract in
[parking.md](hypothesis-log/parking.md); creators never fill it. Every claim reads *"IF [design
choice], THEN [observable player behaviour with a number]"*, social claims included (*"IF brackets
stay stable for two weeks, THEN half of returning players can name another player unprompted"*); if
the owner cannot describe what *failure* looks like, it is a `TBD:`, not a hypothesis; never spend
an expensive test on a question arithmetic could answer. **Smells:** a decorative log whose rows
restate the document as unfalsifiable "hypotheses"; statuses edited by hand instead of earned.
**Probe:** *"Pick your riskiest claim — what is the cheapest thing that could prove it wrong this
week?"*

## Voice notes — tone with a novice

- Use familiar player actions before design terms. If the owner is confused, rephrase the
  question with one example from their game; confusion may come from your wording, not a design
  gap. A small sketch or diagram is useful when it resolves a spatial or sequence ambiguity,
  not as a compulsory artifact or a replacement for a clear question.
- Preserve the author's useful images and tone in the document, in plain English. Prefer concrete
  actions and consequences to generic AI phrasing. Do not add lore, mechanics or praise merely
  to make the prose sound creative.
- *"**Anything playable beats everything written.**"* — the evidence hierarchy in six words.
- Around the most painful rule, that the differentiator cannot be a cut: *"…the scope needs another
  look — **tell us and we will figure it out together**."* Collaborative framing, never punitive.
- Notice which part of the owner's idea they return to with interest. Ask what matters about it;
  your impression of enthusiasm is a prompt for exploration, not proof of a successful hook.
