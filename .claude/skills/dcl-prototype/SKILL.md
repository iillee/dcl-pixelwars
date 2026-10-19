---
name: dcl-prototype
description: "Explore or test one Decentraland mechanic: make a small SDK7 prototype, run an owner self-test or a registered experiment, and record what it does and does not establish. Use for an early sound, movement or look trial without a finished GDD; for a parked hypothesis, greybox, playtest, arithmetic check, mobile check or verdict. Pairs with dcl-gdd through its shared Hypothesis Log. Exploration needs no invented metric; registered experiments preserve their agreed criterion. Takes a hypothesis ID or resume."
---

# Game Prototype Assist: The Prototype Axis

The prototype axis answers **"is it actually fun?"**. The document axis (`dcl-gdd`) answers
**"what do we promise, and why should it work?"**. They interleave through two files in the scene
repo: `design/gdd.md` — the document — and `design/hypothesis-log.md` — the generated Hypothesis Log
index, the interface between the two skills. The log is agent infrastructure; the owner is never
required to fill it or read it.

Run one small experiment, or an exploratory try when the owner has not chosen a criterion yet.
Make the intended action tangible and record what was learned, including an inconclusive result.
An exploratory build is useful without proving a claim; do not invent a metric to justify it.

You address **the design owner** in one voice, the same as `dcl-gdd` — studio or Creator
Success team member, no modes.

The file conventions, statuses, ownership split and verdict format are fixed by the interface
contract: [../dcl-gdd/references/hypothesis-log.md](../dcl-gdd/references/hypothesis-log.md).
Read it in phase 0. Never keep a second copy of it, and never diverge from it on your own.

## Hard rules

1. **One current focus.** Exploration can include successive build–play–adjust passes and owner-led
   changes of direction. For registered tests, run one experiment at a time; say which alternatives you left.
2. **For a registered experiment, the verdict criterion is pre-registered.** It is written in the Brief *before* the build starts,
   and judged unchanged at the end. Moving a threshold after seeing the sessions turns an experiment
   into a story. If a mid-experiment change genuinely invalidates the criterion, that is a return to
   the Brief with a new pre-registration recorded in `## Sessions` — never a silent edit.
3. **Build the least that could kill it.** Use primitives and placeholders; omit menus, persistence
   and polished assets unless essential to the claim. Keep the tested action and the feedback
   needed to perceive it real; a small sound or visual response can be part of the experiment.
   Everything unrelated is faked.
   For a Creator Success milestone, apply [funding and scope](../dcl-gdd/references/funding-and-scope.md)
   when sizing the experiment: fixed support for the studio's own game, within its chosen time
   commitment. Simplify or reuse; do not prescribe unpaid work or recommend more funding merely to fit an oversized idea.
4. **Cheapest rung that can answer the question.** Arithmetic settles only what its inputs and
   criterion support ([arithmetic evidence](../dcl-gdd/references/hypothesis-log/arithmetic.md));
   builds normally start on **desktop Explorer via Creator Hub**, then mobile where needed.
   Estimate from the existing setup, dependencies and action being built; do not promise a fixed duration.
   A hypothesis testable by arithmetic must
   never reach a build untested.
5. **Do not narrate the expected feel before a pass.** Say what to do, never what it should feel
   like — a narrated feeling gets found. The full no-hinting session discipline belongs to external
   testers and lives in the program's `Games/prod-staging/` folder (separate protocol).
