# Multi-device: the repo is the sync layer

Decision note, 2026-10-28.

## The constraint that decides it

Everything that costs anything — generating modules, grading, chat — runs through the local `claude` CLI on the user's subscription. A device that can't run Claude Code can't use the app, so every device that matters is a laptop with git installed. That makes a cloud database redundant: the repo already reaches every device that can act on it.

## What syncs today, and what doesn't

| Data | Storage | Syncs via git? |
|---|---|---|
| Lessons, drill-downs, readings, outlines, research | `content/` | Yes — auto-committed per job |
| Notes | `data/notes/*.md` | Yes |
| Answers, highlights, chats, baseline attempts, job history | `data/app.db` (SQLite) | **No** |

## Design

1. **Two repos.** The app repo is public and forkable (code, skills, rules, docs). The *library* repo is private and holds `content/`, `data/notes/`, `data/state/`. The app finds it through `LEARNING_DIR` (default `./library`). Updating the app never touches a course; sharing a course is sharing a repo.
2. **Files are the source of truth for user state; SQLite is an index.** Each write goes to the DB and to one small JSON file:
   ```
   data/state/answers/<course>/<question>.json
   data/state/annotations/<id>.json
   data/state/chats/<id>.json          # chat + messages
   data/state/attempts/<course>/<id>.json
   ```
   `app.db` is gitignored and rebuilt from these on start (`pnpm reindex` equivalent). One file per record keeps merges rare; when both devices touch the same record, the rebuild keeps the newer `updated_at`.
3. **Git is automated.** `git pull --rebase` on start; `git push` after every job commit; state files committed after a minute of quiet and on shutdown. The user supplies credentials by having cloned the repo.
4. **Chat sessions are per machine.** `--resume` uses `~/.claude`, which does not sync. If resume fails, start a new session whose first prompt replays the stored transcript. Messages live in the library; only the session handle is local.

## Status

Built and verified 2026-10-29 — see [phase-4-results.md](phase-4-results.md). The library lives at `github.com/jacogrande/learning-library` (private).

## Rejected

- **Cloud SQL (Turso, Neon, Supabase):** adds an account, a network dependency, and a second source of truth for marginal gain. Turso embedded replicas are the closest fit but swap `bun:sqlite` for libsql.
- **Firebase / Firestore:** document SDK, auth, nothing to do with files; wrong shape.
- **Cloudflare D1 + R2:** only relevant to a hosted version, and the part that matters can't be hosted.

## Later, if wanted

A read-only static build of a library (GitHub Pages) would let a phone read lessons and notes. Generation would still happen on a laptop.
