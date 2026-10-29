// Reads courses from content/courses/<slug>/. Files are the source of truth; nothing is cached.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import YAML from "yaml";

export const ROOT = resolve(import.meta.dir, "../..");
// The library is the user's data: courses, notes, state. Its own git repo; the app never commits it
// as part of itself. `library/` inside the app dir is the default; LEARNING_DIR points elsewhere.
export const LIBRARY = resolve(process.env.LEARNING_DIR ?? join(ROOT, "library"));
export const COURSES_DIR = join(LIBRARY, "content/courses");
export const NOTES_DIR = join(LIBRARY, "notes");
export const STATE_DIR = join(LIBRARY, "state");

export type Doc = { frontmatter: Record<string, any>; body: string };

export function parseDoc(src: string): Doc {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { frontmatter: {}, body: src };
  let frontmatter: Record<string, any>;
  try { frontmatter = YAML.parse(m[1]) ?? {}; }
  catch {
    // Claude occasionally writes an unquoted value containing ": ". Fall back to a line-wise
    // read of the scalar keys so one bad file never takes a course down.
    frontmatter = {};
    for (const line of m[1].split("\n")) { const k = /^(\w[\w-]*):\s*(.*)$/.exec(line); if (k) frontmatter[k[1]] = k[2].replace(/^["']|["']$/g, ""); }
  }
  return { frontmatter, body: src.slice(m[0].length) };
}

async function exists(p: string) { return stat(p).then(() => true, () => false); }
async function readDoc(p: string): Promise<Doc | null> {
  return (await exists(p)) ? parseDoc(await readFile(p, "utf8")) : null;
}
async function mdFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort();
}

export type Section = { file: string; title: string };
// Drill-downs and reading lists generated from a selection; `section` is the file they came from.
export type Extra = { file: string; title: string; kind: "drilldown" | "reading"; section?: string };
export type Objective = { id: string; text: string; status?: "met" | "partial" | "unmet"; evidence?: string };
export type Module = {
  id: string; title: string; summary?: string; objectives: Objective[];
  status: "planned" | "ready"; sections: Section[]; extras: Extra[];
  test: boolean;            // modules/<id>/quiz.md exists
  understanding: null | { level?: string; summary?: string; calibration?: string; carry?: string[] };
};
export type Course = {
  slug: string; title: string; depth?: string; description: string;
  stage: "baseline" | "assessed" | "ready";
  modules: Module[];
};

export async function listCourses(): Promise<Course[]> {
  if (!(await exists(COURSES_DIR))) return [];
  const slugs = (await readdir(COURSES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const courses = await Promise.all(slugs.map(getCourse));
  return courses.filter((c): c is Course => !!c);
}

export async function getCourse(slug: string): Promise<Course | null> {
  const dir = join(COURSES_DIR, slug);
  const course = await readDoc(join(dir, "course.md"));
  if (!course) return null;

  const assessed = await exists(join(dir, "quizzes/baseline-assessment.md"));
  const outline = await readDoc(join(dir, "outline.md"));
  const stage = outline ? "ready" : assessed ? "assessed" : "baseline";

  const modules: Module[] = [];
  for (const m of outline?.frontmatter.modules ?? []) {
    const files = await mdFiles(join(dir, "modules", m.id));
    const sections: Section[] = [];
    for (const file of files) {
      const d = await readDoc(join(dir, "modules", m.id, file));
      sections.push({ file, title: d?.frontmatter.title ?? basename(file, ".md") });
    }
    const extras: Extra[] = [];
    for (const [sub, kind] of [["drilldowns", "drilldown"], ["readings", "reading"]] as const)
      for (const file of await mdFiles(join(dir, "modules", m.id, sub))) {
        const d = await readDoc(join(dir, "modules", m.id, sub, file));
        extras.push({ file: `${sub}/${file}`, kind, title: d?.frontmatter.title ?? basename(file, ".md"), section: d?.frontmatter.section });
      }
    // Objectives are referenced by position: obj-<module-nn>-<n>. The understanding summary,
    // written at wrap-up, carries their status.
    const nn = m.id.slice(0, 2);
    const u = await readDoc(join(dir, "modules", m.id, "understanding.md"));
    const statuses = Object.fromEntries(((u?.frontmatter.objectives ?? []) as any[]).map((o) => [o.id, o]));
    const objectives: Objective[] = (m.objectives ?? []).map((text: string, i: number) => {
      const id = `obj-${nn}-${i + 1}`;
      return { id, text, status: statuses[id]?.status, evidence: statuses[id]?.evidence };
    });
    const sectionFiles = files.filter((f) => f !== "quiz.md" && f !== "understanding.md");
    modules.push({
      ...m, objectives, status: sectionFiles.length ? "ready" : "planned",
      sections: sections.filter((s) => sectionFiles.includes(s.file)), extras,
      test: files.includes("quiz.md"),
      understanding: u ? { level: u.frontmatter.level, summary: u.frontmatter.summary, calibration: u.frontmatter.calibration, carry: u.frontmatter.carry } : null,
    });
  }

  return { slug, title: course.frontmatter.title ?? slug, depth: course.frontmatter.depth, description: course.body.trim(), stage, modules };
}

// Any markdown doc inside the course, by course-relative path. Guards against traversal.
export async function getDoc(slug: string, rel: string): Promise<Doc | null> {
  const dir = join(COURSES_DIR, slug);
  const full = resolve(dir, rel);
  if (!full.startsWith(dir + "/") || !full.endsWith(".md")) return null;
  return readDoc(full);
}
