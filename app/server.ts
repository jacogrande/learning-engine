// `bun run dev` — serves the client (bundled by Bun) and the API.
import index from "./client/index.html";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NOTES_DIR, listCourses, getCourse, getDoc } from "./server/content";
import { db, id, now } from "./server/db";
import { enqueue, cancel, jobs, jobLog, history } from "./server/jobs";
import { sse, watchContent, broadcast } from "./server/events";
import { state, migrate, rebuild } from "./server/state";
import { rate, due, question, mastery } from "./server/review";
import * as sync from "./server/sync";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const q = (req: Request, key: string) => new URL(req.url).searchParams.get(key) ?? "";

const RESULT = { type: "string", enum: ["correct", "partial", "wrong", "skipped"] };
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
const GRADE_SCHEMA = { type: "object", properties: { result: RESULT, note: { type: "string" } }, required: ["result", "note"] };

// Latest attempt for a quiz, plus any unsent draft.
async function quizState(course: string, quiz: string) {
  const a = db.query("SELECT id, answers, grade, created_at FROM attempts WHERE course=? AND quiz=? ORDER BY created_at DESC LIMIT 1").get(course, quiz) as any;
  const d = db.query("SELECT answers FROM drafts WHERE course=? AND quiz=?").get(course, quiz) as any;
  const grade = a?.grade ? JSON.parse(a.grade) : null;
  // Grades recorded before per-question results existed: read them from the assessment file's table.
  if (grade && !grade.questions) {
    const doc = await getDoc(course, `quizzes/${quiz}-assessment.md`);
    grade.questions = [...(doc?.body.matchAll(/^\|\s*(q-[\w-]+)\s*\|\s*(correct|partial|wrong|skipped)\s*\|\s*(.*?)\s*\|\s*$/gm) ?? [])]
      .map(([, id, result, note]) => ({ id, result, note }));
  }
  return {
    draft: d ? JSON.parse(d.answers) : null,
    attempt: a ? { id: a.id, answers: JSON.parse(a.answers), grade, createdAt: a.created_at } : null,
  };
}

