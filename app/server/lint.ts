// Checks generated module files the way the renderer will read them, so a malformed quiz block or
// a missing objective is reported right after the job instead of discovered in the reader.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import abcjs from "abcjs";
import { COURSES_DIR, parseDoc } from "./content";
import { abcSourceProblems, tidyAbc, tuneProblems, youtubeProblems } from "../shared/notation";

const ID = /^q-(base-\d{2}|\d{2}-(r\d|t\d{2}|dd\d{2}|\d{2}))$/;
const OBJ = /^obj-\d{2}-\d+$/;

export async function lint(course: string, mod: string): Promise<string[]> {
  const dir = join(COURSES_DIR, course, "modules", mod);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).sort();
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const src = await readFile(join(dir, f), "utf8");
    const doc = parseDoc(src);
    if (!doc.frontmatter.title) problems.push(`${f}: no title in frontmatter`);
    if (f !== "quiz.md" && f !== "understanding.md" && doc.frontmatter.order == null) problems.push(`${f}: no order in frontmatter`);
    const fences = [...doc.body.matchAll(/```quiz\n([\s\S]*?)```/g)];
    if (!fences.length && f !== "understanding.md") problems.push(`${f}: no quiz block`);
    for (const [, body] of fences) {
      let q: any;
      try { q = YAML.parse(body); } catch (e) { problems.push(`${f}: quiz block does not parse (${String(e).split("\n")[0]})`); continue; }
      const id = String(q?.id ?? "");
      if (!ID.test(id)) problems.push(`${f}: bad quiz id "${id}"`);
      if (seen.has(id)) problems.push(`${f}: duplicate quiz id "${id}"`); seen.add(id);
      if (!q?.prompt) problems.push(`${f}: ${id} has no prompt`);
      if (!OBJ.test(String(q?.objective ?? ""))) problems.push(`${f}: ${id} has no objective`);
      if (q?.type === "mcq") {
        if (!Array.isArray(q.options) || q.options.length < 3) problems.push(`${f}: ${id} needs 3+ options`);
        else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) problems.push(`${f}: ${id} answer out of range`);
        if (!q.explanation) problems.push(`${f}: ${id} has no explanation`);
      } else if (q?.type === "short") {
        if (!q.rubric) problems.push(`${f}: ${id} has no rubric`);
      } else problems.push(`${f}: ${id} has unknown type "${q?.type}"`);
    }
    problems.push(...notation(doc.body).map((p) => `${f}: ${p}`));
    const words = doc.body.replace(/```[\s\S]*?```/g, "").replace(/:::[\s\S]*?:::/g, "").split(/\s+/).filter(Boolean).length;
    if (f !== "quiz.md" && f !== "understanding.md" && words > 420) problems.push(`${f}: ${words} words of prose (ceiling 350)`);
  }
  return problems;
}

// Notation and passages, read the way the reader will: abc fences (one tune, every bar full, no parser
// warnings), ::youtube directives (form, id, times, quoting), and fences opened inside a quiz block,
// which end the quiz early and print its rubric as prose.
function notation(body: string): string[] {
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
