// Vocabulary: general words the learner collects while reading. A word is captured with the sentence
// it was met in; a background job writes the entry (a plain explanation, teaching examples, test
// sentences, the word it is confused with); Train meets it, which makes it a review card, and it
// climbs the Train ladder. See docs/vocab-spec.md.
import { Rating, createEmptyCard, type Grade } from "ts-fsrs";
import { db, id, now } from "./db";
import { state } from "./state";
import { enqueue, liveFor, cancel, cancelFor, jobs } from "./jobs";
import { broadcast } from "./events";
import { listCourses } from "./content";
import { rate, readProfile, patchProfile, GRADE_SCHEMA, isResult, type Result } from "./review";
import {
  VOCAB, wordRow, parseRow, testPool, anchorOf, lastAsked, freshest, blank, day,
  type Context, type Entry, type Example, type Format, type Kin, type Probe, type TrainLog, type VocabRow,
} from "./vocab-spec";

export { VOCAB };

// Train ladder: each stage is the format asked next. 5 = through the ladder; kept up by review.
export const LADDER: Format[] = ["meet", "pick", "recall", "explain", "use"];
export const DONE = LADDER.length;
const FORMATS: Format[] = [...LADDER];
const UPKEEP: Format[] = ["recall", "explain", "use"];
const LOG_MAX = 80;

// Word ids are what db.id() makes. Anything else in a route never reaches a query or a file path.
export const validId = (x: string) => /^[0-9a-f]{8}$/.test(x);

const EXAMPLE = { type: "object", properties: { sentence: { type: "string" }, form: { type: "string" } }, required: ["sentence", "form"] };
const FAMILY = { type: "array", items: { type: "object", properties: {
  word: { type: "string" }, pos: { type: "string" }, relation: { type: "string" }, sense: { type: "string" }, example: EXAMPLE, separate: { type: "boolean" },
}, required: ["word", "pos", "relation", "sense", "example", "separate"] } };
const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    headword: { type: "string" }, pos: { type: "string" }, explanation: { type: "string" },
    forms: { type: "array", items: { type: "string" } },
    examples: { type: "array", items: EXAMPLE }, tests: { type: "array", items: EXAMPLE },
    confusable: { type: ["object", "null"], properties: { word: { type: "string" }, difference: { type: "string" } } },
    parts: { type: ["string", "null"] }, register: { type: ["string", "null"] },
    probes: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
    family: FAMILY,
  },
  required: ["headword", "pos", "explanation", "forms", "examples", "tests", "probes", "family"],
};

// --- the list ---------------------------------------------------------------------
// One query for the words and their cards. `writing` tells a live entry job from one lost with the
// last process, which the page offers to restart.
const WITH_CARD = `SELECT v.*, c.due card_due, c.state card_state, c.streak card_streak, c.suspended card_suspended, json_array_length(c.log) card_reviews
                   FROM vocab v LEFT JOIN cards c ON c.course='${VOCAB}' AND c.question=v.id`;
const pub = (r: any) => {
  const w = parseRow(r);
  return {
    id: w.id, word: w.word, contexts: w.contexts, courseTerm: w.course_term, entry: w.entry, status: w.status, stage: w.stage,
    writing: w.status === "pending" && liveFor(VOCAB, w.id).some((j) => j.kind === "vocab"),
    trainedAt: w.trained_at, createdAt: w.created_at, updatedAt: w.updated_at, trains: w.trainLog.filter((l) => l.result).length,
    card: r.card_due ? { due: r.card_due as string, state: r.card_state as string, streak: r.card_streak as number, suspended: !!r.card_suspended, reviews: r.card_reviews as number } : null,
  };
};
export type Word = ReturnType<typeof pub>;

export const listWords = () => (db.query(`${WITH_CARD} ORDER BY v.created_at DESC`).all() as any[]).map(pub);
export const getWord = (wid: string) => { const r = db.query(`${WITH_CARD} WHERE v.id=?`).get(wid); return r ? pub(r) : null; };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}' -]/gu, "").replace(/\s+/g, " ").trim();
const save = (wid: string, set: Record<string, unknown>) => {
  const cols = Object.keys(set);
  db.run(`UPDATE vocab SET ${cols.map((c) => `${c}=?`).join(", ")}, updated_at=? WHERE id=?`, [...cols.map((c) => set[c] as any), now(), wid]);
  state.vocab(wid);
  broadcast({ type: "vocab", id: wid });
};
const headOf = (w: Pick<VocabRow, "entry" | "word">) => w.entry?.headword ?? w.word;

