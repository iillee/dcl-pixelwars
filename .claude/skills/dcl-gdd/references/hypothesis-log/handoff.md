# The handoff vehicle

Part of the [Hypothesis Log contract](../hypothesis-log.md), shared with `dcl-prototype` — both
skills route their jumps into prototyping through this question. The hard-rule numbers refer to the
`dcl-gdd` SKILL.md.

Any jump — mid-interview (hard rule 6) or at hand-off — asks **one more question first: the
vehicle.** Recommendation attached, as always:

1. **A separate session** (*recommended for a real build*) — the owner opens a new window in the
   same folder and pastes a bootstrap prompt that you produce. Keep it short; the files are the
   shared state, three lines suffice:

   > Working folder: `<the folder we are in>`. Run `dcl-prototype` with: "experiment `<H-ID>` — `<one
   > line: what and why now>`. Doc at `design/gdd.md`, stage `<n>`. Do not build: `<constraints
   > worth carrying from the interview>`."

   Nothing else transfers — `design/gdd.md`, the Hypothesis Log and the experiment files carry the
   state, and this interview resumes later without loss (hard rule 4 already guaranteed that).
2. **This session** — fine for paper/arithmetic experiments, or while the session is still light.
3. **A sub-agent** — *not recommended*: playtesting is interactive, and the owner cannot feel a
   build through a sub-agent. Acceptable only for non-interactive experiments (pure arithmetic or
   paper).
