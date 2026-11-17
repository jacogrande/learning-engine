// Reads courses from content/courses/<slug>/. Files are the source of truth; nothing is cached.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
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
// Parsed docs, reused while the file's mtime and size are unchanged: every page load reads every
// module of every course, and most of those files have not changed since the last request.
const parsed = new Map<string, { mtime: number; size: number; doc: Doc }>();
async function readDoc(p: string): Promise<Doc | null> {
  const s = await stat(p).catch(() => null);
  if (!s?.isFile()) { parsed.delete(p); return null; }
  const hit = parsed.get(p);
  if (hit && hit.mtime === s.mtimeMs && hit.size === s.size) return structuredClone(hit.doc);
  const doc = parseDoc(await readFile(p, "utf8"));
  parsed.set(p, { mtime: s.mtimeMs, size: s.size, doc });
  return structuredClone(doc);
}
async function mdFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort();
}

export type Section = { file: string; title: string };
// Drill-downs and reading lists generated from a selection, and worksheets made at the end of a
// section; `section` is the file they came from.
export type Extra = { file: string; title: string; kind: "drilldown" | "reading" | "worksheet"; section?: string };
export type Objective = { id: string; text: string; level?: string; status?: "met" | "partial" | "unmet"; evidence?: string };
export type Module = {
  id: string; title: string; summary?: string; objectives: Objective[];
  status: "planned" | "ready"; sections: Section[]; extras: Extra[];
  test: boolean;            // modules/<id>/quiz.md exists
  understanding: null | { level?: string; summary?: string; calibration?: string; carry?: string[] };
};
// `format: brief` is a one-module course with no baseline, for getting up to speed on a topic fast.
// `folder` groups courses on the home page. `review: false` keeps a course's cards out of the daily
// review and the all-course modes; its own review page still serves them.
export type Course = {
  slug: string; title: string; depth?: string; description: string;
  format: "course" | "brief"; folder: string | null; review: boolean;
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
    for (const [sub, kind] of [["drilldowns", "drilldown"], ["readings", "reading"], ["worksheets", "worksheet"]] as const)
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
      return { id, text: typeof text === "string" ? text : String((text as any)?.text ?? ""), level: m.levels?.[i], status: statuses[id]?.status, evidence: statuses[id]?.evidence };
    });
    const sectionFiles = files.filter((f) => f !== "quiz.md" && f !== "understanding.md");
    modules.push({
      ...m, objectives, status: sectionFiles.length ? "ready" : "planned",
      sections: sections.filter((s) => sectionFiles.includes(s.file)), extras,
      test: files.includes("quiz.md"),
      understanding: u ? { level: u.frontmatter.level, summary: u.frontmatter.summary, calibration: u.frontmatter.calibration, carry: u.frontmatter.carry } : null,
    });
  }

  const fm = course.frontmatter;
  return {
    slug, title: fm.title ?? slug, depth: fm.depth, description: course.body.trim(),
    format: fm.format === "brief" ? "brief" : "course", folder: typeof fm.folder === "string" && normFolder(fm.folder) ? normFolder(fm.folder) : null,
    review: fm.review !== false && fm.review !== "false", stage, modules,
  };
}

