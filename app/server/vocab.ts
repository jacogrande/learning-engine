// Vocabulary: general words the learner collects while reading. A word is captured with the sentence
// it was met in; a background job writes the entry (a plain explanation, examples in varied
// contexts, the word it is confused with); then it becomes a review card and climbs the Train
// ladder. See docs/vocab-spec.md.
import { Rating, createEmptyCard, type Grade } from "ts-fsrs";
import { db, id, now } from "./db";
import { state } from "./state";
import { enqueue } from "./jobs";
import { broadcast } from "./events";
import { listCourses } from "./content";
import { rate, readProfile, patchProfile, type Result } from "./review";
import { VOCAB, wordRow, sentences, blank, type Context, type Entry, type Example, type Format } from "./vocab-spec";

export { VOCAB };

// Train ladder: each stage is the format asked next. 5 = through the ladder; kept up by review.
export const LADDER: Format[] = ["meet", "pick", "recall", "explain", "use"];
export const DONE = LADDER.length;

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    headword: { type: "string" }, pos: { type: "string" }, explanation: { type: "string" },
    examples: { type: "array", items: { type: "object", properties: { sentence: { type: "string" }, form: { type: "string" } }, required: ["sentence", "form"] } },
    confusable: { type: ["object", "null"], properties: { word: { type: "string" }, difference: { type: "string" } } },
    parts: { type: ["string", "null"] }, register: { type: ["string", "null"] },
    probes: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
  },
  required: ["headword", "pos", "explanation", "examples"],
};
const GRADE_SCHEMA = { type: "object", properties: { result: { type: "string", enum: ["correct", "partial", "wrong", "skipped"] }, note: { type: "string" } }, required: ["result", "note"] };

const pub = (w: NonNullable<ReturnType<typeof wordRow>>) => {
  const card = db.query("SELECT due, state, streak, suspended, log FROM cards WHERE course=? AND question=?").get(VOCAB, w.id) as any;
  return {
    id: w.id, word: w.word, contexts: w.contexts, courseTerm: w.course_term, entry: w.entry, status: w.status, stage: w.stage,
    trainedAt: w.trained_at, createdAt: w.created_at, updatedAt: w.updated_at, trains: w.trainLog.length,
    card: card ? { due: card.due, state: card.state, streak: card.streak, suspended: !!card.suspended, reviews: JSON.parse(card.log).length } : null,
  };
};
export type Word = ReturnType<typeof pub>;

export const listWords = () => (db.query("SELECT id FROM vocab ORDER BY created_at DESC").all() as any[]).map((r) => pub(wordRow(r.id)!));
export const getWord = (wid: string) => { const w = wordRow(wid); return w ? pub(w) : null; };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}' -]/gu, "").replace(/\s+/g, " ").trim();
const save = (wid: string, set: Record<string, unknown>) => {
  const cols = Object.keys(set);
  db.run(`UPDATE vocab SET ${cols.map((c) => `${c}=?`).join(", ")}, updated_at=? WHERE id=?`, [...cols.map((c) => set[c] as any), now(), wid]);
  state.vocab(wid);
  broadcast({ type: "vocab", id: wid });
};

// --- capture ------------------------------------------------------------------
export type Capture = { word: string; context?: string; course?: string | null; doc?: string | null; title?: string | null; courseTerm?: boolean };

