# Roadmap

A personal course system where Claude Code researches a subject, writes the course, grades your answers, and tutors you — all billed to your own Claude Code subscription, all stored locally in git and SQLite. See [vision.md](vision.md) for the full idea and [tech-feasibility.md](tech-feasibility.md) for how it's built.

## Guiding decisions

- **Claude writes content, not code.** Modules are Markdown with a fixed grammar (callouts, quizzes, predict-first prompts, Mermaid, Vega-Lite). The app owns the components. One bad character breaks a block, never a page.
- **Files for what Claude writes, SQLite for what you do.** Every generation step is a git commit. Your notes, highlights, answers, and chats never get regenerated away.
- **Stable IDs are the contract.** Claude preserves block ids on edit and appends feedback rather than rewriting, so your annotations survive.
- **Teach, don't tell.** The tutor uses a hint ladder with a withheld answer — the pattern the RCTs show works — not open-ended Socratic loops or answer-giving.

## Phases

### Phase 0 — Spike *(half a day)* — done, see [phase-0-results.md](phase-0-results.md)
Prove the one hard dependency: `claude -p` runs headlessly against the Pro/Max login, streams NDJSON, and can invoke a skill and a subagent. If this fails, the premise changes and so does the plan.

**Done when:** a button on a bare HTML page triggers a Claude Code run and streams its output back.

### Phase 1 — Read a course *(1–2 weeks)* — done, see [phase-1-results.md](phase-1-results.md)
The skeleton: Vite + React client, Hono server, Drizzle schema, chokidar indexer with SSE hot reload, content grammar v1, the three-pane layout. Skills for `/start-course` (clarify → breadth research → scaffold → baseline test), `generate-outline`, and `generate-module`. A one-at-a-time job queue with live progress.

**Done when:** you run `/start-course`, take the baseline, get an outline, generate a module, and read it in the browser as sections land.

### Phase 2 — Interact *(1–2 weeks)*
Everything you do while reading. Grading with structured feedback appended into the doc. Selection menu with Add to Note, Drill Down, Find Additional Reading, and Chat. Durable highlights that re-anchor after regeneration. Tiptap notes pane. Chat pane with multi-turn sessions. Git auto-commit per run.

**Done when:** you can highlight a sentence, drill into it, ask Claude about it, and keep notes — and all of it survives a module regeneration.

### Phase 3 — Teach *(1 week)*
The pedagogy loop. End-of-module "teach it to a colleague" summary, Socratic chat with the hint ladder, understanding summary written to disk for future modules to read. Confidence ratings before feedback, predict-first blocks, FSRS spaced review pulling earlier objectives into later quizzes, mastery gate on unassisted recalls.

**Done when:** finishing a module produces an understanding summary that the next module visibly builds on.

### Phase 4 — Polish *(ongoing)*
Charts beyond Mermaid, sandboxed HTML embeds for custom visualizations, run history and usage view, content-lint warnings in the UI, user-state export to git, calibration dashboard.

## Immediate next steps

1. Run the Phase 0 spike.
2. Decide the six open questions in tech-feasibility §12 (content-not-code, notes in git, Node vs Bun, chat protocol, single repo).
3. Write `.claude/rules/content-grammar.md` and `voice.md` — the two documents every generation depends on.
4. Scaffold the app and pick a first real course to build against.
