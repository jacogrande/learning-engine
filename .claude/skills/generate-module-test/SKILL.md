---
name: generate-module-test
description: Write the end-of-module test for a module whose sections exist.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, then module id; `NN` is the module's two-digit number. Paths are under `library/content/courses/<slug>/`.

Read `outline.md` (objectives `obj-NN-1`… by position), `learner.md`, every section in `modules/<id>/` and their `quiz` blocks, `modules/<id>/research/test-plan.md` if it exists, and every earlier module's `understanding.md`.

Write `modules/<id>/quiz.md`:

```markdown
---
title: "Module test"
---
One sentence: what this test covers, that earlier ideas return on purpose, and that it is harder than the section checks because recall under difficulty is what lasts.
```

Then 6–10 `quiz` blocks, no prose between them, ids `q-NN-t01`, `q-NN-t02`…, every block with `objective:`:

- **One transfer question per objective**, from the test plan's case: a situation no section used. Recall alone does not show mastery.
- **One discrimination question per confusable pair** the module introduced; distractors from the research files' misconceptions and from `learner.md` `errors`.
- **Two to four earlier-module questions**, interleaved, tagged with that module's objective id. Prefer `carry` items and objectives marked `partial` or `unmet`. For the first module, use the baseline's wrong answers instead.
- Cases come from the learner's `domains`, rotating. No case from any section.
- Default `short`. `mcq` only where plausible confusions are worth telling apart.

Reply with one line naming the file.
