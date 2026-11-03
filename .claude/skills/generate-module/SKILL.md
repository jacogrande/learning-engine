---
name: generate-module
description: Research one module in depth, plan its test, and write its sections and test.
argument-hint: "<slug> <module-id>"
allowed-tools: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch,Bash"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — first the course slug, then the module id as in `outline.md`. `NN` below is the module's two-digit number, the first two characters of its id. All paths are under `library/content/courses/<slug>/`.

## 1. Orient

Read, in this order: `outline.md` (this module's objectives, `obj-NN-1`… by position, and their `levels`), `learner.md`, `quizzes/baseline-assessment.md`, `research/map.md`, and every earlier `modules/*/understanding.md`. Glob earlier modules' section titles; read a section only when a `carry` item points at it.

From the `understanding.md` files, list what to pick up: every objective marked `partial` or `unmet` and every `carry` item. Repeat nothing else from earlier modules.

If `modules/<id>/` already has files, a run was interrupted. Keep them: skip research briefs that exist, write only the missing sections, continue the numbering.

## 2. Research

Split the objectives into 2–3 briefs. Launch one `module-researcher` per brief, in parallel. Each prompt states: the course title and goals; the learner's `domains` and the `errors` from `learner.md` that touch these objectives; the objectives this brief owns, by id and full text, with their `level`; the objectives it must not cover; and the output path `modules/<id>/research/<brief>.md`. When the course teaches music, each prompt also says so, names the instrument, and asks for the agent's Music material: recorded examples, one transcribed passage per objective, and worked examples as checked scores. Wait for all. Use the files, not the agents' replies.

## 3. Plan the test first

Write `modules/<id>/research/test-plan.md`: per objective, one transfer case from the learner's `domains` that the sections will not use, and the misconception it must discriminate; plus one case per `carry` item. Step 5 builds the test from this file. The sections may not use these cases.

## 4. Sections

Write 3–6 files `modules/<id>/NN-<two-to-four-word-slug>.md`, one at a time, in reading order. One idea per file; an objective takes one section unless it holds two distinct ideas. Never write a second section that restates the first's rule with new examples: fold the examples in or cut them. The module should take a working reader about 25 minutes. Each file, in this order:

1. Frontmatter: `title` (quoted), `order`.
2. `:::callout{type=note}`: one sentence, "After this section you can <the objective, or the part this section covers>."
3. First section only, when an earlier module exists: a `:::callout{type=tip}` naming in one sentence what this module picks up from `carry`, then one `quiz` block (id `q-NN-r1`) re-asking the first `carry` item on a new case, before any prose. If `learner.md` records `retention` under 0.8 for this course, make it two warm-up questions (`q-NN-r1`, `q-NN-r2`).
4. One `:::predict`.
5. Prose per `voice.md`, at the objective's `level`: claim, mechanism, one example from the research, one failure case. The example's domain rotates through the learner's `domains` in list order, section by section across the module (the first section the first domain, the second the second, wrapping round), unless `learner.md`'s body weights them otherwise; follow that. Never default to software, startups or tech workplaces unless a domain names them: a business example can come from any kind of organisation. Link a source inline where a claim needs one. If the section builds on an earlier one, its first sentence names what it takes from there. Every term a quiz or rubric uses is defined in bold before use, here or earlier; define the terms in `learner.md` `asks` before anything else. If `learner.md` lists `vocab_words.learning` (general words the learner is collecting), use one or two in examples where they fit naturally, without glossing them: each new sentence is another encounter with the word. Never bend an example to fit one in.
6. 1–3 `quiz` blocks per the content grammar, ids `q-NN-01` onward across the module, each with `objective:`. At least one per section asks the learner to write or rewrite something, not only to classify. The last question in each section applies the idea to a case from a `domains` entry the prose did not use.

### Music

When the course teaches music, a section teaches by sound and by the page, not by description:

- **Show every line you mention as a score.** A lick, a guide-tone line, a voicing, an enclosure, a contrast pair: each is an `abc` block per the content grammar, placed in the prose where it is discussed. Guitar parts use `clef=treble-8` and give string and fret positions in the prose or a short table. A contrast pair is two scores that differ by the one move.
- **Anchor on real playing.** At least half the sections, and every section whose objective has a `### Transcribed passage` in research, quote a real recording: the prose names player, tune, album, year and timestamp; the transcribed score follows, copied from the research block exactly (title, `C:` line, notes); the `::youtube` passage follows the prose that cites the moment. Nothing about the passage goes beyond the research block. If research found no verified transcription for a section, it may still name a recording and an approximate moment, and use an original line, labelled `C:Original, written for this course`.
- **Standards as players know them.** Tunes in their usual keys with their usual changes; say which source the changes follow when versions differ (a recording, a lead sheet). Name the bar numbers you are talking about.
- **Play it, then write it.** The question that asks the learner to write or rewrite something asks for a line on given changes (note names on beats, or ABC if they want), and at least one question per section refers to a score shown just before it. The score goes in the prose before the `quiz` block, never inside it.
- **Run the check.** After writing each section, run `bun run scripts/check-notation.ts modules/<id>/<file>.md`. Fix every problem it reports and run it again; confirm each passage's printed title and channel match the recording the prose names.

Before each Write, check: every rule has its mechanism in the next sentence; every mentioned example is quoted in full; the boundary case does not contradict a rule stated earlier in the module or a rubric in its quizzes; prose under 350 words; no banned phrases; every quiz block has `objective:` and `>-` scalars. When the learner's baseline sentence or error appears, say explicitly what they got wrong and what the fixed version does to the reader.

## 5. Test

Read `.claude/skills/generate-module-test/SKILL.md` and follow it, building from `research/test-plan.md`. For a music course, run the check script on `quiz.md` too.

## 6. Reply

One line: the files written.
