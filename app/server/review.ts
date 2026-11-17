// Spaced review. Every question answered in a lesson becomes an FSRS card; the daily queue serves
// what is due across every course. "Learned" means three spaced correct recalls in the Review state.
// Baseline questions never become cards: they are diagnostic, not taught.
import { fsrs, createEmptyCard, Rating, State, type Card, type Grade, type FSRSParameters } from "ts-fsrs";
import YAML from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, id, now } from "./db";
import { COURSES_DIR, getDoc, listCourses, outOfReview } from "./content";
import { state } from "./state";
import { touch } from "./sync";
import { VOCAB, reviewSpec, wordRow } from "./vocab-spec";

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
// What a grader returns for one answer: the server's grade jobs and the vocab grader share it.
export const RESULT = { type: "string", enum: ["correct", "partial", "wrong", "skipped"] };
export const GRADE_SCHEMA = { type: "object", properties: { result: RESULT, note: { type: "string" } }, required: ["result", "note"] };
export const isResult = (x: unknown): x is Result => typeof x === "string" && (RESULT.enum as string[]).includes(x);

// A pass for retention: Good or better, or, for a vocab card, a correct answer (an effortful correct
// recall is rated Hard, and it was still recalled).
const passed = (l: any) => (l.difficulty != null ? l.result === "correct" : l.rating >= Rating.Good);

// A course's cards, plus the vocab cards that are that course's own terms.
const inCourse = () => ` AND (course=? OR (course='${VOCAB}' AND module=?))`;
// The reverse, for the unscoped modes: leave out the courses set to `review: false`, and their vocab.
// Slugs are directory names; quoting guards the SQL all the same.
async function notOptedOut(): Promise<string> {
  const out = await outOfReview();
  if (!out.length) return "";
  const list = out.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
  return ` AND course NOT IN (${list}) AND NOT (course='${VOCAB}' AND coalesce(module,'') IN (${list}))`;
}

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

// A leech: six lapses after learning, or six Again ratings in a row at any stage. Both count from
// `base`, where the card stood when the learner last unsuspended it, so a revived leech gets a fresh run.
type LeechBase = { lapses: number; reviews: number } | null;
const isLeech = (card: Card, logs: any[], base: LeechBase = null) => {
  const lapses = card.lapses - (base?.lapses ?? 0), recent = logs.slice(base?.reviews ?? 0);
  return lapses >= LEECH_LAPSES || (recent.length >= LEECH_LAPSES && recent.slice(-LEECH_LAPSES).every((l: any) => l.rating === Rating.Again));
};
const baseOf = (row: any): LeechBase => (row?.leech_base ? JSON.parse(row.leech_base) : null);

// Review answers live in the card's log (answer and grader note), not in the lesson's `answers` row.
// `extra.rating` overrides the result+confidence mapping (vocab: the learner rates how hard the recall
// was); `extra.log` adds fields to the log entry (vocab: format, sentence, difficulty).
export function rate(course: string, question: string, doc: string, result: Result, confidence?: number | null, variant: number | null = null, extra: { answer?: string; note?: string; rating?: Grade; log?: Record<string, unknown> } = {}) {
  if (doc.startsWith("quizzes/")) return null;   // baseline: no card
  const row = db.query("SELECT card, streak, log, suspended, last_variant, leech_base, module FROM cards WHERE course=? AND question=?").get(course, question) as any;
  const prev: Card = row ? revive(JSON.parse(row.card)) : createEmptyCard(new Date());
  const r = extra.rating ?? rating(result, confidence);
  const { card, log } = scheduler().next(prev, new Date(), r);
  const streak = r === Rating.Again ? 0 : (row?.streak ?? 0) + 1;
  const logs = [...(row ? JSON.parse(row.log) : []), { ...log, result, confidence: confidence ?? null, variant, ...(extra.answer !== undefined ? { answer: extra.answer } : {}), ...(extra.note ? { note: extra.note } : {}), ...extra.log }];
  const module = course === VOCAB ? row?.module ?? null : /^modules\/([^/]+)\//.exec(doc)?.[1] ?? null;
  let suspended = !!row?.suspended;
  let leech = false;
  if (!suspended && r === Rating.Again && isLeech(card, logs, baseOf(row))) { suspended = true; leech = true; }
  const st = stateOf(card, streak, logs.length, suspended);
  // last_variant drives rotation, so asking the original leaves it where it was.
  const lastVariant = variant ?? row?.last_variant ?? -1;
  db.run(`INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, last_variant, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, module=excluded.module, due=excluded.due, card=excluded.card, streak=excluded.streak, log=excluded.log, state=excluded.state, suspended=excluded.suspended, last_variant=excluded.last_variant, updated_at=excluded.updated_at`,
    [course, question, doc, module, card.due.toISOString(), JSON.stringify(card), streak, JSON.stringify(logs), st, suspended ? 1 : 0, lastVariant, now()]);
  state.card(course, question);
  if (leech) recordLeech(course, question, doc);
  return { due: card.due.toISOString(), streak, state: st, leech, reviews: logs.length };
}

