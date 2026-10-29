---
name: start-course
description: Start a new course on a subject — clarify scope, research the breadth of the topic, and write the course scaffold, learner profile and baseline test.
argument-hint: "<subject>"
allowed-tools: "Read,Write,Glob,Agent,AskUserQuestion"
disable-model-invocation: true
---

Subject: $ARGUMENTS

## 1. Clarify

Ask the learner, in one round: target depth (entry level / working practitioner / expert), what they already know or have done, what they want to be able to *do* afterward, and what they are producing with it right now (the documents, code, decisions, or work the course should draw examples from). Skip questions the subject line already answers. If the message already carries the answers (the app sends them), ask nothing and proceed.

Pick a short kebab-case slug. Stop and ask if `library/content/courses/<slug>/` already exists.

## 2. Research the breadth

Identify 3–5 facets that together cover the subject at the chosen depth. Launch one `topic-researcher` per facet, in parallel. Each prompt states: the subject, the depth, what the learner wants to be able to do and what they produce, this facet, the other facets by name (so it stays out of them), and the output path `library/content/courses/<slug>/research/<facet>.md`. Wait for all, then read the files; do not rely on the agents' replies.

Write `research/map.md`: the territory in one page — the main talking points, how facets relate, which ideas are foundational vs. advanced, the one to three threshold concepts (ideas that change how the learner sees everything after, and that they will resist), and the misconceptions worth testing. Later skills plan from this file.

## 3. Scaffold

Write `library/content/courses/<slug>/course.md`:

```markdown
---
title: "<Title>"
depth: entry | practitioner | expert
goals:
  - "<what the learner said they want to be able to do>"
---
<One paragraph: what this course covers and for whom. Voice rules apply.>
```

Write `library/content/courses/<slug>/learner.md`:

```markdown
---
title: "Learner"
domains:
  - "<what they produce, most frequent first>"
---
```

Nothing else; `/assess-baseline`, `/generate-outline` and `/wrap-module` fill the rest.

## 4. Baseline test

Write `library/content/courses/<slug>/quizzes/baseline.md`, frontmatter `title: "Baseline"`, then 8–12 `quiz` blocks, ids `q-base-01` through `q-base-12`, no `objective` field, every `prompt` and `rubric` a `>-` block scalar:

- Cover each facet; span easy → hard so the result discriminates.
- Roughly half `mcq`, distractors from the misconceptions in `research/map.md`; half `short`.
- Each facet gets at least one `short` question that asks the learner to *name* the move or rule behind a fix, not only to make it. That separates familiar from proficient.
- One line of prose first, telling the learner wrong answers are expected and shape the course. No other prose.

## 5. Finish

Reply with one line: the slug, and that the baseline is the only thing there until they take it.
