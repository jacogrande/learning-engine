// Things a section chat can do in the app when the learner asks: make flashcards from what was just
// discussed, add words to the vocabulary, or write a new lesson in the module. The tutor never writes
// files itself; it ends its reply with an ```action block, and the server does the work here. Each
// outcome is stored with the message, so the chat can show it (and undo it) after a reload.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { createEmptyCard } from "ts-fsrs";
import { COURSES_DIR, getCourse, getDoc } from "./content";
import { db, now } from "./db";
import { state } from "./state";
import { enqueue } from "./jobs";
import { broadcast } from "./events";
import * as vocab from "./vocab";

// What the tutor is told, every turn (it rides in the system prompt, so resumed sessions keep it).
export const ACTIONS_SYSTEM = `The learner can ask you to act in the app. Only when they ask in so many words ("make flashcards for these", "add X as vocab", "add a lesson on this"), end your reply with one fenced block, \`\`\`action, holding JSON, and say in your reply what you did. Never act unasked; never offer to.
- Flashcards on what this chat just covered: {"type":"cards","cards":[{"prompt":"...","rubric":"...","objective":"obj-NN-n"}]}. One to eight cards, one idea each. "prompt" is a self-contained question the learner may meet weeks from now, with no reference to this chat; "rubric" is the model answer as two to four numbered idea units then a "Wrong if:" line. "objective" is the id from the section's quiz blocks that the card tests.
- Vocabulary: {"type":"vocab","words":[{"word":"...","sentence":"..."}]}. "sentence" is the sentence the word was met in, quoted exactly from the section or this chat, or omitted.
- A new lesson in this module: {"type":"lesson","title":"...","topic":"..."}. "title" states the lesson's claim; "topic" is two to four sentences on what it must teach, drawn from this conversation, and what the learner already has.`;

type Card = { prompt: string; rubric: string; objective?: string };
export type Action = { type: "cards"; cards: Card[] } | { type: "vocab"; words: { word: string; sentence?: string }[] } | { type: "lesson"; title: string; topic: string };
export type Outcome = {
  type: Action["type"]; ok: boolean; text: string; to?: string | null; job?: string;
  undo?: { kind: "cards"; doc: string; ids: string[] } | { kind: "vocab"; ids: string[] } | null; undone?: boolean;
};

