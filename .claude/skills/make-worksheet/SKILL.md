---
name: make-worksheet
description: Write a worksheet for one section — many short exercises on what the section teaches, graded like its questions.
argument-hint: "<slug> <doc-path>"
allowed-tools: "Read,Glob,Grep,Write"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — the course slug, then the section file (course-relative, `modules/<id>/<file>`). The request follows with the size the learner chose, when they chose one ("Size: exactly N exercises"), and their answers to the section's own questions so far. `NN` is the module's two-digit number. All paths are under `library/content/courses/<slug>/`.

A worksheet is practice, not teaching: the section taught the idea; the worksheet makes the learner retrieve and use it many times, in varied cases, with a model answer after each.

## 1. Orient

Read the section, `outline.md` (this module's objectives and their `levels`), `learner.md` (`domains`, `errors`, `vocab_words`), the module's `research/` files for misconceptions and cases, and the sections before this one in the module. List `modules/<id>/worksheets/`: read any worksheet already made from this section, and use none of its cases again.

From the learner's answers in the request, note what they got `partial` or `wrong`: those ideas get more exercises. No answers yet: weight the section's objectives evenly.

## 2. Plan

The size the request gives, exactly; without one, ten to fourteen. Every exercise is a `quiz` block. Ten or more go in three or four groups; fewer than ten in two or three, keeping the order below and dropping Retrieve first, then Transfer. Each group is a `##` heading that names the move (`## Find the main clause`, `## Tell the two apart`, `## Rewrite the sentence`, `## Use it at work`) and one sentence saying what to do. Order the groups from recognising to producing:

1. **Retrieve and recognise.** Short items on the section's core claim and terms, asked in new cases. `mcq` only where the distractors are the misconceptions from the research or `learner.md` `errors`.
2. **Tell apart.** Pairs or cases that differ by one feature, where the learner must say which is which and why.
3. **Produce.** Rewrite, fix or write something: the kind of output the objective names. At least a third of the worksheet is here. When the output is code, these are `type: code` blocks; a "fix it" item puts the broken code in `starter`.
4. **Transfer.** Cases from the learner's `domains` that neither the section nor earlier worksheets used.

In a sheet of ten or more, mix in two or three exercises on earlier sections of this module where the idea connects, marked by their own `objective:`; never more than a fifth of the sheet. A shorter sheet stays on this section. Within a group, vary the case and the surface so no two items can be answered by the same memorised line.

Density by the objective's `level` in `learner.md`:

- novice: open the Produce group with one worked example in prose (the case, each step, the result, in under 120 words), then one completion exercise that gives the first steps and asks for the rest, then independent ones.
- familiar: no worked example; one completion exercise, then independent ones.
- proficient: no worked example or completion; harder cases, and one item where the rule misleads.

## 3. Write

`modules/<id>/worksheets/<nn>-<two-to-four-word-slug>.md`, `nn` continuing from the existing files (start at 01):

```markdown
---
title: "<Practice: the thing practised, as a claim or a name>"
section: <the section file name, e.g. 02-foo.md>
---
```

Then the groups. Follow the content grammar exactly. Quiz `id`s are `q-NN-ws01`, `q-NN-ws02`, … continuing across every worksheet in the module (find the highest existing `q-NN-ws` number first; never reuse one). Every block has `objective:`. Every `prompt` is self-contained, since it may come back weeks later as review. Every `short` rubric is a model answer: two to four numbered idea units, then a `Wrong if:` line naming the misconception. Prose is only the group sentences and the worked example: no introduction, no summary, no encouragement.

Before the Write, check: the requested number of blocks (ten to fourteen without one); ids continue and are unique; every block parses as YAML with `>-` scalars; every `mcq` `options[answer]` is the right option; no case repeats one from the section or an earlier worksheet; the Produce group is at least a third.

## 4. Reply

One line: the file written.
