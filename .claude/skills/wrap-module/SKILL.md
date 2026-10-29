---
name: wrap-module
description: Close a module — judge each objective from the evidence and write the understanding summary later modules build on.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug and module id. The evidence follows in this message as JSON: the learner's written explanation, the wrap-up discussion transcript, every answer they gave in this module's sections and test (with the grader's result, their 1–3 confidence, and the objective each question tests), and the spaced-review state.

Read `outline.md` (this module's objectives, ids `obj-<module-nn>-<n>` by position) and `modules/<id>/quiz.md`. Read the sections only where you need to check what was taught.

Judge each objective from unassisted evidence only — answers and the written explanation. The discussion shows where they could be led; it does not count as mastery.

- `met`: a transfer question on this objective answered correctly, or the explanation handles it precisely and a recall question was correct.
- `partial`: recall correct but transfer wrong or missing; or the idea is present but loose.
- `unmet`: wrong, skipped, or absent.

Calibration: compare confidence to results. Count answers that were sure (3) and wrong, and guessing (1) and correct. Say what that pattern means for how they should study.

Write `library/content/courses/<slug>/modules/<id>/understanding.md`:

```markdown
---
title: Understanding
level: <novice | familiar | intermediate | advanced — for this module's material>
summary: "<One sentence, to the learner: what they now have.>"
objectives:
  - id: obj-NN-1
    status: met | partial | unmet
    evidence: "<one line: which questions or which part of the explanation>"
calibration: "<one line, e.g. 'Sure and wrong on 2 of 6; guessing and right on 1. Trust the hesitation.'>"
carry:
  - "<one line per item the next modules should return to: an unmet objective, a confusion, a confusable pair>"
---
## What you have
<Two to four sentences. Specific. No praise padding.>

## What to watch
<Two to four sentences: the confusions that showed, the planted claim if they accepted it, the objective that is only partial. Name the misconception when there is one.>

## For the next modules
<One to three sentences: what later material should lean on and what it should re-test.>
```

Keep it under 250 words. Reply with one line naming the file.
