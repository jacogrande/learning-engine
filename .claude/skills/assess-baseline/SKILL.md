---
name: assess-baseline
description: Grade a learner's baseline test answers and write an assessment the outline will build on.
argument-hint: "<slug>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Course slug: $ARGUMENTS. The learner's answers follow in this message as JSON (question id → answer; mcq answers are 0-based option indexes as strings).

1. Read `library/content/courses/<slug>/course.md`, `quizzes/baseline.md`, and `research/map.md`.
2. Grade each answer. For `mcq`, compare to `answer`. For `short`, judge against `rubric` — partial credit is fine; note precisely what was present and what was missing. Unanswered questions count as gaps, not errors.
3. Write `library/content/courses/<slug>/quizzes/baseline-assessment.md`:

```markdown
---
title: Baseline assessment
level: <novice | familiar | intermediate | advanced>
---
## Where you are
<Two or three sentences, addressed to the learner. Honest, specific, no praise padding.>

## Strengths
- <facet or idea they clearly have, with the evidence (which question)>

## Gaps
- <facet or idea missing or confused, with the evidence; name the misconception if one showed>

## Per question
| id | result | note |
|---|---|---|
| q-base-01 | correct / partial / wrong / skipped | <one line> |
```

4. Return the structured result the caller asked for — `level`, `summary`, `strengths`, `gaps`, and `questions` (one entry per question: `id`, `result`, `note`) — the same content as the file. The `note` is addressed to the learner, one or two sentences: what was right, what was missing.
