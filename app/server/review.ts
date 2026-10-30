// Spaced review. Every question answered in a lesson becomes an FSRS card; the daily queue serves
// what is due across every course. "Learned" means three spaced correct recalls in the Review state.
// Baseline questions never become cards: they are diagnostic, not taught.
import { fsrs, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";
import YAML from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, id, now } from "./db";
import { COURSES_DIR, getDoc, listCourses } from "./content";
import { state } from "./state";
import { touch } from "./sync";

const scheduler = fsrs({ request_retention: 0.9 });
const LEECH_LAPSES = 6;

export type Result = "correct" | "partial" | "wrong" | "skipped";
export type CardState = "new" | "learning" | "review" | "learned" | "suspended" | "orphaned";

// Result + confidence → FSRS rating. A confident correct answer earns Easy; a guess only Good.
export function rating(result: Result, confidence?: number | null): Grade {
  if (result === "correct") return confidence === 3 ? Rating.Easy : Rating.Good;
  if (result === "partial") return Rating.Hard;
  return Rating.Again;
}

const revive = (c: any): Card => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });

function stateOf(card: Card, streak: number, reviews: number, suspended: boolean): CardState {
  if (suspended) return "suspended";
  if (reviews <= 1) return "new";
  if (card.state === State.Review) return streak >= 3 ? "learned" : "review";
  return "learning";
}

export function rate(course: string, question: string, doc: string, result: Result, confidence?: number | null) {
  if (doc.startsWith("quizzes/")) return null;   // baseline: no card
  const row = db.query("SELECT card, streak, log, suspended FROM cards WHERE course=? AND question=?").get(course, question) as any;
  const prev: Card = row ? revive(JSON.parse(row.card)) : createEmptyCard(new Date());
  const r = rating(result, confidence);
  const { card, log } = scheduler.next(prev, new Date(), r);
  const streak = r === Rating.Again ? 0 : (row?.streak ?? 0) + 1;
  const logs = [...(row ? JSON.parse(row.log) : []), { ...log, result, confidence: confidence ?? null }];
  const module = /^modules\/([^/]+)\//.exec(doc)?.[1] ?? null;
  let suspended = !!row?.suspended;
  let leech = false;
  // A leech: six lapses after learning, or six Again ratings in a row at any stage.
  const recentAgain = logs.slice(-LEECH_LAPSES).length === LEECH_LAPSES && logs.slice(-LEECH_LAPSES).every((l: any) => l.rating === Rating.Again);
  if (!suspended && (card.lapses >= LEECH_LAPSES || recentAgain)) { suspended = true; leech = true; }
  const st = stateOf(card, streak, logs.length, suspended);
  db.run(`INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, module=excluded.module, due=excluded.due, card=excluded.card, streak=excluded.streak, log=excluded.log, state=excluded.state, suspended=excluded.suspended, updated_at=excluded.updated_at`,
    [course, question, doc, module, card.due.toISOString(), JSON.stringify(card), streak, JSON.stringify(logs), st, suspended ? 1 : 0, now()]);
  state.card(course, question);
  if (leech) recordLeech(course, question, doc);
  return { due: card.due.toISOString(), streak, state: st, leech };
}

// A leech goes into the learner profile so the next module generation picks it up as a carry item.
function recordLeech(course: string, question: string, doc: string) {
  const path = join(COURSES_DIR, course, "learner.md");
  let src = ""; try { src = readFileSync(path, "utf8"); } catch { return; }
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return;
  let fm: any; try { fm = YAML.parse(m[1]) ?? {}; } catch { return; }
  fm.errors = Array.isArray(fm.errors) ? fm.errors : [];
  if (fm.errors.some((e: any) => e?.seen?.includes(question))) return;
  fm.errors.push({ pattern: `Leech: ${question} in ${doc} keeps lapsing in review`, seen: [question] });
  writeFileSync(path, `---\n${YAML.stringify(fm, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }).trimEnd()}\n---\n${m[2]}`);
  touch();
}

