---
name: start-course
description: Start a new course on a subject — clarify scope, research the breadth of the topic, and write the course scaffold and baseline test.
argument-hint: "<subject>"
allowed-tools: "Read,Write,Glob,Agent,AskUserQuestion"
disable-model-invocation: true
---

Subject: $ARGUMENTS

## 1. Clarify

Ask the learner, in one round, what you need to plan well. Typically: target depth (entry level / working practitioner / expert), what they already know or have done, what they want to be able to *do* afterward, and any angle to emphasize or avoid. Skip questions the subject line already answers.

Pick a short kebab-case slug for the course directory. Stop and ask if `library/content/courses/<slug>/` already exists.

## 2. Research the breadth

Identify 3–5 facets that together cover the subject at the chosen depth. Launch one `topic-researcher` subagent per facet, **in parallel**, each writing to `library/content/courses/<slug>/research/<facet>.md`. Wait for all of them.

Then write `research/map.md`: the territory in one page — the main talking points, how facets relate, which ideas are foundational vs. advanced, and the misconceptions worth testing. This is the planning document later skills read.

## 3. Scaffold

Write `library/content/courses/<slug>/course.md`:

```markdown
---
title: <Title>
depth: <entry | practitioner | expert>
goals:
  - <what the learner said they want to be able to do>
---
<One paragraph: what this course covers and for whom. Voice rules apply.>
```

## 4. Baseline test

Write `library/content/courses/<slug>/quizzes/baseline.md`. Frontmatter `title: Baseline`. Then 8–12 `quiz` blocks (see the content grammar), ids `q-base-01`…:

- Cover each facet; span easy → hard so the result discriminates.
- Mix: roughly half `mcq` with distractors drawn from the misconceptions in `research/map.md`, half `short` asking the learner to explain or apply.
- Start with one short line of prose telling the learner that wrong answers are expected and will shape the course. No other prose between questions.

## 5. Finish

Tell the learner the course is ready at `http://localhost:4000/c/<slug>` and that the baseline test is the only thing there until they take it.