// What the review page polls after answering: the schedule and the last log entry (result, note).
export function cardStatus(course: string, question: string) {
  const r = db.query("SELECT due, streak, state, log, suspended FROM cards WHERE course=? AND question=?").get(course, question) as any;
  if (!r) return null;
  const log = JSON.parse(r.log), last = log.at(-1) ?? null;
  return { due: r.due, streak: r.streak, state: r.state, suspended: !!r.suspended, reviews: log.length, last: last && { result: last.result ?? null, note: last.note ?? null, confidence: last.confidence ?? null, variant: last.variant ?? null, review: last.review ?? null } };
}

// --- learner profile writes ---------------------------------------------------
export function readProfile(course: string): { path: string; fm: any; body: string } | null {
  const path = join(COURSES_DIR, course, "learner.md");
  let src = ""; try { src = readFileSync(path, "utf8"); } catch { return null; }
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return null;
  let fm: any; try { fm = YAML.parse(m[1]) ?? {}; } catch { return null; }
  return { path, fm, body: m[2] };
}
// Set (or remove, with undefined) top-level frontmatter keys by editing their lines in place, so
// hand-written YAML elsewhere in the file keeps its style. Writes only when a value changed.
export function patchProfile(course: string, patch: Record<string, unknown>): boolean {
  const p = readProfile(course); if (!p) return false;
  let fmText = readFileSync(p.path, "utf8").match(/^---\n([\s\S]*?)\n---/)![1] + "\n";
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(p.fm[key] ?? null) === JSON.stringify(value ?? null)) continue;
    changed = true;
    const block = value === undefined ? "" : YAML.stringify({ [key]: value }, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 });
    // The key's line plus every continuation line (indented, or a list item at the key's indent).
    const re = new RegExp(`^${key}:[^\\n]*\\n(?:(?:[ \\t]+[^\\n]*|-[^\\n]*)\\n)*`, "m");
    fmText = re.test(fmText) ? fmText.replace(re, block) : fmText + block;
  }
  if (!changed) return false;
  writeFileSync(p.path, `---\n${fmText.trimEnd()}\n---\n${p.body}`);
  touch();
  return true;
}
// A leech goes into the learner profile so the next module generation picks it up as a carry item.
function recordLeech(course: string, question: string, doc: string) {
  const p = readProfile(course); if (!p) return;
  const errors = Array.isArray(p.fm.errors) ? [...p.fm.errors] : [];
  const patch: Record<string, unknown> = { leeches: [...new Set([...(Array.isArray(p.fm.leeches) ? p.fm.leeches : []), question])] };
  if (!errors.some((e: any) => e?.seen?.includes(question))) patch.errors = [...errors, { pattern: `Leech: ${question} in ${doc} keeps lapsing in review`, seen: [question] }];
  patchProfile(course, patch);
}
// After a session with reviews: review calibration counts, retention per course, leeches (the cards
// rate() suspended as leeches, not ones the learner suspended by hand). Only the courses reviewed in
// this session are written. `calibration` itself belongs to wrap-module; review data has its own key.
export function updateProfiles(sessionStart: string) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = db.query("SELECT course, question, card, log, suspended, leech_base FROM cards").all() as any[];
  const by: Record<string, { reviews: number; good: number; sureWrong: number; guessRight: number; leeches: string[]; touched: boolean }> = {};
  const all = { sureWrong: 0, guessRight: 0 };
  for (const r of rows) {
    if (r.course === VOCAB) continue;   // no learner.md; and recall effort is not confidence
    const c = (by[r.course] ??= { reviews: 0, good: 0, sureWrong: 0, guessRight: 0, leeches: [], touched: false });
    const log = JSON.parse(r.log);
    for (const l of log) {
      if (l.review >= since) { c.reviews++; if (passed(l)) c.good++; }
      if (l.review >= sessionStart) c.touched = true;
      if (l.result === "wrong" && l.confidence === 3) { c.sureWrong++; all.sureWrong++; }
      if (l.result === "correct" && l.confidence === 1) { c.guessRight++; all.guessRight++; }
    }
    if (r.suspended && isLeech(revive(JSON.parse(r.card)), log, baseOf(r))) c.leeches.push(r.question);
  }
  for (const [course, c] of Object.entries(by)) {
    if (!c.touched) continue;
    const patch: Record<string, unknown> = {
      review_calibration: `Across all courses: sure and wrong ${all.sureWrong}, guessing and right ${all.guessRight}. This course: ${c.sureWrong} and ${c.guessRight}.`,
      leeches: c.leeches.length ? c.leeches.sort() : undefined,
    };
    if (c.reviews >= 10) patch.retention = Math.round((c.good / c.reviews) * 100) / 100;
    patchProfile(course, patch);
  }
}

