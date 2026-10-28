---
name: grade
description: Grade one short-answer question from a lesson against its rubric.
argument-hint: "<slug> <doc-path> <question-id>"
allowed-tools: "Read"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, the section file (course-relative, e.g. `modules/01-x/02-y.md`), and the quiz `id`. The learner's answer follows in this message.

1. Read the section file. Find the `quiz` block with that id; read its `prompt` and `rubric`. Read the surrounding prose so you know what the section taught.
2. Judge the answer against the rubric. `correct` = every idea unit in the rubric is present; `partial` = some are; `wrong` = the answer misses the point or asserts a misconception; `skipped` = empty.
3. Return the structured result: `result` and a `note` addressed to the learner, two or three sentences at most — what was right, what is missing, and the one thing to re-read or try. Do not restate the whole answer. Do not praise. If the answer is correct, say what made it correct in one sentence.
