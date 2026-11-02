// User state is files-first: one JSON per answer, highlight, chat, attempt, progress record and
// review card under library/state/, which git syncs between machines. SQLite is an index rebuilt
// from those files on boot and after every pull. Drafts, jobs and chat session handles stay local.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { db } from "./db";
import { STATE_DIR } from "./content";
import { touch } from "./sync";

const file = (...p: string[]) => join(STATE_DIR, ...p) + ".json";

function save(path: string, obj: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
  touch();
}
function remove(path: string) { rmSync(path, { force: true }); touch(); }

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".json")) yield p;
  }
}
const load = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

// --- writers: called by the API after each DB write -----------------------
export const state = {
  answer: (course: string, question: string) => {
    const r = db.query("SELECT course, question, doc, answer, result, note, confidence, history, updated_at updatedAt, graded_at gradedAt FROM answers WHERE course=? AND question=?").get(course, question) as any;
    if (r) save(file("answers", course, question), { ...r, history: JSON.parse(r.history ?? "[]") });
  },
  annotation: (id: string) => {
    const r = db.query("SELECT id, course, doc, quote, prefix, suffix, created_at createdAt FROM annotations WHERE id=?").get(id);
    if (r) save(file("annotations", id), r);
  },
  annotationDeleted: (id: string) => remove(file("annotations", id)),
  chat: (id: string) => {
    const c = db.query("SELECT id, course, doc, kind, module, context, title, created_at createdAt, updated_at updatedAt FROM chats WHERE id=?").get(id) as any;
    if (!c) return;
    c.messages = db.query("SELECT id, role, content, created_at createdAt FROM messages WHERE chat=? ORDER BY created_at").all(id);
    save(file("chats", id), c);
  },
  chatDeleted: (id: string) => remove(file("chats", id)),
  attempt: (id: string) => {
    const r = db.query("SELECT id, course, quiz, answers, grade, created_at createdAt FROM attempts WHERE id=?").get(id) as any;
    if (r) save(file("attempts", r.course, id), { ...r, answers: JSON.parse(r.answers), grade: r.grade ? JSON.parse(r.grade) : null });
  },
  progress: (course: string, module: string) => {
    const r = db.query("SELECT course, module, data, updated_at updatedAt FROM progress WHERE course=? AND module=?").get(course, module) as any;
    if (r) save(file("progress", course, module), { ...r, data: JSON.parse(r.data) });
  },
  card: (course: string, question: string) => {
    const r = db.query("SELECT course, question, doc, module, due, card, streak, log, state, suspended, flag, variants, last_variant lastVariant, leech_base leechBase, updated_at updatedAt FROM cards WHERE course=? AND question=?").get(course, question) as any;
    if (r) save(file("cards", course, question), { ...r, card: JSON.parse(r.card), log: JSON.parse(r.log), variants: JSON.parse(r.variants), suspended: !!r.suspended, leechBase: r.leechBase ? JSON.parse(r.leechBase) : null });
  },
  cardDeleted: (course: string, question: string) => remove(file("cards", course, question)),
  vocab: (id: string) => {
    const r = db.query("SELECT id, word, contexts, course_term courseTerm, entry, status, stage, train_log trainLog, trained_at trainedAt, created_at createdAt, updated_at updatedAt FROM vocab WHERE id=?").get(id) as any;
    if (r) save(file("vocab", id), { ...r, contexts: JSON.parse(r.contexts), entry: r.entry ? JSON.parse(r.entry) : null, trainLog: JSON.parse(r.trainLog) });
  },
  vocabDeleted: (id: string) => remove(file("vocab", id)),
  settings: () => save(file("settings"), Object.fromEntries((db.query("SELECT key, value FROM settings").all() as any[]).map((r) => [r.key, JSON.parse(r.value)]))),
  session: (id: string) => {
    const r = db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE id=?").get(id);
    if (r) save(file("sessions", id), r);
  },
};

