# Layout, IDs and statuses

Part of the [Hypothesis Log contract](../hypothesis-log.md).

## Layout on disk

```
<project folder>/design/            ← the scene repo when there is one; any folder will do
  gdd.md                                  ← source of truth: the document the owner submits
  gdd.html                                ← optional creative render; early concept + meaningful updates
  hypothesis-log.md                       ← generated log index — agent interface, never hand-edited, never submitted
  ideas.md                                ← append-only idea parking lot — dated, attributed, never judged on entry
  decisions.md                            ← append-only decision history: date · decision · why · owner call / agent call (incl. standing non-goals)
  references.md                           ← useful inspirations and their sources; create only when needed
  01-find-the-fun/
    H1-01-core-drop-fun_validated.md
    H1-02-pop-feel_active.md
    playtest-2026-08-12-notes.md          ← intermediate files park here too
  02-core-loop/
    H2-01-session-length_parked.md
  03-vertical-slice/
```

Stage folders **are** the process — there is no `experiments/` level, and folders carry no status
suffix. Stage folders may hold any intermediate file that acts as memory: playtest notes,
screenshots, raw data.

The `design/` path is the session folder's `design/` (see SKILL.md phase 0); never hardcode it.

## Shared working memory

Keep each record in its existing home; link instead of duplicating history in a session changelog.
Use `notes.md` only for context with no suitable home. Create files when there is something to save.

For meaningful changes of direction, append to `decisions.md`: what changed, whose choice it was,
why (if known), and which earlier decision it replaces. Preserve the old entry; link the new one.
Do not invent a rationale or ask for one after every small tweak.

Keep a test’s question, build/change, conditions, observations and limits together in its existing
experiment record or exploratory note. An attractive outcome is not proof of its proposed cause.

At a pause or handoff, save the current focus and next step in the existing status or active note.
Distinguish an owner-chosen step, an agent suggestion and an outstanding check. On resume, use
that record with the owner’s current intent; a suggested or unchecked step is not an obligation.
Keep this concise and maintain it yourself, not as an owner questionnaire.

## Reference notes

When the owner supplies an inspiration, or research finds one useful to the current design,
save it in `design/references.md` (reuse an existing reference list). References can be images,
video, audio/music, 3D models, animations, links, text descriptions or other useful material — for example, a lighting
image, a clip's pacing, a sound's texture or a described mood. Keep the title, source URL
or local path, a page/timestamp when useful, and what matters about it. Separate the owner's
interest from your suggestion; note rejected aspects so they are not offered again. A reference
does not approve a mechanic or grant rights to reuse its assets. Preserve supplied local
attachments in the project's reference folder when permitted; keep provenance and do not rely
on temporary paths alone. For online material, save links rather than downloading media by
default. Unknown provenance stays unknown. No reference questionnaire or empty file is needed.

## IDs and filenames

`H<stage>-<nn>-<slug>_<status>.md`

- Numbering is **per stage**, not global — a late find-the-fun experiment inserts as `H1-07` without
  renumbering anything.
- References anywhere (the log table, `design/gdd.md` prose, a handoff message) use the **stable ID**
  `H1-03`, resolved by glob. Renames never break a link.
- When a section holds more than one hypothesis, the marker itself carries the ID —
  `[HYPOTHESIS H1-03]` — so every marker resolves to exactly one row.
- **Slugs use hyphens only, never underscores** — the underscore is reserved as the status separator
  and must parse unambiguously.
- **Statuses are resting states only:**

| Status | Meaning |
|---|---|
| `parked` | written down, not started. The state `dcl-gdd` creates. |
| `active` | an experiment is in flight |
| `validated` | the registered THEN held through measurement or a sufficient calculation under [arithmetic evidence](arithmetic.md), at the rung named in `tested on`. Name the method; conditional model output is not observed behaviour. Never awarded on an owner-feel self-test. |
| `survived` | terminal for the owner self-test: the **kill-check held under an owner self-test**; the criterion was not measured. This is the owner-*feel* outcome — not a funding milestone verdict. `survived` and `failed` are claims of different sizes, not two thresholds of one scale. |
| `failed` | the registered criterion or owner kill-check did not hold under the recorded conditions. Name which; a failed owner check does not settle the wider player claim. It stays in the log. |
| `deferred` | consciously skipped. Skipped experiments do **not** vanish. |

Transient states — briefed, built, tested-but-unjudged — live *inside* the file, not in its name.

- Re-testing on a higher rung **appends to the same file**; the ID and folder never move, and
  `tested on` records the new rung.