// A word already in the list (by what was typed or by its dictionary form) gains the new sentence as
// another context instead of becoming a second entry.
export function addWord(c: Capture): { word: Word; existed: boolean } {
  const typed = c.word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!typed || typed.length > 80) throw new Error("A word or short phrase, please.");
  // `form` is the word exactly as it appears in the sentence, whatever case it was typed in.
  const text = c.context?.trim().slice(0, 600) ?? "";
  const at = text.toLowerCase().indexOf(typed.toLowerCase());
  const ctx: Context | null = text ? { text, form: at >= 0 ? text.slice(at, at + typed.length) : typed, course: c.course ?? null, doc: c.doc ?? null, title: c.title ?? null, at: now() } : null;
  const existing = (db.query("SELECT id, word, entry FROM vocab").all() as any[])
    .find((r) => norm(r.word) === norm(typed) || (r.entry && norm(JSON.parse(r.entry).headword ?? "") === norm(typed)));
  if (existing) {
    const w = wordRow(existing.id)!;
    if (ctx && !w.contexts.some((x: Context) => x.text === ctx.text)) save(w.id, { contexts: JSON.stringify([...w.contexts, ctx]) });
    syncProfiles();
    return { word: getWord(w.id)!, existed: true };
  }
  const wid = id();
  db.run("INSERT INTO vocab (id, word, contexts, course_term, status, stage, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [wid, typed, JSON.stringify(ctx ? [ctx] : []), c.courseTerm && c.course ? c.course : null, "pending", 0, now(), now()]);
  state.vocab(wid);
  enrich(wid);
  syncProfiles();
  return { word: getWord(wid)!, existed: false };
}

// The learner's domains, so examples come from what they read and write.
async function domains(course: string | null): Promise<string[]> {
  if (course) { const d = readProfile(course)?.fm.domains; if (Array.isArray(d) && d.length) return d; }
  const all = (await listCourses()).flatMap((c) => readProfile(c.slug)?.fm.domains ?? []);
  return [...new Set(all as string[])].slice(0, 4);
}

export async function enrich(wid: string) {
  const w = wordRow(wid); if (!w) return;
  if (w.status !== "pending") save(wid, { status: "pending" });
  const ctx = w.contexts[0];
  const prompt = `/vocab-entry\n\nWord as captured: ${w.word}\n${ctx ? `Sentence it was met in:\n> ${ctx.text}\n` : "Met outside a sentence (typed in).\n"}Learner's domains:\n${(await domains(ctx?.course ?? null)).map((d) => `- ${d}`).join("\n") || "- general reading"}`;
  enqueue(VOCAB, "vocab", prompt, {
    ref: wid, schema: ENTRY_SCHEMA,
    then: (e: any) => {
      const entry = cleanEntry(e, w.word);
      if (!entry) return save(wid, { status: "failed" });
      save(wid, { entry: JSON.stringify(entry), status: "ready" });
      ensureCard(wid);
      broadcast({ type: "notice", kind: "vocab", ok: true, title: entry.headword, to: `/vocab#w-${wid}` });
    },
    fail: () => save(wid, { status: "failed" }),
  });
}

function cleanEntry(e: any, word: string): Entry | null {
  if (!e?.explanation || !Array.isArray(e.examples)) return null;
  const examples: Example[] = e.examples.filter((x: any) => typeof x?.sentence === "string" && typeof x?.form === "string" && x.sentence.includes(x.form)).slice(0, 6);
  if (!examples.length) return null;
  return {
    headword: String(e.headword || word), pos: String(e.pos ?? ""), explanation: String(e.explanation), examples,
    confusable: e.confusable?.word && e.confusable?.difference ? { word: String(e.confusable.word), difference: String(e.confusable.difference) } : null,
    parts: e.parts ? String(e.parts) : null, register: e.register ? String(e.register) : null,
    probes: Array.isArray(e.probes) ? e.probes.filter((p: any) => p?.question && p?.answer).map((p: any) => ({ question: String(p.question), answer: String(p.answer) })).slice(0, 4) : [],
  };
}

// A ready word becomes a review card, first due tomorrow: Train meets it today, review spaces it.
function ensureCard(wid: string) {
  if (db.query("SELECT 1 FROM cards WHERE course=? AND question=?").get(VOCAB, wid)) return;
  const w = wordRow(wid)!;
  const due = new Date(Date.now() + 864e5).toISOString();
  db.run("INSERT INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, updated_at) VALUES (?,?,?,?,?,?,0,'[]','new',0,?)",
    [VOCAB, wid, `vocab/${wid}`, w.course_term, due, JSON.stringify(createEmptyCard(new Date())), now()]);
  state.card(VOCAB, wid);
  broadcast({ type: "card", course: VOCAB });
}

