---
name: generate-module
description: Research one module in depth, plan its test, and write its sections and test.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — first the course slug, then the module id as in `outline.md`. `NN` below is the module's two-digit number, the first two characters of its id. All paths are under `library/content/courses/<slug>/`.

## 1. Orient

Read, in this order: `outline.md` (this module's objectives, `obj-NN-1`… by position, and their `levels`), `learner.md`, `quizzes/baseline-assessment.md`, `research/map.md`, and every earlier `modules/*/understanding.md`. Glob earlier modules' section titles; read a section only when a `carry` item points at it.

From the `understanding.md` files, list what to pick up: every objective marked `partial` or `unmet` and every `carry` item. Repeat nothing else from earlier modules.

If `modules/<id>/` already has files, a run was interrupted. Keep them: skip research briefs that exist, write only the missing sections, continue the numbering.

## 2. Research

Split the objectives into 2–3 briefs. Launch one `module-researcher` per brief, in parallel. Each prompt states: the course title and goals; the learner's `domains` and the `errors` from `learner.md` that touch these objectives; the objectives this brief owns, by id and full text, with their `level`; the objectives it must not cover; and the output path `modules/<id>/research/<brief>.md`. Wait for all. Use the files, not the agents' replies.

## 3. Plan the test first

Write `modules/<id>/research/test-plan.md`: per objective, one transfer case from the learner's `domains` that the sections will not use, and the misconception it must discriminate; plus one case per `carry` item. Step 5 builds the test from this file. The sections may not use these cases.

## 4. Sections

Write 4–8 files `modules/<id>/NN-<two-to-four-word-slug>.md`, one at a time, in reading order. One idea per file; an objective usually takes two. Each file, in this order:

1. Frontmatter: `title` (quoted), `order`.
2. `:::callout{type=note}`: one sentence, "After this section you can <the objective, or the part this section covers>."
3. First section only, when an earlier module exists: a `:::callout{type=tip}` naming in one sentence what this module picks up from `carry`, then one `quiz` block (id `q-NN-r1`) re-asking the first `carry` item on a new case, before any prose.
4. One `:::predict`.
5. Prose per `voice.md`, at the objective's `level`: claim, mechanism, one example from the research in the learner's first domain, one failure case. Link a source inline where a claim needs one. If the section builds on an earlier one, its first sentence names what it takes from there. Every term a quiz or rubric uses is defined in bold before use, here or earlier; define the terms in `learner.md` `asks` before anything else.
6. 1–3 `quiz` blocks per the content grammar, ids `q-NN-01` onward across the module, each with `objective:`. The last question in each section applies the idea to a case from a `domains` entry the prose did not use.

Before each Write, check: every rule has its mechanism in the next sentence; every mentioned example is quoted in full; prose under 350 words; no banned phrases; every quiz block has `objective:` and `>-` scalars.

## 5. Test

Read `.claude/skills/generate-module-test/SKILL.md` and follow it, building from `research/test-plan.md`.

## 6. Reply

One line: the files written.
