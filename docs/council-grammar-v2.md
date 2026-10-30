# Council: grammar course, old prompts vs new

Date: 2026-10-29. After the [prompting pass](prompting-pass.md), a second grammar course (`grammar-for-writers-v2`) was generated from the same learner inputs through the new app flow, given the same baseline assessment, and taken through outline and module 01. Three judges compared the two blind (A = new, B = old), each with a different lens.

## Verdicts

| Judge | Verdict | Confidence | Deciding point |
|---|---|---|---|
| Nonfiction editor | A (new) | medium | Mechanism in every section; every example shown and walked; rubrics with `Wrong if:`; MCQs applied to fresh sentences; a module test. |
| Learning scientist | B (old) | medium | Adaptation 5 vs 2. B's module 1 re-teaches the learner's two documented reversals on their own baseline sentences and names the error; A defers them to modules 3 and 5 and its §8 rewrite blesses the sentence the learner got wrong. |
| Target reader | B (old) | medium | "I came to the course because of the second lever and A makes me wait two modules for it." A ≈ 50 min, B ≈ 25 min; A's §3 and §4 teach the same rule twice. |

Scores (1–5), where lenses overlap: new wins mechanism (5/4, 4/4), examples (5/3), quizzes (5/3, 4/3), segmenting (4/3), backward design (4/3), predict placement (4/3); old wins adaptation (5/2), respect for time (4/2), "could do it afterward" (4/3), desire to continue (4/3). Both judges who chose B wrote that a version of A with B's module-1 scope would beat both.

## What the comparison shows

The new prompts fixed what the first review found: prose that explains mechanism, examples quoted in full, contrast pairs, rubrics a learner can self-score, objective tags on every question, a planned test. They also caused two regressions:

1. **Planning.** The outline ordered modules by dependency and put clause anatomy first; the learner's diagnosed gaps (stress position reversed, a balanced sentence read as an error) landed in modules 3 and 5. The old outline went straight at them in module 1.
2. **Length.** "4–8 sections, one idea each" doubled the module (8 sections, ~5,100 words vs 5 and ~3,300) and produced two sections restating one rule.

Smaller findings on the new version: three module-test items on untaught objectives; a boundary case that contradicted the previous section and the test rubric; several analysis-only quizzes where the old version asked the learner to rewrite; two overstated claims (strict scope of pre-verbal *only*; dependency-length minimization glossed as right-branching). On the old version: terms used before definition (*subordinator*, *topic position*), rubrics without failure criteria, two recall MCQs, a hand-waved mechanism for stress position, and no module test.

## Caveats

- The baseline assessment both versions adapted to was graded on the old course's test; the new baseline is a different instrument the learner never took.
- The learner profile copied into v2 was skipped by an interactive `cp` prompt, so v2's outline ran with domains and levels but without the recorded error patterns.

## Fixes applied

- `generate-outline`: module 1 goes straight at the assessment's biggest gaps; prerequisites are taught inside it in the smallest form that serves the gap; the rationale names which gaps module 1 targets.
- `generate-module`: 3–6 sections; an objective takes one section unless it holds two distinct ideas; never a second section restating the first; ~25 minutes of reading; at least one production (write/rewrite) question per section; the boundary case may not contradict an earlier rule or a rubric; when the learner's own baseline sentence appears, say what they got wrong.
- `generate-module-test`: never tag a question with an untaught objective; the first module re-asks a baseline miss instead of "earlier modules."

## Next

Regenerate v2's outline and module 01 under the fixed prompts (with the profile actually copied) and re-run the council. Until then the learner's active course is the original.