export function updateWord(wid: string, patch: { word?: string; entry?: Partial<Entry>; courseTerm?: string | null }) {
  const w = wordRow(wid); if (!w) return null;
  const set: Record<string, unknown> = {};
  if (patch.word?.trim()) set.word = patch.word.trim();
  if (patch.entry && w.entry) { const e = cleanEntry({ ...w.entry, ...patch.entry }, w.word); if (e) set.entry = JSON.stringify(e); }
  if (patch.courseTerm !== undefined) {
    set.course_term = patch.courseTerm;
    db.run("UPDATE cards SET module=? WHERE course=? AND question=?", [patch.courseTerm, VOCAB, wid]);
    state.card(VOCAB, wid);
  }
  if (Object.keys(set).length) save(wid, set);
  syncProfiles();
  return getWord(wid);
}

export function deleteWord(wid: string) {
  db.run("DELETE FROM vocab WHERE id=?", [wid]); state.vocabDeleted(wid);
  db.run("DELETE FROM cards WHERE course=? AND question=?", [VOCAB, wid]); state.cardDeleted(VOCAB, wid);
  broadcast({ type: "vocab", id: wid }); broadcast({ type: "card", course: VOCAB });
  syncProfiles();
}

// --- grading --------------------------------------------------------------------
// The learner rates how hard the recall was; Claude (or an exact match) says whether it was right.
// Wrong is Again whatever it felt like; partial is Hard; a correct answer takes the learner's rating.
export const DIFFICULTY = ["Effortful", "Some effort", "Instant"];
export function vocabRating(result: Result, difficulty: number): Grade {
  if (result === "wrong" || result === "skipped") return Rating.Again;
  if (result === "partial") return Rating.Hard;
  return difficulty >= 3 ? Rating.Easy : difficulty === 2 ? Rating.Good : Rating.Hard;
}

export type Probe = { question: string; answer: string };
export type Attempt = { format: Format; sentence: string; form: string; answer: string; difficulty: number; mode: "review" | "train"; result?: Result; probe?: Probe };

// Exact recall (an inflection of the word counts) needs no grader.
const sameWord = (answer: string, form: string, head: string) => {
  const a = norm(answer); if (!a) return false;
  return [form, head].some((t) => { const n = norm(t); return a === n || (n.length > 4 && a.startsWith(n.slice(0, -2)) && Math.abs(a.length - n.length) <= 3); });
};

export function answer(wid: string, a: Attempt, done: (g: { result: Result; note: string }) => void): { job: string | null; result?: Result; note?: string } {
  const w = wordRow(wid);
  if (!w?.entry) throw new Error("word not ready");
  const finish = (g: { result: Result; note: string }) => { record(w.id, a, g); done(g); };
  const now_ = (g: { result: Result; note: string }) => { finish(g); return { job: null, ...g }; };
  if (a.format === "pick" && a.result) return now_({ result: a.result, note: "" });
  if (!a.answer.trim()) return now_({ result: "skipped", note: "" });
  if (a.format === "recall" && sameWord(a.answer, a.form, w.entry.headword)) return now_({ result: "correct", note: "" });
  const flag = (db.query("SELECT flag FROM cards WHERE course=? AND question=?").get(VOCAB, wid) as any)?.flag;
  const job = enqueue(VOCAB, "grade", `/grade-vocab\n\n${JSON.stringify({
    headword: w.entry.headword, pos: w.entry.pos, explanation: w.entry.explanation, confusable: w.entry.confusable,
    format: a.probe ? "probe" : a.format, sentence: a.probe ? undefined : a.sentence, expected: a.format === "recall" ? a.form : undefined,
    question: a.probe?.question, model_answer: a.probe?.answer, answer: a.answer,
  }, null, 2)}${flag ? `\n\nThe learner flagged an earlier grade on this word as wrong: "${flag}". Weigh that before scoring.` : ""}`, {
    ref: wid, schema: GRADE_SCHEMA, then: (g: any) => finish({ result: g?.result ?? "wrong", note: g?.note ?? "" }),
  });
  return { job: job.id };
}

