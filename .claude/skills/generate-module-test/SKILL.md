---
name: generate-module-test
description: Write the end-of-module test for a module whose sections exist.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Arguments: $ARGUMENTS (course slug, module id).

Read `outline.md` (this module's objectives; they are referenced as `obj-<module-nn>-<n>` by position, so the second objective of module `03-foo` is `obj-03-2`), every section in `modules/<id>/`, the `quiz` blocks already used in them, `quizzes/baseline-assessment.md`, and every earlier module's `understanding.md` and sections.

Write `library/content/courses/<slug>/modules/<id>/quiz.md`:

```markdown
---
title: Module test
---
One line: what this test covers and that earlier ideas return on purpose.
```

Then 6–10 `quiz` blocks, ids `q-<module-nn>-t<nn>`, each with an `objective:` field:

- **Every objective of this module gets at least two questions, and at least one of them is transfer**: apply the idea to a case the sections did not use. Recall alone does not show mastery.
- **About a third of the questions re-ask ideas from earlier modules** (tag them with that module's objective id), interleaved with the new ones, not grouped. Prefer the objectives earlier `understanding.md` files mark `partial` or `unmet`, and confusable pairs across modules.
- Default `short`. Use `mcq` only where plausible confusions are worth discriminating; distractors come from the misconceptions in the research files.
- Do not reuse a question from the sections. Different cases, same objectives.
- No prose between questions.

Reply with one line naming the file.
