# Content grammar

Every file under `library/content/courses/` is Markdown the app renders with fixed components. No HTML or JSX. A malformed block renders as an error card.

## Frontmatter

YAML between `---` lines. `title` is required; section files also need `order`. Put every prose value in double quotes; escape inner quotes as `\"`. An unquoted colon in one value can drop a whole course.

```markdown
---
title: "Bottom line first: a document rule"
order: 4
---
```

## Prose

CommonMark + GFM. Headings start at `##`; the app renders `title` as the `#`. See `voice.md`.

## Callouts

```markdown
:::callout{type=note}
One or two sentences. Types: note, tip, warning.
:::

:::predict
One question the reader answers in their head before reading on. Once per section, before the mechanism or the counterintuitive result. The next paragraph answers it in its first sentence.
:::
```

## Diagrams

Only for a relation the prose has not already stated, with four or more nodes. Short labels; no parentheses or quotes in node labels.

````markdown
```mermaid
flowchart LR
  A[Order] --> B[Cut] --> C[Weld]
```
````

## Notation

A fenced `abc` block holds one tune in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1): one `X:` line per fence; a second tune goes in its own fence. The app engraves it and adds a player, so a reader can hear every phrase. Always set `M:`, `L:`, `K:` and `Q:`; put chord symbols in double quotes before the note they sit on; `%` starts a comment. A space between notes breaks the beam, so write the eighths of one beat group without spaces (`GCD^D`) and keep the space only between groups. Write concert pitch unless the section says otherwise. A phrase taken from a recording names the source and the timestamp in the prose, never only in the block. For a swung phrase in an x/4 or x/8 meter, add `%%MIDI swing 66` after `K:` (50 is straight, 60 light, 66 a triplet feel, 75 the most); the player starts at that feel and lets the reader change it. Notate swung eighths as plain eighths, never as dotted pairs. Every bar fills the meter, except a pickup first bar and its complement at the end; the reader lists a bar that does not, and every parser warning, under the score. Notation never goes inside a `quiz` block: a fence there ends the question early. Put the score in the prose just before the question and refer to it.

````markdown
```abc
X:1
T:ii-V-I in C
M:4/4
L:1/8
Q:1/4=140
K:C
"Dm7" DFAc dcAF | "G7" _AGFE DB,G,F, | "Cmaj7" E4 z4 |]
```
````

## Video

A leaf directive embeds a player for one passage of a YouTube video: it plays from `t` to `end`, and its reset button jumps back to `t`. Use it only for a recording the section quotes, placed right after the prose that cites the moment. `v` is the video id, `t` and `end` are `m:ss`, seconds or `1m43s` (either may carry a decimal, `1:48.5`), `title` is the caption. Quote every value; a value cannot hold a double quote, even escaped, so use single or curly quotes inside a title. Always the two-colon form: `:::youtube` would take in everything after it.

```markdown
::youtube{v="-_lIEU7mz8s" t="1:43" end="1:49" title="Stan Getz, Pennies from Heaven, 1957"}
```

## Questions

A fenced `quiz` block with a YAML body. Every section ends with one to three. Default `short`; `mcq` only when the distractors are confusions worth telling apart.

````markdown
```quiz
id: q-02-03
type: short
objective: obj-02-1
prompt: >-
  A step adds 3 minutes of work and 2 days of waiting. Which waste is this, and why?
rubric: >-
  1. Waiting. 2. Lead time, not work time, dominates: two days against three minutes.
  Wrong if: counts only the three minutes, or calls it overprocessing.
```

```quiz
id: q-02-04
type: mcq
objective: obj-02-2
prompt: >-
  Which metric does a value stream map add that a flowchart lacks?
options:
  - Step ownership
  - Time spent waiting between steps
  - Number of steps
  - Tooling per step
answer: 1
explanation: >-
  Flowcharts show sequence. Value stream maps add lead time and process time per step, which exposes waiting.
  "Number of steps" tempts because both diagrams count them; neither one times them.
```
````

Fields:

- `id`: unique in the course; never changed or reused. Patterns, two digits zero-padded: baseline `q-base-01`; section `q-02-03` (module number, question number counted across the module); warm-up review `q-02-r1`; module test `q-02-t03`; drill-down `q-02-dd01`; flashcard made in a chat `q-02-fc01`.
- `objective`: the outline objective the question tests, `obj-02-1` (module number, objective position). Required everywhere except the baseline.
- `prompt`: self-contained; the reader may meet it weeks later as spaced review.
- `rubric` (`short`): two to four numbered idea units, then a `Wrong if:` line naming the misconception. The learner may see it as the model answer; write it as one. No grader talk.
- `options` (`mcq`): one line each, no `: ` inside. Every distractor is a misconception from the research files or a neighbouring idea from the module. `answer` is the 0-based index. `explanation`: why the answer is right and why the most tempting distractor tempts.

YAML: write `prompt`, `rubric`, and `explanation` as `>-` block scalars, always. Never a double-quoted scalar with `\"` escapes inside a quiz block. After writing an `mcq`, confirm `options[answer]` is the correct option.