// --- capture ------------------------------------------------------------------
export type Capture = { word: string; context?: string; course?: string | null; doc?: string | null; title?: string | null; url?: string | null; courseTerm?: boolean };

// A word already in the list (by what was typed or by its dictionary form) gains the new sentence as
// another context instead of becoming a second entry.
export function addWord(c: Capture): { word: Word; existed: boolean } {
  const typed = String(c.word ?? "").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!typed || typed.length > 80) throw new Error("A word or short phrase, please.");
  // `form` is the word exactly as it appears in the sentence, whatever case it was typed in.
  const text = typeof c.context === "string" ? c.context.trim().slice(0, 600) : "";
  const i = text.toLowerCase().indexOf(typed.toLowerCase());
  const opt = (x: unknown) => (typeof x === "string" && x ? x : null);
  const url = opt(c.url) && /^https?:\/\//.test(c.url!) ? c.url!.slice(0, 2000) : null;
  const ctx: Context | null = text ? { text, form: i >= 0 ? text.slice(i, i + typed.length) : typed, course: opt(c.course), doc: opt(c.doc), title: opt(c.title)?.slice(0, 200) ?? null, url, at: now() } : null;
  const existing = (db.query("SELECT id, word, entry FROM vocab").all() as any[])
    .find((r) => norm(r.word) === norm(typed) || (r.entry && norm(JSON.parse(r.entry).headword ?? "") === norm(typed)));
  if (existing) {
    const w = wordRow(existing.id)!;
    if (ctx && !w.contexts.some((x) => x.text === ctx.text)) save(w.id, { contexts: JSON.stringify([...w.contexts, ctx]) });
    syncProfiles();
    return { word: getWord(w.id)!, existed: true };
  }
  const wid = id();
  db.run("INSERT INTO vocab (id, word, contexts, course_term, status, stage, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [wid, typed, JSON.stringify(ctx ? [ctx] : []), c.courseTerm && ctx?.course ? ctx.course : null, "pending", 0, now(), now()]);
  state.vocab(wid);
  enrich(wid).catch((e) => { console.warn("vocab entry:", e.message); failed(wid); });
  syncProfiles();
  return { word: getWord(wid)!, existed: false };
}

// The learner's domains, so examples come from what they read and write.
async function domains(course: string | null): Promise<string[]> {
  if (course) { const d = readProfile(course)?.fm.domains; if (Array.isArray(d) && d.length) return d; }
  const all = (await listCourses()).flatMap((c) => readProfile(c.slug)?.fm.domains ?? []);
  return [...new Set(all as string[])].slice(0, 4);
}

// Write (or rewrite) a word's entry. A rewrite that fails keeps the old entry, so the word stays in
// Train; a first entry that fails leaves the word `failed`, with Try again on the page.
export async function enrich(wid: string) {
  const w = wordRow(wid); if (!w) return;
  if (liveFor(VOCAB, wid).some((j) => j.kind === "vocab")) {
    if (w.status === "pending") return;   // already being written
    for (const j of liveFor(VOCAB, wid)) if (j.kind === "vocab") cancel(j.id);   // new test sentences: the rewrite writes its own
  }
  if (w.status !== "pending") save(wid, { status: "pending" });
  const ctx = w.contexts[0];
  const prompt = `/vocab-entry\n\nWord as captured: ${w.word}\n${ctx ? `Sentence it was met in:\n> ${ctx.text}\n` : "Met outside a sentence (typed in).\n"}Learner's domains:\n${(await domains(ctx?.course ?? null)).map((d) => `- ${d}`).join("\n") || "- general reading"}`;
  enqueue(VOCAB, "vocab", prompt, {
    ref: wid, schema: ENTRY_SCHEMA,
    then: (e: any) => {
      const cur = wordRow(wid); if (!cur) return;   // deleted while it was being written
      const entry = cleanEntry(e, cur.word);
      if (!entry) return failed(wid);
      // The typed form ("obdurately") can turn out to be a word already in the list ("obdurate").
      // The word further up the ladder (else the older one) is kept.
      const dup = (db.query("SELECT id, entry, stage, created_at FROM vocab WHERE id<>? AND entry IS NOT NULL").all(wid) as any[])
        .find((r) => norm(JSON.parse(r.entry).headword) === norm(entry.headword));
      save(wid, { entry: JSON.stringify(entry), status: "ready" });
      if (dup) return dup.stage > cur.stage || (dup.stage === cur.stage && dup.created_at < cur.created_at) ? merge(wid, dup.id) : merge(dup.id, wid);
      broadcast({ type: "notice", kind: "vocab", ok: true, title: entry.headword, to: cur.stage === 0 ? "/vocab/train" : `/vocab#w-${wid}` });
    },
    fail: () => failed(wid),
  });
}

