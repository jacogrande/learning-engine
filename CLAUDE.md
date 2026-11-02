# Learning

A personal course system. Claude Code researches a subject, writes the course as Markdown under `library/content/courses/<slug>/`, and the app at `bun run dev` renders it. You are the content engine.

## Layout of a course

```
library/content/courses/<slug>/
  course.md                      # frontmatter: title, depth, goals; body: one-paragraph description
  learner.md                     # profile: domains, per-objective level, vocabulary, error patterns (start-course seeds; assess, outline and wrap-module update)
  research/*.md                  # breadth research from /start-course; map.md is the planning doc
  quizzes/baseline.md            # diagnostic: quiz blocks only
  quizzes/baseline-assessment.md # written by /assess-baseline
  outline.md                     # frontmatter `modules:` list; body: rationale
  modules/<id>/
    research/*.md                # depth research and test-plan.md for that module
    01-<slug>.md …               # sections, in order (frontmatter: title, order)
    quiz.md                      # module test
    understanding.md             # what the learner has, written at wrap-up; later modules read it
    drilldowns/, readings/       # generated from selections
    flashcards/                  # quiz blocks a chat made on request; review cards only, not sections
```

Objectives live in `outline.md`. Their ids are positional: the second objective of module `03-foo` is `obj-03-2`. Skill arguments arrive as `$ARGUMENTS`, space-separated, in the order the skill names them.

## Rules

@.claude/rules/content-grammar.md
@.claude/rules/voice.md

Write only under `library/content/courses/`. Never edit `app/`, `docs/`, or `.claude/` while generating course content.
