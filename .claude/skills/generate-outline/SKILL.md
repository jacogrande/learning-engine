---
name: generate-outline
description: Plan the course modules from the research map and the baseline assessment. Module level only — no section content.
argument-hint: "<slug>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Course slug: $ARGUMENTS.

1. Read `course.md`, `research/map.md`, every file in `research/`, and `quizzes/baseline-assessment.md`.
2. Plan 4–8 modules. Backward design: start from what the learner said they want to *do* (course goals), decide what each module must leave them able to do, order by dependency. Use the assessment to skip or compress what they already have and to put extra weight where gaps showed. Stay at module level — do not list sections or write content.
3. Write `library/content/courses/<slug>/outline.md`:

```markdown
---
title: Outline
modules:
  - id: 01-<short-slug>
    title: <Module title — a claim or a thing, not "Introduction">
    summary: <One sentence: what this module leaves you able to do.>
    objectives:
      - <Bloom verb + object: "Map a value stream and compute lead time vs. process time">
      - …
  - id: 02-…
---
<Three to six sentences, to the learner: why this order, what was skipped or compressed because of the baseline, and where the hard parts are.>
```

Each module gets 2–4 objectives. Ids are `NN-slug`, zero-padded, in order. Objectives are the unit later skills plan against, so make them concrete and testable.
