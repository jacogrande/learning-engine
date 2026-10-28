// `bun run dev` — serves the client (bundled by Bun) and the API.
import index from "./client/index.html";
import { listCourses, getCourse, getDoc } from "./server/content";
import { db, id, now } from "./server/db";
import { enqueue, cancel, jobs, jobLog, history } from "./server/jobs";
import { sse, watchContent } from "./server/events";

const json = (data: unknown, status = 200) => Response.json(data, { status });

const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string", enum: ["novice", "familiar", "intermediate", "advanced"] },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          result: { type: "string", enum: ["correct", "partial", "wrong", "skipped"] },
          note: { type: "string" },
        },
        required: ["id", "result", "note"],
      },
    },
  },
  required: ["level", "summary", "strengths", "gaps", "questions"],
};

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
      enqueue(slug, "outline", `/generate-outline ${slug}`);
    },
  });
}

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
      const path = new URL(req.url).searchParams.get("path") ?? "";
      const d = await getDoc(req.params.slug, path);
      return d ? json(d) : json({ error: "not found" }, 404);
    },

    // Answers are saved as a draft while typing, as an attempt on submit (before Claude
    // sees them), and the grade is attached when assessment finishes.
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
        db.run("INSERT INTO attempts (id, course, quiz, answers, created_at) VALUES (?,?,?,?,?)",
          [attempt.id, slug, "baseline", JSON.stringify(answers), now()]);
        db.run("DELETE FROM drafts WHERE course=? AND quiz=?", [slug, "baseline"]);
        assess(slug, attempt);
        return json({ attempt: attempt.id });
      },
    },
    // Re-run assessment on the saved attempt (after a failed or cancelled job).
    "/api/courses/:slug/baseline/assess": {
      POST: async (req) => {
        const { attempt } = await quizState(req.params.slug, "baseline");
        return attempt ? json(assess(req.params.slug, attempt)) : json({ error: "no attempt" }, 404);
      },
    },
    "/api/courses/:slug/outline": { POST: (req) => json(enqueue(req.params.slug, "outline", `/generate-outline ${req.params.slug}`)) },
    "/api/courses/:slug/modules/:id/generate": {
      POST: (req) => json(enqueue(req.params.slug, "module", `/generate-module ${req.params.slug} ${req.params.id}`, { ref: req.params.id })),
    },

    "/api/jobs": () => json(jobs()),
    "/api/courses/:slug/jobs": (req) => json(history(req.params.slug)),
    "/api/jobs/:id/log": (req) => json(jobLog(req.params.id)),
    "/api/jobs/:id/cancel": { POST: (req) => { cancel(req.params.id); return json({ ok: true }); } },

    "/*": index,
  },
});

console.log(`Learning: http://localhost:${process.env.PORT ?? 4000}`);
