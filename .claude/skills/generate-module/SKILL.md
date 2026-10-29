---
name: generate-module
description: Research one module in depth and write its sections.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch"
disable-model-invocation: true
---

Arguments: $ARGUMENTS (course slug, then module id as it appears in `outline.md`).

## 1. Orient

Read `course.md`, `outline.md` (find this module's objectives; they are referenced as `obj-<module-nn>-<n>` by position), `quizzes/baseline-assessment.md` (the learner's level and gaps), `research/map.md`, and any `modules/*/` sections that already exist (so you build on them and do not repeat them).

**Read every earlier module's `understanding.md`.** They record what the learner actually has. Where one lists an objective as `partial` or `unmet`, or names a confusion in `carry`, this module opens with a short, targeted review of it before new material and re-tests it in a quiz. Where mastery was shown, tighten the prose and skip the restated connectives. Say in the first section's opening callout what you are picking up from the last module, in one sentence.

**If this module's directory already has research or section files, a previous run was interrupted. Keep them.** Read what is there, skip research briefs that already have a file, and write only the sections that are missing, continuing the numbering. Do not rewrite finished sections.

## 2. Research in depth

Split the module's objectives into 2–3 research briefs. Launch one `module-researcher` subagent per brief, **in parallel**, each writing to `library/content/courses/<slug>/modules/<id>/research/<brief>.md`. Each brief lists the exact objectives it owns and says explicitly what is out of scope. Wait for all.

## 3. Write the sections

Write 3–6 section files at `library/content/courses/<slug>/modules/<id>/NN-<slug>.md`, `NN` zero-padded in reading order. Each file:

- Frontmatter: `title`, `order`.
- Opens with the objective it serves, as one line in a `:::callout{type=note}`: "After this section you can …".
- A `:::predict` block before any mechanism or counterintuitive result.
- 150–350 words of prose per the voice rules. Claim → mechanism → concrete example → boundary condition. Use the researchers' worked examples and sources; link sources inline where a claim needs one.
- A `mermaid` diagram only where structure beats prose.
- Ends with 1–3 `quiz` blocks (ids `q-<module-nn>-<nn>`), each tagged with the `objective:` it tests, default `short`, `mcq` only with misconception distractors. At least one question in the module should apply the idea to a new case rather than recall it.

Adjust density to the learner's level in the assessment. Write the files one at a time, in order, so the reader can start on the first while you write the rest.

## 4. Module test

Read `.claude/skills/generate-module-test/SKILL.md` and follow it to write `modules/<id>/quiz.md`.

## 5. Finish

Reply with one line listing the files written.
