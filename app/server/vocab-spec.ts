// What a vocabulary word looks like as a review card. Kept apart from vocab.ts so the review
// scheduler can build vocab cards without importing the job and capture code.
import { db } from "./db";

// Vocab cards live in `cards` under this pseudo-course. Their `module` holds the course slug when
// the word is one of that course's own terms, so a course's review can include it.
export const VOCAB = "_vocab";

export type Example = { sentence: string; form: string };
export type Entry = { headword: string; pos: string; explanation: string; examples: Example[]; confusable: { word: string; difference: string } | null; parts: string | null; register: string | null; probes?: { question: string; answer: string }[] };
export type Context = { text: string; form: string; course: string | null; doc: string | null; title: string | null; at: string };
export type Format = "meet" | "pick" | "recall" | "explain" | "use";

export function wordRow(id: string) {
  const r = db.query("SELECT * FROM vocab WHERE id=?").get(id) as any;
  if (!r) return null;
  return { ...r, contexts: JSON.parse(r.contexts) as Context[], entry: r.entry ? (JSON.parse(r.entry) as Entry) : null, trainLog: JSON.parse(r.train_log) as any[] };
}

// Every sentence the word can be asked in: the generated examples, then the ones it was met in.
export function sentences(w: { entry: Entry | null; contexts: Context[] }): Example[] {
  const own = w.contexts.filter((c) => c.text && c.form && c.text.includes(c.form)).map((c) => ({ sentence: c.text, form: c.form }));
  return [...(w.entry?.examples ?? []).filter((e) => e.sentence.includes(e.form)), ...own];
}

export const blank = (e: Example) => e.sentence.replace(e.form, "_____");

// A review card alternates meaning (word → what it means) and recall (meaning → word), each time in
// a different sentence, so the word is never recalled from one memorised line.
export function reviewSpec(id: string, reviews: number) {
  const w = wordRow(id);
  if (!w?.entry) return null;
  const all = sentences(w);
  if (!all.length) return null;
  const ex = all[Math.floor(reviews / 2) % all.length];
  const format: Format = reviews % 2 === 0 ? "explain" : "recall";
  const spec = format === "explain"
    ? { id, type: "short" as const, prompt: `What does **${ex.form}** mean in this sentence?\n\n> ${ex.sentence}`, rubric: w.entry.explanation }
    : { id, type: "short" as const, prompt: `Which word fits the blank? It means: ${w.entry.explanation}\n\n> ${blank(ex)}`, rubric: `${ex.form}. ${w.entry.explanation}` };
  return { word: w.entry.headword, format, sentence: ex.sentence, form: ex.form, spec };
}
