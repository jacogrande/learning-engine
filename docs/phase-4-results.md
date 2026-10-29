# Phase 4 — Sync across devices

Date: 2026-10-29. Goal from [roadmap.md](roadmap.md): answer a quiz on one machine, open the app on another, and the answer, note, and chat are there — with nothing running anywhere but the two laptops.

## Verdict: done

Tested with two app instances, each with its own clone of the library, syncing through `github.com/jacogrande/learning-library` (private):

| Step | Result |
|---|---|
| First boot after the split | Existing SQLite rows (1 highlight, 1 baseline attempt, 1 chat) exported to `library/state/*.json` once, then committed and pushed |
| Second machine | Cloned the library, booted, saw the course, the notes, and the graded baseline |
| A: answer on machine 1 → sync | Machine 2 pulled and showed the answer |
| B: highlight on machine 2 → sync | Pushed |
| C: machine 1 edits notes while behind the remote | Push rejected → pulled with rebase → pushed; machine 1 immediately showed machine 2's highlight (rebuild after pull) |
| D: machine 2 pulls | Saw the note edit |
| Top bar | "synced just now" · click to sync now · shows "sync error" with the git message on failure |

## What changed

```
library/                     the user's data, its own git repo (LEARNING_DIR to relocate)
  content/courses/           was ./content
  notes/                     was ./data/notes
  state/{answers,annotations,chats,attempts}/*.json   new: one file per record

app/server/state.ts          write a record's file after each DB write; rebuild SQLite from files
app/server/sync.ts           pull on start, commit+push, debounce, status over SSE
app/server/jobs.ts           job commits go to the library; shutdown flushes pending state
app/server.ts                state writes on every mutation; /api/sync; chat resume fallback
.claude/, CLAUDE.md          paths now library/content/courses/…
```

`data/app.db`, `data/jobs/` and quiz drafts stay local: they are caches or per-machine handles.

## How it behaves

- **Start:** `git pull --rebase --autostash`, then rebuild SQLite from `state/`. A conflict aborts the rebase and shows "sync error" in the top bar; resolve it in `library/` like any repo.
- **After a generation job:** commit + push immediately.
- **After you act:** the record's file is written at once; a commit + push follows after 60 s of quiet, on the next generation, on click, or on shutdown (bounded to 8 s).
- **Chat on a machine without the session:** `--resume` fails, the server clears the handle and starts a fresh session with the stored transcript replayed in the first prompt.

## Setting up another machine

```
git clone <app repo> learning && cd learning && bun install
git clone git@github.com:jacogrande/learning-library.git library
bun run dev
```

Or clone the library anywhere and set `LEARNING_DIR=/path/to/library`.

## Known limits

- Same record edited on both machines before either syncs → a git conflict on that one JSON file, surfaced as a sync error. Rare for one person; resolve by keeping the newer file.
- Quiz drafts (unsent baseline answers) are local-only by design.
- `kill -9` skips the shutdown flush; the next start or click commits what was pending.