// Pull the action blocks out of a reply; what is left is what the learner reads.
export function parseActions(reply: string): { text: string; actions: Action[] } {
  const actions: Action[] = [];
  const text = reply.replace(/```action\s*\n([\s\S]*?)```/g, (_, body) => {
    try { const a = JSON.parse(body); if (a && typeof a === "object") actions.push(...(Array.isArray(a) ? a : [a])); } catch {}
    return "";
  }).trim();
  return { text, actions };
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
// A `>-` block scalar, as the content grammar requires inside quiz blocks.
const block = (s: string) => `>-\n${s.split("\n").map((l) => `  ${l}`).join("\n")}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-") || "cards";

type Chat = { id: string; course: string; doc: string; title: string | null };

export async function runActions(chat: Chat, actions: Action[], transcript: string): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const a of actions.slice(0, 3)) {
    try {
      if (a.type === "cards") out.push(await makeCards(chat, a.cards));
      else if (a.type === "vocab") out.push(addVocab(chat, a.words));
      else if (a.type === "lesson") out.push(await addLesson(chat, a, transcript));
    } catch (e) { out.push({ type: a.type, ok: false, text: `That did not work: ${(e as Error).message}` }); }
  }
  return out;
}

// Flashcards: one file of quiz blocks per request under the module's flashcards/ (not a section:
// every .md directly in a module folder is one), each block a review card from tomorrow.
async function makeCards(chat: Chat, cards: Card[]): Promise<Outcome> {
  const mod = /^modules\/([^/]+)\//.exec(chat.doc)?.[1];
  if (!mod) throw new Error("flashcards need a lesson to belong to");
  const nn = mod.slice(0, 2);
  const valid = (Array.isArray(cards) ? cards : []).map((c) => ({ prompt: str(c?.prompt), rubric: str(c?.rubric), objective: str(c?.objective) })).filter((c) => c.prompt && c.rubric).slice(0, 8);
  if (!valid.length) throw new Error("no usable cards came back");
  // Objectives: an id of this module, else the one the section's own questions test most.
  const course = await getCourse(chat.course);
  const ids = new Set(course?.modules.find((m) => m.id === mod)?.objectives.map((o) => o.id) ?? []);
  const sec = await getDoc(chat.course, chat.doc);
  const used = [...(sec?.body.matchAll(/^objective:\s*(obj-[\w-]+)/gm) ?? [])].map((m) => m[1]);
  const fallback = used.sort((a, b) => used.filter((x) => x === b).length - used.filter((x) => x === a).length)[0] ?? [...ids][0] ?? `obj-${nn}-1`;
  const dir = join(COURSES_DIR, chat.course, "modules", mod, "flashcards");
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  // Ids continue across the module: q-NN-fc01, q-NN-fc02, …
  let n = 0;
  for (const f of files) for (const m of (await readFile(join(dir, f), "utf8")).matchAll(new RegExp(`q-${nn}-fc(\\d+)`, "g"))) n = Math.max(n, Number(m[1]));
  const file = `${String(files.length + 1).padStart(2, "0")}-${slug(valid[0].prompt)}.md`, doc = `modules/${mod}/flashcards/${file}`;
  const qids = valid.map((_, i) => `q-${nn}-fc${String(n + i + 1).padStart(2, "0")}`);
  const title = `Flashcards from chat: ${(chat.title ?? "").replace(/"/g, "'").slice(0, 60)}`;
  const body = valid.map((c, i) => ["```quiz", `id: ${qids[i]}`, "type: short", `objective: ${ids.has(c.objective) ? c.objective : fallback}`, `prompt: ${block(c.prompt)}`, `rubric: ${block(c.rubric)}`, "```"].join("\n")).join("\n\n");
  const src = `---\ntitle: "${title}"\nsection: ${chat.doc.split("/").pop()}\n---\n\n${body}\n`;
  for (const m of src.matchAll(/```quiz\n([\s\S]*?)```/g)) YAML.parse(m[1]);   // never write a block the app cannot read
  await writeFile(join(dir, file), src);
  const due = new Date(Date.now() + 864e5).toISOString();
  for (const q of qids) {
    db.run("INSERT OR IGNORE INTO cards (course, question, doc, module, due, card, streak, log, state, suspended, updated_at) VALUES (?,?,?,?,?,?,0,'[]','new',0,?)",
      [chat.course, q, doc, mod, due, JSON.stringify(createEmptyCard(new Date())), now()]);
    state.card(chat.course, q);
  }
  broadcast({ type: "card", course: chat.course });
  return { type: "cards", ok: true, text: `Made ${qids.length} flashcard${qids.length === 1 ? "" : "s"}; first review tomorrow.`, to: `/c/${chat.course}/review?mode=module&scope=${encodeURIComponent(`${chat.course}/${mod}`)}`, undo: { kind: "cards", doc, ids: qids } };
}

function addVocab(chat: Chat, words: { word: string; sentence?: string }[]): Outcome {
  const list = (Array.isArray(words) ? words : []).map((w) => ({ word: str(w?.word), sentence: str(w?.sentence) })).filter((w) => w.word).slice(0, 10);
  if (!list.length) throw new Error("no words came back");
  const added: string[] = [], had: string[] = [];
  for (const w of list) {
    const r = vocab.addWord({ word: w.word, context: w.sentence, course: chat.course, doc: chat.doc, title: chat.title });
    (r.existed ? had : added).push(r.word.id);
  }
  const names = list.map((w) => `“${w.word}”`).join(", ");
  return { type: "vocab", ok: true, text: `Added ${names} to your vocabulary${had.length ? ` (${had.length} already there; the sentence was added)` : ""}.`, to: "/vocab", undo: added.length ? { kind: "vocab", ids: added } : null };
}

// A new lesson: a generation job appends one section to the module.
async function addLesson(chat: Chat, a: { title: string; topic: string }, transcript: string): Promise<Outcome> {
  const mod = /^modules\/([^/]+)\//.exec(chat.doc)?.[1];
  if (!mod) throw new Error("a lesson needs a module");
  const title = str(a.title), topic = str(a.topic);
  if (!title || !topic) throw new Error("the lesson needs a title and a topic");
  const dir = join(COURSES_DIR, chat.course, "modules", mod);
  const job = enqueue(chat.course, "lesson", `/add-lesson ${chat.course} ${mod}\n\nTitle: ${title}\nWhat it must teach: ${topic}\nAsked for in a chat on ${chat.doc}. The conversation:\n\n${transcript.slice(-6000)}`, {
    ref: `${mod}/lesson`,
    then: async (_r, j) => {
      // The newest section file written since the job started.
      const since = j.startedAt ? +new Date(j.startedAt) : 0;
      let newest: { file: string; t: number } | null = null;
      for (const f of await readdir(dir).catch(() => [] as string[])) {
        if (!/^\d\d-.*\.md$/.test(f)) continue;
        const t = (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0;
        if (t >= since && (!newest || t > newest.t)) newest = { file: f, t };
      }
      const d = newest ? await getDoc(chat.course, `modules/${mod}/${newest.file}`) : null;
      broadcast({ type: "notice", kind: "lesson", course: chat.course, ok: !!d, title: d?.frontmatter.title ?? null, to: d ? `/c/${chat.course}/m/${mod}/${newest!.file}` : null });
    },
  });
  return { type: "lesson", ok: true, text: `Writing a new lesson for this module: “${title}”. It appears in the module when ready.`, job: job.id };
}

export async function undo(o: Outcome, course: string) {
  if (!o.undo || o.undone) return;
  if (o.undo.kind === "cards") {
    await rm(join(COURSES_DIR, course, o.undo.doc), { force: true });
    for (const q of o.undo.ids) { db.run("DELETE FROM cards WHERE course=? AND question=?", [course, q]); state.cardDeleted(course, q); }
    broadcast({ type: "card", course });
  } else for (const wid of o.undo.ids) if (vocab.getWord(wid)) vocab.deleteWord(wid);
  o.undone = true;
}
