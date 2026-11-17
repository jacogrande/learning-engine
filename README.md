# Learning

A personal course system. You name a subject; Claude Code researches it, writes the course, grades your answers, and tutors you, on your own Claude Code subscription and your own machine.

This repo is the **engine**: the app, and the skills and rules Claude Code writes courses with. Your courses, notes and progress live in a separate **library** repo of your own, kept at `library/` inside this folder (ignored by this repo's git). The app commits to the library as you work and pushes it, so every machine you learn on stays in step.

## Start

You need [Bun](https://bun.sh), git and [Claude Code](https://claude.com/claude-code). For a library synced through GitHub, also the GitHub CLI, logged in (`gh auth login`).

```
git clone https://github.com/jacogrande/learning-engine.git && cd learning-engine
claude
> /start-learning
```

`/start-learning` installs dependencies, creates your library (a new private GitHub repo, or an existing one on a second machine, or local only), asks whether the app should start with your computer, and opens it at http://localhost:4000.

Then: **New course** in the app, or `/start-course <subject>` in Claude Code. Take the baseline in the browser; the outline builds itself; generate modules from the outline page. For a one-module briefing on a work topic, choose **Brief**.

**Another machine:** clone the engine, run `/start-learning`, choose "I already have a library".

**After engine updates** (a pull that touched `app/server/`), restart the app: `systemctl --user restart learning` on Linux, or `bun run scripts/setup.ts start`. The client hot-reloads; the server does not.

**By hand:** `bun install`, then `bun run scripts/setup.ts check | library new [--github owner/name] | library clone <owner/name> | autostart on|off | start`, or just `bun run dev`.

**Docs:** `bun run docs` → http://localhost:8000: [vision](docs/vision.md), [roadmap](docs/roadmap.md), feasibility, and per-phase results.

```
app/        Bun server + React client
.claude/    skills, agents, rules Claude Code runs with
scripts/    setup, notation checks, image generation
docs/       design docs
library/    your library repo (not part of this one): content/, notes/, state/
```