6. **Save meaningful evidence when it appears.** In a registered experiment, write the Brief before building, smoke before
   the human pass, each completed pass with its conditions, and amendments before the next pass;
   save the current state before any pause or stop. Keep debug chatter out of the record.
   Rebuild the index at open, close or status change, not after every observation. New hypotheses
   get their files immediately under the parking contract. Ideas and author decisions go straight
   to `ideas.md` and `decisions.md`, dated and attributed; uncertainty goes to ideas, not owner decisions.
   Keep useful inspirations in the shared [reference notes](../dcl-gdd/references/hypothesis-log/files.md#reference-notes) as they appear.
7. **A failure is a result.** Never rescue a hypothesis by widening its criterion, adding testers
   until it passes, or explaining away a session. `failed` stays in the log and is worth as much as
   `validated`.
8. **In registered tests, you own `## Brief`, `## Sessions`, `## Verdict`** — plus `Tested on`, the file rename, the
   source-section rewrite and the index regeneration after a verdict. You do not touch the rest of
   the header block; if the IF/THEN is not falsifiable, raise it with the owner instead of rewriting
   it.

For every preview pass, including resume, reuse the open Explorer and hot reload; check the
existing instance before launching or restarting. Follow [preview lifecycle](references/greybox-build.md#preview-lifecycle).

## Phases

The numbered experiment phases below apply to registered tests. Exploration follows its own
route from phase 0 through stopping or handoff; use shared build guidance without requiring
Brief/Sessions headings, an H-ID, a verdict or an index for an exploratory note.

### 0 — Orient and pick

Use the established `design/` path in the scene repo; clarify only if unknown. Resume the current
note or experiment before choosing new work, preserving [next-step ownership](../dcl-gdd/references/hypothesis-log/files.md#shared-working-memory).
For registered tests, glob `design/*/H*_*.md` and
read the header blocks.

For scene work, follow [bootstrap and resume checks](references/bootstrap.md): verify the needed
workflow once, save its state, then check current availability cheaply. Skip setup for paper/math.

If the owner wants to try an unfinished idea without an agreed criterion, take the
[exploratory route](references/experiment-brief.md#exploratory-try) instead of forcing a pick.
An existing experiment keeps its record and criterion; explicitly defer it if the owner switches away.
For exploration, continue with that route instead of the experiment-picking steps below.

**Resume before you pick.** An `_active` file means an experiment is in flight, and its contents name
the phase — this is why a session can be cut anywhere:

| The file has | Resume at |
|---|---|
| `## Brief` empty | 1 — Brief |
| Brief written, `## Sessions` empty | 2 — Build (skip to 3 if the scene already runs) |
| Sessions contain smoke, amendments or passes, no verdict | Resume the recorded next step; smoke alone is not a human pass |
| Sessions closed, no verdict line | 4 — Verdict |

Otherwise **pick one**: among the hypotheses whose killing test is cheapest, take the one that kills
the most design if it turns out false. Cheapest first is the ordering key; risk is the tie-breaker
inside a band — not the other way round. See [references/the-ladder.md](references/the-ladder.md).

If nothing is parked, you may create **one** experiment file per invocation under the contract's four
requirements, and you must say aloud that you did. With no `design/gdd.md` yet, `Source section` reads
`— (backfill via dcl-gdd)`.

Close the phase by naming the pick, its rung and its cost in one sentence, and getting a yes. If the
owner picks something a cheaper test could kill first, say so once — then do what they chose.

### 1 — Brief

Rename `_parked` → `_active`, then write `## Brief`:
[references/experiment-brief.md](references/experiment-brief.md). It carries the pre-registered
pair — `Criterion (external):` (the agreed observable criterion and failure condition) and
`Kill-check (owner-testable):` (the claim the owner can kill by feel) — plus who tests and who
launches, the rung and why that rung, what gets faked, what gets instrumented, and what is
deliberately **not** built.

The brief is finished when another person could run the procedure and interpret the same recorded
evidence consistently; different people may experience the action differently.

### 2 — Build

Greybox on the rung the brief chose: [references/greybox-build.md](references/greybox-build.md).
For layout, camera clearance, navigation or spatial feel, read the relevant moves in the
[level-design playbook](references/level-design-playbook.md) before shaping the space.
SDK7 API comes from the `sdk-skills` set and mechanics from the `sdk7-test-scenes` catalog — never
from memory. If neither is available and installing fails, say so aloud, build from the official
SDK7 docs ([capability index](../dcl-gdd/references/research/dcl-capability-links-2026-08.md)), and
mark that code as built from docs with no verified reference — the fallback replaces the source,
never the rule.

**Make the selected check observable.** A measured criterion needs its instrument; an owner-only
pass needs the action and feedback for its kill-check, not instrumentation for a future external test.
Dry-run the setup before the human pass; a mechanical check cannot predict the human's verdict.

For a registered experiment, if the build outgrows the brief, resolve the scope before continuing;
do not silently widen the experiment. Owner-led exploratory changes follow the exploratory route.

### 3 — Playtest

**The phase does not open until a smoke line exists in `## Sessions`.** Three sources count: an
agent MCP run, an agent manual dry-run (any transport), or an owner dry-run explicitly recorded as
smoke. This gate binds your initiative, never the owner's request — "give it to me now" is honoured
immediately: hand the build over and write `smoke: skipped at owner request`. Without a smoke line,
later debug passes read as playtest sessions.

For this early experiment, **the owner self-tests** for a feel verdict. This is a local test
convention, not completion of funded V0 or a substitute for its agreed player testing. Fix the instrument between owner passes and log what changed between
which passes, or the passes stop being comparable. The criterion does not move with them (hard
rule 2). Stop early when the answer is already unambiguous: a clean kill after two passes is a
result, not a half-experiment. A separate external-player protocol is
staged in the program's `Games/prod-staging/` folder.

For a solo-enjoyment claim, run the intended lone-arrival condition rather than a group test or
mere winability check. Observe the action and its perceivable response; let the tester describe
what drew them to continue or stop without scripting an expected feeling. Note whether earlier
players' traces were present. Do not add bots or another game simply to make the test pass.
An owner self-test remains `survived` at most; group success does not validate the solo claim.

### 4 — Verdict

Apply [claim-to-evidence limits](../dcl-gdd/references/scope-and-evidence.md#why-playable-evidence-outranks-everything-written)
when interpreting a comparison: a preferred version does not isolate which change caused it.

Judge against the brief, unchanged. Three outcomes, of different sizes:

- **`validated`** — the registered criterion held through measurement or a sufficient calculation
  under the arithmetic rules. Name which; a model scenario is not observed behaviour. Never awarded
  on an owner-feel self-test.
- **`survived`** — the kill-check held under an owner self-test; the criterion was not measured.
  Terminal for this owner self-test, not a funding milestone verdict.
- **`failed`** — the criterion or the kill-check did not hold. A failure is a result.

If evidence cannot settle the registered criterion, record the attempt and gap in Sessions, keep
the source claim open and the experiment nonterminal (active, or deferred if postponed). The
owner kill-check can still support its narrower survived/failed result. Apply the
[verdict limits and write-back](../dcl-gdd/references/hypothesis-log/verdicts.md) before closing;
an inconclusive attempt gets no terminal verdict.

Then write back, in this order:

1. `## Verdict` — first line machine-readable, exactly as the contract specifies. A `survived`
   verdict names *which claim* survived: `**Verdict:** survived — kill-check held: <what> (owner
   self-test) · criterion not measured · <date> · tested on: <rung>`.
2. `Tested on` — the rung that was actually used.
3. Rename the file `_validated` / `_survived` / `_failed` — the suffix goes terminal at the verdict.
   A **mobile-sensitive** hypothesis closed on desktop keeps its terminal suffix; the index renders
   *… — mobile pending* from `Mobile-sensitive: yes` + `Tested on: desktop` while that is true.
4. Rewrite the **source section** in `design/gdd.md` to state what is now known, and report what you
   changed and where. For `survived` the rewrite is scoped exactly to the kill-check — indicative
   mood for what held; the unmeasured criterion stays in the section as `[HYPOTHESIS]` with its
   H-link. If the rewrite would *contradict* the design rather than refine it, raise the conflict
   instead.
5. Regenerate the Hypothesis Log index (`design/hypothesis-log.md`). The `design/gdd.html` render is a gate
   artifact and not yours.

### 5 — Hand off

Never end with "keep building". End with the next cheapest experiment against the riskiest open
hypothesis, named by its ID — or with `dcl-gdd` when the verdict moves the document: a closed
stage, a section that needs re-interviewing, or a bare-idea experiment waiting to be backfilled.

When you offer the jump to `dcl-gdd`, ask **one more question — which vehicle**: (1) a
**separate session** the owner opens themselves (*recommended for a full document pass*; emit a
three-line bootstrap prompt — short because all state lives on disk: working folder + hypothesis
IDs + doc path/stage + carry-over constraints); (2) **this session** (fine for a single section
rewrite or while context is light); (3) a **sub-agent** (*not recommended*: the interview is
interactive — the owner cannot answer questions through a sub-agent; acceptable only for mechanical
passes such as a harvest with no holes to interview).

## Escape hatches

In exploration, honour skip/stop by saving the current build, observations and remaining question
in its note. Do not create a deferred/active hypothesis or a verdict just to stop. For registered tests:

The owner can say **"just build it"** (use the exploratory route if no criterion is agreed;
an existing registered experiment keeps its criterion and history), **"skip the playtest"** (say what the verdict is then worth, and
either mark the hypothesis `_deferred` or record the owner self-test as a verdict — `survived` if
the kill-check held, `failed` if it did not, never `validated` from a self-test — with `tested on`
set honestly),
**"we already know this"** (mark `_deferred` with the reason — skipped experiments never vanish), or
**"stop"** (write the current phase to the file, leave it `_active`, and say in one line where to
resume). Honour all four immediately without arguing.

## Files

The interface contract lives in the other skill and is linked, never copied:
[../dcl-gdd/references/hypothesis-log.md](../dcl-gdd/references/hypothesis-log.md). The
knowledge references are loaded per phase: [experiment-brief](references/experiment-brief.md) ·
[the-ladder](references/the-ladder.md) · [greybox-build](references/greybox-build.md). The
external-tester playtest protocol (RITE) is separate and lives in the program's
`Games/prod-staging/` folder, not in this skill.
