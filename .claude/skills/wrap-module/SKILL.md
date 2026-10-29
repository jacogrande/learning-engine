---
name: wrap-module
description: Close a module — judge each objective from the evidence, write the understanding summary later modules build on, and update the learner profile.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Write"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug, then module id; `NN` is the module's two-digit number. The evidence follows as JSON: the learner's written explanation, the wrap-up discussion, every answer in this module's sections and test (grader result, 1–3 confidence, the objective each question tests), and the review schedule.

Read `outline.md`, `learner.md`, and `modules/<id>/quiz.md`. Read `library/state/chats/*.json` whose `course` matches and whose `doc` starts with `modules/<id>/` for the section chats. Read a section only to check what was taught.

Judge each objective from unassisted evidence only: answers and the written explanation. The discussion shows where they can be led; it does not count.

- `met`: a transfer question on this objective answered correctly, or the explanation handles it precisely and a recall question was correct.
- `partial`: recall correct but transfer wrong or missing; or the idea is present but loose.
- `unmet`: wrong, skipped, or absent.

Calibration: count answers that were sure (3) and wrong, and guessing (1) and correct. Say what the pattern means for how they should study.

Write `modules/<id>/understanding.md`, every string value quoted:

```markdown
---
title: "Understanding"
level: novice | familiar | proficient
summary: "<One sentence, to the learner: what they now have.>"
objectives:
  - id: obj-NN-1
    status: met | partial | unmet
    evidence: "<one line: which questions, or which part of the explanation>"
calibration: "<one line, e.g. Sure and wrong on 2 of 6; guessing and right on 1. Trust the hesitation.>"
carry:
  - "<one per item: an unmet objective, or a confusion as a contrast pair the next module can re-test: X vs Y, chose X when Y applies>"
---
## What you have
<Two to four sentences. Specific. No praise padding.>

## What to watch
<Two to four sentences: the confusions that showed, the planted claim if they accepted it, the objective that is only partial. Name the misconception when there is one.>

## For the next modules
<One to three sentences: what later material should lean on and what it should re-test.>
```

Under 250 words. Then update `learner.md`, keeping its shape and quoting every string:

- `level`: this module's objectives from unassisted evidence — met → proficient, partial → familiar, unmet → novice.
- `vocabulary`: terms used correctly in the explanation move to `owns`; ideas they paraphrased go to `describes`.
- `errors`: add a pattern only when it appears in two or more questions or modules, with `seen:` ids; drop one two modules after it last appeared.
- `calibration`: running counts of sure-and-wrong and guess-and-right, and where each clusters.
- `attempting`: questions skipped this module; whether chat first messages contain an attempt before a request.
- `asks`: what the section chats asked for (a term, a mechanism, a check), with the chat id.
- Body: one paragraph of imperatives for the next generator. Whole file under 200 words; every entry carries its evidence; nothing from one data point except `level`.

Reply with one line naming the files.
