# Multi-device: the repo is the sync layer

Decision note, 2026-10-28.

## The constraint that decides it

Everything that costs anything — generating modules, grading, chat — runs through the local `claude` CLI on the user's subscription. A device that can't run Claude Code can't use the app, so every device that matters is a laptop with git installed. That makes a cloud database redundant: the repo already reaches every device that can act on it.

## What syncs today, and what doesn't

| Data | Storage | Syncs via git? |
|---|---|---|
| Lessons, drill-downs, readings, outlines, research | `content/` | Yes — auto-committed per job |
| Notes | `library/notes/*.md` | Yes |
| Answers, highlights, chats, baseline attempts, job history | `data/app.db` (SQLite) | **No** |

## Design

1. **One repo.** The app and the user's data live together; data sits under `library/` (`content/`, `notes/`, `state/`). Sync only ever stages the library path, so code you are editing is never swept into a state commit. `LEARNING_DIR` can point the library elsewhere (sync then runs in whichever repo contains it).
2. **Files are the source of truth for user state; SQLite is an index.** Each write goes to the DB and to one small JSON file:
   ```
   library/state/answers/<course>/<question>.json
   library/state/annotations/<id>.json
   library/state/chats/<id>.json          # chat + messages
   library/state/attempts/<course>/<id>.json
   ```
   `data/app.db` is gitignored and rebuilt from these on start. One file per record keeps merges rare; when both devices touch the same record, the rebuild keeps the newer `updated_at`.
3. **Git is automated.** `git pull --rebase` on start; `git push` after every job commit; state files committed after a minute of quiet and on shutdown. The user supplies credentials by having cloned the repo.
4. **Chat sessions are per machine.** `--resume` uses `~/.claude`, which does not sync. If resume fails, start a new session whose first prompt replays the stored transcript. Messages live in the library; only the session handle is local.

## Status

Built and verified 2026-10-29 — see [phase-4-results.md](phase-4-results.md). Since 2026-11-17 the engine (`github.com/jacogrande/learning-engine`, public) and each learner's library (their own repo, private) are separate again, so the engine can be shared without anyone's data. The library is cloned at `library/` inside the engine and ignored by it; `/start-learning` sets this up on each machine. Sync runs in the library repo, so it no longer needs path-limiting, though it still stages only the library path.

## Rejected

- **Cloud SQL (Turso, Neon, Supabase):** adds an account, a network dependency, and a second source of truth for marginal gain. Turso embedded replicas are the closest fit but swap `bun:sqlite` for libsql.
- **Firebase / Firestore:** document SDK, auth, nothing to do with files; wrong shape.
- **Cloudflare D1 + R2:** only relevant to a hosted version, and the part that matters can't be hosted.

## Later, if wanted

A read-only static build of a library (GitHub Pages) would let a phone read lessons and notes. Generation would still happen on a laptop.
