---
name: generate-outline
description: Plan the course modules from the research map, the baseline assessment and the learner profile. Module level only — no section content.
argument-hint: "<slug>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Course slug: $ARGUMENTS.

1. Read `course.md`, `learner.md`, `research/map.md`, every file in `research/`, and `quizzes/baseline-assessment.md`.
2. Plan 4–8 modules. Backward design: start from what the learner wants to *do* (course goals), decide what each module must leave them able to do, order by dependency. Compress what the assessment shows they have; weight what showed as a gap. Module level only — no sections, no content.
3. Write `library/content/courses/<slug>/outline.md`. Quote every `title`, `summary` and objective string.

```markdown
---
title: "Outline"
modules:
  - id: 01-<short-slug>
    title: "<A claim or a thing, not Introduction>"
    summary: "<One sentence: what this module leaves you able to do.>"
    objectives:
      - "<Bloom verb + object: Map a value stream and compute lead time vs. process time>"
      - "…"
    levels: [familiar, novice]   # one per objective, same order, from the assessment's facet levels
  - id: 02-…
---
<Three to six sentences, to the learner: why this order, what was compressed because of the baseline, which one to three modules carry the threshold concepts from research/map.md, and where the hard parts are.>
```

Each module gets 2–4 objectives, concrete and testable: later skills plan, test and judge against them. Ids are `NN-slug`, zero-padded, in order.

4. Write the per-objective levels into `learner.md` under `level:` as `obj-NN-n: <level>`, keeping everything else in the file.
