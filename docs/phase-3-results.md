# Phase 3 — Teach

Date: 2026-10-29. Goal from [roadmap.md](roadmap.md): finishing a module produces an understanding summary that the next module visibly builds on.

## Verdict: done

Verified end to end on a throwaway copy of a real module, with real Claude jobs:

| Step | Result |
|---|---|
| Module test | `/generate-module-test` wrote 9 questions, each tagged with an objective; every objective covered at least twice; the preamble noted there was no earlier module to interleave from and chose the two baseline misreads instead |
| Confidence before feedback | Check stays disabled until Guessing / Fairly sure / Sure is picked; a confident wrong answer shows the hypercorrection framing above the explanation |
| Grading → spaced review | Each answer becomes an FSRS card. Correct + Sure scheduled 8 days out; wrong came due in a minute; the Review tab served it, took a new answer and confidence, and re-rated it (log: 2 reviews, streak reset) |
| Teach it | Wrap-up page: explanation written from memory in the editor (word count, 60-word gate), drafts saved as you type |
| Socratic discussion | `/socratic` opened by naming the one missing idea unit, tied it to a test miss, and asked one question; after a correct parse it moved to "now bend the rule" (the counterexample step) unprompted |
| Finish | `/wrap-module` (32 s) wrote `understanding.md`: per-objective `met / partial / unmet` with evidence, calibration line, and `carry` items for later modules. It noticed six of nine test questions were never attempted and said so |
| Outline and reader | Module shows done, `0/4 met`, summary line, objective statuses; sidebar marks read sections and "Understanding ✓"; Review tab shows `2 due` |
| Next module | Generated module 02 against that summary. Its first callout: "Module one left rank and stress as two axes you can state but have not yet used under pressure; this module puts them to work." Its test preamble: "gapping and the negation test on content clauses return on purpose, because module one left them unmet and partial" — two of the summary's three `carry` items, with the questions tagged `obj-01-1` and `obj-01-4` |

## What was built

```
.claude/skills/generate-module-test   module test: ≥2 per objective, ≥1 transfer, ~⅓ earlier-module items interleaved
.claude/skills/socratic               the sharp-student script: gap → counterexample → planted claim → new case → stop
.claude/skills/wrap-module            judges objectives from unassisted evidence; writes understanding.md
.claude/skills/generate-module        reads prior understanding summaries; opens with targeted review
app/server/review.ts                  ts-fsrs cards, rating from result + confidence, due list, mastery
app/server.ts                         progress, question lookup, test/discuss/finish routes, review
app/client/Quiz.tsx                   confidence rating, hypercorrection note
app/client/Wrap.tsx                   teach-it editor → discussion → understanding
app/client/Review.tsx                 one due question at a time
app/client/Editor.tsx                 shared Tiptap editor (notes and the explanation)
library/state/{progress,cards}/       synced like everything else
```

## How the research shows up

- **Objectives are the unit** (Wiggins & McTighe): `obj-<module>-<n>` ids, every question tagged, mastery judged per objective from transfer, not recall.
- **Retrieval with feedback, short-answer default** (Dunlosky; Kang et al.): unchanged from Phase 2, now also in the module test and review.
- **Confidence before feedback** (Dunlosky & Rawson; hypercorrection): three-point rating, framing on confident errors, calibration line in every understanding summary.
- **Spacing with FSRS** (open-spaced-repetition benchmark): every question is a card; "learned" means three spaced correct recalls in the Review state.
- **Interleaving** (Rohrer): module tests re-ask earlier objectives mixed in, weighted toward what earlier summaries marked partial or unmet.
- **Teaching as learning + interactive partner** (Kobayashi; ICAP): the explanation is written for a colleague; the discussion partner is interactive, not a grader.
- **Hint ladder, not open Socratic loops** (Bastani; Kestin; the SIGCSE 2026 null): the script has a fixed shape, one question per turn, answers withheld only until an attempt, stops after about five exchanges.
- **Mastery from unassisted work only** (Lehmann; Khanmigo trial): `wrap-module` is told the discussion shows where the learner can be led, and does not count it.

## Carried forward

- Objective ids are positional in the outline; reordering objectives would shift them.
- Review items are served in due order with no cap on session length.
- "Learned" is computed but not yet surfaced beyond the review API's `mastery` field.
- Heading "…" menu and click-highlight-to-jump remain in the backlog.
