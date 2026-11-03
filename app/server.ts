// `bun run dev` — serves the client (bundled by Bun) and the API.
import index from "./client/index.html";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COURSES_DIR, NOTES_DIR, listCourses, getCourse, getDoc, type Course } from "./server/content";
import { db, id, now } from "./server/db";
import { enqueue, cancel, jobs, jobLog, history } from "./server/jobs";
import { sse, watchContent, broadcast } from "./server/events";
import { state, migrate, rebuild } from "./server/state";
import { RESULT, GRADE_SCHEMA, rate, question, mastery, queue, summary, startSession, updateSession, lastSession, setSuspended, setFlag, flagOf, suspendedCards, cardList, deleteCard, seed, clearSeeded, setVariantHook, addVariant, variantsOf, markVariantPending, markVariantFailed, cardStatus, settings, setSetting, optimize, reschedule, stats, type Mode, type Result } from "./server/review";
import * as sync from "./server/sync";
import * as vocab from "./server/vocab";
import { ACTIONS_SYSTEM, parseActions, runActions, undo as undoAction, type Outcome } from "./server/actions";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const q = (req: Request, key: string) => new URL(req.url).searchParams.get(key) ?? "";
// A vocab route: a valid word id, and 404 when the word (or what was asked of it) is not there.
const word = async (req: Request & { params: { id: string } }, fn: (wid: string) => unknown) => {
  if (!vocab.validId(req.params.id)) return json({ error: "not found" }, 404);
  const r = await fn(req.params.id);
  return r ? json(r) : json({ error: "not found" }, 404);
};

const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string", enum: ["novice", "familiar", "proficient"] },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, result: RESULT, note: { type: "string" } }, required: ["id", "result", "note"] } },
  },
  required: ["level", "summary", "strengths", "gaps", "questions"],
};

// Latest attempt for a quiz, plus any unsent draft.
async function quizState(course: string, quiz: string) {
  const a = db.query("SELECT id, answers, confidence, notes, grade, created_at FROM attempts WHERE course=? AND quiz=? ORDER BY created_at DESC LIMIT 1").get(course, quiz) as any;
  const d = db.query("SELECT answers, confidence, notes FROM drafts WHERE course=? AND quiz=?").get(course, quiz) as any;
  const grade = a?.grade ? JSON.parse(a.grade) : null;
  // Grades recorded before per-question results existed: read them from the assessment file's table.
  if (grade && !grade.questions) {
    const doc = await getDoc(course, `quizzes/${quiz}-assessment.md`);
    grade.questions = [...(doc?.body.matchAll(/^\|\s*(q-[\w-]+)\s*\|\s*(correct|partial|wrong|skipped)\s*\|\s*(.*?)\s*\|\s*$/gm) ?? [])]
      .map(([, id, result, note]) => ({ id, result, note }));
  }
  return {
    draft: d ? { answers: JSON.parse(d.answers), confidence: JSON.parse(d.confidence), notes: JSON.parse(d.notes) } : null,
    attempt: a ? { id: a.id, answers: JSON.parse(a.answers), confidence: JSON.parse(a.confidence), notes: JSON.parse(a.notes), grade, createdAt: a.created_at } : null,
  };
}

const CONFIDENCE = ["", "guessing", "fairly sure", "sure"];

type Sheet = { answers: Record<string, string>; confidence?: Record<string, number>; notes?: Record<string, string> };
function assess(slug: string, attempt: Sheet & { id: string }) {
  // One entry per question: the answer, how sure the learner was, and their note if they left one.
  const sheet = Object.fromEntries(Object.entries(attempt.answers).map(([q, answer]) => {
    const c = attempt.confidence?.[q], note = attempt.notes?.[q]?.trim();
    return [q, { answer, ...(c ? { confidence: CONFIDENCE[c] } : {}), ...(note ? { note } : {}) }];
  }));
  return enqueue(slug, "assess", `/assess-baseline ${slug}\n\nLearner answers (question id → answer, confidence, note):\n${JSON.stringify(sheet, null, 2)}`, {
    schema: ASSESSMENT_SCHEMA,
    then: (grade) => {
      db.run("UPDATE attempts SET grade=? WHERE id=?", [JSON.stringify(grade), attempt.id]);
      state.attempt(attempt.id);
      enqueue(slug, "outline", `/generate-outline ${slug}`);
    },
  });
}

const notesPath = (slug: string, mod: string) => join(NOTES_DIR, slug, `${mod}.md`);
const quoteBlock = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

// Invariants for every tutor turn, including resumed ones, where the skill body is far back in context.
const TUTOR_SYSTEM = `Your reply is shown to the learner verbatim. Produce exactly one reply and nothing else: no text before or between tool calls, no "I'll read…", no headings, no bullet lists unless listing is the point. Two to six sentences, laid out to be read in a narrow pane: short paragraphs of one to three sentences with a blank line between them (the direct answer first, then the mechanism or example), an example sentence on its own line as a \`>\` quote, and the question, if any, as its own last paragraph. Bold a term where you define it. At most one question per reply. Hold an answer back until the learner has made a real attempt; after that, give it straight. If they say something wrong, say so and why. Each learner message starts with its exchange number.`;