function failed(wid: string) {
  const w = wordRow(wid); if (!w) return;
  save(wid, { status: w.entry ? "ready" : "failed" });
  broadcast({ type: "notice", kind: "vocab", ok: false, kept: !!w.entry, title: headOf(w), to: `/vocab#w-${wid}` });
}

// Fold a duplicate into the word it turned out to be: its sentences and course-term mark move over.
function merge(from: string, into: string) {
  const a = wordRow(from)!, b = wordRow(into)!;
  const contexts = [...b.contexts, ...a.contexts.filter((c) => !b.contexts.some((x) => x.text === c.text))];
  save(into, { contexts: JSON.stringify(contexts), ...(a.course_term && !b.course_term ? { course_term: a.course_term } : {}) });
  deleteWord(from);
  broadcast({ type: "notice", kind: "vocab", ok: true, merged: true, title: headOf(b), to: `/vocab#w-${into}` });
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
function cleanEntry(e: any, word: string): Entry | null {
  const ex = (xs: unknown) => (Array.isArray(xs) ? xs : [])
    .map((x: any) => ({ sentence: str(x?.sentence), form: str(x?.form) }))
    .filter((x) => x.sentence && x.form && x.sentence.includes(x.form));
  const examples = ex(e?.examples).slice(0, 6);
  // Two examples at least: one anchors the word, the other is the first sentence it is tested in.
  if (!str(e?.explanation) || examples.length < 2) return null;
  const headword = str(e.headword) || word;
  return {
    headword, pos: str(e.pos), explanation: str(e.explanation), examples, tests: ex(e.tests).slice(0, 8),
    forms: [...new Set([headword, ...(Array.isArray(e.forms) ? e.forms.map(str).filter(Boolean) : [])])].slice(0, 8),
    confusable: str(e.confusable?.word) && str(e.confusable?.difference) ? { word: str(e.confusable.word), difference: str(e.confusable.difference) } : null,
    parts: str(e.parts) || null, register: str(e.register) || null,
    probes: (Array.isArray(e.probes) ? e.probes : []).map((p: any) => ({ question: str(p?.question), answer: str(p?.answer) })).filter((p: Probe) => p.question && p.answer).slice(0, 6),
    ...(Array.isArray(e.family) ? { family: cleanFamily(e.family, headword, e.forms) } : {}),
  };
}

// Family members: a real word, not the headword or one of its inflections, each listed once.
function cleanFamily(list: any[], headword: string, forms: unknown): Kin[] {
  const own = new Set([headword, ...(Array.isArray(forms) ? forms : [])].map((x) => norm(String(x))));
  const seen = new Set<string>();
  return list.map((k: any) => {
    const word = str(k?.word), ex = { sentence: str(k?.example?.sentence), form: str(k?.example?.form) };
    return { word, pos: str(k?.pos), relation: str(k?.relation), sense: str(k?.sense), example: ex.sentence && ex.form && ex.sentence.includes(ex.form) ? ex : null, separate: !!k?.separate };
  }).filter((k) => k.word && k.sense && k.word.length <= 40 && !own.has(norm(k.word)) && !seen.has(norm(k.word)) && seen.add(norm(k.word))).slice(0, 6);
}

// A word becomes a review card when Train first meets it, first due the next day: a card for a word
// never studied would only collect early lapses.
function ensureCard(wid: string) {
  if (db.query("SELECT 1 FROM cards WHERE course=? AND question=?").get(VOCAB, wid)) return;
  const w = wordRow(wid); if (!w) return;
  const due = new Date(Date.now() + 864e5).toISOString();
  db.run("INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, updated_at) VALUES (?,?,?,?,?,?,0,'[]','new',0,?)",
    [VOCAB, wid, `vocab/${wid}`, w.course_term, due, JSON.stringify(createEmptyCard(new Date())), now()]);
  state.card(VOCAB, wid);
  broadcast({ type: "card", course: VOCAB });
}

export function updateWord(wid: string, patch: { word?: string; entry?: Partial<Entry>; courseTerm?: string | null }) {
  const w = wordRow(wid); if (!w) return null;
  const set: Record<string, unknown> = {};
  if (typeof patch.word === "string" && patch.word.trim()) set.word = patch.word.trim().slice(0, 80);
  if (patch.entry && w.entry) {
    const e = cleanEntry({ ...w.entry, ...patch.entry }, w.word);
    if (!e) throw new Error("An entry needs an explanation and two examples that contain the word.");
    set.entry = JSON.stringify(e);
  }
  if (patch.courseTerm !== undefined) {
    // Only a course the word was met in.
    const term = patch.courseTerm && w.contexts.some((c) => c.course === patch.courseTerm) ? patch.courseTerm : null;
    set.course_term = term;
    db.run("UPDATE cards SET module=? WHERE course=? AND question=?", [term, VOCAB, wid]);
    state.card(VOCAB, wid);
  }
  if (Object.keys(set).length) save(wid, set);
  syncProfiles();
  return getWord(wid);
}

export function deleteWord(wid: string) {
  cancelFor(VOCAB, wid);   // a pending entry or grade would otherwise land on a word that is gone
  pendingReview.delete(wid);
  db.run("DELETE FROM vocab WHERE id=?", [wid]); state.vocabDeleted(wid);
  db.run("DELETE FROM cards WHERE course=? AND question=?", [VOCAB, wid]); state.cardDeleted(VOCAB, wid);
  broadcast({ type: "vocab", id: wid }); broadcast({ type: "card", course: VOCAB });
  syncProfiles();
}

// Entries cut off by the last process (a crash, a closed terminal) start again.
export function resumePending() {
  for (const r of db.query("SELECT id FROM vocab WHERE status='pending'").all() as any[])
    enrich(r.id).catch((e) => { console.warn("vocab entry:", e.message); failed(r.id); });
  // Entries written before word families existed get theirs, one background job each.
  for (const r of db.query("SELECT id, entry FROM vocab WHERE status='ready' AND entry IS NOT NULL").all() as any[])
    if (!("family" in JSON.parse(r.entry))) fillFamily(r.id);
}

// Writes only the family into an existing entry, leaving the learner's edits to the rest alone.
function fillFamily(wid: string) {
  const w = wordRow(wid);
  if (!w?.entry || liveFor(VOCAB, wid).some((j) => j.kind === "vocab")) return;
  enqueue(VOCAB, "vocab", `/vocab-entry\n\nWord family only, for: ${w.entry.headword} (${w.entry.pos}): ${w.entry.explanation}`, {
    ref: wid, schema: { type: "object", properties: { family: FAMILY }, required: ["family"] },
    then: (r: any) => {
      const cur = wordRow(wid); if (!cur?.entry || !Array.isArray(r?.family)) return;
      save(wid, { entry: JSON.stringify({ ...cur.entry, family: cleanFamily(r.family, cur.entry.headword, cur.entry.forms) }) });
    },
  });
}

// A family member added as its own word: its example sentence (seen on the entry) is where it was met,
// so the new entry is written for that sense.
export function addKin(wid: string, word: string) {
  const w = wordRow(wid);
  const k = w?.entry?.family?.find((x) => norm(x.word) === norm(word));
  if (!w?.entry || !k) return null;
  const from = w.contexts.find((c) => c.course) ?? null;
  return addWord({ word: k.word, context: k.example?.sentence, title: `Family of “${w.entry.headword}”`, course: from?.course ?? null, doc: from?.doc ?? null });
}

// Once every test sentence has been asked twice, a background job writes new ones: a sentence seen
// with its answer more than once starts to test memory for the line, not the word.
const TESTS_SCHEMA = { type: "object", properties: { tests: { type: "array", items: EXAMPLE } }, required: ["tests"] };
function refreshTests(wid: string) {
  const w = wordRow(wid);
  if (!w?.entry || liveFor(VOCAB, wid).some((j) => j.kind === "vocab")) return;
  const pool = testPool(w), seen = new Map<string, number>();
  for (const l of [...w.trainLog, ...cardLog(wid)]) if (l.sentence) seen.set(l.sentence, (seen.get(l.sentence) ?? 0) + 1);
  if (pool.length < 2 || pool.some((e) => (seen.get(e.sentence) ?? 0) < 2)) return;
  const used = [...w.entry.examples, ...pool].map((e) => `- ${e.sentence}`).join("\n");
  enqueue(VOCAB, "vocab", `/vocab-entry\n\nNew test sentences only, for: ${w.entry.headword} (${w.entry.pos}): ${w.entry.explanation}\nEvery one different from these, which the learner has seen:\n${used}`, {
    ref: wid, schema: TESTS_SCHEMA,
    then: (r: any) => {
      const cur = wordRow(wid); if (!cur?.entry) return;
      const tests = cleanEntry({ ...cur.entry, tests: r?.tests }, cur.word)?.tests ?? [];
      if (tests.length >= 2) save(wid, { entry: JSON.stringify({ ...cur.entry, tests }) });
    },
  });
}

// --- grading --------------------------------------------------------------------
// In review, the learner rates how hard the recall was; Claude (or an exact match) says whether it was
// right. Wrong is Again whatever it felt like. Partial is Hard, except a partial fill-in: a
// near-synonym means the word itself was not recalled. A correct answer takes the learner's rating.
export function vocabRating(result: Result, difficulty: number, format: Format): Grade {
  if (result === "wrong" || result === "skipped") return Rating.Again;
  if (result === "partial") return format === "recall" ? Rating.Again : Rating.Hard;
  return difficulty >= 3 ? Rating.Easy : difficulty === 2 ? Rating.Good : Rating.Hard;
}

export type Attempt = { format: Format; sentence: string; form: string; answer: string; difficulty?: number; mode: "review" | "train"; result?: Result; probe?: Probe };
type Graded = { result: Result; note: string };

export function parseAttempt(b: any): Attempt | null {
  if (!b || !FORMATS.includes(b.format) || !["review", "train"].includes(b.mode) || typeof b.answer !== "string") return null;
  return {
    format: b.format, mode: b.mode, answer: b.answer.slice(0, 2000), sentence: str(b.sentence), form: str(b.form),
    difficulty: Number.isInteger(b.difficulty) ? Math.min(3, Math.max(0, b.difficulty)) : 0,
    result: isResult(b.result) ? b.result : undefined,
    probe: b.probe && typeof b.probe.question === "string" && typeof b.probe.answer === "string" ? { question: b.probe.question, answer: b.probe.answer } : undefined,
  };
}

// A fill-in that is the word or one of its listed forms needs no grader. Nothing looser: "principle"
// for "principal" is the mix-up the grader exists to catch, and never the confusable itself.
const exact = (answer: string, form: string, e: Entry) => {
  const a = norm(answer);
  if (!a || (e.confusable && a === norm(e.confusable.word))) return false;
  return [form, e.headword, ...(e.forms ?? []), ...e.examples.map((x) => x.form), ...(e.tests ?? []).map((x) => x.form)].some((f) => norm(f) === a);
};

// Review grades in flight, one per card: a re-check supersedes the earlier job, which must not rate
// the card a second time. Finished grades are kept a while by job id, so a page that missed the
// event (a refresh, a dropped connection) can still collect its grade.
const pendingReview = new Map<string, string>();
const grades = new Map<string, Graded | { error: string }>();
const keep = (job: string, g: Graded | { error: string }) => { grades.set(job, g); if (grades.size > 200) grades.delete(grades.keys().next().value!); };
export function gradeOf(job: string) {
  if (grades.has(job)) return grades.get(job)!;
  return jobs().some((j) => j.id === job) ? { pending: true } : { error: "The grade was lost when the server restarted." };
}

export function answer(wid: string, a: Attempt, done: (g: Graded | { error: string }, job: string | null) => void): { job: string | null; result?: Result; note?: string; review?: unknown } {
  const w = wordRow(wid);
  if (!w?.entry) throw new Error("word not ready");
  const entry = w.entry;
  const at_once = (g: Graded) => { if (a.mode === "review") pendingReview.delete(wid); const review = record(wid, a, g); done(g, null); return { job: null, ...g, review }; };
  if (a.format === "pick" && a.result) return at_once({ result: a.result, note: "" });
  if (!a.answer.trim()) return at_once({ result: "skipped", note: "" });
  if (a.format === "recall" && exact(a.answer, a.form, entry)) return at_once({ result: "correct", note: "" });
  const flag = (db.query("SELECT flag FROM cards WHERE course=? AND question=?").get(VOCAB, wid) as any)?.flag;
  const current = () => a.mode !== "review" || pendingReview.get(wid) === job.id;
  const job = enqueue(VOCAB, "grade", `/grade-vocab\n\n${JSON.stringify({
    headword: entry.headword, pos: entry.pos, explanation: entry.explanation, confusable: entry.confusable,
    format: a.probe ? "probe" : a.format, sentence: a.probe ? undefined : a.sentence, expected: a.format === "recall" ? a.form : undefined,
    question: a.probe?.question, model_answer: a.probe?.answer, answer: a.answer,
  }, null, 2)}${flag ? `\n\nThe learner flagged an earlier grade on this word as wrong: "${flag}". Weigh that before scoring.` : ""}`, {
    ref: wid, schema: GRADE_SCHEMA,
    then: (g: any) => {
      if (!current()) return;
      pendingReview.delete(wid);
      // A garbled grade is the grader's failure, not the learner's: nothing is recorded.
      if (!isResult(g?.result)) { keep(job.id, { error: "The grader returned no grade." }); return done({ error: "The grader returned no grade." }, job.id); }
      const graded = { result: g.result, note: typeof g.note === "string" ? g.note : "" };
      if (!wordRow(wid)) return;   // deleted while grading
      record(wid, a, graded); keep(job.id, graded); done(graded, job.id);
    },
    fail: (j) => {
      if (!current()) return;
      pendingReview.delete(wid);
      const err = { error: j.status === "cancelled" ? "Grading was cancelled." : "Grading failed." };
      keep(j.id, err); done(err, j.id);
    },
  });
  if (a.mode === "review") pendingReview.set(wid, job.id);
  return { job: job.id };
}

// Review rates the card. Train only logs: the ladder moves when a word's session is finished.
function record(wid: string, a: Attempt, g: Graded) {
  const w = wordRow(wid); if (!w) return null;
  if (a.mode === "review") {
    if (!db.query("SELECT 1 FROM cards WHERE course=? AND question=?").get(VOCAB, wid)) return null;
    // Recall effort is logged as `difficulty`, never as `confidence`: it is not a calibration signal.
    const r = rate(VOCAB, wid, `vocab/${wid}`, g.result, null, null, { answer: a.answer, note: g.note, rating: vocabRating(g.result, a.difficulty ?? 0, a.format), log: { format: a.format, sentence: a.sentence, difficulty: a.difficulty ?? 0 } });
    broadcast({ type: "card", course: VOCAB, question: wid });
    syncProfiles(); refreshTests(wid);
    return r;
  }
  const line: TrainLog = { at: now(), format: a.format, result: g.result, answer: a.answer, note: g.note || undefined, sentence: a.probe ? undefined : a.sentence || undefined, probe: a.probe?.question };
  save(wid, { train_log: JSON.stringify([...w.trainLog, line].slice(-LOG_MAX)), trained_at: now() });
  refreshTests(wid);
  return null;
}

export function meet(wid: string) {
  const w = wordRow(wid); if (!w?.entry) return null;
  if (w.stage === 0) save(wid, { stage: 1, trained_at: now(), train_log: JSON.stringify([...w.trainLog, { at: now(), format: "meet" }].slice(-LOG_MAX)) });
  ensureCard(wid);
  return getWord(wid);
}

// The end of a word's turn in a session. Three correct answers and no misses climb one rung, at most
// once a day: the next day's session is the spaced relearning that makes it stick. Two misses drop a
// rung. A word through the ladder needs one correct.
export const CRITERION = 3;
export function finishWord(wid: string, s: { correct: number; wrong: number }) {
  const w = wordRow(wid); if (!w) return null;
  const correct = Number(s?.correct) || 0, wrong = Number(s?.wrong) || 0;
  const climbedToday = w.trainLog.some((l) => l.format === "climb" && day(l.at) === day());
  let stage = w.stage, event: "climb" | "drop" | null = null;
  if (stage < DONE && correct >= CRITERION && wrong === 0 && !climbedToday) { stage += 1; event = "climb"; }
  else if (wrong >= 2 && stage > 1) { stage -= 1; event = "drop"; }
  if (event) {
    save(wid, { stage, train_log: JSON.stringify([...w.trainLog, { at: now(), format: event, stage }].slice(-LOG_MAX)) });
    syncProfiles();
  }
  return { stage, event, climbedToday };
}

// --- train sessions --------------------------------------------------------------
export type Task = {
  word: string; format: Format; stage: number; headword: string; entry: Entry; contexts: Context[]; courseTerm: string | null;
  sentence: string; form: string; anchor: Example; prompt: string; hint?: string; options?: string[]; answer?: number; probe?: Probe;
};

const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cardLog = (wid: string) => { const r = db.query("SELECT log FROM cards WHERE course=? AND question=?").get(VOCAB, wid) as any; return r ? JSON.parse(r.log) : []; };

// One task at a word's rung, in the test sentence asked longest ago, across Train and review: the
// learner has not been shown it with its answer, or not for the longest time.
export function task(wid: string, stage?: number): Task | null {
  const w = wordRow(wid);
  if (!w?.entry) return null;
  const e = w.entry;
  const s = Math.max(0, Math.min(DONE, stage ?? w.stage));
  // Upkeep rotates recall → explain → use from the last format asked.
  const lastFormat = w.trainLog.filter((l) => l.result).at(-1)?.format as Format | undefined;
  const format: Format = s >= DONE ? UPKEEP[(UPKEEP.indexOf(lastFormat ?? "use") + 1) % UPKEEP.length] : LADDER[s];
  const pool = testPool(w), last = lastAsked(w, cardLog(wid));
  const ex = freshest(pool, last);
  const base = { word: wid, format, stage: s, headword: e.headword, entry: e, contexts: w.contexts, courseTerm: w.course_term, sentence: ex.sentence, form: ex.form, anchor: anchorOf(w) };
  if (format === "meet") return { ...base, prompt: "" };
  if (format === "pick") {
    // Options are headwords, all in the same form, so grammar and capitals give nothing away; a
    // sentence that uses the headword itself is preferred. Distractors: other words in the list, same
    // part of speech first, never the word it is confused with: near-neighbours are contrasted once
    // each is known, not while one is new.
    const px = freshest(pool, last, (x) => norm(x.form) === norm(e.headword));
    const others = (db.query("SELECT entry FROM vocab WHERE status='ready' AND id<>?").all(wid) as any[]).map((r) => JSON.parse(r.entry) as Entry);
    const avoid = new Set([norm(e.headword), norm(e.confusable?.word ?? "")]);
    const same = shuffle(others.filter((o) => o.pos === e.pos)).map((o) => o.headword);
    const rest = shuffle(others.filter((o) => o.pos !== e.pos)).map((o) => o.headword);
    const distractors = [...new Set([...same, ...rest])].filter((x) => !avoid.has(norm(x))).slice(0, 3);
    if (distractors.length < 2) return task(wid, 2);   // too few words yet for a fair choice: recall instead
    const options = shuffle([e.headword, ...distractors]);
    return { ...base, sentence: px.sentence, form: px.form, prompt: `Which word fits?\n\n> ${blank(px)}`, options, answer: options.indexOf(e.headword) };
  }
  if (format === "recall") return { ...base, prompt: `Which word fits the blank?\n\n> ${blank(ex)}`, hint: `${ex.form[0]}${" _".repeat(Math.max(0, ex.form.length - 1))} (${ex.form.length} letters)` };
  if (format === "explain") return { ...base, prompt: `What does **${ex.form}** mean in this sentence?\n\n> ${ex.sentence}` };
  // Use: a probe, a question whose answer has to show the meaning; the one asked longest ago, and
  // none asked earlier today, since its model answer was shown then. With none left, a situation to
  // describe. Not "write a sentence with X", which tests poorly.
  const asked = new Map<string, string>();
  for (const l of w.trainLog) if (l.probe) asked.set(l.probe, l.at);
  const probe = (e.probes ?? []).filter((p) => !asked.has(p.question) || day(asked.get(p.question)) !== day())
    .sort((a, b) => ((asked.get(a.question) ?? "") < (asked.get(b.question) ?? "") ? -1 : 1))[0];
  return probe
    ? { ...base, prompt: `${probe.question} Say why.`, probe }
    : { ...base, prompt: `Describe a real situation, from your work or reading, that **${e.headword}** fits. One or two sentences, using the word, so that someone who did not know it could work out what it means.` };
}

// Today's words: up to 5 new ones, then the climbing words trained longest ago, then two through the
// ladder for upkeep. Left out: suspended words, words already trained today, words whose review card
// is due today (review first, so Train cannot inflate it), and a new word whose confusable is new or
// still low on the ladder.
function pick(limit = 12) {
  const today = day();
  const rows = (db.query(`SELECT v.*, c.due card_due, c.suspended card_suspended FROM vocab v LEFT JOIN cards c ON c.course='${VOCAB}' AND c.question=v.id WHERE v.status='ready'`).all() as any[])
    .filter((r) => !r.card_suspended).map((r) => ({ ...parseRow(r), due: r.card_due as string | null }));
  const dueToday = (r: { due: string | null }) => !!r.due && day(r.due) <= today;
  const notToday = (r: VocabRow) => !r.trained_at || day(r.trained_at) !== today;
  const byOldest = (a: VocabRow, b: VocabRow) => ((a.trained_at ?? "") < (b.trained_at ?? "") ? -1 : 1);
  const head = (r: VocabRow) => norm(r.entry!.headword), conf = (r: VocabRow) => norm(r.entry!.confusable?.word ?? "");
  const related = (a: VocabRow, b: VocabRow) => conf(a) === head(b) || conf(b) === head(a);
  const low = rows.filter((r) => r.stage > 0 && r.stage < 3);
  const fresh: VocabRow[] = [];
  let held = 0;
  for (const r of rows.filter((r) => r.stage === 0).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (fresh.length >= 5) break;
    if (fresh.some((f) => related(f, r)) || low.some((l) => related(l, r))) { held++; continue; }
    fresh.push(r);
  }
  const climbing = rows.filter((r) => r.stage > 0 && r.stage < DONE && notToday(r) && !dueToday(r)).sort(byOldest);
  const upkeep = rows.filter((r) => r.stage >= DONE && notToday(r) && !dueToday(r)).sort(byOldest).slice(0, 2);
  const picked = [...[...fresh, ...climbing].slice(0, limit - upkeep.length), ...upkeep];
  return { picked, reviewFirst: rows.filter((r) => r.stage > 0 && notToday(r) && dueToday(r)).length, held };
}

// A session in progress, kept on the server so a refresh, another tab or a dropped connection picks
// it up where it was. The client owns its shape; it only has to be today's and unfinished.
export type SavedSession = { day: string; i: number; queue: (Task | { word: string; placeholder: true })[]; tally: Record<string, unknown>; pending?: unknown };
export function saveSession(s: SavedSession | null) { state.trainSession(s); }

export function session(fresh = false) {
  const saved = fresh ? null : (state.loadTrainSession() as SavedSession | null);
  if (saved && saved.day === day() && Array.isArray(saved.queue) && saved.i < saved.queue.length) {
    // Drop the tasks still ahead for words deleted or no longer ready since.
    const ready = new Set((db.query("SELECT id FROM vocab WHERE status='ready'").all() as any[]).map((r) => r.id));
    const queue = saved.queue.filter((t, k) => k < saved.i || ready.has(t.word));
    return { resume: { ...saved, queue }, tasks: [], counts: counts(), criterion: CRITERION };
  }
  return { tasks: pick().picked.map((r) => task(r.id)).filter(Boolean) as Task[], counts: counts(), criterion: CRITERION };
}

export function counts() {
  const rows = db.query("SELECT status, stage, trained_at FROM vocab").all() as any[];
  const today = day(), p = pick();
  return {
    total: rows.length, pending: rows.filter((r) => r.status === "pending").length, failed: rows.filter((r) => r.status === "failed").length,
    new: rows.filter((r) => r.status === "ready" && r.stage === 0).length,
    climbing: rows.filter((r) => r.status === "ready" && r.stage > 0 && r.stage < DONE).length,
    through: rows.filter((r) => r.stage >= DONE).length,
    trainedToday: rows.filter((r) => r.trained_at && day(r.trained_at) === today).length,
    trainable: p.picked.length, reviewFirst: p.reviewFirst, held: p.held,
  };
}

// --- the course's learner profile ------------------------------------------------
// Each course's learner.md lists the words captured while reading it: `learning` until the word is
// through the Train ladder or learned in review, then `owns`. Module generation may use them.
export async function syncProfilesNow() {
  const words = db.query("SELECT v.id, v.word, v.entry, v.stage, v.contexts, c.state FROM vocab v LEFT JOIN cards c ON c.course=? AND c.question=v.id").all(VOCAB) as any[];
  for (const course of await listCourses()) {
    const mine = words.filter((w) => JSON.parse(w.contexts).some((c: Context) => c.course === course.slug));
    const name = (w: any) => (w.entry ? JSON.parse(w.entry).headword : w.word);
    const owns = mine.filter((w) => w.stage >= DONE || w.state === "learned").map(name).sort();
    const learning = mine.filter((w) => !(w.stage >= DONE || w.state === "learned")).map(name).sort();
    if (!readProfile(course.slug)) continue;
    patchProfile(course.slug, { vocab_words: mine.length ? { learning, owns } : undefined });
  }
}
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const syncProfiles = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncProfilesNow().catch((e) => console.warn("vocab profile:", e.message)); }, 2000); };
