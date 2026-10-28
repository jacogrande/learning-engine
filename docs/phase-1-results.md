# Phase 1 — Read a course

Date: 2026-10-28. Goal from [roadmap.md](roadmap.md): run `/start-course`, take the baseline, get an outline, generate a module, and read it in the browser.

## Verdict: done

Verified end to end on a fixture course with real Claude Code jobs:

| Step | Result |
|---|---|
| Baseline submitted from the browser | Attempt saved to SQLite; `assess` job ran `/assess-baseline` with `--json-schema`; structured grade stored and `quizzes/baseline-assessment.md` written (36 s) |
| Outline | Chained automatically after assess; `/generate-outline` wrote `outline.md` with 5 modules and objectives, kept an existing module id, compressed what the baseline showed the learner knew (42 s) |
| Module generation | `/generate-module` spawned 3 `module-researcher` subagents in parallel (web search + fetch), wrote 3 research files and 4 sections (5 m 40 s). Sections followed the grammar: objective callout, predict block, cited sources, boundary section, quizzes with misconception distractors |
| Hot reload | `fs.watch` on `content/` → SSE → the course page flipped the module from Generate to Open without a refresh, and sections appeared as they were written |
| Rendering | Directives, Mermaid, quiz fences, tables; no block errors; light and dark |
| Cancel | SIGTERM to the child; job row marked `cancelled` |

## What was built

```
bun run dev  →  http://localhost:4000

app/server.ts            Bun.serve: API routes + bundled client (HMR in dev)
app/server/content.ts    reads content/courses/<slug>/ — files are the source of truth
app/server/db.ts         bun:sqlite — attempts, jobs
app/server/jobs.ts       one-at-a-time `claude -p` runner, NDJSON → activity + log
app/server/events.ts     SSE channel: content changes + job progress
app/client/              React: Courses → Course (baseline | outline) → Reader
app/client/Markdown.tsx  react-markdown + :::directives + quiz/mermaid fences
.claude/skills/          start-course, assess-baseline, generate-outline, generate-module
.claude/agents/          topic-researcher, module-researcher
.claude/rules/           content-grammar.md, voice.md (loaded via CLAUDE.md)
```

No ORM, no router library, no Vite, no Hono. ~900 lines total.

## How to use it

1. `bun run dev`.
2. In another terminal, in this directory: `claude`, then `/start-course <subject>`. Answer the clarifying questions. It researches, scaffolds, and writes the baseline.
3. Open the course at `http://localhost:4000`, take the baseline, submit. Assessment and outline run automatically (about 1–2 minutes).
4. Click **Generate** on a module (5–10 minutes). Read it as it lands.

## Decisions made

- **Bun end to end.** Its built-in bundler and `bun:sqlite` removed three dependencies the feasibility doc had pencilled in.
- **No index tables yet.** The server reads files on request; the watcher only says "something changed." Fast enough for one user, and nothing to rebuild.
- **Job chaining lives in the route** (`baseline` → `assess` → `outline`), not in the skills. Skills stay single-purpose.
- **Quiz prompts render inline Markdown**, since Claude will use emphasis in them whatever the rules say.

## Carried to Phase 2

- Grading in-lesson answers (currently MCQ self-check only; short answers have no feedback).
- Selection menu, highlights, notes, chat, drill-down, additional reading.
- Git auto-commit per job with a `Run-Id` trailer.
- A `PreToolUse` hook denying writes outside `content/`.
- Stable ids on headings (quizzes have them; prose blocks do not yet).
- Job log is in memory only; a restart loses it (rows in `jobs` survive).