export function setSuspended(course: string, question: string, suspended: boolean) {
  const row = db.query("SELECT card, streak, log FROM cards WHERE course=? AND question=?").get(course, question) as any;
  if (!row) return;
  const st = stateOf(revive(JSON.parse(row.card)), row.streak, JSON.parse(row.log).length, suspended);
  db.run("UPDATE cards SET suspended=?, state=?, updated_at=? WHERE course=? AND question=?", [suspended ? 1 : 0, st, now(), course, question]);
  state.card(course, question);
}

export function setFlag(course: string, question: string, flag: string | null) {
  db.run("UPDATE cards SET flag=?, updated_at=? WHERE course=? AND question=?", [flag, now(), course, question]);
  state.card(course, question);
}
export const flagOf = (course: string, question: string) => (db.query("SELECT flag FROM cards WHERE course=? AND question=?").get(course, question) as any)?.flag ?? null;

// Pull a quiz block out of a doc by id.
export async function question(course: string, doc: string, qid: string) {
  const d = await getDoc(course, doc);
  if (!d) return null;
  for (const m of d.body.matchAll(/```quiz\n([\s\S]*?)```/g)) {
    try { const q = YAML.parse(m[1]); if (q?.id === qid) return q; } catch {}
  }
  return null;
}

type Row = { course: string; question: string; doc: string; module: string | null; due: string; streak: number; state: CardState; log: string; card: string };
export type QueueItem = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; due: string; streak: number; state: CardState; reviews: number; sureWrong: boolean; spec: any };

async function resolve(rows: Row[]): Promise<QueueItem[]> {
  const courses = Object.fromEntries((await listCourses()).map((c) => [c.slug, c]));
  const items: QueueItem[] = [];
  for (const r of rows) {
    const spec = await question(r.course, r.doc, r.question);
    if (!spec) { db.run("UPDATE cards SET state='orphaned' WHERE course=? AND question=?", [r.course, r.question]); continue; }
    if (r.state === "orphaned") db.run("UPDATE cards SET state=? WHERE course=? AND question=?", [stateOf(revive(JSON.parse(r.card)), r.streak, JSON.parse(r.log).length, false), r.course, r.question]);
    const c = courses[r.course], m = c?.modules.find((x) => x.id === r.module);
    const file = r.doc.split("/").slice(2).join("/");
    const last = JSON.parse(r.log).at(-1);
    items.push({
      course: r.course, courseTitle: c?.title ?? r.course, question: r.question, doc: r.doc, module: r.module,
      moduleTitle: m?.title ?? r.module ?? "", sectionTitle: file === "quiz.md" ? "Module test" : (m?.sections.find((s) => s.file === file)?.title ?? m?.extras.find((e) => e.file === file)?.title ?? file),
      due: r.due, streak: r.streak, state: r.state, reviews: JSON.parse(r.log).length, sureWrong: last?.result === "wrong" && last?.confidence === 3, spec,
    });
  }
  return items;
}

