---
name: assess-baseline
description: Grade a learner's baseline test answers, write the assessment the outline builds on, and seed the learner profile.
argument-hint: "<slug>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Course slug: $ARGUMENTS. The learner's answers follow as JSON (question id → answer; mcq answers are 0-based indexes as strings).

1. Read `course.md`, `learner.md`, `quizzes/baseline.md`, `research/map.md`.
2. Grade each answer. `mcq`: compare to `answer`. `short`: score the rubric's idea units; partial credit is fine; say what was present and what was missing. Unanswered counts as a gap, not an error.
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

4. Update `learner.md`, keeping its `domains`. Add `vocabulary.owns` (terms used correctly, unprompted), `vocabulary.describes` (ideas they paraphrased instead of naming), and seed `errors` with each gap that looks like a pattern rather than a one-off, each with `seen: [q-base-..]`. One line per entry, every string quoted. Leave `level` for the outline.

5. Return the JSON the schema asks for: `level`, `summary`, `strengths`, `gaps`, and per-question `id`, `result`, `note`. Each `note` is to the learner, one or two sentences.
