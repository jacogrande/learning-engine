# Research: Storage layer (files + SQLite + git)

Research date: 2026-10-27. Versions from the npm registry that day. **[uncertain]** marks things not fully confirmed.

## 1. SQLite drivers

| Driver | Version | Status | Notes |
|---|---|---|---|
| `better-sqlite3` | 13.0.3 | stable, mature | synchronous C++ addon; de-facto Node default; not usable under Bun |
| `node:sqlite` | built-in (Node ≥ 22.5) | "Stability 1.2 – Release candidate" in Node 24/26 | no flag needed; has transactions, `loadExtension`, **sessions/changesets**, `backup()`, FTS via extension; Drizzle support only on the 1.0 RC line |
| `bun:sqlite` | built-in | stable | API modelled on better-sqlite3; faster reads |
| `@libsql/client` | 0.18.0 | maintained; Turso focus shifting to Rust rewrite | only if you want Turso embedded replicas |
| `sql.js` / `@sqlite.org/sqlite-wasm` | 1.15.2 / 3.54.1 | maintained | in-memory WASM; wrong fit for a server-side app |

**Pick:** `better-sqlite3` on Node (or `bun:sqlite` on Bun). Both synchronous, which makes the watcher→upsert pipeline trivially transactional. Wrap behind Drizzle so switching to `node:sqlite` later is a one-file change.

Pragmas on open: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`.

## 2. ORM

- **Drizzle ORM** 0.45.4 + drizzle-kit 0.31.11 (1.0 at rc.5). First-class SQLite; `drizzle-kit generate` from a TS schema. SQLite's limited `ALTER TABLE` means many column changes become create/copy/drop/rename migrations — review generated SQL. **Recommended.**
- Prisma 7 requires a driver adapter for SQLite; `latest` tag currently points at an 8.0 RC **[uncertain]**. Skip mid-major-bump.
- Kysely 0.29.7: type-safe SQL builder, hand-written migrations. Fallback if you prefer SQL.

## 3. Files vs DB: how others do it

- **Obsidian**: markdown is the only source of truth; metadata cache is a derived, rebuildable index ([help](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data)).
- **Logseq**: split into "OG" (files are truth) and "DB" (SQLite is truth) with a **Markdown Mirror** projection that embeds each block's stable id in a comment so the mirror survives renames ([May 2026 update](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020)). Their position: git only works with plain-text modes.
- **Dendron**: files are truth; optional SQLite + FTS5 index. **Zettlr/Foam**: files + clearable cache. **Anytype**: the opposite (object store is truth; markdown export is lossy and users complain).

**Committing the `.db` to git**: not recommended (binary, WAL sidecars, no diff/merge). The accepted pattern is a diffable dump: Simon Willison's [`sqlite-diffable`](https://datasette.io/tools/sqlite-diffable) (one `.metadata.json` + one `.ndjson` per table), or `sqlite2dir`/`stfg`.

### Recommended split

1. **Files in git = source of truth for agent/human-authored content** (lessons, research notes, quiz definitions, outline). The agent only ever writes files.
2. **SQLite = source of truth for user state** (notes, highlights, answers, progress, chats, FSRS state). `.gitignore` the `.db*` files.
3. Inside SQLite, two layers: `idx_*` tables that are a **rebuildable index of the files** (a `rebuild-index` command truncates and re-parses), and durable tables that reference the index only by **stable string ids**, never autoincrement row ids.
4. Optional scheduled NDJSON export of user state under `user-state/` for git history. One-way; never auto-import.
5. Record the git commit SHA at every agent run and annotation so old text is recoverable even after the file changes.

## 4. Linking annotations to regenerable content

**Stable ids (primary).** The agent must emit `id: <ULID>` in frontmatter for every document and an explicit id per section/block (`## Title {#sec_01HX…}` or `<!-- block: blk_01HX… -->`). Contract: **preserve existing ids when editing; mint new ones only for new blocks.** The indexer lints every write (duplicate, missing, vanished ids) and surfaces warnings. Content hashes are *version markers*, not identity.