// Round-robin across modules so two cards from one module never run back to back when avoidable.
function interleave(items: QueueItem[]): QueueItem[] {
  const buckets = new Map<string, QueueItem[]>();
  for (const it of items) { const k = `${it.course}/${it.module}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(it); }
  const out: QueueItem[] = [];
  const lists = [...buckets.values()];
  while (lists.some((l) => l.length)) for (const l of lists) if (l.length) out.push(l.shift()!);
  return out;
}

// The daily queue: due cards (sure-and-wrong first), interleaved, capped; topped up with the
// oldest never-reviewed cards when fewer than 8 are due. `exclude` supports "+10 more".
export async function queue(opts: { course?: string; cap?: number; exclude?: string[] } = {}) {
  const cap = opts.cap ?? 20;
  const where = `suspended=0 AND state<>'orphaned'${opts.course ? " AND course=?" : ""}`;
  const args = opts.course ? [opts.course] : [];
  const dueRows = db.query(`SELECT * FROM cards WHERE ${where} AND due<=? ORDER BY due`).all(...args, now()) as Row[];
  const excl = new Set(opts.exclude ?? []);
  const key = (r: Row) => `${r.course}:${r.question}`;
  let due = await resolve(dueRows.filter((r) => !excl.has(key(r))));
  due = [...due.filter((i) => i.sureWrong), ...due.filter((i) => !i.sureWrong)];
  let items = interleave(due).slice(0, cap);
  let topped = 0;
  if (items.length < 8 && !opts.exclude?.length) {
    const fresh = db.query(`SELECT * FROM cards WHERE ${where} AND state='new' AND due>? ORDER BY updated_at LIMIT ?`).all(...args, now(), 8 - items.length) as Row[];
    const extra = await resolve(fresh.filter((r) => !items.some((i) => i.course === r.course && i.question === r.question)));
    topped = extra.length;
    items = [...items, ...extra];
  }
  const totalDue = (db.query(`SELECT count(*) n FROM cards WHERE ${where} AND due<=?`).get(...args, now()) as any).n;
  const next = (db.query(`SELECT min(due) d FROM cards WHERE ${where} AND due>?`).get(...args, now()) as any).d;
  return { items, dueCount: totalDue, remaining: Math.max(0, totalDue - excl.size - items.filter((i) => +new Date(i.due) <= Date.now()).length), topped, next };
}

// Counts for the courses page and the review page header.
export function summary(course?: string) {
  const where = `suspended=0 AND state<>'orphaned'${course ? " AND course=?" : ""}`;
  const args = course ? [course] : [];
  const by = (sql: string) => (db.query(sql).get(...args) as any).n;
  return {
    dueCount: by(`SELECT count(*) n FROM cards WHERE ${where} AND due<='${now()}'`),
    total: by(`SELECT count(*) n FROM cards WHERE ${where}`),
    learned: by(`SELECT count(*) n FROM cards WHERE ${where} AND state='learned'`),
    suspended: by(`SELECT count(*) n FROM cards WHERE suspended=1${course ? " AND course=?" : ""}`),
    streak: streak(),
    next: (db.query(`SELECT min(due) d FROM cards WHERE ${where} AND due>'${now()}'`).get(...args) as any).d,
  };
}

// Consecutive days (ending today or yesterday) with at least one review.
function streak(): number {
  const days = new Set((db.query("SELECT substr(started_at, 1, 10) d FROM review_sessions WHERE reviewed > 0").all() as any[]).map((r) => r.d));
  let n = 0; const d = new Date();
  const key = (x: Date) => x.toISOString().slice(0, 10);
  if (!days.has(key(d))) d.setDate(d.getDate() - 1);
  while (days.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function startSession(kind: string, scope: string | null) {
  const s = { id: id(), kind, scope, startedAt: now(), endedAt: null as string | null, reviewed: 0, correct: 0, sureWrong: 0 };
  db.run("INSERT INTO review_sessions (id, kind, scope, started_at, reviewed, correct, sure_wrong) VALUES (?,?,?,?,0,0,0)", [s.id, kind, scope, s.startedAt]);
  state.session(s.id);
  return s;
}
export function updateSession(sid: string, patch: { reviewed?: number; correct?: number; sureWrong?: number; end?: boolean }) {
  const r = db.query("SELECT * FROM review_sessions WHERE id=?").get(sid) as any;
  if (!r) return null;
  db.run("UPDATE review_sessions SET reviewed=?, correct=?, sure_wrong=?, ended_at=? WHERE id=?",
    [patch.reviewed ?? r.reviewed, patch.correct ?? r.correct, patch.sureWrong ?? r.sure_wrong, patch.end ? now() : r.ended_at, sid]);
  state.session(sid);
  return db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE id=?").get(sid);
}
export const lastSession = () => db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE reviewed>0 ORDER BY started_at DESC LIMIT 1").get();

export const suspendedCards = async (course?: string) =>
  resolve(db.query(`SELECT * FROM cards WHERE suspended=1${course ? " AND course=?" : ""} ORDER BY updated_at DESC`).all(...(course ? [course] : [])) as Row[]);

// Per-module mastery from the cards: how many questions are "learned".
export function mastery(course: string) {
  const rows = db.query("SELECT module, state FROM cards WHERE course=? AND module IS NOT NULL AND suspended=0").all(course) as any[];
  const by: Record<string, { questions: number; learned: number }> = {};
  for (const r of rows) { const m = (by[r.module] ??= { questions: 0, learned: 0 }); m.questions++; if (r.state === "learned") m.learned++; }
  return by;
}