// Slugs of the courses whose course.md sets `review: false`. Reads only course.md (mtime-cached).
export async function outOfReview(): Promise<string[]> {
  if (!(await exists(COURSES_DIR))) return [];
  const slugs = (await readdir(COURSES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const out: string[] = [];
  for (const slug of slugs) { const r = (await readDoc(join(COURSES_DIR, slug, "course.md")))?.frontmatter.review; if (r === false || r === "false") out.push(slug); }
  return out;
}

// A free slug for a new course: kebab-case of the subject, numbered if taken.
export async function freeSlug(subject: string): Promise<string> {
  const base = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 6).join("-") || "brief";
  for (let n = 1; ; n++) { const s = n === 1 ? base : `${base}-${n}`; if (!(await exists(join(COURSES_DIR, s)))) return s; }
}

// Folders. A course's `folder` is a path, "Work" or "Work/Clients". Folders with no course in them
// yet are kept in content/folders.json, so a folder can be made before anything is filed in it.
export const FOLDERS_FILE = join(LIBRARY, "content/folders.json");
export const normFolder = (p: string) => p.split("/").map((s) => s.trim().replace(/\|/g, "")).filter((s) => s && s !== "." && s !== "..").join("/");
async function savedFolders(): Promise<string[]> {
  try { const v = JSON.parse(await readFile(FOLDERS_FILE, "utf8")); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
const saveFolders = (list: string[]) => writeFile(FOLDERS_FILE, JSON.stringify([...new Set(list)].sort(), null, 2) + "\n");
// Every folder: the saved ones, every course's, and each one's ancestors.
export async function listFolders(): Promise<string[]> {
  const all = new Set<string>();
  const add = (p: string) => { const parts = normFolder(p).split("/").filter(Boolean); for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("/")); };
  for (const f of await savedFolders()) add(f);
  // Only each course.md (mtime-cached), not the whole course: this runs on every folder change.
  const slugs = (await readdir(COURSES_DIR, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const slug of slugs) { const f = (await readDoc(join(COURSES_DIR, slug, "course.md")))?.frontmatter.folder; if (typeof f === "string") add(f); }
  return [...all].sort();
}
export async function addFolder(path: string) {
  const p = normFolder(path); if (!p) return null;
  await saveFolders([...(await savedFolders()), p]);
  return p;
}
const under = (f: string, root: string) => f === root || f.startsWith(root + "/");
// Folder context: a markdown note per folder, content/folders/<path>.md, that every generation job
// for a course in that folder (at any depth) reads. See folderContextBlock.
export const FOLDER_CONTEXT_DIR = join(LIBRARY, "content/folders");
const contextFile = (p: string) => join(FOLDER_CONTEXT_DIR, ...normFolder(p).split("/")) + ".md";
export async function getFolderContext(p: string) { return normFolder(p) ? readFile(contextFile(p), "utf8").catch(() => "") : ""; }
export async function setFolderContext(p: string, markdown: string) {
  if (!normFolder(p)) return false;
  const f = contextFile(p);
  if (!markdown.trim()) await rm(f, { force: true });
  else { await mkdir(dirname(f), { recursive: true }); await writeFile(f, markdown.trimEnd() + "\n"); }
  return true;
}
// The contexts a course inherits, top folder first, as a block to append to a job's prompt.
// Synchronous: the job runner builds its command line in one go. `folder` stands in for a
// course that does not exist yet (a new course or brief being started inside a folder).
export function folderContextBlock(slug: string, folder?: string | null): string {
  let f = folder ?? null;
  if (f === null && slug !== "new") {
    try { const fm = parseDoc(readFileSync(join(COURSES_DIR, slug, "course.md"), "utf8")).frontmatter; f = typeof fm.folder === "string" ? fm.folder : null; } catch {}
  }
  const path = f ? normFolder(f) : "";
  if (!path) return "";
  const parts = path.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))
    .map((p) => { try { const md = readFileSync(contextFile(p), "utf8").trim(); return md ? `### ${p.split("/").join(" › ")}\n\n${md}` : ""; } catch { return ""; } })
    .filter(Boolean);
  if (!parts.length) return "";
  return `\n\n## Folder context\n\nThis course sits in the folder ${path.split("/").join(" › ")}. The learner wrote these notes on that folder and each one above it, outermost first; a deeper folder's note is more specific and wins where they differ. Use them as standing context about the learner, their work and how they want material shaped: draw examples, emphasis and terminology from them. They come after this skill's rules and the content grammar, never instead of them.\n\n${parts.join("\n\n")}\n`;
}

// Renames a folder and everything under it: the saved list, every course filed there, and the
// folder contexts.
export async function renameFolder(from: string, to: string) {
  const a = normFolder(from), b = normFolder(to);
  if (!a || !b || a === b || under(b, a)) return false;
  const swap = (f: string) => (under(f, a) ? b + f.slice(a.length) : f);
  const fromBase = join(FOLDER_CONTEXT_DIR, ...a.split("/")), toBase = join(FOLDER_CONTEXT_DIR, ...b.split("/"));
  await mkdir(dirname(toBase), { recursive: true });
  await rename(fromBase + ".md", toBase + ".md").catch(() => {});
  await rename(fromBase, toBase).catch(() => {});
  await saveFolders((await savedFolders()).map(swap));
  for (const c of await listCourses()) if (c.folder && under(c.folder, a)) await setCourseMeta(c.slug, { folder: swap(c.folder) });
  return true;
}
// Removes a folder that holds no course, at any depth.
export async function removeFolder(path: string) {
  const p = normFolder(path);
  if ((await listCourses()).some((c) => c.folder && under(c.folder, p))) return false;
  await saveFolders((await savedFolders()).filter((f) => !under(f, p)));
  const base = join(FOLDER_CONTEXT_DIR, ...p.split("/"));
  await rm(base + ".md", { force: true }); await rm(base, { recursive: true, force: true });
  return true;
}

// Sets `folder` and `review` in course.md, keeping every other line of the file as written.
export async function setCourseMeta(slug: string, meta: { folder?: string | null; review?: boolean }): Promise<boolean> {
  const p = join(COURSES_DIR, slug, "course.md");
  const src = await readFile(p, "utf8").catch(() => null);
  const m = src && /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!src || !m) return false;
  let lines = m[1].split("\n");
  const put = (key: string, line: string | null) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (line === null) { if (i >= 0) lines.splice(i, 1); }
    else if (i >= 0) lines[i] = line; else lines.push(line);
  };
  if (meta.folder !== undefined) put("folder", meta.folder && normFolder(meta.folder) ? `folder: ${JSON.stringify(normFolder(meta.folder))}` : null);
  if (meta.review !== undefined) put("review", meta.review ? null : "review: false");
  await writeFile(p, `---\n${lines.join("\n")}\n---\n${src.slice(m[0].length)}`);
  return true;
}

// Any markdown doc inside the course, by course-relative path. Guards against traversal.
export async function getDoc(slug: string, rel: string): Promise<Doc | null> {
  const dir = join(COURSES_DIR, slug);
  const full = resolve(dir, rel);
  if (!full.startsWith(dir + "/") || !full.endsWith(".md")) return null;
  return readDoc(full);
}