export function setSuspended(course: string, question: string, suspended: boolean) {
  const row = db.query("SELECT card, streak, log, leech_base FROM cards WHERE course=? AND question=?").get(course, question) as any;
  if (!row) return;
  const card = revive(JSON.parse(row.card)), log = JSON.parse(row.log);
  const st = stateOf(card, row.streak, log.length, suspended);
  // Unsuspending resets the leech count; the card comes back due now.
  const base = suspended ? row.leech_base : JSON.stringify({ lapses: card.lapses, reviews: log.length });
  const due = suspended ? null : now();
  db.run("UPDATE cards SET suspended=?, state=?, leech_base=?, due=COALESCE(?, due), updated_at=? WHERE course=? AND question=?", [suspended ? 1 : 0, st, base, due, now(), course, question]);
  state.card(course, question);
}
export function deleteCard(course: string, question: string) {
  db.run("DELETE FROM cards WHERE course=? AND question=?", [course, question]);
  state.cardDeleted(course, question);
}

// Cards that need the learner's attention: suspended (by hand or as leeches), flagged grades, and
// orphans whose question is gone from the course files.
export async function cardList(kind: "suspended" | "flagged" | "orphaned", course?: string) {
  const where = { suspended: "suspended=1", flagged: "flag IS NOT NULL", orphaned: "state='orphaned'" }[kind];
  const rows = db.query(`SELECT * FROM cards WHERE ${where}${course ? " AND course=?" : ""} ORDER BY updated_at DESC`).all(...(course ? [course] : [])) as any[];
  const courses = Object.fromEntries((await listCourses()).map((c) => [c.slug, c]));
  const out = [];
  for (const r of rows) {
    const log = JSON.parse(r.log), card = revive(JSON.parse(r.card));
    if (r.course === VOCAB) {
      const w = wordRow(r.question);
      out.push({ course: r.course, courseTitle: "Vocabulary", question: r.question, doc: r.doc, module: null, moduleTitle: "", sectionTitle: w?.word ?? r.question,
                 prompt: w ? `${w.entry?.headword ?? w.word}: ${w.entry?.explanation ?? ""}` : null, flag: r.flag ?? null, reviews: log.length, lapses: card.lapses,
                 leech: !!r.suspended && isLeech(card, log, baseOf(r)), updatedAt: r.updated_at, vocab: true });
      continue;
    }
    const spec = await question(r.course, r.doc, r.question);
    const c = courses[r.course], m = c?.modules.find((x) => x.id === r.module), file = r.doc.split("/").slice(2).join("/");
    out.push({
      course: r.course, courseTitle: c?.title ?? r.course, question: r.question, doc: r.doc, module: r.module,
      moduleTitle: m?.title ?? r.module ?? "", sectionTitle: file === "quiz.md" ? "Module test" : (m?.sections.find((s) => s.file === file)?.title ?? m?.extras.find((e) => e.file === file)?.title ?? file),
      prompt: spec?.prompt ?? null, flag: r.flag ?? null, reviews: log.length, lapses: card.lapses,
      leech: !!r.suspended && isLeech(card, log, baseOf(r)), updatedAt: r.updated_at,
    });
  }
  return out;
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
// Variant generation is best effort: two failed attempts per card (until restart) and at most a few
// requests per queue load, so a logged-out `claude` never fans out into dozens of failing processes.
const MAX_VARIANT_ATTEMPTS = 2, VARIANTS_PER_LOAD = 4;
const pendingVariants = new Set<string>();
const variantAttempts = new Map<string, number>();
export const wantsVariant = (course: string, question: string, reviews: number, count: number) => {
  const k = `${course}:${question}`;
  return reviews >= 1 && count < MAX_VARIANTS && !pendingVariants.has(k) && (variantAttempts.get(k) ?? 0) < MAX_VARIANT_ATTEMPTS;
};
export const markVariantPending = (course: string, question: string, pending: boolean) => { const k = `${course}:${question}`; pending ? pendingVariants.add(k) : pendingVariants.delete(k); };
export const markVariantFailed = (course: string, question: string) => { const k = `${course}:${question}`; variantAttempts.set(k, (variantAttempts.get(k) ?? 0) + 1); };

// Which wording to ask this time: a variant whenever one exists, from the first review on (the
// learner rebuilds the idea on a new case instead of recalling the answer they wrote), with the
// original one time in four after that; else the variant after the one asked last.
function pickVariant(reviews: number, lastVariant: number, variants: Variant[], prefer: boolean): number | null {
  if (!variants.length || reviews < 1) return null;
  if (!prefer && reviews % 4 === 3) return null;
  return (lastVariant + 1) % variants.length;
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

type Row = { course: string; question: string; doc: string; module: string | null; due: string; streak: number; state: CardState; log: string; card: string; variants: string; last_variant: number };
export type QueueItem = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; due: string; streak: number; state: CardState; reviews: number; sureWrong: boolean; variant: number | null; variantCount: number; original: any; spec: any; vocab?: { format: string; sentence: string; form: string; reveal: unknown } };

async function resolve(rows: Row[], prefer = false): Promise<QueueItem[]> {
  const courses = Object.fromEntries((await listCourses()).map((c) => [c.slug, c]));
  const items: QueueItem[] = [];
  for (const r of rows) {
    if (r.course === VOCAB) {
      const log = JSON.parse(r.log), v = reviewSpec(r.question, log), last = log.at(-1);
      if (!v) { db.run("UPDATE cards SET state='orphaned' WHERE course=? AND question=?", [r.course, r.question]); continue; }
      if (r.state === "orphaned") db.run("UPDATE cards SET state=? WHERE course=? AND question=?", [stateOf(revive(JSON.parse(r.card)), r.streak, log.length, false), r.course, r.question]);
      items.push({
        course: VOCAB, courseTitle: "Vocabulary", question: r.question, doc: r.doc, module: r.module, moduleTitle: "Vocabulary", sectionTitle: v.word,
        due: r.due, streak: r.streak, state: r.state, reviews: log.length, sureWrong: false, variant: null, variantCount: 0,
        original: v.spec, spec: v.spec, vocab: { format: v.format, sentence: v.sentence, form: v.form, reveal: v.reveal },
      });
      continue;
    }
    const spec = await question(r.course, r.doc, r.question);
    if (!spec) { db.run("UPDATE cards SET state='orphaned' WHERE course=? AND question=?", [r.course, r.question]); continue; }
    if (r.state === "orphaned") db.run("UPDATE cards SET state=? WHERE course=? AND question=?", [stateOf(revive(JSON.parse(r.card)), r.streak, JSON.parse(r.log).length, false), r.course, r.question]);
    const c = courses[r.course], m = c?.modules.find((x) => x.id === r.module);
    const file = r.doc.split("/").slice(2).join("/");
    const log = JSON.parse(r.log), last = log.at(-1);
    const variants: Variant[] = JSON.parse(r.variants ?? "[]");
    const vi = pickVariant(log.length, r.last_variant ?? -1, variants, prefer);
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

// The daily review happens once per local calendar day. A card answered today (in review or in a
// lesson) waits for tomorrow even if its schedule says it is due again in minutes; the daily cap
// is a budget for the day, spent by every daily session started today. What is left carries over.
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const notToday = " AND (log='[]' OR json_extract(log, '$[#-1].review') < ?)";
const doneToday = () => (db.query("SELECT coalesce(sum(reviewed), 0) n FROM review_sessions WHERE kind='daily' AND started_at>=?").get(todayStart()) as any).n as number;
const dailyBudget = () => Math.max(0, getSetting("dailyCap", 20) - doneToday());

// Daily: due cards not seen today (sure-and-wrong first), interleaved, within the day's budget;
// topped up with never-reviewed cards so the day's review reaches 8. Ad hoc modes ignore due dates
// and the day; course, module and cram serve the whole set, burst ten, weak spots twenty.
export async function queue(opts: { mode?: Mode; scope?: string; cap?: number; exclude?: string[] } = {}) {
  const mode = opts.mode ?? "daily";
  const cap = mode === "daily" ? dailyBudget() : opts.cap ?? (mode === "burst" ? 10 : mode === "weak" ? 20 : Infinity);
  const excl = new Set(opts.exclude ?? []);
  const key = (r: Row) => `${r.course}:${r.question}`;
  const base = "suspended=0 AND state<>'orphaned'";
  let rows: Row[]; const args: string[] = [];
  let scopeWhere = "";
  const optOut = opts.scope ? "" : await notOptedOut();
  if (mode === "daily" && !opts.scope) scopeWhere = optOut;
  if (mode === "course" || (mode === "daily" && opts.scope)) { scopeWhere = inCourse(); args.push(opts.scope!, opts.scope!); }
  if (mode === "module" || mode === "cram") { const [c, m] = (opts.scope ?? "/").split("/"); scopeWhere = " AND course=? AND module=?"; args.push(c, m); }
  if (mode === "cram") scopeWhere += " AND doc NOT LIKE '%/quiz.md'";   // the module test is what cram prepares for, not part of it
  if (mode === "daily") rows = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} AND due<=?${notToday} ORDER BY due`).all(...args, now(), todayStart()) as Row[];
  else if (mode === "burst") rows = db.query(`SELECT * FROM cards WHERE ${base}${opts.scope ? inCourse() : optOut} ORDER BY random() LIMIT ?`).all(...(opts.scope ? [opts.scope, opts.scope] : []), cap) as Row[];
  else if (mode === "weak") {
    const skip = new Set(opts.scope ? [] : await outOfReview());
    rows = (await weakRows()).filter((r) => opts.scope ? r.course === opts.scope || (r.course === VOCAB && r.module === opts.scope) : !skip.has(r.course) && !(r.course === VOCAB && skip.has(r.module ?? "")));
  }
  else rows = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} ORDER BY due`).all(...args) as Row[];

  let items = await resolve(rows.filter((r) => !excl.has(key(r))), mode === "cram");
  items = [...items.filter((i) => i.sureWrong), ...items.filter((i) => !i.sureWrong)];
  items = interleave(items).slice(0, cap);
  let topped = 0;
  const want = mode === "daily" ? Math.min(8, cap + doneToday()) - doneToday() - items.length : 0;
  if (want > 0) {
    // Not vocab cards: a word's first review waits for the day after it was met in Train.
    const fresh = db.query(`SELECT * FROM cards WHERE ${base}${scopeWhere} AND course<>'${VOCAB}' AND state='new' AND due>?${notToday} ORDER BY updated_at LIMIT ?`).all(...args, now(), todayStart(), want) as Row[];
    const extra = await resolve(fresh.filter((r) => !items.some((i) => i.course === r.course && i.question === r.question)));
    topped = extra.length; items = [...items, ...extra];
  }
  const totalDue = mode === "daily" ? (db.query(`SELECT count(*) n FROM cards WHERE ${base}${scopeWhere} AND due<=?${notToday}`).get(...args, now(), todayStart()) as any).n : rows.length;
  const next = (db.query(`SELECT min(due) d FROM cards WHERE ${base}${scopeWhere} AND due>?`).get(...args, now()) as any).d;
  // Ask for variants in the background for cards that will be seen again, a few per load.
  let asked = 0;
  for (const it of items) if (it.course !== VOCAB && asked < VARIANTS_PER_LOAD && wantsVariant(it.course, it.question, it.reviews, it.variantCount)) { asked++; onVariantWanted?.(it); }
  // And for cards coming due in the next two days that have none yet, so the variant is ready when they are.
  if (asked < VARIANTS_PER_LOAD) {
    const soon = db.query(`SELECT course, question, doc FROM cards WHERE suspended=0 AND state<>'orphaned' AND course<>'${VOCAB}' AND log<>'[]' AND variants='[]' AND due<=? ORDER BY due LIMIT 20`).all(new Date(Date.now() + 2 * 864e5).toISOString()) as any[];
    for (const r of soon) { if (asked >= VARIANTS_PER_LOAD) break; if (await requestVariant(r.course, r.question, r.doc)) asked++; }
  }
  // Daily `remaining`: due cards the day's budget leaves for tomorrow.
  return { mode, scope: opts.scope ?? null, items, dueCount: totalDue, remaining: Math.max(0, totalDue - excl.size - items.length + topped), topped, next, doneToday: doneToday() };
}
let onVariantWanted: ((it: QueueItem) => void) | null = null;
export const setVariantHook = (fn: (it: QueueItem) => void) => { onVariantWanted = fn; };

// Ask for a card's next variant now, outside a queue: when a lesson answer creates the card, so its
// first review can be asked on a new case. True if a variant job was started.
export async function requestVariant(course: string, qid: string, doc: string): Promise<boolean> {
  if (course === VOCAB || !onVariantWanted) return false;
  const r = db.query("SELECT log, variants FROM cards WHERE course=? AND question=?").get(course, qid) as any;
  if (!r || !wantsVariant(course, qid, JSON.parse(r.log).length, JSON.parse(r.variants ?? "[]").length)) return false;
  const spec = await question(course, doc, qid);
  if (!spec) return false;
  onVariantWanted({ course, question: qid, doc, original: spec } as QueueItem);
  return true;
}

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
export async function summary(course?: string) {
  const where = `suspended=0 AND state<>'orphaned'${course ? inCourse() : await notOptedOut()}`;
  const args = course ? [course, course] : [];
  const by = (sql: string) => (db.query(sql).get(...args) as any).n;
  // `dueCount` is what today's review still holds: due, not seen today, within the day's budget.
  return {
    dueCount: Math.min(dailyBudget(), by(`SELECT count(*) n FROM cards WHERE ${where} AND due<='${now()}' AND (log='[]' OR json_extract(log, '$[#-1].review') < '${todayStart()}')`)),
    doneToday: doneToday(),
    total: by(`SELECT count(*) n FROM cards WHERE ${where}`),
    learned: by(`SELECT count(*) n FROM cards WHERE ${where} AND state='learned'`),
    suspended: by(`SELECT count(*) n FROM cards WHERE suspended=1${course ? inCourse() : await notOptedOut()}`),
    seeded: seededCount(course),
    streak: streak(),
    next: (db.query(`SELECT min(due) d FROM cards WHERE ${where} AND due>'${now()}'`).get(...args) as any).d,
  };
}

// Consecutive local days (ending today or yesterday) with at least one review.
function streak(): number {
  const days = new Set((db.query("SELECT started_at FROM review_sessions WHERE reviewed > 0").all() as any[]).map((r) => dayOf(r.started_at)));
  let n = 0; const d = new Date();
  if (!days.has(dayOf(d.toISOString()))) d.setDate(d.getDate() - 1);
  while (days.has(dayOf(d.toISOString()))) { n++; d.setDate(d.getDate() - 1); }
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
  if (patch.end && (patch.reviewed ?? r.reviewed) > 0) try { updateProfiles(r.started_at); } catch (e) { console.warn("profile update:", (e as Error).message); }
  return db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE id=?").get(sid);
}
export const lastSession = () => db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE reviewed>0 ORDER BY started_at DESC LIMIT 1").get();

// --- history ------------------------------------------------------------------
// A review answer's log entry carries `answer` (a lesson's first rating does not) and, since
// sessions were tagged, `session`. Older entries are matched to the session that started before
// them, within six hours and before the next session began (or the one that began just after).
type Entry = { course: string; question: string; doc: string; module: string | null; review: string; result: Result | null; note?: string; confidence?: number | null; answer: string; variant?: number | null; session?: string; format?: string; sentence?: string };
type SessionRow = { id: string; kind: string; scope: string | null; startedAt: string; endedAt: string | null; reviewed: number; correct: number; sureWrong: number };
function sessionEntries(course?: string) {
  const sessions = db.query("SELECT id, kind, scope, started_at startedAt, ended_at endedAt, reviewed, correct, sure_wrong sureWrong FROM review_sessions WHERE reviewed>0 ORDER BY started_at").all() as SessionRow[];
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const of = new Map<string, Entry[]>(sessions.map((s) => [s.id, []]));
  const all: Entry[] = [];
  for (const r of db.query(`SELECT course, question, doc, module, log FROM cards${course ? inCourse().replace(" AND", " WHERE") : ""}`).all(...(course ? [course, course] : [])) as any[])
    for (const l of JSON.parse(r.log)) if (l.review && l.answer !== undefined) all.push({ ...l, course: r.course, question: r.question, doc: r.doc, module: r.module });
  for (const e of all) {
    let s = e.session ? byId.get(e.session) : undefined;
    if (!s) {
      const i = sessions.findLastIndex((x) => x.startedAt <= e.review);
      const c = sessions[i], nextStart = sessions[i + 1]?.startedAt;
      if (c && +new Date(e.review) - +new Date(c.startedAt) < 6 * 36e5 && (!nextStart || e.review < nextStart)) s = c;
      // Before tagging, a session was created when the first grade came back, so it can start just after it.
      else if (nextStart && +new Date(nextStart) - +new Date(e.review) < 30 * 6e4) s = sessions[i + 1];
    }
    if (s) of.get(s.id)!.push(e);
  }
  return { sessions, all, of };
}
const tallyOf = (es: Entry[]) => es.reduce((t, e) => (e.result ? { ...t, [e.result]: (t[e.result] ?? 0) + 1 } : t), {} as Record<string, number>);

// The calendar (reviews per local day, the last year) and every session, newest first.
export function reviewHistory(course?: string) {
  const { sessions, all, of } = sessionEntries(course);
  const days: Record<string, { reviewed: number; correct: number }> = {};
  for (const e of all) { const k = dayOf(e.review), d = (days[k] ??= { reviewed: 0, correct: 0 }); d.reviewed++; if (e.result === "correct") d.correct++; }
  const list = sessions.filter((s) => !course || s.scope === course || of.get(s.id)!.length).map((s) => {
    const es = of.get(s.id)!;
    return { ...s, day: dayOf(s.startedAt), tally: tallyOf(es), graded: es.length, pending: course ? 0 : Math.max(0, s.reviewed - es.length) };
  }).reverse();
  return { streak: streak(), today: dayOf(now()), days, sessions: list };
}

// One session's answers: what was asked, what the learner wrote, and the grade.
export async function sessionDetail(sid: string) {
  const { of, sessions } = sessionEntries();
  const s = sessions.find((x) => x.id === sid); if (!s) return null;
  const es = [...of.get(sid)!].sort((a, b) => (a.review < b.review ? -1 : 1));
  const courses = Object.fromEntries((await listCourses()).map((c) => [c.slug, c]));
  const items = [];
  for (const e of es) {
    const base = { course: e.course, question: e.question, result: e.result, note: e.note ?? null, confidence: e.confidence ?? null, at: e.review, variant: e.variant ?? null };
    if (e.course === VOCAB) {
      const w = wordRow(e.question);
      items.push({ ...base, courseTitle: "Vocabulary", where: w?.entry?.headword ?? w?.word ?? e.question, to: `/vocab#w-${e.question}`, prompt: e.sentence ? `${e.format ?? "Vocab"}: ${e.sentence}` : w?.entry?.headword ?? w?.word ?? "", type: "short", answer: e.answer, options: null, correct: null });
      continue;
    }
    const spec = await question(e.course, e.doc, e.question);
    const v = e.variant != null ? variantsOf(e.course, e.question)[e.variant] : undefined;
    const c = courses[e.course], m = c?.modules.find((x) => x.id === e.module), file = e.doc.split("/").slice(2).join("/");
    const options: string[] | null = v?.options ?? spec?.options ?? null, answerIx = v?.answer ?? spec?.answer;
    items.push({
      ...base, courseTitle: c?.title ?? e.course,
      where: file === "quiz.md" ? "Module test" : (m?.sections.find((x) => x.file === file)?.title ?? m?.extras.find((x) => x.file === file)?.title ?? file),
      to: `/c/${e.course}/m/${e.module}/${file === "quiz.md" ? "test" : file}`,
      prompt: v?.prompt ?? spec?.prompt ?? "(This question is no longer in the course.)", type: spec?.type ?? "short",
      answer: spec?.type === "mcq" && options ? options[Number(e.answer)] ?? e.answer : e.answer,
      correct: spec?.type === "mcq" && options && answerIx != null ? options[answerIx] : null, options: null,
    });
  }
  return { ...s, day: dayOf(s.startedAt), tally: tallyOf(es), pending: Math.max(0, s.reviewed - es.length), items };
}

// Dummy cards: one `new` card per quiz question in every generated module, due now, with an empty
// log. The first real answer rates it like any other card; unreviewed ones can be cleared again.
export async function seed(course?: string) {
  const courses = (await listCourses()).filter((c) => !course || c.slug === course);
  let added = 0;
  for (const c of courses) {
    for (const m of c.modules) {
      const files = [...m.sections.map((s) => s.file), ...(m.test ? ["quiz.md"] : []), ...m.extras.filter((e) => e.kind === "drilldown" || e.kind === "worksheet").map((e) => e.file)];
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
  const rows = db.query(`SELECT course, question FROM cards WHERE log='[]' AND course<>'${VOCAB}'${course ? " AND course=?" : ""}`).all(...(course ? [course] : [])) as any[];
  for (const r of rows) { db.run("DELETE FROM cards WHERE course=? AND question=?", [r.course, r.question]); state.cardDeleted(r.course, r.question); }
  return rows.length;
}
export const seededCount = (course?: string) => (db.query(`SELECT count(*) n FROM cards WHERE log='[]' AND course<>'${VOCAB}'${course ? " AND course=?" : ""}`).get(...(course ? [course] : [])) as any).n;

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
  const logs = rows.map((r) => JSON.parse(r.log).filter((l: any) => l.review).sort((a: any, b: any) => (a.review < b.review ? -1 : a.review > b.review ? 1 : 0))).filter((l) => l.length >= 2);
  const total = logs.reduce((n, l) => n + l.length, 0);
  if (total < 400) return { ok: false, message: `Need about 400 reviews to fit weights; have ${total}.`, reviews: total };
  try {
    const { FSRS, FSRSItem, FSRSReview } = await import("fsrs-rs-nodejs");   // native binding: may be missing on this platform
    const items: any[] = [];
    for (const log of logs) {
      let prev: Date | null = null;
      const reviews = log.map((l: any) => { const d = new Date(l.review); const delta = prev ? Math.max(0, Math.round((+d - +prev) / 864e5)) : 0; prev = d; return new FSRSReview(l.rating, delta); });
      for (let i = 2; i <= reviews.length; i++) items.push(new FSRSItem(reviews.slice(0, i)));
    }
    const w = await new FSRS(null).computeParameters(items);
    setSetting("weights", Array.from(w)); setSetting("optimizedAt", now());
    reschedule();
    return { ok: true, message: `Fitted ${w.length} weights on ${total} reviews and rescheduled every card.`, reviews: total };
  } catch (e) { return { ok: false, message: `Optimizer: ${(e as Error).message}`, reviews: total }; }
}
// Change one log entry's grade (a regrade) and replay the card's schedule, streak and state from its
// log. The old grade is kept on the entry as `regraded`. Vocab cards rate by difficulty: not here.
export function amendLog(course: string, question: string, match: (l: any, i: number) => boolean, g: { result: Result; note: string }) {
  if (course === VOCAB) return false;
  const row = db.query("SELECT log, suspended, state FROM cards WHERE course=? AND question=?").get(course, question) as any;
  if (!row) return false;
  const log = JSON.parse(row.log), i = log.findIndex(match);
  if (i < 0) return false;
  const l = log[i];
  log[i] = { ...l, result: g.result, note: g.note, rating: rating(g.result, l.confidence), regraded: { result: l.result, note: l.note ?? null, at: now() } };
  const f = scheduler(), rated = log.filter((x: any) => x.review);
  let card = createEmptyCard(new Date(rated[0].review));
  for (const x of rated) card = f.next(card, new Date(x.review), x.rating).card;
  let streak = 0; for (const x of rated) streak = x.rating === Rating.Again ? 0 : streak + 1;
  const st = row.state === "orphaned" ? "orphaned" : stateOf(card, streak, log.length, !!row.suspended);
  db.run("UPDATE cards SET due=?, card=?, streak=?, log=?, state=?, updated_at=? WHERE course=? AND question=?", [card.due.toISOString(), JSON.stringify(card), streak, JSON.stringify(log), st, now(), course, question]);
  state.card(course, question);
  return true;
}

// Recompute every card's schedule from its log under the current retention and weights.
export function reschedule() {
  const f = scheduler();
  for (const r of db.query("SELECT course, question, log, streak, suspended, state FROM cards").all() as any[]) {
    const log = JSON.parse(r.log).filter((l: any) => l.review);
    if (!log.length) continue;
    let card = createEmptyCard(new Date(log[0].review));
    for (const l of log) card = f.next(card, new Date(l.review), l.rating).card;
    const st = r.state === "orphaned" ? "orphaned" : stateOf(card, r.streak, log.length, !!r.suspended);   // only resolve() un-orphans
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
      if (t >= since) { const d = l.review.slice(0, 10); const x = (perDay[d] ??= { reviews: 0, good: 0 }); x.reviews++; if (passed(l)) x.good++; }
      if (t >= sinceW) { const dt = new Date(t); dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay()); const w = dt.toISOString().slice(0, 10); const x = (perWeek[w] ??= { reviews: 0, good: 0 }); x.reviews++; if (passed(l)) x.good++; }
    }
  }
  const days = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ day: d, ...(perDay[d] ?? { reviews: 0, good: 0 }) }); }
  const weeks = Object.entries(perWeek).sort().map(([week, x]) => ({ week, ...x, retention: x.reviews ? Math.round((x.good / x.reviews) * 100) : null }));
  const sessions = db.query("SELECT count(*) n, coalesce(sum(reviewed),0) reviewed FROM review_sessions").get() as any;
  return { byState, total: rows.length, days, weeks, sessions, settings: settings(), streak: streak() };
}
