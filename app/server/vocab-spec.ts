// What a vocabulary word looks like as a review card. Kept apart from vocab.ts so the review
// scheduler can build vocab cards without importing the job and capture code.
import { db } from "./db";

// Vocab cards live in `cards` under this pseudo-course. Their `module` holds the course slug when
// the word is one of that course's own terms, so a course's review can include it.
export const VOCAB = "_vocab";

export type Example = { sentence: string; form: string };
export type Probe = { question: string; answer: string };
// A word built on the same root (`bereave`, `bereavement` beside `bereft`). `separate`: its meaning has
// drifted, or it is easily confused with the headword, so it is worth learning as its own word.
export type Kin = { word: string; pos: string; relation: string; sense: string; example: Example | null; separate: boolean };
// `examples` teach: each makes the meaning inferable. `tests` only fit: a learner who does not know
// the word cannot read its meaning off them, so they test the word, not inference. `forms` are the
// headword's inflections, the only answers a fill-in accepts without the grader.
export type Entry = {
  headword: string; pos: string; explanation: string; examples: Example[]; tests?: Example[]; forms?: string[];
  confusable: { word: string; difference: string } | null; parts: string | null; register: string | null; probes?: Probe[];
  family?: Kin[];   // absent on entries written before families existed; a background job fills it in
};
// `url`: the web page a word was captured from (the browser extension); course words have `doc` instead.
export type Context = { text: string; form: string; course: string | null; doc: string | null; title: string | null; url?: string | null; at: string };
export type Format = "meet" | "pick" | "recall" | "explain" | "use";
// One line of a word's Train log: an attempt (with the sentence or probe asked), meet, or a ladder move.
export type TrainLog = { at: string; format: Format | "climb" | "drop"; result?: string; answer?: string; note?: string; sentence?: string; probe?: string; stage?: number };
export type VocabRow = {
  id: string; word: string; contexts: Context[]; course_term: string | null; entry: Entry | null; status: "pending" | "ready" | "failed";
  stage: number; trainLog: TrainLog[]; trained_at: string | null; created_at: string; updated_at: string;
};

export function wordRow(id: string): VocabRow | null {
  const r = db.query("SELECT * FROM vocab WHERE id=?").get(id) as any;
  return r ? parseRow(r) : null;
}
export const parseRow = (r: any): VocabRow => ({ ...r, contexts: JSON.parse(r.contexts), entry: r.entry ? JSON.parse(r.entry) : null, trainLog: JSON.parse(r.train_log) });

// The calendar day on this machine, so "once a day" turns over at local midnight, not UTC's.
export const day = (iso?: string | null) => { const d = iso ? new Date(iso) : new Date(); return new Date(+d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

// Where `form` stands as a whole word in `sentence` ("art" is not inside "start"); else its first
// occurrence; -1 if absent.
export function at(sentence: string, form: string) {
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").exec(sentence);
  return m ? m.index : sentence.indexOf(form);
}
const swap = (e: Example, by: string) => { const i = at(e.sentence, e.form); return i < 0 ? e.sentence : e.sentence.slice(0, i) + by + e.sentence.slice(i + e.form.length); };
export const blank = (e: Example) => swap(e, "_____");
export const bold = (e: Example) => swap(e, `**${e.form}**`);
const valid = (e: Example) => !!e?.sentence && !!e?.form && at(e.sentence, e.form) >= 0;

// The sentence a new word is anchored in: where the learner met it, else the first example.
export function anchorOf(w: Pick<VocabRow, "entry" | "contexts">): Example {
  const c = w.contexts.find((x) => valid({ sentence: x.text, form: x.form }));
  return c ? { sentence: c.text, form: c.form } : w.entry!.examples[0];
}

// The sentences a word is tested in: the test sentences, which the learner has never been shown
// before a test. Older entries have none, so their examples stand in, minus the anchor and the
// sentences it was met in, which the learner has already read with the word.
export function testPool(w: Pick<VocabRow, "entry" | "contexts">): Example[] {
  const tests = (w.entry?.tests ?? []).filter(valid);
  if (tests.length >= 2) return tests;
  const seen = new Set([anchorOf(w).sentence, ...w.contexts.map((c) => c.text)]);
  const rest = (w.entry?.examples ?? []).filter((e) => valid(e) && !seen.has(e.sentence));
  return rest.length ? rest : (w.entry?.examples ?? []).filter(valid);
}

// When each sentence was last asked, across Train and review.
export function lastAsked(w: Pick<VocabRow, "trainLog">, cardLog: any[] = []) {
  const last = new Map<string, string>();
  for (const l of [...w.trainLog.map((l) => ({ s: l.sentence, t: l.at })), ...cardLog.map((l) => ({ s: l.sentence, t: l.review }))])
    if (l.s && (last.get(l.s) ?? "") < (l.t ?? "")) last.set(l.s, l.t ?? "");
  return last;
}
// The sentence asked longest ago (never asked first), so the word is not recalled from one memorised line.
export function freshest(pool: Example[], last: Map<string, string>, prefer?: (e: Example) => boolean) {
  const order = (e: Example) => last.get(e.sentence) ?? "";
  const sorted = [...pool].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  return (prefer && sorted.find(prefer)) || sorted[0];
}

// A review card alternates meaning (word → what it means) and recall (meaning → word), each time in
// the test sentence asked longest ago, so no two reviews in a row share a sentence.
export function reviewSpec(id: string, log: any[]) {
  const w = wordRow(id);
  if (!w?.entry) return null;
  const pool = testPool(w);
  if (!pool.length) return null;
  const ex = freshest(pool, lastAsked(w, log));
  const format: Format = log.length % 2 === 0 ? "explain" : "recall";
  const spec = format === "explain"
    ? { id, type: "short" as const, prompt: `What does **${ex.form}** mean in this sentence?\n\n> ${ex.sentence}`, rubric: w.entry.explanation }
    : { id, type: "short" as const, prompt: `Which word fits the blank? It means: ${w.entry.explanation}\n\n> ${blank(ex)}`, rubric: `${ex.form}. ${w.entry.explanation}` };
  return {
    word: w.entry.headword, format, sentence: ex.sentence, form: ex.form, spec,
    // The full answer, shown after the grade.
    reveal: { sentence: bold(ex), headword: w.entry.headword, explanation: w.entry.explanation, confusable: w.stage >= 3 ? w.entry.confusable : null },
  };
}