function assess(slug: string, attempt: { id: string; answers: unknown }) {
  return enqueue(slug, "assess", `/assess-baseline ${slug}\n\nLearner answers (question id → answer):\n${JSON.stringify(attempt.answers, null, 2)}`, {
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
const TUTOR_SYSTEM = `Your reply is shown to the learner verbatim. Produce exactly one reply and nothing else: no text before or between tool calls, no "I'll read…", no headings, no bullet lists unless listing is the point. Two to six sentences. At most one question per reply. Hold an answer back until the learner has made a real attempt; after that, give it straight. If they say something wrong, say so and why. Each learner message starts with its exchange number.`;

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
    : `/chat ${chat.course} ${chat.doc}\n\n${chat.context ? `Selected passage:\n${quoteBlock(chat.context)}\n\n` : ""}`;
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
    ref: chat.id, resume: chat.session_id ?? undefined, system: TUTOR_SYSTEM,
    stream: (delta, reset) => { if (reset) { text = ""; broadcast({ type: "chat", chat: chat.id, reset: true }); } else { text += delta; broadcast({ type: "chat", chat: chat.id, delta }); } },
    then: (result, job) => {
      const reply = typeof result === "string" && result.trim() ? result : text;
      const aid = id();
      db.run("INSERT INTO messages (id, chat, role, content, created_at) VALUES (?,?,?,?,?)", [aid, chat.id, "assistant", reply, now()]);
      db.run("UPDATE chats SET session_id=COALESCE(session_id, ?), updated_at=? WHERE id=?", [job.sessionId ?? null, now(), chat.id]);
      state.chat(chat.id);
      broadcast({ type: "chat", chat: chat.id, done: true, message: { id: aid, role: "assistant", content: reply } });
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
  messages: db.query("SELECT id, role, content, created_at createdAt FROM messages WHERE chat=? ORDER BY created_at").all(cid),
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

migrate();
sync.afterPull(() => { rebuild(); broadcast({ type: "content" }); });
await sync.init();
rebuild();
watchContent();

Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  development: { hmr: true, console: false },
  routes: {
    "/api/events": (req) => sse(req),
    "/api/courses": async () => json(await listCourses()),
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
        const { answers } = (await req.json()) as { answers: unknown };
        db.run("INSERT INTO drafts (course, quiz, answers, updated_at) VALUES (?,?,?,?) ON CONFLICT(course, quiz) DO UPDATE SET answers=excluded.answers, updated_at=excluded.updated_at",
          [req.params.slug, req.params.quiz, JSON.stringify(answers), now()]);
        return json({ ok: true });
      },
    },
    "/api/courses/:slug/baseline": {
      POST: async (req) => {
        const slug = req.params.slug;
        const { answers } = (await req.json()) as { answers: Record<string, string> };
        const attempt = { id: id(), answers };
        db.run("INSERT INTO attempts (id, course, quiz, answers, created_at) VALUES (?,?,?,?,?)", [attempt.id, slug, "baseline", JSON.stringify(answers), now()]);
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
      GET: (req) => json(db.query("SELECT question, answer, result, note, job, confidence, graded_at gradedAt FROM answers WHERE course=? AND doc=?").all(req.params.slug, q(req, "doc"))),
      // Confidence is recorded before feedback; the result feeds the spaced-review schedule.
      POST: async (req) => {
        const slug = req.params.slug;
        const { question: qid, doc, answer, type, result, confidence } = (await req.json()) as { question: string; doc: string; answer: string; type: "mcq" | "short"; result?: string; confidence?: number };
        let job: string | null = null;
        const jobRef = { id: "" };
        if (type === "short") {
          job = jobRef.id = enqueue(slug, "grade", `/grade ${slug} ${doc} ${qid}\n\nLearner's answer:\n${quoteBlock(answer)}`, {
            ref: qid, schema: GRADE_SCHEMA,
            then: (g: any) => {
              // Only if this is still the answer the job graded (the learner may have re-checked since).
              const r = db.run("UPDATE answers SET result=?, note=?, graded_at=? WHERE course=? AND question=? AND job=?", [g.result, g.note, now(), slug, qid, jobRef.id]);
              if (!r.changes) return;
              state.answer(slug, qid);
              rate(slug, qid, doc, g.result, confidence);
              broadcast({ type: "answer", course: slug, doc, question: qid });
            },
          }).id;
        }
        db.run(`INSERT INTO answers (course, question, doc, answer, result, note, job, confidence, updated_at, graded_at) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(course, question) DO UPDATE SET doc=excluded.doc, answer=excluded.answer, result=excluded.result, note=NULL, job=excluded.job, confidence=excluded.confidence, updated_at=excluded.updated_at, graded_at=excluded.graded_at`,
          [slug, qid, doc, answer, type === "mcq" ? result ?? null : null, null, job, confidence ?? null, now(), type === "mcq" ? now() : null]);
        state.answer(slug, qid);
        const review = type === "mcq" && result ? rate(slug, qid, doc, result as any, confidence) : null;
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
    "/api/annotations/:id": { DELETE: (req) => { db.run("DELETE FROM annotations WHERE id=?", [req.params.id]); state.annotationDeleted(req.params.id); return json({ ok: true }); } },

    // --- notes: one markdown file per module, readable by Claude --------
    "/api/courses/:slug/notes/:module": {
      GET: async (req) => json({ markdown: await readFile(notesPath(req.params.slug, req.params.module), "utf8").catch(() => "") }),
      PUT: async (req) => {
        const { markdown } = (await req.json()) as { markdown: string };
        const p = notesPath(req.params.slug, req.params.module);
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
    "/api/chats/:id": (req) => json(chatWithMessages(req.params.id)),
    "/api/chats/:id/messages": {
      POST: async (req) => {
        const chat = db.query("SELECT * FROM chats WHERE id=?").get(req.params.id) as any;
        if (!chat) return json({ error: "not found" }, 404);
        const { content } = (await req.json()) as { content: string };
        return json(sendChat(chat, content));
      },
    },

    // --- selection-driven generation -----------------------------------
    "/api/courses/:slug/drilldown": {
      POST: async (req) => {
        const { doc, quote, guidance } = (await req.json()) as { doc: string; quote: string; guidance?: string };
        const prompt = `/drill-down ${req.params.slug} ${doc}\n\nSelected passage:\n${quoteBlock(quote)}${guidance ? `\n\nLearner's guidance: ${guidance}` : ""}`;
        return json(enqueue(req.params.slug, "drilldown", prompt, { ref: doc }));
      },
    },
    "/api/courses/:slug/reading": {
      POST: async (req) => {
        const { doc, quote } = (await req.json()) as { doc: string; quote: string };
        return json(enqueue(req.params.slug, "reading", `/find-reading ${req.params.slug} ${doc}\n\nSelected passage:\n${quoteBlock(quote)}`, { ref: doc }));
      },
    },

    // --- phase 3: progress, module test, wrap-up, review ----------------
    "/api/courses/:slug/question": async (req) => { const spec = await question(req.params.slug, q(req, "doc"), q(req, "id")); return spec ? json(spec) : json({ error: "not found" }, 404); },
    "/api/courses/:slug/progress/:module": {
      GET: (req) => json(progressOf(req.params.slug, req.params.module)),
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
    "/api/courses/:slug/review": async (req) => json({ ...(await due(req.params.slug)), mastery: mastery(req.params.slug) }),

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
