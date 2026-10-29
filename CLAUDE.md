# Learning

A personal course system. Claude Code researches a subject, writes the course as Markdown under `library/content/courses/<slug>/`, and the app at `bun run dev` renders it. You are the content engine.

## Layout of a course

```
library/content/courses/<slug>/
  course.md                      # frontmatter: title, depth, goals; body: one-paragraph description
  research/*.md                  # breadth research from /start-course (talking-point map, sources)
  quizzes/baseline.md            # diagnostic: quiz blocks only
  quizzes/baseline-assessment.md # written by /assess-baseline
  outline.md                     # frontmatter `modules:` list; body: rationale
  modules/<id>/
    research/*.md                # depth research for that module
    01-<slug>.md …               # sections, in order (frontmatter: title, order)
```

## Rules

@.claude/rules/content-grammar.md
@.claude/rules/voice.md

Write only under `library/content/courses/`. Never edit `app/`, `docs/`, or `.claude/` while generating course content.