// --- rebuild: files → SQLite ----------------------------------------------
export function rebuild() {
  const run = db.transaction(() => {
    for (const t of ["answers", "annotations", "attempts", "progress", "cards", "review_sessions", "settings", "vocab"]) db.run(`DELETE FROM ${t}`);
    const settings = load(file("settings"));
    if (settings) for (const [k, v] of Object.entries(settings)) db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", [k, JSON.stringify(v)]);
    for (const p of walk(join(STATE_DIR, "answers"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO answers (course, question, doc, answer, result, note, job, confidence, history, updated_at, graded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.course, r.question, r.doc, r.answer, r.result ?? null, r.note ?? null, null, r.confidence ?? null, JSON.stringify(r.history ?? []), r.updatedAt, r.gradedAt ?? null]);
    }
    for (const p of walk(join(STATE_DIR, "annotations"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO annotations (id, course, doc, quote, prefix, suffix, created_at) VALUES (?,?,?,?,?,?,?)", [r.id, r.course, r.doc, r.quote, r.prefix ?? "", r.suffix ?? "", r.createdAt]);
    }
    for (const p of walk(join(STATE_DIR, "attempts"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO attempts (id, course, quiz, answers, grade, created_at) VALUES (?,?,?,?,?,?)", [r.id, r.course, r.quiz, JSON.stringify(r.answers), r.grade ? JSON.stringify(r.grade) : null, r.createdAt]);
    }
    for (const p of walk(join(STATE_DIR, "progress"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO progress (course, module, data, updated_at) VALUES (?,?,?,?)", [r.course, r.module, JSON.stringify(r.data), r.updatedAt]);
    }
    for (const p of walk(join(STATE_DIR, "cards"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, flag, variants, last_variant, leech_base, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [r.course, r.question, r.doc, r.module ?? null, r.due, JSON.stringify(r.card), r.streak ?? 0, JSON.stringify(r.log ?? []), r.state ?? "new", r.suspended ? 1 : 0, r.flag ?? null, JSON.stringify(r.variants ?? []), r.lastVariant ?? -1, r.leechBase ? JSON.stringify(r.leechBase) : null, r.updatedAt]);
    }
    for (const p of walk(join(STATE_DIR, "vocab"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO vocab (id, word, contexts, course_term, entry, status, stage, train_log, trained_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [r.id, r.word, JSON.stringify(r.contexts ?? []), r.courseTerm ?? null, r.entry ? JSON.stringify(r.entry) : null, r.status ?? "pending", r.stage ?? 0, JSON.stringify(r.trainLog ?? []), r.trainedAt ?? null, r.createdAt, r.updatedAt ?? r.createdAt]);
    }
    for (const p of walk(join(STATE_DIR, "sessions"))) {
      const r = load(p); if (!r) continue;
      db.run("INSERT OR REPLACE INTO review_sessions (id, kind, scope, started_at, ended_at, reviewed, correct, sure_wrong) VALUES (?,?,?,?,?,?,?,?)",
        [r.id, r.kind, r.scope ?? null, r.startedAt, r.endedAt ?? null, r.reviewed ?? 0, r.correct ?? 0, r.sureWrong ?? 0]);
    }
    // Chats are upserted, not truncated: session_id is a local handle the file does not carry. A chat
    // whose file is gone was deleted (here or on another machine).
    const chats = new Set<string>();
    for (const p of walk(join(STATE_DIR, "chats"))) {
      const c = load(p); if (!c) continue;
      chats.add(c.id);
      db.run(`INSERT INTO chats (id, course, doc, kind, module, context, title, session_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,NULL,?,?)
              ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, module=excluded.module, context=excluded.context, title=excluded.title, updated_at=excluded.updated_at`,
        [c.id, c.course, c.doc, c.kind ?? "section", c.module ?? null, c.context ?? null, c.title ?? null, c.createdAt, c.updatedAt ?? c.createdAt]);
      for (const m of c.messages ?? [])
        db.run("INSERT OR IGNORE INTO messages (id, chat, role, content, created_at) VALUES (?,?,?,?,?)", [m.id, c.id, m.role, m.content, m.createdAt]);
    }
    for (const r of db.query("SELECT id FROM chats").all() as any[]) if (!chats.has(r.id)) db.run("DELETE FROM chats WHERE id=?", [r.id]);
  });
  run();
}

// --- one-time migration: rows that predate state files --------------------
export function migrate() {
  const marker = join(STATE_DIR, ".migrated");
  if (existsSync(marker)) return;
  for (const r of db.query("SELECT course, question FROM answers").all() as any[]) state.answer(r.course, r.question);
  for (const r of db.query("SELECT id FROM annotations").all() as any[]) state.annotation(r.id);
  for (const r of db.query("SELECT id FROM chats").all() as any[]) state.chat(r.id);
  for (const r of db.query("SELECT id FROM attempts").all() as any[]) state.attempt(r.id);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(marker, new Date().toISOString() + "\n");
}
