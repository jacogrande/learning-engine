# Learning

A personal course system. You name a subject; Claude Code researches it, writes the course, grades your answers, and tutors you — on your own Claude Code subscription, on your own machine. Everything lives in this repo: the app, and your courses, notes and progress under `library/`.

```
bun install
bun run dev                      # http://localhost:4000
claude  →  /start-course <subject>   # in a second terminal, in this directory
```

Take the baseline in the browser; the outline builds itself; generate modules from the outline page.

**Another machine:** clone this repo, `bun install`, `bun run dev`. The app pulls on start and pushes as you work.

**After app updates** (a pull that touched `app/server/`), restart `bun run dev`: the client hot-reloads, the server does not.

**Docs:** `bun run docs` → http://localhost:8000 — [vision](docs/vision.md), [roadmap](docs/roadmap.md), feasibility, and per-phase results.

```
app/        Bun server + React client
library/    content/courses, notes, state — your data
.claude/    skills, agents, rules Claude Code runs with
docs/       design docs
```