// One chat turn: the first uses the /chat or /socratic skill with context; later turns resume the session.
function sendChat(chat: any, content: string, record = true) {
  const mid = id();
  if (record) {
    db.run("INSERT INTO messages (id, chat, role, content, created_at) VALUES (?,?,?,?,?)", [mid, chat.id, "user", content, now()]);
    state.chat(chat.id);
  }
  // Exchange counter: the model cannot count its own turns across --resume; the five-step discussion needs it.
  const turn = (db.query("SELECT count(*) n FROM messages WHERE chat=? AND role='assistant'").get(chat.id) as any).n + 1;
  const tag = chat.kind === "summary" ? `[Exchange ${turn} of 5] ` : `[Exchange ${turn}] `;
  const opener = chat.kind === "summary"
    ? `/socratic ${chat.course} ${chat.module}\n\n${chat.context ? `${chat.context}\n\n` : ""}`
    : `/chat ${chat.course} ${chat.doc}\n\n${chat.context ? `${chat.context.startsWith("Question: ") ? "The learner's answer to a question in this section, and the grader's feedback on it. They want to discuss the feedback" : "Selected passage"}:\n${quoteBlock(chat.context)}\n\n` : ""}`;
  let prompt: string;
  if (chat.session_id) prompt = tag + content;
  else {
    // New session. On a machine that has no handle for an old chat, replay the transcript so far.
    // Exclude the message being sent (recorded under `mid`, or, on a retry, the latest user row).
    const skip = record ? mid : ((db.query("SELECT id FROM messages WHERE chat=? AND role='user' ORDER BY created_at DESC LIMIT 1").get(chat.id) as any)?.id ?? "");
    const prior = (db.query("SELECT role, content FROM messages WHERE chat=? AND id<>? ORDER BY created_at").all(chat.id, skip) as any[]);
    const label = (m: any, i: number) => (m.role === "user" ? (chat.kind === "summary" && i === 0 ? "Learner's explanation" : "Learner") : "You");
    const transcript = prior.length
      ? `This conversation started earlier on another machine. The transcript follows; lines marked "You:" are your own earlier replies. Continue from the last learner message; do not restart or repeat an earlier step.\n\n${prior.map((m, i) => `${label(m, i)}: ${m.content}`).join("\n\n")}\n\n`
      : "";
    prompt = `${opener}${transcript}${chat.kind === "summary" && !prior.length ? "Learner's explanation of the module:\n" : tag + "Learner: "}${content}`;
  }
  let text = "";
  enqueue(chat.course, "chat", prompt, {
    // Section chats can act in the app when asked (flashcards, vocab, a lesson); the wrap-up discussion cannot.
    ref: chat.id, resume: chat.session_id ?? undefined, system: chat.kind === "summary" ? TUTOR_SYSTEM : `${TUTOR_SYSTEM}\n\n${ACTIONS_SYSTEM}`,
    stream: (delta, reset) => { if (reset) { text = ""; broadcast({ type: "chat", chat: chat.id, reset: true }); } else { text += delta; broadcast({ type: "chat", chat: chat.id, delta }); } },
    then: async (result, job) => {
      const raw = typeof result === "string" && result.trim() ? result : text;
      const { text: reply, actions } = chat.kind === "summary" ? { text: raw, actions: [] } : parseActions(raw);
      const transcript = (db.query("SELECT role, content FROM messages WHERE chat=? ORDER BY created_at").all(chat.id) as any[]).map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content}`).join("\n\n");
      const outcomes = actions.length ? await runActions(chat, actions, `${transcript}\n\nTutor: ${reply}`) : [];
      const aid = id();
      db.run("INSERT INTO messages (id, chat, role, content, actions, created_at) VALUES (?,?,?,?,?,?)", [aid, chat.id, "assistant", reply || "Done.", outcomes.length ? JSON.stringify(outcomes) : null, now()]);
      db.run("UPDATE chats SET session_id=COALESCE(session_id, ?), updated_at=? WHERE id=?", [job.sessionId ?? null, now(), chat.id]);
      state.chat(chat.id);
      broadcast({ type: "chat", chat: chat.id, done: true, message: { id: aid, role: "assistant", content: reply || "Done.", actions: outcomes.length ? outcomes : undefined } });
    },
    fail: () => {
      // A resumed session that no longer exists here (other machine, pruned): retry fresh once.
      if (!chat.session_id) {
        const aid = id(), content = "_No reply came back. Send your message again._";
        db.run("INSERT INTO messages (id, chat, role, content, created_at) VALUES (?,?,?,?,?)", [aid, chat.id, "assistant", content, now()]);
        state.chat(chat.id);
        return broadcast({ type: "chat", chat: chat.id, done: true, message: { id: aid, role: "assistant", content } });
      }
      db.run("UPDATE chats SET session_id=NULL WHERE id=?", [chat.id]);
      sendChat({ ...chat, session_id: null }, content, false);
    },
  });
  return { id: mid, role: "user", content };
}
const chatWithMessages = (cid: string) => ({
  chat: db.query("SELECT id, course, doc, kind, module, context, title, created_at createdAt FROM chats WHERE id=?").get(cid),
  messages: (db.query("SELECT id, role, content, actions, created_at createdAt FROM messages WHERE chat=? ORDER BY created_at").all(cid) as any[])
    .map(({ actions, ...m }) => (actions ? { ...m, actions: JSON.parse(actions) } : m)),
});

// After a generation job: parse every quiz block the way the renderer does and report what the
// model got wrong. Warnings go to the server log and the job's log; the content still renders.
async function lintModule(course: string, mod: string) {
  const { lint } = await import("./server/lint");
  const problems = await lint(course, mod);
  if (problems.length) { console.warn(`lint ${course}/${mod}:\n  ${problems.join("\n  ")}`); broadcast({ type: "lint", course, module: mod, problems }); }
}

function progressOf(course: string, mod: string) {
  const r = db.query("SELECT data FROM progress WHERE course=? AND module=?").get(course, mod) as any;
  return r ? JSON.parse(r.data) : {};
}
function saveProgress(course: string, mod: string, patch: Record<string, any>) {
  const prev = progressOf(course, mod);
  const next = { ...prev, ...patch, ...(patch.read ? { read: { ...(prev.read ?? {}), ...patch.read } } : {}) };
  db.run("INSERT INTO progress (course, module, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(course, module) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at", [course, mod, JSON.stringify(next), now()]);
  state.progress(course, mod);
  broadcast({ type: "progress", course, module: mod });
  return next;
}
// A card exists and has at least one review in its log (dummy cards have none).
const cardReviewed = (course: string, qid: string) => ((db.query("SELECT log FROM cards WHERE course=? AND question=?").get(course, qid) as any)?.log ?? "[]") !== "[]";

// A section is done when every question in it has an answer. Opening it only makes it seen (`read`,
// kept under its old name). A section with no questions is done once seen.
async function doneSections(c: Course | null, mod: string, p: { read?: Record<string, string> }) {
  const m = c?.modules.find((x) => x.id === mod);
  if (!c || !m) return {} as Record<string, boolean>;
  const answered = new Set((db.query("SELECT question FROM answers WHERE course=? AND doc LIKE ? AND answer<>''").all(c.slug, `modules/${mod}/%`) as any[]).map((r) => r.question));
  const done: Record<string, boolean> = {};
  for (const s of m.sections) {
    const d = await getDoc(c.slug, `modules/${mod}/${s.file}`);
    const ids = [...(d?.body.matchAll(/```quiz\n([\s\S]*?)```/g) ?? [])].map((f) => /^id:\s*(\S+)/m.exec(f[1])?.[1]).filter(Boolean) as string[];
    done[s.file] = ids.length ? ids.every((q) => answered.has(q)) : !!p.read?.[s.file];
  }
  return done;
}

// Where to pick a course up: the first generated module not yet finished, at its first section not
// done (or its test or wrap-up once every section is). Null when nothing generated is open.
async function resumeOf(c: Course) {
  const done = c.modules.filter((m) => progressOf(c.slug, m.id).completedAt).length;
  for (const m of c.modules) {
    const p = progressOf(c.slug, m.id);
    if (p.completedAt) continue;
    if (m.status !== "ready") return { done, resume: null, nextToGenerate: m.id };
    const finished = await doneSections(c, m.id, p);
    const unread = m.sections.find((s) => !finished[s.file]);
    const target = unread ? { file: unread.file, title: unread.title } : m.test && !p.summary ? { file: "test", title: "Module test" } : { file: "wrap", title: "Wrap up" };
    return { done, resume: { module: m.id, moduleTitle: m.title, ...target }, nextToGenerate: null };
  }
  return { done, resume: null, nextToGenerate: null };
}

// Everything the learner wrote or kept in a course, for the notebook page.
async function notebook(slug: string) {
  const files = await readdir(join(NOTES_DIR, slug)).catch(() => [] as string[]);
  const notes: Record<string, string> = {};
  for (const f of files.filter((f) => f.endsWith(".md"))) notes[f.slice(0, -3)] = await readFile(join(NOTES_DIR, slug, f), "utf8").catch(() => "");
  const progress = Object.fromEntries((db.query("SELECT module, data FROM progress WHERE course=?").all(slug) as any[]).map((r) => [r.module, JSON.parse(r.data)]));
  const highlights = db.query("SELECT id, doc, quote, created_at createdAt FROM annotations WHERE course=? ORDER BY created_at").all(slug);
  // `body` is every message's text, so the notebook can search inside conversations.
  const chats = db.query(`SELECT c.id, c.doc, c.kind, c.module, c.context, c.title, c.created_at createdAt, c.updated_at updatedAt, count(m.id) messages, group_concat(m.content, ' ') body
                          FROM chats c LEFT JOIN messages m ON m.chat=c.id WHERE c.course=? GROUP BY c.id ORDER BY c.updated_at DESC`).all(slug);
  const words = vocab.listWords().filter((w) => w.contexts.some((c: { course: string | null }) => c.course === slug));
  return { notes, progress, highlights, chats, words };
}

// A drill-down or reading started from the module test or from another extra still has to hang off
// something the sidebar lists: the test, or the section the source extra came from.
async function sectionHint(course: string, doc: string) {
  const file = doc.split("/").slice(2).join("/");
  if (!file.includes("/") && file !== "quiz.md") return "";
  const parent = file === "quiz.md" ? "quiz.md" : ((await getDoc(course, doc))?.frontmatter.section ?? "");
  return parent ? `\n\nSet \`section: ${parent}\` in the new file's frontmatter (the passage comes from ${file === "quiz.md" ? "the module test" : `a ${file.startsWith("drilldowns/") ? "drill-down" : "reading"} on that section`}).` : "";
}

// After a drill-down or reading job: tell the page the new file exists, so it can offer a link.
async function announceExtra(course: string, doc: string, kind: "drilldown" | "reading" | "worksheet", startedAt?: string) {
  const mod = /^modules\/([^/]+)\//.exec(doc)?.[1];
  const c = mod ? await getCourse(course) : null;
  const m = c?.modules.find((x) => x.id === mod);
  const dir = join(COURSES_DIR, course, "modules", mod ?? "", `${kind}s`);
  const since = startedAt ? +new Date(startedAt) : 0;
  let newest: { file: string; t: number } | null = null;
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const t = (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0;
    if (f.endsWith(".md") && t >= since && (!newest || t > newest.t)) newest = { file: f, t };
  }
  const extra = newest && m?.extras.find((e) => e.file.endsWith(`/${newest!.file}`));
  broadcast({ type: "notice", kind, course, ok: !!extra, title: extra?.title ?? null, to: extra ? `/c/${course}/m/${mod}/${extra.file}` : null });
}

// Everything the wrap-up judges from: the explanation, the discussion, every answer with its
// objective and confidence, and the review schedule.
async function evidence(course: string, mod: string) {
  const p = progressOf(course, mod);
  const rows = db.query("SELECT question, doc, answer, result, note, confidence, graded_at gradedAt FROM answers WHERE course=? AND doc LIKE ?").all(course, `modules/${mod}/%`) as any[];
  const answers = [];
  for (const a of rows) { const spec = await question(course, a.doc, a.question); answers.push({ ...a, objective: spec?.objective ?? null, type: spec?.type ?? null, prompt: spec?.prompt ?? null }); }
  const chat = p.chat ? (db.query("SELECT role, content FROM messages WHERE chat=? ORDER BY created_at").all(p.chat) as any[]) : [];
  const cards = db.query("SELECT question, streak, due FROM cards WHERE course=? AND module=?").all(course, mod);
  return { summary: p.summary ?? "", discussion: chat, answers, cards };
}

const VARIANT_SCHEMA = { type: "object", properties: { prompt: { type: "string" }, rubric: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "integer" }, explanation: { type: "string" } }, required: ["prompt"] };
setVariantHook((it) => {
  markVariantPending(it.course, it.question, true);
  const prior = variantsOf(it.course, it.question).map((v, i) => `${i + 1}. ${v.prompt}`).join("\n");
  enqueue(it.course, "variant", `/review-variant ${it.course} ${it.doc} ${it.question}${prior ? `\n\nVariants already written:\n${prior}` : ""}`, {
    ref: it.question, schema: VARIANT_SCHEMA,
    then: (v: any) => {
      markVariantPending(it.course, it.question, false);
      const err = addVariant(it.course, it.question, it.original.type, v ?? {});
      if (err) { markVariantFailed(it.course, it.question); console.warn(`variant ${it.course}/${it.question}: ${err}`); }
    },
    fail: () => { markVariantPending(it.course, it.question, false); markVariantFailed(it.course, it.question); },
  });
});

// One grade job for a short answer. When review asked a variant, the grader is told so in the system
// prompt, which outranks the skill's "find the block in the file" step.
function gradeShort(slug: string, doc: string, qid: string, answer: string, variant: { prompt: string; rubric?: string } | null, then: (g: { result: Result; note: string }, jobId: string) => void) {
  const flag = flagOf(slug, qid);
  const ref = { id: "" };
  const asked = variant ? `\n\nThe learner was asked this variant of the question, not the block in the file:\nPrompt: ${variant.prompt}\nRubric: ${variant.rubric ?? "(the original rubric's idea units, applied to this case)"}` : "";
  const system = variant ? "This grade is for a variant of the quiz question. Score the learner's answer against the variant's prompt and rubric given in the request, not against the block in the file; read the file only for context on the idea being tested." : undefined;
  ref.id = enqueue(slug, "grade", `/grade ${slug} ${doc} ${qid}${asked}\n\nLearner's answer:\n${quoteBlock(answer)}${flag ? `\n\nThe learner flagged an earlier grade on this question as wrong: "${flag}". Weigh that before scoring.` : ""}`, {
    ref: qid, schema: GRADE_SCHEMA, system, then: (g: any) => then(g, ref.id),
  }).id;
  return ref.id;
}
// Review grades in flight, one per card: a stale job (the learner re-checked) must not rate the card twice.
const pendingReviewGrades = new Map<string, string>();

migrate();
sync.afterPull(() => { rebuild(); broadcast({ type: "content" }); });
await sync.init();
rebuild();
vocab.resumePending();
watchContent();

Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  // This machine only: the app can start Claude jobs and holds every note. HOST=0.0.0.0 opens it to the network.
  hostname: process.env.HOST ?? "127.0.0.1",
  development: { hmr: true, console: false },
  routes: {
    "/api/events": (req) => sse(req),
    "/api/courses": {
      GET: async () => json(await Promise.all((await listCourses()).map(async (c) => ({ ...c, progress: await resumeOf(c) })))),
      // New course from the app: the clarifying answers come with the request, so the skill skips its questions.
      POST: async (req) => {
        const b = (await req.json()) as { subject: string; depth?: string; know?: string; goals?: string; produce?: string; angle?: string };
        if (!b.subject?.trim()) return json({ error: "subject required" }, 400);
        const answers = [
          ["Target depth", b.depth], ["What they already know or have done", b.know], ["What they want to be able to do afterward", b.goals],
          ["What they are producing with it right now", b.produce], ["Angle to emphasize or avoid", b.angle],
        ].filter(([, v]) => v?.trim()).map(([k, v]) => `- ${k}: ${v!.trim()}`).join("\n");
        const prompt = `/start-course ${b.subject.trim()}\n\nThe learner has already answered the clarifying questions. Do not ask any; use these:\n${answers || "- (no further answers given; choose sensible defaults for a working practitioner)"}`;
        return json(enqueue("new", "start", prompt, { ref: b.subject.trim().slice(0, 60) }));
      },
    },
    "/api/courses/:slug": async (req) => {
      const c = await getCourse(req.params.slug);
      return c ? json(c) : json({ error: "not found" }, 404);
    },
    "/api/courses/:slug/doc": async (req) => {
      const d = await getDoc(req.params.slug, q(req, "path"));
      return d ? json(d) : json({ error: "not found" }, 404);
    },

    // --- baseline -------------------------------------------------------
    "/api/courses/:slug/quiz/:quiz": async (req) => json(await quizState(req.params.slug, req.params.quiz)),
    "/api/courses/:slug/quiz/:quiz/draft": {
      PUT: async (req) => {
        const { answers, confidence, notes } = (await req.json()) as Sheet;
        db.run("INSERT INTO drafts (course, quiz, answers, confidence, notes, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(course, quiz) DO UPDATE SET answers=excluded.answers, confidence=excluded.confidence, notes=excluded.notes, updated_at=excluded.updated_at",
          [req.params.slug, req.params.quiz, JSON.stringify(answers), JSON.stringify(confidence ?? {}), JSON.stringify(notes ?? {}), now()]);
        return json({ ok: true });
      },
    },
    "/api/courses/:slug/baseline": {
      POST: async (req) => {
        const slug = req.params.slug;
        const { answers, confidence = {}, notes = {} } = (await req.json()) as Sheet;
        const attempt = { id: id(), answers, confidence, notes };
        db.run("INSERT INTO attempts (id, course, quiz, answers, confidence, notes, created_at) VALUES (?,?,?,?,?,?,?)", [attempt.id, slug, "baseline", JSON.stringify(answers), JSON.stringify(confidence), JSON.stringify(notes), now()]);
        db.run("DELETE FROM drafts WHERE course=? AND quiz=?", [slug, "baseline"]);
        state.attempt(attempt.id);
        assess(slug, attempt);
        return json({ attempt: attempt.id });
      },
    },
    "/api/courses/:slug/baseline/assess": {
      POST: async (req) => {
        const { attempt } = await quizState(req.params.slug, "baseline");
        return attempt ? json(assess(req.params.slug, attempt)) : json({ error: "no attempt" }, 404);
      },
    },
    "/api/courses/:slug/outline": { POST: (req) => json(enqueue(req.params.slug, "outline", `/generate-outline ${req.params.slug}`)) },
    "/api/courses/:slug/modules/:id/generate": {
      POST: (req) => json(enqueue(req.params.slug, "module", `/generate-module ${req.params.slug} ${req.params.id}`, { ref: req.params.id, then: () => lintModule(req.params.slug, req.params.id) })),
    },

    // --- in-lesson answers ---------------------------------------------
    "/api/courses/:slug/answers": {
      GET: (req) => json((db.query(`SELECT a.question, a.answer, a.result, a.note, a.job, a.confidence, a.history, a.graded_at gradedAt, c.due, c.state
                                   FROM answers a LEFT JOIN cards c ON c.course=a.course AND c.question=a.question WHERE a.course=? AND a.doc=?`).all(req.params.slug, q(req, "doc")) as any[])
                          .map((a) => ({ ...a, history: JSON.parse(a.history ?? "[]") }))),
      // Confidence is recorded before feedback. Only the first lesson answer rates the card: after that
      // the schedule belongs to review, and re-checking a lesson question must not move due dates.
      // Earlier lesson answers are kept in `history`.
      POST: async (req) => {
        const slug = req.params.slug;
        const { question: qid, doc, answer, type, result, confidence } = (await req.json()) as { question: string; doc: string; answer: string; type: "mcq" | "short"; result?: string; confidence?: number };
        const firstRating = !cardReviewed(slug, qid);
        const prev = db.query("SELECT answer, result, note, confidence, history, graded_at gradedAt FROM answers WHERE course=? AND question=?").get(slug, qid) as any;
        const history = prev ? [...JSON.parse(prev.history ?? "[]"), { answer: prev.answer, result: prev.result, note: prev.note, confidence: prev.confidence, gradedAt: prev.gradedAt }].slice(-10) : [];
        let job: string | null = null;
        if (type === "short") {
          job = gradeShort(slug, doc, qid, answer, null, (g, jobId) => {
            // Only if this is still the answer the job graded (the learner may have re-checked since).
            const r = db.run("UPDATE answers SET result=?, note=?, graded_at=? WHERE course=? AND question=? AND job=?", [g.result, g.note, now(), slug, qid, jobId]);
            if (!r.changes) return;
            state.answer(slug, qid);
            if (firstRating) rate(slug, qid, doc, g.result, confidence);
            broadcast({ type: "answer", course: slug, doc, question: qid });
          });
        }
        db.run(`INSERT INTO answers (course, question, doc, answer, result, note, job, confidence, history, updated_at, graded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, answer=excluded.answer, result=excluded.result, note=NULL, job=excluded.job, confidence=excluded.confidence, history=excluded.history, updated_at=excluded.updated_at, graded_at=excluded.graded_at`,
          [slug, qid, doc, answer, type === "mcq" ? result ?? null : null, null, job, confidence ?? null, JSON.stringify(history), now(), type === "mcq" ? now() : null]);
        state.answer(slug, qid);
        const review = type === "mcq" && result && firstRating ? rate(slug, qid, doc, result as any, confidence) : null;
        if (review) broadcast({ type: "card", course: slug, question: qid });
        return json({ ok: true, job, review });
      },
    },

    // --- highlights -----------------------------------------------------
    "/api/courses/:slug/annotations": {
      GET: (req) => json(db.query("SELECT id, doc, quote, prefix, suffix, created_at createdAt FROM annotations WHERE course=? AND doc=? ORDER BY created_at").all(req.params.slug, q(req, "doc"))),
      POST: async (req) => {
        const { doc, quote, prefix, suffix } = (await req.json()) as { doc: string; quote: string; prefix?: string; suffix?: string };
        const row = { id: id(), doc, quote, prefix: prefix ?? "", suffix: suffix ?? "", createdAt: now() };
        db.run("INSERT INTO annotations (id, course, doc, quote, prefix, suffix, created_at) VALUES (?,?,?,?,?,?,?)", [row.id, req.params.slug, doc, quote, row.prefix, row.suffix, row.createdAt]);
        state.annotation(row.id);
        return json(row);
      },
    },
    "/api/annotations/:id": { DELETE: (req) => { if (db.run("DELETE FROM annotations WHERE id=?", [req.params.id]).changes) state.annotationDeleted(req.params.id); return json({ ok: true }); } },   // only a real id reaches a file path

    // --- notes: one markdown file per module, readable by Claude --------
    "/api/courses/:slug/notes/:module": {
      GET: async (req) => json({ markdown: await readFile(notesPath(req.params.slug, req.params.module), "utf8").catch(() => "") }),
      // `base` is the text the editor last loaded or saved. If the file has moved on since (another
      // machine's notes arrived in a pull), refuse and hand back the file so the page can ask.
      PUT: async (req) => {
        const { markdown, base, force } = (await req.json()) as { markdown: string; base?: string; force?: boolean };
        const p = notesPath(req.params.slug, req.params.module);
        const disk = await readFile(p, "utf8").catch(() => "");
        if (!force && base !== undefined && disk !== base && disk !== markdown) return json({ conflict: true, markdown: disk }, 409);
        await mkdir(join(p, ".."), { recursive: true });
        await writeFile(p, markdown);
        sync.touch();
        return json({ ok: true });
      },
    },

    // --- chat -------------------------------------------------------------
    "/api/courses/:slug/chats": {
      GET: (req) => json(db.query("SELECT id, doc, context, title, created_at createdAt FROM chats WHERE course=? AND doc=? AND kind='section' ORDER BY updated_at DESC").all(req.params.slug, q(req, "doc"))),
      POST: async (req) => {
        const { doc, context, message } = (await req.json()) as { doc: string; context?: string; message: string };
        const chat = { id: id(), course: req.params.slug, doc, kind: "section", module: null, context: context ?? null, title: (context ?? message).slice(0, 60), session_id: null };
        db.run("INSERT INTO chats (id, course, doc, kind, module, context, title, session_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [chat.id, chat.course, doc, "section", null, chat.context, chat.title, null, now(), now()]);
        sendChat(chat, message);
        return json(chatWithMessages(chat.id));
      },
    },
    "/api/chats/:id": {
      GET: (req) => json(chatWithMessages(req.params.id)),
      PUT: async (req) => {
        const { title } = (await req.json()) as { title: string };
        if (!title?.trim()) return json({ error: "title required" }, 400);
        db.run("UPDATE chats SET title=? WHERE id=?", [title.trim().slice(0, 120), req.params.id]);
        state.chat(req.params.id);
        return json({ ok: true });
      },
      // Section chats only: the wrap-up discussion is evidence for the module's understanding summary.
      DELETE: (req) => {
        const c = db.query("SELECT kind FROM chats WHERE id=?").get(req.params.id) as any;
        if (!c) return json({ error: "not found" }, 404);
        if (c.kind !== "section") return json({ error: "the wrap-up discussion cannot be deleted" }, 400);
        db.run("DELETE FROM chats WHERE id=?", [req.params.id]);
        state.chatDeleted(req.params.id);
        broadcast({ type: "content" });
        return json({ ok: true });
      },
    },
    "/api/courses/:slug/notebook": async (req) => json(await notebook(req.params.slug)),
    "/api/chats/:id/messages": {
      POST: async (req) => {
        const chat = db.query("SELECT * FROM chats WHERE id=?").get(req.params.id) as any;
        if (!chat) return json({ error: "not found" }, 404);
        const { content } = (await req.json()) as { content: string };
        return json(sendChat(chat, content));
      },
    },
    // Undo something a chat turn did (flashcards made, words added). Lessons are not undone here.
    "/api/chats/:id/messages/:mid/actions/:k/undo": {
      POST: async (req) => {
        const m = db.query("SELECT m.actions, c.course FROM messages m JOIN chats c ON c.id=m.chat WHERE m.id=? AND m.chat=?").get(req.params.mid, req.params.id) as any;
        const outcomes: Outcome[] | null = m?.actions ? JSON.parse(m.actions) : null;
        const o = outcomes?.[Number(req.params.k)];
        if (!o) return json({ error: "not found" }, 404);
        await undoAction(o, m.course);
        db.run("UPDATE messages SET actions=? WHERE id=?", [JSON.stringify(outcomes), req.params.mid]);
        state.chat(req.params.id);
        return json({ actions: outcomes });
      },
    },

    // --- selection-driven generation -----------------------------------
    "/api/courses/:slug/drilldown": {
      POST: async (req) => {
        const { doc, quote, guidance } = (await req.json()) as { doc: string; quote: string; guidance?: string };
        const prompt = `/drill-down ${req.params.slug} ${doc}${await sectionHint(req.params.slug, doc)}\n\nSelected passage:\n${quoteBlock(quote)}${guidance ? `\n\nLearner's guidance: ${guidance}` : ""}`;
        return json(enqueue(req.params.slug, "drilldown", prompt, { ref: doc, then: (_r, job) => announceExtra(req.params.slug, doc, "drilldown", job.startedAt) }));
      },
    },
    // A worksheet for a section: many exercises on it, weighted toward what the learner has missed in
    // the section's own questions. `doc` is the section, or a worksheet made from it (another one).
    "/api/courses/:slug/worksheet": {
      POST: async (req) => {
        const slug = req.params.slug, { doc: from } = (await req.json()) as { doc: string };
        const doc = from?.includes("/worksheets/") ? `modules/${from.split("/")[1]}/${(await getDoc(slug, from))?.frontmatter.section ?? ""}` : from;
        if (!/^modules\/[^/]+\/\d\d-[^/]+\.md$/.test(doc ?? "") || !(await getDoc(slug, doc))) return json({ error: "a section is needed" }, 400);
        const rows = db.query("SELECT question, answer, result FROM answers WHERE course=? AND doc=?").all(slug, doc) as any[];
        const answers = rows.length ? rows.map((r) => `- ${r.question}: ${r.result ?? "not graded yet"}. Answer: ${String(r.answer).replace(/\s+/g, " ").slice(0, 300)}`).join("\n") : "None yet.";
        const mod = doc.split("/")[1];
        return json(enqueue(slug, "worksheet", `/make-worksheet ${slug} ${doc}\n\nThe learner's answers to this section's questions:\n${answers}`, {
          ref: doc, then: (_r, job) => { announceExtra(slug, doc, "worksheet", job.startedAt); lintModule(slug, mod); },
        }));
      },
    },
    "/api/courses/:slug/reading": {
      POST: async (req) => {
        const { doc, quote } = (await req.json()) as { doc: string; quote: string };
        return json(enqueue(req.params.slug, "reading", `/find-reading ${req.params.slug} ${doc}${await sectionHint(req.params.slug, doc)}\n\nSelected passage:\n${quoteBlock(quote)}`, { ref: doc, then: (_r, job) => announceExtra(req.params.slug, doc, "reading", job.startedAt) }));
      },
    },

    // --- phase 3: progress, module test, wrap-up, review ----------------
    "/api/courses/:slug/question": async (req) => { const spec = await question(req.params.slug, q(req, "doc"), q(req, "id")); return spec ? json(spec) : json({ error: "not found" }, 404); },
    "/api/courses/:slug/progress/:module": {
      // `read`: sections opened (seen). `done`: sections whose questions are all answered.
      GET: async (req) => { const p = progressOf(req.params.slug, req.params.module); return json({ ...p, done: await doneSections(await getCourse(req.params.slug), req.params.module, p) }); },
      PUT: async (req) => { const patch = await req.json(); return json(saveProgress(req.params.slug, req.params.module, patch)); },
    },
    "/api/courses/:slug/modules/:id/test": {
      POST: (req) => json(enqueue(req.params.slug, "test", `/generate-module-test ${req.params.slug} ${req.params.id}`, { ref: `${req.params.id}/test`, then: () => lintModule(req.params.slug, req.params.id) })),
    },
    // The learner's explanation starts the wrap-up discussion.
    "/api/courses/:slug/modules/:id/discuss": {
      POST: async (req) => {
        const { slug, id: mod } = req.params;
        const { summary } = (await req.json()) as { summary: string };
        const ev = await evidence(slug, mod);
        const results = ev.answers.filter((a) => a.doc.endsWith("/quiz.md")).map((a) => `${a.question} (${a.objective ?? "?"}): ${a.result ?? "ungraded"}, confidence ${a.confidence ?? "?"}`).join("\n");
        const chat = { id: id(), course: slug, doc: `modules/${mod}`, kind: "summary", module: mod, context: results ? `Their module test results:\n${results}` : null, title: "Wrap-up discussion", session_id: null };
        db.run("INSERT INTO chats (id, course, doc, kind, module, context, title, session_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [chat.id, slug, chat.doc, chat.kind, mod, chat.context, chat.title, null, now(), now()]);
        saveProgress(slug, mod, { summary, chat: chat.id, discussedAt: now() });
        sendChat(chat, summary);
        return json(chatWithMessages(chat.id));
      },
    },
    "/api/courses/:slug/modules/:id/finish": {
      POST: async (req) => {
        const { slug, id: mod } = req.params;
        const ev = await evidence(slug, mod);
        const job = enqueue(slug, "wrap", `/wrap-module ${slug} ${mod}\n\nEvidence:\n${JSON.stringify(ev, null, 2)}`, {
          ref: `${mod}/wrap`,
          then: () => { saveProgress(slug, mod, { completedAt: now() }); },
        });
        return json(job);
      },
    },
    "/api/courses/:slug/review": async (req) => json({ ...summary(req.params.slug), mastery: mastery(req.params.slug) }),
    "/api/review/summary": () => json(summary()),
    "/api/review": async (req) => {
      const u = new URL(req.url);
      const exclude = (u.searchParams.get("exclude") ?? "").split(",").filter(Boolean);
      const mode = (u.searchParams.get("mode") ?? "daily") as Mode;
      const scope = u.searchParams.get("scope") ?? u.searchParams.get("course") ?? undefined;
      const cap = u.searchParams.get("cap") ? Number(u.searchParams.get("cap")) : undefined;
      const course = mode === "module" || mode === "cram" ? scope?.split("/")[0] : scope;
      return json({ ...(await queue({ mode, scope, cap, exclude })), summary: summary(course), last: lastSession() });
    },
    "/api/review/settings": {
      GET: () => json(settings()),
      PUT: async (req) => { const b = (await req.json()) as { retention?: number; dailyCap?: number }; if (b.retention) setSetting("retention", Math.min(0.97, Math.max(0.8, b.retention))); if (b.dailyCap) setSetting("dailyCap", Math.min(100, Math.max(5, b.dailyCap))); if (b.retention) reschedule(); return json(settings()); },
    },
    "/api/review/optimize": { POST: async () => json(await optimize()) },
    "/api/review/stats": () => json(stats()),
    // A review answer rates the card and goes into its log; the lesson's `answers` row is untouched, so
    // the lesson page keeps showing what the learner did there, graded against the wording they saw.
    "/api/review/answer": {
      POST: async (req) => {
        const { course, question: qid, doc, answer, type, result, confidence, variant } = (await req.json()) as { course: string; question: string; doc: string; answer: string; type: "mcq" | "short"; result?: Result; confidence?: number; variant?: number | null };
        if (!course || !qid || !doc || typeof answer !== "string") return json({ error: "course, question, doc, answer required" }, 400);
        const vi = variant ?? null, v = vi != null ? variantsOf(course, qid)[vi] ?? null : null;
        const key = `${course}:${qid}`;
        if (type === "short") {
          const job = gradeShort(course, doc, qid, answer, v, (g, jobId) => {
            if (pendingReviewGrades.get(key) !== jobId) return;   // a later answer superseded this one
            pendingReviewGrades.delete(key);
            rate(course, qid, doc, g.result, confidence, vi, { answer, note: g.note });
            broadcast({ type: "card", course, question: qid });
          });
          pendingReviewGrades.set(key, job);
          return json({ ok: true, job, review: null });
        }
        if (!result) return json({ error: "result required for mcq" }, 400);
        pendingReviewGrades.delete(key);
        const review = rate(course, qid, doc, result, confidence, vi, { answer });
        broadcast({ type: "card", course, question: qid });
        return json({ ok: true, job: null, review });
      },
    },
    "/api/review/cards/:course/:question": (req) => { const c = cardStatus(req.params.course, req.params.question); return c ? json(c) : json({ error: "not found" }, 404); },
    "/api/review/sessions": { POST: async (req) => { const { kind, scope } = (await req.json()) as { kind: string; scope?: string }; return json(startSession(kind, scope ?? null)); } },
    "/api/review/sessions/:id": { PUT: async (req) => json(updateSession(req.params.id, await req.json())) },
    "/api/review/cards/:course/:question/suspend": { POST: async (req) => { const { suspended } = (await req.json()) as { suspended: boolean }; setSuspended(req.params.course, req.params.question, suspended); broadcast({ type: "card", course: req.params.course }); return json({ ok: true }); } },
    "/api/review/cards/:course/:question/flag": { POST: async (req) => { const { note } = (await req.json()) as { note: string | null }; setFlag(req.params.course, req.params.question, note || null); broadcast({ type: "card", course: req.params.course }); return json({ ok: true }); } },
    "/api/review/seed": { POST: async (req) => { const { course } = (await req.json().catch(() => ({}))) as { course?: string }; const added = await seed(course); broadcast({ type: "card" }); return json({ added }); } },
    "/api/review/seed/clear": { POST: async (req) => { const { course } = (await req.json().catch(() => ({}))) as { course?: string }; const removed = clearSeeded(course); broadcast({ type: "card" }); return json({ removed }); } },
    "/api/review/suspended": async (req) => json(await suspendedCards(new URL(req.url).searchParams.get("course") ?? undefined)),
    "/api/review/cards": async (req) => json(Object.fromEntries(await Promise.all((["suspended", "flagged", "orphaned"] as const).map(async (k) => [k, await cardList(k)])))),
    // Only orphans can be removed: a card whose question still exists would just come back.
    "/api/review/cards/:course/:question/delete": { POST: (req) => { const c = db.query("SELECT state FROM cards WHERE course=? AND question=?").get(req.params.course, req.params.question) as any; if (c?.state !== "orphaned") return json({ error: "only orphaned cards can be removed" }, 400); deleteCard(req.params.course, req.params.question); broadcast({ type: "card", course: req.params.course }); return json({ ok: true }); } },

    // abcjs's prebuilt file, loaded by the first score on a page instead of living in the app bundle.
    "/vendor/abcjs.js": () => new Response(Bun.file(join(import.meta.dir, "../node_modules/abcjs/dist/abcjs-basic-min.js")), { headers: { "content-type": "text/javascript", "cache-control": "max-age=86400" } }),

    // --- vocabulary ---------------------------------------------------------
    "/api/vocab": {
      GET: () => json({ words: vocab.listWords(), counts: vocab.counts() }),
      POST: async (req) => {
        try { return json(vocab.addWord((await req.json()) as vocab.Capture)); }
        catch (e) { return json({ error: (e as Error).message }, 400); }
      },
    },
    // Today's session, or the one in progress; ?fresh=1 starts over. PUT keeps the one in progress.
    "/api/vocab/train": (req) => json(vocab.session(q(req, "fresh") === "1")),
    "/api/vocab/train/session": { PUT: async (req) => { vocab.saveSession((await req.json()) as vocab.SavedSession | null); return json({ ok: true }); } },
    // A grade by job id, for a page that missed its `vgrade` event.
    "/api/vocab/grades/:job": (req) => json(vocab.gradeOf(req.params.job)),
    "/api/vocab/:id": {
      GET: (req) => word(req, (wid) => vocab.getWord(wid)),
      PUT: async (req) => {
        const body = await req.json();
        try { return await word(req, (wid) => vocab.updateWord(wid, body)); } catch (e) { return json({ error: (e as Error).message }, 400); }
      },
      DELETE: (req) => word(req, (wid) => { if (!vocab.getWord(wid)) return null; vocab.deleteWord(wid); return { ok: true }; }),
    },
    "/api/vocab/:id/family": { POST: async (req) => { const { word: kin } = (await req.json()) as { word: string }; try { return await word(req, (wid) => vocab.addKin(wid, String(kin ?? ""))); } catch (e) { return json({ error: (e as Error).message }, 400); } } },
    "/api/vocab/:id/regenerate": { POST: async (req) => word(req, async (wid) => { if (!vocab.getWord(wid)) return null; await vocab.enrich(wid); return { ok: true }; }) },
    "/api/vocab/:id/meet": { POST: (req) => word(req, (wid) => vocab.meet(wid)) },
    "/api/vocab/:id/finish": { POST: async (req) => { const body = await req.json(); return word(req, (wid) => vocab.finishWord(wid, body)); } },
    "/api/vocab/:id/task": (req) => word(req, (wid) => vocab.task(wid, q(req, "stage") ? Number(q(req, "stage")) : undefined)),
    // A graded attempt. Exact recalls and picks answer at once; the rest come back as a `vgrade`
    // event (a grade, or an error), and from /api/vocab/grades/:job.
    "/api/vocab/:id/answer": {
      POST: async (req) => {
        const wid = req.params.id, a = vocab.parseAttempt(await req.json());
        if (!vocab.validId(wid)) return json({ error: "not found" }, 404);
        if (!a) return json({ error: "format, mode and answer required" }, 400);
        try {
          return json(vocab.answer(wid, a, (g, job) => broadcast({ type: "vgrade", id: wid, mode: a.mode, job, ...g })));
        } catch (e) { return json({ error: (e as Error).message }, 400); }
      },
    },

    "/api/sync": {
      GET: () => json(sync.status),
      POST: async () => { await sync.pull(); await sync.flush(); return json(sync.status); },
    },
    "/api/jobs": () => json(jobs()),
    "/api/courses/:slug/jobs": (req) => json(history(req.params.slug)),
    "/api/jobs/:id/log": (req) => json(jobLog(req.params.id)),
    "/api/jobs/:id/cancel": { POST: (req) => { cancel(req.params.id); return json({ ok: true }); } },

    "/*": index,
  },
});

console.log(`Learning: http://localhost:${process.env.PORT ?? 4000}`);
