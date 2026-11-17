// Checks generated module files the way the renderer will read them, so a malformed quiz block or
// a missing objective is reported right after the job instead of discovered in the reader.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import abcjs from "abcjs";
import { COURSES_DIR, parseDoc } from "./content";
import { abcSourceProblems, tidyAbc, tuneProblems, youtubeProblems } from "../shared/notation";
import { imageRefs, mockProblems, parseChart } from "../shared/visuals";
import { LANGUAGES, checkCode, runSql, runnable } from "./code";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const ID = /^q-(base-\d{2}|\d{2}-(r\d|t\d{2}|dd\d{2}|fc\d{2,3}|ws\d{2,3}|\d{2}))$/;
const OBJ = /^obj-\d{2}-\d+$/;

export async function lint(course: string, mod: string): Promise<string[]> {
  const dir = join(COURSES_DIR, course, "modules", mod);
  // Sections, the test and understanding, then worksheets (practice pages: no `order`, no prose ceiling).
  const top = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).sort();
  const sheets = (await readdir(join(dir, "worksheets")).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).sort().map((f) => `worksheets/${f}`);
  const files = [...top, ...sheets];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const src = await readFile(join(dir, f), "utf8");
    const doc = parseDoc(src);
    if (!doc.frontmatter.title) problems.push(`${f}: no title in frontmatter`);
    const sheet = f.startsWith("worksheets/");
    if (!sheet && f !== "quiz.md" && f !== "understanding.md" && doc.frontmatter.order == null) problems.push(`${f}: no order in frontmatter`);
    if (sheet && !doc.frontmatter.section) problems.push(`${f}: no section in frontmatter`);
    const fences = [...doc.body.matchAll(/```quiz\n([\s\S]*?)```/g)];
    if (!fences.length && f !== "understanding.md") problems.push(`${f}: no quiz block`);
    // The first module's test re-asks a baseline question; when no objective of the module fits it,
    // it carries none (generate-module-test). One such question is allowed there, nowhere else.
    let unaimed = f === "quiz.md" && mod.startsWith("01-") ? 1 : 0;
    for (const [, body] of fences) {
      let q: any;
      try { q = YAML.parse(body); } catch (e) { problems.push(`${f}: quiz block does not parse (${String(e).split("\n")[0]})`); continue; }
      const id = String(q?.id ?? "");
      if (!ID.test(id)) problems.push(`${f}: bad quiz id "${id}"`);
      if (seen.has(id)) problems.push(`${f}: duplicate quiz id "${id}"`); seen.add(id);
      if (!q?.prompt) problems.push(`${f}: ${id} has no prompt`);
      if (q?.objective == null && unaimed > 0) unaimed--;
      else if (!OBJ.test(String(q?.objective ?? ""))) problems.push(`${f}: ${id} has no objective`);
      if (q?.type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 3) problems.push(`${f}: ${id} needs 3+ options`);
        else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) problems.push(`${f}: ${id} answer out of range`);
        if (!q.explanation) problems.push(`${f}: ${id} has no explanation`);
      } else if (q?.type === "short") {
        if (!q.rubric) problems.push(`${f}: ${id} has no rubric`);
      } else if (q?.type === "code") {
        problems.push(...(await codeProblems(q)).map((p) => `${f}: ${id} ${p}`));
      } else problems.push(`${f}: ${id} has unknown type "${q?.type}"`);
    }
    problems.push(...notation(doc.body).map((p) => `${f}: ${p}`));
    problems.push(...visuals(doc.body, dirname(join(dir, f))).map((p) => `${f}: ${p}`));
    const words = doc.body.replace(/```[\s\S]*?```/g, "").replace(/:::[\s\S]*?:::/g, "").split(/\s+/).filter(Boolean).length;
    if (sheet && (fences.length < 5 || fences.length > 14)) problems.push(`${f}: ${fences.length} exercises; a worksheet has five to fourteen`);
    if (!sheet && f !== "quiz.md" && f !== "understanding.md" && words > 420) problems.push(`${f}: ${words} words of prose (ceiling 350)`);
  }
  return problems;
}