**Anchors (secondary) — W3C Web Annotation selectors scoped to the block**: store `TextPositionSelector` (offsets into the block's plain text), `TextQuoteSelector` (exact + 32-char prefix/suffix), block id and block hash at creation. Re-anchor in Hypothesis order ([fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)):
1. block found, hash unchanged → positions directly
2. block found, hash changed → verify quote at position → exact search in block → fuzzy (prefix/suffix, bitap) → widen to document
3. no match → `orphaned`; keep quote + git SHA so the UI can show "you highlighted this in the previous version"

**"Agent updates the doc with feedback"**: make it append-mostly by convention — add a new `feedback` block with a new id and `responds_to: [blk_…]` instead of rewriting the misunderstood paragraph. Keep every version in `content_versions` (git blob SHA).

## 5. File watching and indexing

- **chokidar 6.0.0** (2026-10-19): rewritten pipeline, confirms every event with stat, Node ≥ 22.22. **v5** is the conservative pick for a few weeks.
- `@parcel/watcher` 2.6.0: native backends, events coalesced in C++, no `awaitWriteFinish`.
- Raw `fs.watch({recursive:true})`: supported on Linux since Node 19.1 but no dedupe or atomic-write handling.

**Claude Code write gotchas (important):** Write/Edit write to `<file>.tmp.<PID>.<hex>` then `rename()` over the target ([issue 60146](https://claudeissues.com/issue/60146-edit-write-tool-leaves-tmp-pid-hex-files-after-atomic-rename), [issue 92419](https://claudeissues.com/issue/92419-bug-edit-write-replace-files-via-rename-new-inode-so-editor-file-watchers-never)):
1. The target gets a **new inode** every write — watch directories, never file handles.
2. Expect an `add` for `.tmp.*` then a rename. Set `atomic: true` and `ignored: /\.tmp\.\d+\.[0-9a-f]+$/`; gitignore stray `.tmp.*`.
3. Partial writes aren't a problem (rename is atomic) but **bursts** are (10–50 files in seconds). Debounce per path (~100–200 ms) and a "run finished" quiet period (~1–2 s) before emitting a UI-level "module updated" event.
4. On startup, reconcile: walk the tree, compare `(mtime, size, hash)` to `index_state`, upsert diffs.

Pipeline: `watch → debounce → read + gray-matter + remark split into blocks → block hashes → one transaction upsert into idx_* → diff block set → re-anchor affected annotations → push one SSE event {doc_id, changed_block_ids}`.

## 6. Spaced repetition

- **`ts-fsrs`** 5.4.2 stable (6.0.0-beta implements FSRS-6). Card: `due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review`. ReviewLog: `rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review`. API: `createEmptyCard`, `fsrs(params).next()`, `forget`, `reschedule(card, reviews)`.
- `fsrs-rs-nodejs` 0.9.1 brings the optimizer (train weights from logs). `fsrs.js` is superseded; `supermemo` 2.0.23 if you want SM-2.
- Store the append-only review log, not just the card.

## 7. Local-first sync (future, brief)

Electric (`@electric-sql/client` 1.5.28, Postgres read-path), PowerSync (`@powersync/node` 1.2.0, bidirectional), cr-sqlite (unmaintained since 2024), Evolu (`@evolu/common` 8.23, own data model), TinyBase 10. Cheapest future path: `node:sqlite` session extension changesets for user-state tables; content sync is just `git pull`.

## 8. Git from Node

- **Shell out** (`execFile('git', [...])`): zero deps, git is guaranteed present. Fine for "stage + commit after each run".
- `simple-git` 4.0.2 (2026-09-26): nicer API, same mechanism; 4.0.x includes a security fix for 3.15.0–4.0.1.
- `@napi-rs/simple-git` (libgit2) and `isomorphic-git`: overkill here.

Pattern: app holds a mutex; after the watcher's quiet period at run end, `git add -A -- content/ && git commit -m "gen(<module_id>): <summary>\n\nRun-Id: <run_id>"`; store the SHA in `agent_runs.commit_sha`. Use a commit trailer, not `git notes`. Guard with `git diff --quiet`.

## Draft SQLite schema

Conventions: string ULID primary keys; ISO-8601 TEXT timestamps; `idx_*` tables fully rebuildable from files. Translate 1:1 to Drizzle `sqliteTable()`.

```sql
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;

-- ===== INDEX LAYER (rebuildable from files; never hand-edited) =====

CREATE TABLE idx_documents (
  doc_id        TEXT PRIMARY KEY,        -- ULID from frontmatter `id`
  kind          TEXT NOT NULL,           -- 'lesson'|'research'|'quiz'|'summary'|'drilldown'|'reading'|'outline'
  course_id     TEXT, module_id TEXT,
  path          TEXT NOT NULL UNIQUE,    -- repo-relative; may change, id does not
  title         TEXT,
  frontmatter   TEXT NOT NULL,           -- JSON
  content_hash  TEXT NOT NULL, git_blob_sha TEXT,
  mtime         TEXT NOT NULL, indexed_at TEXT NOT NULL
);

CREATE TABLE idx_blocks (
  block_id      TEXT PRIMARY KEY,        -- stable id emitted by the agent
  doc_id        TEXT NOT NULL REFERENCES idx_documents(doc_id) ON DELETE CASCADE,
  parent_block_id TEXT, ordinal INTEGER NOT NULL,
  block_type    TEXT NOT NULL,           -- heading|paragraph|code|callout|question|...
  heading_level INTEGER,
  text          TEXT NOT NULL,           -- plain-text projection (selectors measured against this)
  markdown      TEXT NOT NULL,
  content_hash  TEXT NOT NULL, meta TEXT
);
CREATE INDEX idx_blocks_doc ON idx_blocks(doc_id, ordinal);
CREATE VIRTUAL TABLE idx_blocks_fts USING fts5(text, content='idx_blocks', content_rowid='rowid');

-- ===== CURRICULUM =====

CREATE TABLE courses (
  course_id TEXT PRIMARY KEY, title TEXT NOT NULL, manifest_path TEXT, description TEXT,
  depth TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE modules (
  module_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, title TEXT NOT NULL, dir_path TEXT,
  status TEXT NOT NULL DEFAULT 'planned'   -- planned|generating|ready|archived
);

-- ===== AGENT PROVENANCE =====

CREATE TABLE agent_runs (
  run_id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(course_id), module_id TEXT REFERENCES modules(module_id),
  trigger TEXT NOT NULL,            -- generate_module|grade|drilldown|reading|chat|summary|outline|baseline
  trigger_ref TEXT,                 -- id of the message/annotation/attempt that caused it
  prompt TEXT, session_id TEXT,
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running|succeeded|failed|cancelled
  commit_sha TEXT, model TEXT, cost_json TEXT, error TEXT
);
CREATE TABLE agent_responses (
  response_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE run_outputs (
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  doc_id TEXT, path TEXT NOT NULL, change TEXT NOT NULL,   -- added|modified|deleted
  PRIMARY KEY (run_id, path)
);
CREATE TABLE content_versions (
  doc_id TEXT NOT NULL, content_hash TEXT NOT NULL,
  git_blob_sha TEXT, commit_sha TEXT, run_id TEXT, seen_at TEXT NOT NULL,
  PRIMARY KEY (doc_id, content_hash)
);
CREATE TABLE research_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(run_id), module_id TEXT REFERENCES modules(module_id),
  doc_id TEXT, kind TEXT NOT NULL,   -- url|file|note|dataset
  uri TEXT, title TEXT, excerpt TEXT, meta TEXT, created_at TEXT NOT NULL
);

-- ===== QUIZZES =====

CREATE TABLE quizzes (
  quiz_id TEXT PRIMARY KEY, module_id TEXT REFERENCES modules(module_id),
  kind TEXT NOT NULL,   -- baseline|section|module|custom
  title TEXT, created_at TEXT NOT NULL
);
CREATE TABLE quiz_questions (
  question_id TEXT PRIMARY KEY,     -- = block_id
  quiz_id TEXT NOT NULL REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, qtype TEXT NOT NULL,   -- mcq|short|cloze|predict
  prompt_md TEXT NOT NULL, options_json TEXT, answer_json TEXT, rubric_md TEXT,
  objective_id TEXT, bloom_level TEXT,
  content_hash TEXT NOT NULL, source_block_ids TEXT
);
CREATE TABLE quiz_attempts (
  attempt_id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(quiz_id),
  started_at TEXT NOT NULL, submitted_at TEXT,
  score REAL, max_score REAL, grader_run_id TEXT REFERENCES agent_runs(run_id)
);
CREATE TABLE quiz_answers (
  answer_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES quiz_questions(question_id),
  question_hash TEXT NOT NULL, response_json TEXT NOT NULL,
  confidence INTEGER,               -- 1..3, captured before feedback
  is_correct INTEGER, score REAL,
  feedback_md TEXT, feedback_run_id TEXT REFERENCES agent_runs(run_id),
  answered_at TEXT NOT NULL
);

-- ===== USER STATE =====

CREATE TABLE notes (
  note_id TEXT PRIMARY KEY, doc_id TEXT, block_id TEXT,
  module_id TEXT REFERENCES modules(module_id),
  body_md TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE annotations (
  annotation_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL, block_id TEXT NOT NULL,
  block_hash_at_creation TEXT NOT NULL, doc_hash_at_creation TEXT NOT NULL, commit_sha_at_creation TEXT,
  pos_start INTEGER NOT NULL, pos_end INTEGER NOT NULL,
  quote_exact TEXT NOT NULL, quote_prefix TEXT, quote_suffix TEXT,
  color TEXT, body_md TEXT,
  anchor_status TEXT NOT NULL DEFAULT 'exact',  -- exact|repositioned|fuzzy|orphaned
  anchor_updated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX annotations_block ON annotations(block_id);
CREATE TABLE chats (
  chat_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,   -- course|module|doc|block|annotation|quiz_attempt|module_summary
  scope_id TEXT NOT NULL, session_id TEXT,   -- Claude Code session for --resume
  title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  message_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, role TEXT NOT NULL, content_md TEXT NOT NULL,
  run_id TEXT REFERENCES agent_runs(run_id), context_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE drill_downs (
  drilldown_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,   -- drilldown|reading
  source_doc_id TEXT NOT NULL, source_block_id TEXT, annotation_id TEXT REFERENCES annotations(annotation_id),
  question_md TEXT NOT NULL, run_id TEXT REFERENCES agent_runs(run_id),
  result_doc_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE module_progress (
  module_id TEXT PRIMARY KEY REFERENCES modules(module_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  last_doc_id TEXT, last_block_id TEXT, scroll_pct REAL,
  started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE doc_reads (
  doc_id TEXT PRIMARY KEY, content_hash TEXT NOT NULL,
  first_opened_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, read_pct REAL NOT NULL DEFAULT 0
);
CREATE TABLE module_understanding (
  summary_id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(run_id), version INTEGER NOT NULL,
  summary_md TEXT NOT NULL, strengths_json TEXT, gaps_json TEXT, evidence_json TEXT,
  doc_id TEXT, created_at TEXT NOT NULL,
  UNIQUE (module_id, version)
);

-- ===== SPACED REPETITION (ts-fsrs shape) =====

CREATE TABLE review_cards (
  card_id TEXT PRIMARY KEY, question_id TEXT REFERENCES quiz_questions(question_id), block_id TEXT,
  due TEXT NOT NULL, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0, scheduled_days INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0, last_review TEXT,
  suspended INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX review_cards_due ON review_cards(due) WHERE suspended = 0;
CREATE TABLE review_logs (
  log_id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES review_cards(card_id) ON DELETE CASCADE,
  rating INTEGER NOT NULL, state INTEGER NOT NULL, due TEXT NOT NULL,
  stability REAL NOT NULL, difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL, review TEXT NOT NULL
);

-- ===== OPS =====
CREATE TABLE index_state (path TEXT PRIMARY KEY, mtime TEXT, size INTEGER, content_hash TEXT);
CREATE TABLE index_warnings (id INTEGER PRIMARY KEY, path TEXT, code TEXT, detail TEXT, created_at TEXT);
```

Notes: user-state tables reference `doc_id`/`block_id` as plain strings (no FK into `idx_*`) on purpose — the index may be rebuilt, and a deleted block must not cascade-delete user data. `content_versions` is durable so "what did this block say when I highlighted it" is answerable via `git show <blob_sha>`.

## Open uncertainties

1. Drizzle 1.0 timing; `node:sqlite` support is RC-only.
2. Prisma's `latest` resolving to an 8.0 RC.
3. chokidar 6 is a week old; v5 is conservative.
4. Apache Annotator maintenance; Dendron project status.
5. Whether Claude Code's `.tmp.<PID>.<hex>` naming is stable across versions — treat the ignore pattern as defensive and always do the startup reconcile.

## Sources

[node:sqlite](https://nodejs.org/api/sqlite.html) · [bun:sqlite](https://bun.com/docs/runtime/sqlite.md) · [Drizzle SQLite](https://orm.drizzle.team/docs/get-started-sqlite) · [Prisma 7](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) · [Obsidian storage](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data) · [Logseq DB update](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020) · [Dendron SQLite](https://wiki.dendron.so/notes/r6e3yl55oa3bpvyhjq3wkt2) · [sqlite-diffable](https://datasette.io/tools/sqlite-diffable) · [W3C Web Annotation](https://www.w3.org/TR/annotation-model/) · [Hypothesis fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/) · [chokidar changelog](https://github.com/paulmillr/chokidar/blob/main/CHANGELOG.md) · [@parcel/watcher](https://github.com/parcel-bundler/watcher) · [Claude Code atomic write issue](https://claudeissues.com/issue/92419-bug-edit-write-replace-files-via-rename-new-inode-so-editor-file-watchers-never) · [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) · [simple-git](https://npmjs.com/package/simple-git)
