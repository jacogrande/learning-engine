---
name: drill-down
description: Go deeper on a passage the learner selected; research it and write a short companion document.
argument-hint: "<slug> <doc-path>"
allowed-tools: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch,Bash"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug and the section file (course-relative, `modules/<id>/<file>`). The selected passage, and optional guidance from the learner, follow.

1. Read the section so you know what was already said. Read `learner.md`: the worked example comes from their first `domains` entry and the density follows the objective's `level`. List existing files in `modules/<id>/drilldowns/` so you do not repeat one.
2. Decide what "deeper" means here: the mechanism behind the claim, the evidence for it, the edge cases, a worked example at length, the history of the idea, or the strongest objection to it. The learner's guidance, if any, decides. Otherwise pick the one that most changes how they would use the idea.
3. Research it. Use one `module-researcher` subagent if the topic needs sources; search directly if it is small. Scope is the passage, not the section.
4. Write `library/content/courses/<slug>/modules/<id>/drilldowns/<nn>-<short-slug>.md`, `nn` continuing from existing files (start at 01):

```markdown
---
title: "<A claim or a thing, not Deeper dive on …>"
section: <the section file name, e.g. 03-foo.md>
quote: "<the selected passage, trimmed to one line, in double quotes with inner quotes escaped>"
---
```

Then 300–700 words in the course voice and grammar, a `##` heading at least every 350 words: claim → mechanism → example → boundary. Link sources inline. One `quiz` block at the end (id `q-NN-dd01`, counting up from existing files) with `objective:` that applies the deeper idea to a new case. No `:::predict`.

5. Reply with one line naming the file.
