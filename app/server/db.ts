// User state lives here (SQLite). Content Claude writes lives in files.
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ROOT } from "./content";

export const db = new Database(join(ROOT, "data/app.db"), { create: true });
db.run("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
db.run(`
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, quiz TEXT NOT NULL,
    answers TEXT NOT NULL, grade TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    course TEXT NOT NULL, quiz TEXT NOT NULL, answers TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (course, quiz)
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT,
    status TEXT NOT NULL, started_at TEXT, finished_at TEXT, session_id TEXT, result TEXT, error TEXT
  );
  -- one row per in-lesson question; short answers are graded by a job
  CREATE TABLE IF NOT EXISTS answers (
    course TEXT NOT NULL, question TEXT NOT NULL, doc TEXT NOT NULL,
    answer TEXT NOT NULL, result TEXT, note TEXT, job TEXT, confidence INTEGER,
    updated_at TEXT NOT NULL, graded_at TEXT,
    PRIMARY KEY (course, question)
  );
  -- highlights: W3C-style quote selectors re-anchored on render
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, doc TEXT NOT NULL,
    quote TEXT NOT NULL, prefix TEXT, suffix TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, course TEXT NOT NULL, doc TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'section', module TEXT,
    context TEXT, title TEXT, session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  -- per-module progress: sections read, the learner's summary, wrap-up chat, completion
  CREATE TABLE IF NOT EXISTS progress (
    course TEXT NOT NULL, module TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (course, module)
  );
  -- spaced-repetition cards (ts-fsrs), one per question ever answered
  CREATE TABLE IF NOT EXISTS cards (
    course TEXT NOT NULL, question TEXT NOT NULL, doc TEXT NOT NULL, module TEXT,
    due TEXT NOT NULL, card TEXT NOT NULL, streak INTEGER NOT NULL DEFAULT 0, log TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course, question)
  );
  -- one row per review session (daily, course, module, …); drives the streak and the summary
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- vocabulary: words collected while reading; entry is the generated explanation and examples,
  -- contexts every sentence the word was captured from, train_log the Train view's attempts
  CREATE TABLE IF NOT EXISTS vocab (
    id TEXT PRIMARY KEY, word TEXT NOT NULL, contexts TEXT NOT NULL DEFAULT '[]', course_term TEXT,
    entry TEXT, status TEXT NOT NULL DEFAULT 'pending', stage INTEGER NOT NULL DEFAULT 0,
    train_log TEXT NOT NULL DEFAULT '[]', trained_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_sessions (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT, started_at TEXT NOT NULL, ended_at TEXT,
    reviewed INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, sure_wrong INTEGER NOT NULL DEFAULT 0
  );
`);
// Columns added after the first release.
for (const [table, col, type] of [["answers", "confidence", "INTEGER"], ["chats", "kind", "TEXT NOT NULL DEFAULT 'section'"], ["chats", "module", "TEXT"],
                                  ["cards", "state", "TEXT NOT NULL DEFAULT 'new'"], ["cards", "suspended", "INTEGER NOT NULL DEFAULT 0"], ["cards", "flag", "TEXT"],
                                  ["cards", "variants", "TEXT NOT NULL DEFAULT '[]'"], ["cards", "last_variant", "INTEGER NOT NULL DEFAULT -1"],
                                  ["cards", "leech_base", "TEXT"], ["answers", "history", "TEXT NOT NULL DEFAULT '[]'"]])
  if (!(db.query(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === col)) db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);

export const id = () => crypto.randomUUID().slice(0, 8);
export const now = () => new Date().toISOString();
