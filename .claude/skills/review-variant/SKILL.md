---
name: review-variant
description: Write one variant of a quiz question for spaced review — same idea, a different case — so the learner recalls the idea rather than the wording.
argument-hint: "<slug> <doc-path> <question-id>"
allowed-tools: "Read"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, the file (course-relative, e.g. `modules/01-x/02-y.md`), the quiz `id`. The variants already written for this question follow, if any.

1. Read the file; find the `quiz` block with that id. Read the surrounding section so you know exactly what idea it tests. Read `learner.md` for `domains` and `errors`.
2. Write one variant that tests the same idea units with a different case: a situation from a `domains` entry the original and the earlier variants did not use. Keep the type. For `short`, write a new `rubric` with the same numbered idea units adapted to the new case and a `Wrong if:` line. For `mcq`, keep the same misconceptions as distractors in new wording, a new correct option, and an `explanation` that says why the tempting distractor tempts. The prompt must be self-contained.
3. Return the JSON the schema asks for. No file writes. No commentary.