// Review rates the card. Train only logs: the ladder moves when a word's session is finished.
function record(wid: string, a: Attempt, g: { result: Result; note: string }) {
  if (a.mode === "review") {
    rate(VOCAB, wid, `vocab/${wid}`, g.result, a.difficulty, null, { answer: a.answer, note: g.note, rating: vocabRating(g.result, a.difficulty), format: a.format });
    broadcast({ type: "card", course: VOCAB, question: wid });
    syncProfiles();
    return;
  }
  const w = wordRow(wid)!;
  const log = [...w.trainLog, { at: now(), format: a.format, result: g.result, difficulty: a.difficulty, answer: a.answer, note: g.note || undefined }].slice(-80);
  save(wid, { train_log: JSON.stringify(log), trained_at: now() });
}

export function meet(wid: string) {
  const w = wordRow(wid); if (!w) return null;
  if (w.stage === 0) save(wid, { stage: 1, trained_at: now(), train_log: JSON.stringify([...w.trainLog, { at: now(), format: "meet" }]) });
  return getWord(wid);
}

// The end of a word's turn in a session. Three correct answers and no misses climb one rung, at most
// once a day: same-day performance overstates what will last, and the next day's session is the
// relearning that makes it stick. Two misses drop a rung. A word through the ladder needs one correct.
export const CRITERION = 3;
export function finishWord(wid: string, s: { correct: number; wrong: number }) {
  const w = wordRow(wid); if (!w) return null;
  const today = now().slice(0, 10);
  const climbedToday = w.trainLog.some((l: any) => l.format === "climb" && l.at.slice(0, 10) === today);
  let stage = w.stage, event: string | null = null;
  if (stage < DONE && s.correct >= CRITERION && s.wrong === 0 && !climbedToday) { stage += 1; event = "climb"; }
  else if (s.wrong >= 2 && stage > 1) { stage -= 1; event = "drop"; }
  if (event) {
    save(wid, { stage, train_log: JSON.stringify([...w.trainLog, { at: now(), format: event, stage }].slice(-80)) });
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

// The sentence a new word is anchored in: where the learner met it, else the first example.
const anchorOf = (w: { entry: Entry | null; contexts: Context[] }): Example => {
  const c = w.contexts.find((x) => x.text.includes(x.form));
  return c ? { sentence: c.text, form: c.form } : w.entry!.examples[0];
};

// One task at a word's rung, in a sentence other than the last few it was asked in. Tests use the
// generated examples first: sentences the learner has not seen, so the word is recalled, not the line.
export function task(wid: string, stage?: number): Task | null {
  const w = wordRow(wid);
  if (!w?.entry) return null;
  const s = stage ?? w.stage;
  const n = w.trainLog.filter((l: any) => l.result).length;
  const format: Format = s >= DONE ? (["recall", "explain", "use"] as Format[])[n % 3] : LADDER[s];
  const all = sentences(w), anchor = anchorOf(w);
  const ex = all[n % all.length];
  const base = { word: wid, format, stage: s, headword: w.entry.headword, entry: w.entry, contexts: w.contexts, courseTerm: w.course_term, sentence: ex.sentence, form: ex.form, anchor };
  if (format === "meet") return { ...base, prompt: "" };
  if (format === "pick") {
    // Distractors: other words in the list, same part of speech first. Never the word it is confused
    // with: near-neighbours are contrasted once each is known, not while one is new.
    const others = (db.query("SELECT entry FROM vocab WHERE status='ready' AND id<>?").all(wid) as any[]).map((r) => JSON.parse(r.entry) as Entry);
    const avoid = new Set([norm(w.entry.headword), norm(w.entry.confusable?.word ?? "")]);
    const same = shuffle(others.filter((o) => o.pos === w.entry!.pos)).map((o) => o.headword);
    const rest = shuffle(others.filter((o) => o.pos !== w.entry!.pos)).map((o) => o.headword);
    const pool = [...new Set([...same, ...rest])].filter((x) => !avoid.has(norm(x))).slice(0, 3);
    if (pool.length < 2) return task(wid, 2);   // too few words yet for a fair choice: recall instead
    const options = shuffle([ex.form, ...pool]);
    return { ...base, prompt: `Which word fits?\n\n> ${blank(ex)}`, options, answer: options.indexOf(ex.form) };
  }
  if (format === "recall") return { ...base, prompt: `Which word fits the blank?\n\n> ${blank(ex)}`, hint: `${ex.form[0]}${" _".repeat(Math.max(0, ex.form.length - 1))} (${ex.form.length} letters)` };
  if (format === "explain") return { ...base, prompt: `What does **${ex.form}** mean in this sentence?\n\n> ${ex.sentence}` };
  // Use: a question whose answer has to show the meaning, or a situation to describe. Not "write a
  // sentence with X", which tests poorly.
  const probes = (w.entry as any).probes as Probe[] | undefined;
  const probe = probes?.length && n % 3 !== 2 ? probes[n % probes.length] : undefined;
  return probe
    ? { ...base, prompt: `${probe.question} Say why.`, probe }
    : { ...base, prompt: `Describe a real situation, from your work or reading, that **${w.entry.headword}** fits. One or two sentences, using the word, so that someone who did not know it could work out what it means.` };
}

// Today's session: up to 5 new words, then the words lowest on the ladder not yet trained today,
// then two through the ladder for upkeep. A new word whose confusable is also new waits a day.
export function session(limit = 12) {
  const today = now().slice(0, 10);
  const ready = (db.query("SELECT id, stage, trained_at, created_at, entry FROM vocab WHERE status='ready'").all() as any[])
    .filter((r) => !(db.query("SELECT suspended FROM cards WHERE course=? AND question=?").get(VOCAB, r.id) as any)?.suspended);
  const notToday = (r: any) => (r.trained_at ?? "").slice(0, 10) !== today;
  const head = (r: any) => norm(JSON.parse(r.entry).headword), conf = (r: any) => norm(JSON.parse(r.entry).confusable?.word ?? "");
  const fresh: any[] = [];
  for (const r of ready.filter((r) => r.stage === 0).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (fresh.length >= 5) break;
    if (!fresh.some((f) => conf(f) === head(r) || conf(r) === head(f))) fresh.push(r);
  }
  const climbing = ready.filter((r) => r.stage > 0 && r.stage < DONE && notToday(r)).sort((a, b) => a.stage - b.stage || ((a.trained_at ?? "") < (b.trained_at ?? "") ? -1 : 1));
  const upkeep = ready.filter((r) => r.stage >= DONE && notToday(r)).sort((a, b) => ((a.trained_at ?? "") < (b.trained_at ?? "") ? -1 : 1)).slice(0, 2);
  const picked = [...[...fresh, ...climbing].slice(0, limit - upkeep.length), ...upkeep];
  return { tasks: picked.map((r) => task(r.id)).filter(Boolean) as Task[], counts: counts(), criterion: CRITERION };
}

export function counts() {
  const rows = db.query("SELECT status, stage, trained_at FROM vocab").all() as any[];
  const today = now().slice(0, 10);
  return {
    total: rows.length, pending: rows.filter((r) => r.status === "pending").length, failed: rows.filter((r) => r.status === "failed").length,
    new: rows.filter((r) => r.status === "ready" && r.stage === 0).length,
    climbing: rows.filter((r) => r.status === "ready" && r.stage > 0 && r.stage < DONE).length,
    through: rows.filter((r) => r.stage >= DONE).length,
    trainedToday: rows.filter((r) => (r.trained_at ?? "").slice(0, 10) === today).length,
    trainable: rows.filter((r) => r.status === "ready" && (r.stage === 0 || (r.trained_at ?? "").slice(0, 10) !== today)).length,
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
