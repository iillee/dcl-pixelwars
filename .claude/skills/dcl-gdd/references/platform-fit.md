# Platform fit — the playable action, not just the API

Use when proposing or reviewing a load-bearing action. Keep the creator's intended sensation;
resolve the risky dependency before building more design on it.

Trace one repetition: **player input → what the scene controls → visible/audible response →
what the player can notice and choose next**. Account for the actual camera, avatar and target
client, including touch. The existence of an animation, attachment or camera API does not prove
that their combination delivers precise hand interaction, a readable close-up or good control.

Distinguish a built-in client feature from an API the scene can call, custom scene/asset/server
work, and an unverified dependency. Verify only the load-bearing parts using current specific
official docs; the [capability index](research/dcl-capability-links-2026-08.md) helps locate them.
Identify which verified feature or existing implementation supplies a dependency. A built-in
capability can support feasibility, not zero integration or testing work. Qualifiers such as
"probably free" still claim effort; without a basis, describe the work and uncertainty instead.
Do not label something impossible because it is undocumented, or cheap because it is possible.
This applies to every offered alternative, not only the owner's original idea: device support,
scene-callable control and experienced quality are separate claims. An apparently simple sound,
object effect or camera change still has integration, performance and client dependencies.
If multiplayer matters, identify what others actually receive; local feedback is not shared state.
Before calling a design robust, try a counterexample to the claimed protection: a player holds
control, reacquires it, leaves, or joins after a busier session. A rule handling one transition
does not establish the broader guarantee. State what it handles and leave the rest unverified.

Explain the consequence in player language: what works, what is uncertain, and what changes in
feel or effort. When a workaround changes the core sensation, offer the trade-off to the owner;
do not quietly replace their idea. A simpler presentation can be a candidate, not a forced answer.
Keep API names in the evidence/experiment notes, not as homework for the creator.

An unresolved dependency remains `TBD:` with a focused check, not a promised feature or an
ordinary later-version cut. Test the smallest risky interaction in the intended client before
calling its feel proven. Documentation alone can support feasibility, never experienced quality.
Use the existing hypothesis workflow; no new report or checklist is required from the owner.

Also ask whether the design fits how people enter, leave, observe and control play here. A genre
need not be unique to Decentraland. Preserve interesting solo play; another player should improve
it without requiring an unverified invite, matchmaking or minimum crowd as the rescue plan.
Do not add wearables, rewards or social systems merely to make the game look platform-specific.
