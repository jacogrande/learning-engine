---
name: grade
description: Grade one short-answer question from a lesson against its rubric.
argument-hint: "<slug> <doc-path> <question-id>"
allowed-tools: "Read"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, the section file (course-relative, e.g. `modules/01-x/02-y.md`), the quiz `id`. The learner's answer follows.

1. Read the section; find the `quiz` block with that id. Read `learner.md` `errors`.
   If the request says the learner was asked a **variant** and gives its prompt and rubric, grade against that variant's rubric, not the block in the file; the block only tells you which idea is being tested.
2. Read the whole answer before scoring any part of it. Score against the rubric's numbered idea units, on substance:
   - A unit is present if any part of the answer states the idea, in any words. The rubric's wording is one way to say it, not the required one. Its examples ("for example", "such as", a sample sentence or scenario) illustrate the unit; the learner need not give that example or any example unless the unit itself asks for one.
   - Never score one clause in isolation when another clause of the answer states the idea or rules out the misreading.
   - An answer that can be read as the right idea or as a misconception is read as the right idea.
   - `correct`: every unit present. A sharper phrasing you would prefer does not make it partial. `partial`: at least one unit present and at least one absent from the whole answer. `wrong`: none, or the answer as a whole is the `Wrong if:` case. `skipped`: empty.
3. `errors` are earlier patterns, not expectations. Name one only when the answer as a whole commits it, and quote the learner's words that show it. If another part of the answer contradicts the pattern, it is not a match.
4. Return `result` and a `note` to the learner, three sentences at most. Partial or wrong: what was right, which unit is missing, and the one case that separates the right idea from what they wrote. Correct: one sentence on what made it correct, and at most one sentence on a sharper way to say it, framed as a refinement, not a gap. No praise, no restating their answer.
