---
name: find-reading
description: Find further reading — books, papers, articles — for a passage the learner selected.
argument-hint: "<slug> <doc-path>"
allowed-tools: "Read,Glob,Write,WebSearch,WebFetch"
disable-model-invocation: true
---

Arguments: $ARGUMENTS — course slug and the section file (course-relative, `modules/<id>/<file>`). The selected passage follows.

1. Read the section and `research/map.md` (its sources list is your starting point). Read `quizzes/baseline-assessment.md` for the learner's level. List existing files in `modules/<id>/readings/`.
2. Search for 5–8 sources that go further on exactly what the passage says: the primary text an idea comes from, the best modern treatment, one accessible article, one that argues against it if a serious critique exists. Verify each exists; prefer sources with a URL or a well-known book.
3. Write `content/courses/<slug>/modules/<id>/readings/<nn>-<short-slug>.md`, `nn` continuing from existing files:

```markdown
---
title: Reading on <the idea>
section: <section file name>
quote: "<the selected passage, one line, in double quotes with inner quotes escaped>"
---
Two sentences: what the passage claims and what these sources add.

## <Source title> — <Author, year>
[link](url) · <book | paper | article | talk> · <20 min | 2 hours | a weekend> · <level: entry | practitioner | expert>

<Two or three sentences: what it covers, why read it for this passage, and what to skip. If it disagrees with the lesson, say how.>
```

One `##` per source, ordered by how much they add. No quiz block.

4. Reply with one line naming the file.
