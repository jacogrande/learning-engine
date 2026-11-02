---
name: add-lesson
description: Write one new section in an existing module, on a topic the learner asked for in a chat.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — the course slug, then the module id. The request follows: a working title, what the lesson must teach, and the chat it came from. `NN` is the module's two-digit number. All paths are under `library/content/courses/<slug>/`.

## 1. Orient

Read `outline.md` (this module's objectives, `obj-NN-1`… by position, and their `levels`), `learner.md`, and every section in `modules/<id>/`. Read the chat: it says what the learner already has and what confused them. The new section teaches what the chat asked for and nothing the module's sections already teach; where a section already covers part of it, build on that section and name it in the first sentence.

Pick the objective the lesson serves. If none of this module's objectives covers it, append one to this module's `objectives` list in `outline.md` (and its `levels` entry, from the chat's evidence), changing nothing else in the file: objective ids are positional, so appending is the only safe edit.

## 2. Research

If the topic needs sources the module's `research/` does not have, launch one `module-researcher` scoped to this one topic, writing `modules/<id>/research/<short-slug>.md`. Small topics: search directly or use the existing research.

## 3. Write the section

One file, `modules/<id>/MM-<two-to-four-word-slug>.md`, where `MM` is one more than the highest-numbered section file in the folder. It follows `generate-module` step 4 exactly (read `.claude/skills/generate-module/SKILL.md` for it): frontmatter with `title` (quoted, a claim, the request's title or a better one) and `order` (one more than the highest existing); the "After this section you can …" callout; one `:::predict`; prose per `voice.md` at the objective's `level`; one to three `quiz` blocks. Quiz ids continue the module's numbering: `q-NN-` and one more than the highest `q-NN-<n>` in any of the module's sections. Never reuse or renumber an id. Do not touch `quiz.md`, other sections, or `understanding.md`.

Run that skill's pre-write check before the Write.

## 4. Reply

One line: the file written.
