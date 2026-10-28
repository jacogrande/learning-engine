// Reads courses from content/courses/<slug>/. Files are the source of truth; nothing is cached.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import YAML from "yaml";

export const ROOT = resolve(import.meta.dir, "../..");
export const COURSES_DIR = join(ROOT, "content/courses");

export type Doc = { frontmatter: Record<string, any>; body: string };

export function parseDoc(src: string): Doc {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { frontmatter: {}, body: src };
  return { frontmatter: YAML.parse(m[1]) ?? {}, body: src.slice(m[0].length) };
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
export type Module = {
  id: string; title: string; summary?: string; objectives?: string[];
  status: "planned" | "ready"; sections: Section[];
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
    modules.push({ ...m, status: sections.length ? "ready" : "planned", sections });
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
