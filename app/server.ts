// `bun run dev` — serves the client (bundled by Bun) and the API.
import index from "./client/index.html";
import { listCourses, getCourse, getDoc } from "./server/content";
import { db, id, now } from "./server/db";
import { enqueue, cancel, jobs, jobLog } from "./server/jobs";
import { sse, watchContent } from "./server/events";

const json = (data: unknown, status = 200) => Response.json(data, { status });

const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string", enum: ["novice", "familiar", "intermediate", "advanced"] },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["level", "summary", "strengths", "gaps"],
};

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

    // Baseline submitted → save attempt → assess → outline.
    "/api/courses/:slug/baseline": {
      POST: async (req) => {
        const slug = req.params.slug;
        const { answers } = (await req.json()) as { answers: Record<string, string> };
        const attempt = id();
        db.run("INSERT INTO attempts (id, course, quiz, answers, created_at) VALUES (?,?,?,?,?)",
          [attempt, slug, "baseline", JSON.stringify(answers), now()]);
        const job = enqueue(slug, "assess", `/assess-baseline ${slug}\n\nLearner answers (question id → answer):\n${JSON.stringify(answers, null, 2)}`, {
          schema: ASSESSMENT_SCHEMA,
          then: (grade) => {
            db.run("UPDATE attempts SET grade=? WHERE id=?", [JSON.stringify(grade), attempt]);
            enqueue(slug, "outline", `/generate-outline ${slug}`);
          },
        });
        return json(job);
      },
    },
    "/api/courses/:slug/outline": { POST: (req) => json(enqueue(req.params.slug, "outline", `/generate-outline ${req.params.slug}`)) },
    "/api/courses/:slug/modules/:id/generate": {
      POST: (req) => json(enqueue(req.params.slug, "module", `/generate-module ${req.params.slug} ${req.params.id}`, { ref: req.params.id })),
    },

    "/api/jobs": () => json(jobs()),
    "/api/jobs/:id/log": (req) => json(jobLog(req.params.id)),
    "/api/jobs/:id/cancel": { POST: (req) => { cancel(req.params.id); return json({ ok: true }); } },

    "/*": index,
  },
});

console.log(`Learning: http://localhost:${process.env.PORT ?? 4000}`);
