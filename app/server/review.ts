// Spaced review. Every question answered in a lesson becomes an FSRS card; the daily queue serves
// what is due across every course. "Learned" means three spaced correct recalls in the Review state.
// Baseline questions never become cards: they are diagnostic, not taught.
import { fsrs, createEmptyCard, Rating, State, type Card, type Grade, type FSRSParameters } from "ts-fsrs";
import YAML from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, id, now } from "./db";
import { COURSES_DIR, getDoc, listCourses } from "./content";
import { state } from "./state";
import { touch } from "./sync";

const LEECH_LAPSES = 6;
const MAX_VARIANTS = 3;

export type Result = "correct" | "partial" | "wrong" | "skipped";
export type CardState = "new" | "learning" | "review" | "learned" | "suspended" | "orphaned";
export type Variant = { prompt: string; rubric?: string; options?: string[]; answer?: number; explanation?: string; createdAt: string };

// --- settings ---------------------------------------------------------------
export function getSetting<T>(key: string, fallback: T): T {
  const r = db.query("SELECT value FROM settings WHERE key=?").get(key) as any;
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export function setSetting(key: string, value: unknown) {
  db.run("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]);
  state.settings();
}
export const settings = () => ({ retention: getSetting("retention", 0.9), dailyCap: getSetting("dailyCap", 20), weights: getSetting<number[] | null>("weights", null), optimizedAt: getSetting<string | null>("optimizedAt", null) });

function scheduler() {
  const p: Partial<FSRSParameters> = { request_retention: getSetting("retention", 0.9) };
  const w = getSetting<number[] | null>("weights", null);
  if (w) p.w = w;
  return fsrs(p);
}

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

export function rate(course: string, question: string, doc: string, result: Result, confidence?: number | null, variant: number | null = null) {
  if (doc.startsWith("quizzes/")) return null;   // baseline: no card
  const row = db.query("SELECT card, streak, log, suspended FROM cards WHERE course=? AND question=?").get(course, question) as any;
  const prev: Card = row ? revive(JSON.parse(row.card)) : createEmptyCard(new Date());
  const r = rating(result, confidence);
  const { card, log } = scheduler().next(prev, new Date(), r);
  const streak = r === Rating.Again ? 0 : (row?.streak ?? 0) + 1;
  const logs = [...(row ? JSON.parse(row.log) : []), { ...log, result, confidence: confidence ?? null, variant }];
  const module = /^modules\/([^/]+)\//.exec(doc)?.[1] ?? null;
  let suspended = !!row?.suspended;
  let leech = false;
  // A leech: six lapses after learning, or six Again ratings in a row at any stage.
  const recentAgain = logs.slice(-LEECH_LAPSES).length === LEECH_LAPSES && logs.slice(-LEECH_LAPSES).every((l: any) => l.rating === Rating.Again);
  if (!suspended && (card.lapses >= LEECH_LAPSES || recentAgain)) { suspended = true; leech = true; }
  const st = stateOf(card, streak, logs.length, suspended);
  db.run(`INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, last_variant, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, module=excluded.module, due=excluded.due, card=excluded.card, streak=excluded.streak, log=excluded.log, state=excluded.state, suspended=excluded.suspended, last_variant=excluded.last_variant, updated_at=excluded.updated_at`,
    [course, question, doc, module, card.due.toISOString(), JSON.stringify(card), streak, JSON.stringify(logs), st, suspended ? 1 : 0, variant ?? -1, now()]);
  state.card(course, question);
  if (leech) recordLeech(course, question, doc);
  return { due: card.due.toISOString(), streak, state: st, leech };
}

// --- learner profile writes ---------------------------------------------------
function readProfile(course: string): { path: string; fm: any; body: string } | null {
  const path = join(COURSES_DIR, course, "learner.md");
  let src = ""; try { src = readFileSync(path, "utf8"); } catch { return null; }
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return null;
  let fm: any; try { fm = YAML.parse(m[1]) ?? {}; } catch { return null; }
  return { path, fm, body: m[2] };
}
function writeProfile(p: { path: string; fm: any; body: string }) {
  writeFileSync(p.path, `---\n${YAML.stringify(p.fm, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }).trimEnd()}\n---\n${p.body}`);
  touch();
}
// A leech goes into the learner profile so the next module generation picks it up as a carry item.
function recordLeech(course: string, question: string, doc: string) {
  const p = readProfile(course); if (!p) return;
  p.fm.errors = Array.isArray(p.fm.errors) ? p.fm.errors : [];
  if (p.fm.errors.some((e: any) => e?.seen?.includes(question))) return;
  p.fm.errors.push({ pattern: `Leech: ${question} in ${doc} keeps lapsing in review`, seen: [question] });
  p.fm.leeches = [...new Set([...(p.fm.leeches ?? []), question])];
  writeProfile(p);
}
// After a session: calibration across courses, retention per course, leeches. Read by generate-module and wrap-module.
export function updateProfiles() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = db.query("SELECT course, question, log, suspended FROM cards").all() as any[];
  const by: Record<string, { reviews: number; good: number; sureWrong: number; guessRight: number; leeches: string[] }> = {};
  const all = { sureWrong: 0, guessRight: 0 };
  for (const r of rows) {
    const c = (by[r.course] ??= { reviews: 0, good: 0, sureWrong: 0, guessRight: 0, leeches: [] });
    const log = JSON.parse(r.log);
    for (const l of log) {
      if (l.review >= since) { c.reviews++; if (l.rating >= Rating.Good) c.good++; }
      if (l.result === "wrong" && l.confidence === 3) { c.sureWrong++; all.sureWrong++; }
      if (l.result === "correct" && l.confidence === 1) { c.guessRight++; all.guessRight++; }
    }
    if (r.suspended && log.length >= LEECH_LAPSES) c.leeches.push(r.question);
  }
  for (const [course, c] of Object.entries(by)) {
    const p = readProfile(course); if (!p) continue;
    p.fm.calibration = `Across all courses: sure and wrong ${all.sureWrong}, guessing and right ${all.guessRight}. This course: ${c.sureWrong} and ${c.guessRight}.`;
    if (c.reviews >= 10) p.fm.retention = Math.round((c.good / c.reviews) * 100) / 100;
    if (c.leeches.length) p.fm.leeches = c.leeches;
    writeProfile(p);
  }
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

// --- variants -----------------------------------------------------------------
export const variantsOf = (course: string, question: string): Variant[] => JSON.parse((db.query("SELECT variants FROM cards WHERE course=? AND question=?").get(course, question) as any)?.variants ?? "[]");
export function addVariant(course: string, question: string, type: "mcq" | "short", v: Partial<Variant>): string | null {
  // Lint like any quiz block before storing.
  if (!v.prompt || typeof v.prompt !== "string") return "no prompt";
  if (type === "short" && !v.rubric) return "no rubric";
  if (type === "mcq") {
    if (!Array.isArray(v.options) || v.options.length < 3) return "needs 3+ options";
    if (!Number.isInteger(v.answer) || v.answer! < 0 || v.answer! >= v.options.length) return "answer out of range";
    if (!v.explanation) return "no explanation";
  }
  const vs = variantsOf(course, question);
  if (vs.length >= MAX_VARIANTS) return "already has three";
  vs.push({ prompt: v.prompt, rubric: v.rubric, options: v.options, answer: v.answer, explanation: v.explanation, createdAt: now() });
  db.run("UPDATE cards SET variants=?, updated_at=? WHERE course=? AND question=?", [JSON.stringify(vs), now(), course, question]);
  state.card(course, question);
  return null;
}
const pendingVariants = new Set<string>();
export const wantsVariant = (course: string, question: string, reviews: number, count: number) => reviews >= 1 && count < MAX_VARIANTS && !pendingVariants.has(`${course}:${question}`);
export const markVariantPending = (course: string, question: string, pending: boolean) => { const k = `${course}:${question}`; pending ? pendingVariants.add(k) : pendingVariants.delete(k); };

// Which wording to ask this time: the original one time in four, else rotate through the variants.
function pickVariant(reviews: number, variants: Variant[], prefer: boolean): number | null {
  if (!variants.length || reviews < 1) return null;
  if (!prefer && reviews % 4 === 3) return null;
  return reviews % variants.length;
}

// Pull a quiz block out of a doc by id.
export async function question(course: string, doc: string, qid: string) {
  const d = await getDoc(course, doc);
  if (!d) return null;
  for (const m of d.body.matchAll(/```quiz\n([\s\S]*?)```/g)) {
    try { const q = YAML.parse(m[1]); if (q?.id === qid) return q; } catch {}
  }
  return null;
}

type Row = { course: string; question: string; doc: string; module: string | null; due: string; streak: number; state: CardState; log: string; card: string; variants: string };
export type QueueItem = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; due: string; streak: number; state: CardState; reviews: number; sureWrong: boolean; variant: number | null; variantCount: number; original: any; spec: any };

async function resolve(rows: Row[], prefer = false): Promise<QueueItem[]> {
  const courses = Object.fromEntries((await listCourses()).map((c) => [c.slug, c]));
  const items: QueueItem[] = [];
  for (const r of rows) {
    const spec = await question(r.course, r.doc, r.question);
    if (!spec) { db.run("UPDATE cards SET state='orphaned' WHERE course=? AND question=?", [r.course, r.question]); continue; }
    if (r.state === "orphaned") db.run("UPDATE cards SET state=? WHERE course=? AND question=?", [stateOf(revive(JSON.parse(r.card)), r.streak, JSON.parse(r.log).length, false), r.course, r.question]);
    const c = courses[r.course], m = c?.modules.find((x) => x.id === r.module);
    const file = r.doc.split("/").slice(2).join("/");
    const log = JSON.parse(r.log), last = log.at(-1);
    const variants: Variant[] = JSON.parse(r.variants ?? "[]");
    const vi = pickVariant(log.length, variants, prefer);
    const asked = vi === null ? spec : { ...spec, prompt: variants[vi].prompt, rubric: variants[vi].rubric ?? spec.rubric, options: variants[vi].options ?? spec.options, answer: variants[vi].answer ?? spec.answer, explanation: variants[vi].explanation ?? spec.explanation };
    items.push({
      course: r.course, courseTitle: c?.title ?? r.course, question: r.question, doc: r.doc, module: r.module,
      moduleTitle: m?.title ?? r.module ?? "", sectionTitle: file === "quiz.md" ? "Module test" : (m?.sections.find((s) => s.file === file)?.title ?? m?.extras.find((e) => e.file === file)?.title ?? file),
      due: r.due, streak: r.streak, state: r.state, reviews: log.length, sureWrong: last?.result === "wrong" && last?.confidence === 3,
      variant: vi, variantCount: variants.length, original: spec, spec: asked,
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

export type Mode = "daily" | "course" | "module" | "weak" | "burst" | "cram";

// Daily: due cards (sure-and-wrong first), interleaved, capped; topped up with the oldest
// never-reviewed cards when fewer than 8 are due. Ad hoc modes ignore due dates.
export async function queue(opts: { mode?: Mode; scope?: string; cap?: number; exclude?: string[] } = {}) {
  const mode = opts.mode ?? "daily";
  const cap = opts.cap ?? (mode === "burst" ? 10 : getSetting("dailyCap", 20));
  const excl = new Set(opts.exclude ?? []);
  const key = (r: Row) => `${r.course}:${r.question}`;
  const base = "suspended=0 AND state<>'orphaned'";
  let rows: Row[]; const args: string[] = [];
  let scopeWhere = "";
  if (mode === "course" || (mode === "daily" && opts.scope)) { scopeWhere = " AND course=?"; args.push(opts.scope!); }
  if (mode === "module" || mode === "cram") { const [c, m] = (opts.scope ?? "/").split("/"); scopeWhere = " AND course=? AND module=?"; args.push(c, m); }
  if (mode === "daily") rows = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} AND due<=? ORDER BY due`).all(...args, now()) as Row[];
  else if (mode === "burst") rows = db.query(`SELECT * FROM cards WHERE ${base} ORDER BY random() LIMIT ?`).all(cap) as Row[];
  else if (mode === "weak") rows = await weakRows();
  else rows = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} ORDER BY due`).all(...args) as Row[];

  let items = await resolve(rows.filter((r) => !excl.has(key(r))), mode === "cram");
  items = [...items.filter((i) => i.sureWrong), ...items.filter((i) => !i.sureWrong)];
  items = interleave(items).slice(0, cap);
  let topped = 0;
  if (mode === "daily" && items.length < 8 && !opts.exclude?.length) {
    const fresh = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} AND state='new' AND due>? ORDER BY updated_at LIMIT ?`).all(...args, now(), 8 - items.length) as Row[];
    const extra = await resolve(fresh.filter((r) => !items.some((i) => i.course === r.course && i.question === r.question)));
    topped = extra.length; items = [...items, ...extra];
  }
  const totalDue = mode === "daily" ? (db.query(`SELECT count(*) n FROM cards WHERE ${base}${scopeWhere} AND due<=?`).get(...args, now()) as any).n : rows.length;
  const next = (db.query(`SELECT min(due) d FROM cards WHERE ${base}${scopeWhere} AND due>?`).get(...args, now()) as any).d;
  // Ask for variants in the background for cards that will be seen again.
  for (const it of items) if (wantsVariant(it.course, it.question, it.reviews, it.variantCount)) onVariantWanted?.(it);
  return { mode, scope: opts.scope ?? null, items, dueCount: totalDue, remaining: Math.max(0, totalDue - excl.size - items.length + topped), topped, next };
}
let onVariantWanted: ((it: QueueItem) => void) | null = null;
export const setVariantHook = (fn: (it: QueueItem) => void) => { onVariantWanted = fn; };

// Weak spots: a lapse in the last 30 days, an objective partial/unmet in understanding.md, or a
// question listed in learner.md errors.
async function weakRows(): Promise<Row[]> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = db.query("SELECT * FROM cards WHERE suspended=0 AND state<>'orphaned'").all() as Row[];
  const courses = await listCourses();
  const weakObjectives = new Set<string>(), flagged = new Set<string>();
  for (const c of courses) {
    for (const m of c.modules) for (const o of m.objectives) if (o.status === "partial" || o.status === "unmet") weakObjectives.add(`${c.slug}:${o.id}`);
    const p = readProfile(c.slug);
    for (const e of p?.fm.errors ?? []) for (const q of e?.seen ?? []) flagged.add(`${c.slug}:${q}`);
  }
  const out: Row[] = [];
  for (const r of rows) {
    const lapsed = JSON.parse(r.log).some((l: any) => l.rating === Rating.Again && l.review >= since);
    if (lapsed || flagged.has(`${r.course}:${r.question}`)) { out.push(r); continue; }
    const spec = await question(r.course, r.doc, r.question);
    if (spec?.objective && weakObjectives.has(`${r.course}:${spec.objective}`)) out.push(r);
  }
  return out;
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
    seeded: seededCount(course),
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
  if (patch.end) try { updateProfiles(); } catch (e) { console.warn("profile update:", (e as Error).message); }
  return db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE id=?").get(sid);
}
export const lastSession = () => db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE reviewed>0 ORDER BY started_at DESC LIMIT 1").get();

// Dummy cards: one `new` card per quiz question in every generated module, due now, with an empty
// log. The first real answer rates it like any other card; unreviewed ones can be cleared again.
export async function seed(course?: string) {
  const courses = (await listCourses()).filter((c) => !course || c.slug === course);
  let added = 0;
  for (const c of courses) {
    for (const m of c.modules) {
      const files = [...m.sections.map((s) => s.file), ...(m.test ? ["quiz.md"] : []), ...m.extras.filter((e) => e.kind === "drilldown").map((e) => e.file)];
      for (const f of files) {
        const doc = `modules/${m.id}/${f}`;
        const d = await getDoc(c.slug, doc);
        if (!d) continue;
        for (const match of d.body.matchAll(/```quiz\n([\s\S]*?)```/g)) {
          let q: any; try { q = YAML.parse(match[1]); } catch { continue; }
          if (!q?.id || !q.prompt) continue;
          if (db.query("SELECT 1 FROM cards WHERE course=? AND question=?").get(c.slug, q.id)) continue;
          const card = createEmptyCard(new Date());
          db.run("INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, updated_at) VALUES (?,?,?,?,?,?,0,'[]','new',0,?)",
            [c.slug, q.id, doc, m.id, now(), JSON.stringify(card), now()]);
          state.card(c.slug, q.id);
          added++;
        }
      }
    }
  }
  return added;
}
export function clearSeeded(course?: string) {
  const rows = db.query(`SELECT course, question FROM cards WHERE log='[]'${course ? " AND course=?" : ""}`).all(...(course ? [course] : [])) as any[];
  for (const r of rows) { db.run("DELETE FROM cards WHERE course=? AND question=?", [r.course, r.question]); state.cardDeleted(r.course, r.question); }
  return rows.length;
}
export const seededCount = (course?: string) => (db.query(`SELECT count(*) n FROM cards WHERE log='[]'${course ? " AND course=?" : ""}`).get(...(course ? [course] : [])) as any).n;

export const suspendedCards = async (course?: string) =>
  resolve(db.query(`SELECT * FROM cards WHERE suspended=1${course ? " AND course=?" : ""} ORDER BY updated_at DESC`).all(...(course ? [course] : [])) as Row[]);

// Per-module mastery from the cards: how many questions are "learned".
export function mastery(course: string) {
  const rows = db.query("SELECT module, state FROM cards WHERE course=? AND module IS NOT NULL AND suspended=0").all(course) as any[];
  const by: Record<string, { questions: number; learned: number }> = {};
  for (const r of rows) { const m = (by[r.module] ??= { questions: 0, learned: 0 }); m.questions++; if (r.state === "learned") m.learned++; }
  return by;
}

// --- optimizer and rescheduling ----------------------------------------------
// Fit FSRS weights to this learner's review log (fsrs-rs), store them, and reschedule every card.
export async function optimize(): Promise<{ ok: boolean; message: string; reviews: number }> {
  const rows = db.query("SELECT course, question, log FROM cards").all() as any[];
  let total = 0;
  const { FSRS, FSRSItem, FSRSReview } = await import("fsrs-rs-nodejs");
  const items: any[] = [];
  for (const r of rows) {
    const log = JSON.parse(r.log).filter((l: any) => l.review);
    if (log.length < 2) continue;
    let prev: Date | null = null;
    const reviews = log.map((l: any) => { const d = new Date(l.review); const delta = prev ? Math.round((+d - +prev) / 864e5) : 0; prev = d; return new FSRSReview(l.rating, delta); });
    total += reviews.length;
    for (let i = 2; i <= reviews.length; i++) items.push(new FSRSItem(reviews.slice(0, i)));
  }
  if (total < 400) return { ok: false, message: `Need about 400 reviews to fit weights; have ${total}.`, reviews: total };
  try {
    const w = await new FSRS(null).computeParameters(items);
    setSetting("weights", Array.from(w)); setSetting("optimizedAt", now());
    reschedule();
    return { ok: true, message: `Fitted ${w.length} weights on ${total} reviews and rescheduled every card.`, reviews: total };
  } catch (e) { return { ok: false, message: `Optimizer: ${(e as Error).message}`, reviews: total }; }
}
// Recompute every card's schedule from its log under the current retention and weights.
export function reschedule() {
  const f = scheduler();
  for (const r of db.query("SELECT course, question, log, streak, suspended FROM cards").all() as any[]) {
    const log = JSON.parse(r.log).filter((l: any) => l.review);
    if (!log.length) continue;
    let card = createEmptyCard(new Date(log[0].review));
    for (const l of log) card = f.next(card, new Date(l.review), l.rating).card;
    const st = stateOf(card, r.streak, log.length, !!r.suspended);
    db.run("UPDATE cards SET due=?, card=?, state=?, updated_at=? WHERE course=? AND question=?", [card.due.toISOString(), JSON.stringify(card), st, now(), r.course, r.question]);
    state.card(r.course, r.question);
  }
}

// --- stats ------------------------------------------------------------------
export function stats() {
  const rows = db.query("SELECT course, state, suspended, log FROM cards").all() as any[];
  const byState: Record<string, number> = {};
  const perDay: Record<string, { reviews: number; good: number }> = {};
  const perWeek: Record<string, { reviews: number; good: number }> = {};
  const since = Date.now() - 30 * 864e5, sinceW = Date.now() - 12 * 7 * 864e5;
  for (const r of rows) {
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    for (const l of JSON.parse(r.log)) {
      if (!l.review) continue;
      const t = +new Date(l.review);
      if (t >= since) { const d = l.review.slice(0, 10); const x = (perDay[d] ??= { reviews: 0, good: 0 }); x.reviews++; if (l.rating >= Rating.Good) x.good++; }
      if (t >= sinceW) { const dt = new Date(t); dt.setDate(dt.getDate() - dt.getDay()); const w = dt.toISOString().slice(0, 10); const x = (perWeek[w] ??= { reviews: 0, good: 0 }); x.reviews++; if (l.rating >= Rating.Good) x.good++; }
    }
  }
  const days = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ day: d, ...(perDay[d] ?? { reviews: 0, good: 0 }) }); }
  const weeks = Object.entries(perWeek).sort().map(([week, x]) => ({ week, ...x, retention: x.reviews ? Math.round((x.good / x.reviews) * 100) : null }));
  const sessions = db.query("SELECT count(*) n, coalesce(sum(reviewed),0) reviewed FROM review_sessions").get() as any;
  return { byState, total: rows.length, days, weeks, sessions, settings: settings(), streak: streak() };
}
