// Checks generated module files the way the renderer will read them, so a malformed quiz block or
// a missing objective is reported right after the job instead of discovered in the reader.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { COURSES_DIR, parseDoc } from "./content";

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
    const words = doc.body.replace(/```[\s\S]*?```/g, "").replace(/:::[\s\S]*?:::/g, "").split(/\s+/).filter(Boolean).length;
    if (f !== "quiz.md" && f !== "understanding.md" && words > 420) problems.push(`${f}: ${words} words of prose (ceiling 350)`);
  }
  return problems;
}
