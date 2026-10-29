---
name: grade
description: Grade one short-answer question from a lesson against its rubric.
argument-hint: "<slug> <doc-path> <question-id>"
allowed-tools: "Read"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, the section file (course-relative, e.g. `modules/01-x/02-y.md`), the quiz `id`. The learner's answer follows.

1. Read the section; find the `quiz` block with that id. Read `learner.md` `errors`.
2. Score against the rubric's numbered idea units. `correct`: every unit present, in the learner's words or better. `partial`: at least one. `wrong`: none, or the `Wrong if:` case. `skipped`: empty.
3. Return `result` and a `note` to the learner, three sentences at most: what was right, which unit is missing, and the one case that separates the right idea from what they wrote. If the answer matches a pattern in `errors`, name the pattern. If correct, one sentence on what made it correct. No praise, no restating their answer.
