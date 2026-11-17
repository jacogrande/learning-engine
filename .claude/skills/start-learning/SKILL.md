---
name: start-learning
description: Set up a fresh clone of the learning engine — check the tools, create or connect the learning library repo, configure sync, optionally start the app with the computer, and open it.
argument-hint: ""
allowed-tools: "Bash,Read,AskUserQuestion"
disable-model-invocation: true
---

You are setting up the learning engine on this machine, from the engine folder (the current directory). The engine is this repo: the app, skills and rules. The learner's data, the **library** (courses, notes, progress), is a separate git repo kept at `./library`, which the engine's git ignores. The app commits to the library as the learner works and pushes it, so any machine with the library cloned stays in step.

Everything mechanical is in `scripts/setup.ts`; run it, read its output, and explain in plain words. Never print tokens or secrets. Ask everything you need in as few `AskUserQuestion` rounds as possible.

## 1. Check

Run `bun run scripts/setup.ts check` (if `bun` is missing, say so and give the install line `curl -fsSL https://bun.sh/install | bash`, then stop). Read the JSON.

- `tools.claude` missing: impossible here, skip. `tools.git` missing: stop and say to install git.
- `tools.gitIdentity` false: ask for a name and email and set them with `git config --global` before anything commits.
- `dependencies` false: run `bun install`.
- `library.exists && library.repo`: the library is already set up (say where and its remote, or that it has none); skip to step 3.
- `library.exists` but not its own repo: stop and explain; do not move or delete it.

## 2. The library

Ask one question, with these options (first is the default):

1. **New library on GitHub, private** — only if `tools.ghLoggedIn`. Suggest `<tools.ghUser>/learning-library`; let them rename it in Other. Run `bun run scripts/setup.ts library new --github <owner/name>`.
2. **I already have a library** — for a second machine. Ask for its GitHub `owner/name` or URL (if they gave it in Other, use that). Run `bun run scripts/setup.ts library clone <it>`.
3. **Local only, no GitHub** — `bun run scripts/setup.ts library new`. Say that progress then lives only on this computer, and that they can add a remote later.

If `gh` is missing or not logged in and they want GitHub, tell them to run `! gh auth login` themselves, then re-run the check. If a command fails, show its message and offer the next option; never retry blindly or delete anything.

## 3. Start with the computer

If `autostart.supported`, ask: start the app automatically when they log in? Default yes. The app is a small local server at http://localhost:4000 that also grades answers and writes courses in the background, so it is most useful left running.

- Yes: `bun run scripts/setup.ts autostart on` (it starts the app now too).
- No: `bun run scripts/setup.ts start` (runs it now, until the next restart). Mention `bun run scripts/setup.ts autostart on` for later.

If unsupported (Windows), run `bun run scripts/setup.ts start` and say that `bun run dev` in this folder starts it next time.

## 4. Finish

Run the check once more and confirm: library path and remote (or local only), autostart on or off, app running. Then reply in a few lines:

- The app is at http://localhost:4000.
- To learn something: **New course** in the app, or `/start-course <subject>` here. For a quick one-module briefing on a work topic, pick **Brief**.
- Another machine: clone the engine there, open Claude Code in it, run `/start-learning`, and choose "I already have a library".
- After pulling engine updates, restart the app (`systemctl --user restart learning` on Linux, or re-run `bun run scripts/setup.ts start`).
