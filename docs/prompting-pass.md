# Prompting pass

Date: 2026-10-29. Two specialist reviews (learning science; prompt engineering) of every prompt that generates course content, judged against the research synthesis and the real `grammar-for-writers` output. Their findings agreed on most points and were merged into one rewrite.

## What was wrong

- **No section quiz carried `objective:`.** Three skills required it; the grammar's examples omitted it, and Claude copies examples over rules. Result: `wrap-module` could judge objectives only from the module test.
- **Every section ran over the length cap with two ideas** (395–435 words against 150–350). The skill asked for 3–6 sections for 4 objectives, which forces an objective per section, and an objective is bigger than an idea.
- **Citations standing in for mechanism** ("Hooper and Thompson documented this in 1973") and **examples mentioned but not shown** ("a forty-word Didion sentence" never quoted).
- **Density inverted**: 90 words re-defining *clause* for a learner the assessment said could label subject and verb; the densest section carried five new terms. No level vocabulary was defined anywhere (`familiar` appeared in output without a definition).
- **Rubrics were prose model answers** with grader talk ("bonus for…"), while `grade` scored "idea units" and the app shows rubrics to the learner.
- **Tutor rules lived only in the first turn**; after `--resume` they were far back in context, and nothing counted exchanges for the five-step discussion.
- **Quiz id conventions stated four ways**; YAML safety split across two rules; subagent briefs with no scope lock, size cap or return contract.

## What changed

**Learner profile — `learner.md`** per course (`start-course` seeds `domains`; `assess-baseline` adds vocabulary and error patterns; `generate-outline` writes per-objective `level`; `wrap-module` updates everything). Fields: `domains` (what they produce; examples come from here), `level` per objective (novice / familiar / proficient, each defined), `vocabulary.owns / describes`, `errors` (patterns seen twice or more, with evidence), `calibration`, `attempting`, `asks`. Every generation and tutoring skill reads it. Deliberately **not** inferred: learning styles or modality (no evidence of a matching effect — Pashler 2008, Kirschner 2017), a "worked-example vs attempt-first" trait (the right scaffold depends on current knowledge of the objective, not a preference — Kalyuga 2003), anything from a single data point except `level`.

**Voice** (`voice.md`): the mechanism sentence must answer *why* in terms of what the reader, system or process does — a citation is not a mechanism; show every example in full; teach on a contrast pair; boundary is a shown failure case; define before first use; pick one analysis when sources offer two; a literal ban list; a density dial keyed to `level`.

**Grammar** (`content-grammar.md`): both quiz examples carry `objective`; one id table (`q-02-03`, `q-02-r1`, `q-02-t03`, `q-02-dd01`, `q-base-01`); rubrics are numbered idea units plus a `Wrong if:` line; MCQ explanations say why the tempting distractor tempts; binary YAML rule (frontmatter prose quoted; quiz prose always `>-`).

**Module generation**: orient on `learner.md` and prior `understanding.md` → research briefs that carry domains and error patterns → **plan the test first** (`research/test-plan.md`, transfer cases the sections may not use) → 4–8 sections, one idea each, split rule → warm-up `q-NN-r1` on the first `carry` item → test from the plan. Tests: one transfer per objective, one discrimination per confusable pair, 2–4 interleaved earlier-module items, cases rotating through `domains`.

**Tutor**: `chat` makes one move per reply (direct answer for what/why; hint ladder for "do it for me", one rung per turn, unassisted variant after a full answer, faded example on the third no-attempt request). `socratic` keeps its five steps, now with the planted claim built from the learner's own `errors`. The invariants (one reply, no narration, 2–6 sentences, one question, withhold until attempt) moved to `--append-system-prompt` on every chat turn, and each learner message carries `[Exchange n]` so the script holds across `--resume`.

**Researchers**: scope lock, size caps, contrast pairs, worked examples per domain with reasoning steps, boundary cases, terms marked prerequisite/new; reply with the path and a few lines, not the file.

**App guards**: `app/server/lint.ts` parses every quiz block after a module or test job and reports bad ids, missing objectives, out-of-range answers, missing rubrics/explanations and over-length prose; the assessment level enum is now novice / familiar / proficient; outline `levels` flow into the course API.

## Verified

- Positional skill arguments (`$1`, `$2`) were proposed; a test showed them unreliable in this CLI, so everything stays on `$ARGUMENTS` with explicit ordering.
- Tutor turn 1 ("What is a subordinator?"): four sentences, direct, ends with one question drawn from the learner's domain. Turn 2 ("just rewrite this for me"): asks what they tried, says once that the answer is held back, offers "show me a parallel". Both carried the system prompt; the second resumed the session.
- Module generation under the new prompts (module 02 of the grammar course, on a throwaway copy with a hand-written module-01 `understanding.md`): 14 minutes; `research/test-plan.md` written first with a reserved transfer case and a misconception per objective; 7 one-idea sections at 316–388 words of prose (module 01 under the old prompts: 395–435); the first section opens with a tip naming the two `carry` items and a warm-up `q-02-r1` on the gapping confusion, with a numbered idea-unit rubric and a `Wrong if:` line; every quiz tagged with an objective; terms bolded before use; mechanism sentences that answer why; examples quoted in full with sources linked; an 8-question test with two interleaved module-01 items. Lint: 0 problems.

## Techniques that work with Claude (per the prompt review), kept

Slot structure; literal examples of the exact format (Claude copies them over rules); short literal ban lists; "why in the next sentence or cut it" (checkable per paragraph); example domain named by file; a yes/no pre-write checklist; turn state in the user message; invariants in the system prompt. Rejected as cargo cult: draft-then-tighten passes, word-count targets without a cutting rule, persona paragraphs.