// A code exercise: a language, and a rubric for the grader. A SQL one runs: its setup and solution
// must execute, the solution must return rows (an empty expected result passes any query that
// returns nothing), and the starter code must not already pass.
async function codeProblems(q: any): Promise<string[]> {
  const out: string[] = [];
  if (!q.language) out.push("has no language");
  else if (!LANGUAGES.includes(String(q.language).toLowerCase())) out.push(`has language "${q.language}"; use one of ${LANGUAGES.join(", ")}`);
  if (!q.rubric) out.push("has no rubric");
  if (!runnable(q)) return out;
  if (!q.solution) { out.push("has no solution (a SQL exercise is graded by comparing results with it)"); return out; }
  const want = await runSql({ setup: q.setup, code: q.solution, check: q.check });
  if (want.error) { out.push(`solution fails: ${want.error}`); return out; }
  if (!want.total) out.push("solution returns no rows; give the setup data that makes the answer visible");
  if (q.starter && (await checkCode(q, q.starter))?.match) out.push("starter code already passes");
  return out;
}

// Charts that do not parse, mocks that reach for the network, images that are not on disk.
export function visuals(body: string, dir: string): string[] {
  const out: string[] = [];
  for (const [, src] of body.matchAll(/^```(?:chart|vega-lite)\n([\s\S]*?)^```/gm)) { const { error } = parseChart(src); if (error) out.push(error); }
  for (const [, src] of body.matchAll(/^```html\n([\s\S]*?)^```/gm)) out.push(...mockProblems(src));
  for (const { alt, src } of imageRefs(body)) {
    if (!existsSync(join(dir, src))) out.push(`image ${src} is not on disk`);
    if (!alt.trim()) out.push(`image ${src} has no alt text`);
  }
  return out;
}

// Notation and passages, read the way the reader will: abc fences (one tune, every bar full, no parser
// warnings), ::youtube directives (form, id, times, quoting), and fences opened inside a quiz block,
// which end the quiz early and print its rubric as prose.
export function notation(body: string): string[] {
  const out: string[] = [];
  for (const [, src] of body.matchAll(/^```abc\n([\s\S]*?)^```/gm)) {
    const before = abcSourceProblems(src);
    if (before.length) { out.push(...before.map((p) => `abc: ${p}`)); continue; }
    try { out.push(...tuneProblems((abcjs as any).parseOnly(tidyAbc(src))[0]).map((p: string) => `abc "${/^T:(.*)$/m.exec(src)?.[1] ?? "untitled"}": ${p}`)); }
    catch (e) { out.push(`abc: does not parse (${String(e).split("\n")[0]})`); }
  }
  for (const [line, colons, attrs] of body.matchAll(/^(:{2,3})youtube\b(.*)$/gm)) {
    if (colons === ":::") out.push(`${line.slice(0, 40)}…: use ::youtube (two colons); ::: holds everything after it`);
    if (attrs.includes('\\"')) out.push(`${line.slice(0, 40)}…: a quoted value cannot contain \\" (the line renders as prose); use single or curly quotes`);
    const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    out.push(...youtubeProblems({ v: a.v ?? a.id, t: a.t ?? a.start, end: a.end }).map((p) => `::youtube: ${p}`));
  }
  let inQuiz = false;
  for (const line of body.split("\n")) {
    if (!inQuiz && /^```quiz\s*$/.test(line)) inQuiz = true;
    else if (inQuiz && /^```\s*$/.test(line)) inQuiz = false;
    else if (inQuiz && line.startsWith("```")) { out.push(`a ${line.trim()} fence inside a quiz block ends the quiz early; put the notation in the prose before the question`); inQuiz = false; }
  }
  return out;
}
