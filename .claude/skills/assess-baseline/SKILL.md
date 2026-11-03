---
name: assess-baseline
description: Grade a learner's baseline test answers, write the assessment the outline builds on, and seed the learner profile.
argument-hint: "<slug>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Course slug: $ARGUMENTS. The learner's answers follow as JSON: question id → `{ answer, confidence, note }`. mcq answers are 0-based indexes as strings. `confidence` is how sure the learner was before seeing any feedback: `guessing`, `fairly sure` or `sure`. `note` is optional: the learner's own remark on the answer (what they were unsure of, how they reasoned, what they half remember).

1. Read `course.md`, `learner.md`, `quizzes/baseline.md`, `research/map.md`.
2. Grade each answer. `mcq`: compare to `answer`. `short`: score the rubric's idea units; partial credit is fine; say what was present and what was missing. Unanswered counts as a gap, not an error. Read each `note` as part of the answer: credit an idea the note states, and use it to tell a confusion from a slip. Weigh confidence as evidence: a correct guess is weak evidence the idea is held; sure and wrong is a misconception, not a gap.
3. Write `quizzes/baseline-assessment.md`:

```markdown
---
title: "Baseline assessment"
level: novice | familiar | proficient
facets:
  - name: "<facet from research/map.md>"
    level: novice | familiar | proficient
---
## Where you are
<Two or three sentences to the learner. Specific. No praise padding.>

## Strengths
- <idea they have, with the question as evidence>

## Gaps
- <idea missing or confused, with the question; name the misconception if one showed>

## Per question
| id | result | note |
|---|---|---|
| q-base-01 | correct / partial / wrong / skipped | <one line> |
```

Levels: `novice` cannot produce the fix or recognize the idea; `familiar` produces the right fix but cannot name the move or state the rule; `proficient` applies and explains it on a case the question did not show.

4. Update `learner.md`, keeping its `domains`. Add `vocabulary.owns` (terms used correctly, unprompted), `vocabulary.describes` (ideas they paraphrased instead of naming), and seed `errors` with each gap that looks like a pattern rather than a one-off, each with `seen: [q-base-..]`; every sure-and-wrong answer goes in `errors`. Set `calibration: "<one line: sure and wrong on N, guessing and right on M, and where each clusters>"`. One line per entry, every string quoted. Leave `level` for the outline.

5. Return the JSON the schema asks for: `level`, `summary`, `strengths`, `gaps`, and per-question `id`, `result`, `note`. Each `note` is to the learner, one or two sentences.
