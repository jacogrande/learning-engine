// Code exercises (`type: code` quiz blocks). SQL runs here: the learner's code and the block's
// `solution` each run against the block's `setup` in a fresh in-memory SQLite database, and the two
// results are compared. A match is correct with no grader; a mismatch or an error goes to the
// grader with what each returned, so the note can say what the query got wrong. Other languages
// have an editor but no runner: the grader reads the code against the rubric.

export type CodeSpec = { language?: string; setup?: string; solution?: string; check?: string; ordered?: boolean };
export type SqlJob = { setup?: string; code: string; check?: string };
// `rows` holds the first 500 for display; `ordered` and `unordered` digest every row, so results
// longer than that still compare in full.
export type SqlOutput = { columns?: string[]; rows?: unknown[][]; total?: number; ordered?: string; unordered?: string; error?: string };
export type CodeCheck = { match: boolean; note: string; evidence: string };

const TIMEOUT_MS = 3000, PARALLEL = 4;
export const RUNNABLE = ["sql", "sqlite"];
export const LANGUAGES = [...RUNNABLE, "python", "javascript", "typescript"];
export const runnable = (s: CodeSpec | null | undefined) => RUNNABLE.includes((s?.language ?? "").toLowerCase());

// Statements one at a time: semicolons inside strings, quoted names and comments do not split, and
// a CREATE TRIGGER runs to the END that closes its BEGIN (a CASE … END inside it does not).
export const splitSql = (src: string) => scan(src).map((st) => st.text);
// The source with strings, quoted names and comments blanked: what the keyword checks read.
export const bareSql = (src: string) => scan(src).map((st) => st.bare).join(" ; ");

function scan(src: string) {
  const out: { text: string; bare: string }[] = [];
  let cur = "", bare = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i], two = src.slice(i, i + 2);
    if (two === "--") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j - 1; cur += " "; bare += " "; continue; }
    if (two === "/*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 1; cur += " "; bare += " "; continue; }
    const close = c === "'" ? "'" : c === '"' ? '"' : c === "`" ? "`" : c === "[" ? "]" : null;
    if (close) { const j = src.indexOf(close, i + 1); const end = j < 0 ? src.length : j; cur += src.slice(i, end + 1); bare += " _ "; i = end; continue; }
    if (c === ";" && !openTrigger(bare)) {
      if (cur.trim()) out.push({ text: cur.trim(), bare });
      cur = bare = ""; continue;
    }
    cur += c; bare += c;
  }
  if (cur.trim()) out.push({ text: cur.trim(), bare });
  return out;
}
// A trigger whose BEGIN (and any CASE) has not been closed by as many ENDs. `NEW.end` is a column.
function openTrigger(bare: string) {
  if (!/^\s*create\s+(temp\s+|temporary\s+)?trigger\b/i.test(bare)) return false;
  const words = (re: RegExp) => bare.match(re)?.length ?? 0;
  const opens = words(/(?<![.\w])(begin|case)\b/gi);
  return opens > 0 && words(/(?<![.\w])end\b/gi) < opens;
}

// Nothing that reaches past the in-memory database: no attached files, no VACUUM INTO, no extensions.
// Read from the bare text, so a string or a comment that mentions them does not trip it. Setup and
// check are tested too: /api/run takes them from the request.
const FORBIDDEN = /\b(attach|detach|load_extension)\b|\bvacuum\b[^;]*\binto\b/i;
export const forbidden = (job: SqlJob) => [job.code, job.setup, job.check].some((s) => s && FORBIDDEN.test(bareSql(s)));

// At most PARALLEL runners at once; the rest wait their turn.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

export function runSql(job: SqlJob): Promise<SqlOutput> {
  if (forbidden(job)) return Promise.resolve({ error: "ATTACH, VACUUM INTO and extensions are off in exercises: they reach outside the scratch database." });
  return slot(() => spawnRunner(job));
}
function spawnRunner(job: SqlJob): Promise<SqlOutput> {
  const p = Bun.spawn([process.execPath, RUNNER], { stdin: new Blob([JSON.stringify(job)]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; p.kill(9); }, TIMEOUT_MS);
  return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err]) => {
    clearTimeout(t);
    if (timedOut) return { error: `Stopped after ${TIMEOUT_MS / 1000} seconds. A recursive query with no stopping condition runs forever.` };
    try { return JSON.parse(out) as SqlOutput; } catch { return { error: err.split("\n").find((l) => /error/i.test(l))?.trim() || "The query runner crashed." }; }
  });
}
const RUNNER = new URL("./sql-runner.ts", import.meta.url).pathname;

// One row as a comparable string. Floats to 12 significant digits, so 0.1+0.2 matches 0.3.
const norm = (v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(12)) : v);
export const rowKey = (r: unknown[]) => JSON.stringify(r.map(norm));
const key = rowKey;

// Run the learner's code and the solution; compare. Null when the spec has nothing to run.
export async function checkCode(spec: CodeSpec, answer: string): Promise<CodeCheck | null> {
  if (!runnable(spec) || !spec.solution?.trim()) return null;
  const [got, want] = await Promise.all([
    runSql({ setup: spec.setup, code: answer, check: spec.check }),
    runSql({ setup: spec.setup, code: spec.solution, check: spec.check }),
  ]);
  const what = spec.check ? "the check query, after the code ran," : "the code";
  if (want.error) return { match: false, note: "", evidence: `The reference solution itself failed (${want.error}), so the app could not compare results. Grade the code against the rubric and the prompt.` };
  const head = `The app ran the learner's SQL against the exercise's setup in a scratch SQLite database and compared what ${what} returned with what the reference solution returns.`;
  if (got.error) return { match: false, note: "", evidence: `${head}\n\nThe learner's SQL failed with: ${got.error}\n\nExpected result:\n${table(want)}` };
  const g = got.rows ?? [], w = want.rows ?? [];
  const sameCols = (got.columns?.length ?? 0) === (want.columns?.length ?? 0);
  const gk = g.map(key), wk = w.map(key);
  // Every row, through the digests; the shown rows below only describe a difference.
  const ordered = spec.ordered ? got.ordered === want.ordered : got.unordered === want.unordered;
  const sameTotal = (got.total ?? g.length) === (want.total ?? w.length);
  if (sameCols && sameTotal && ordered) {
    return { match: true, evidence: "", note: `Your query returns the expected result: ${count(want)}${spec.ordered ? ", in the expected order" : ""}.` };
  }
  const diffs: string[] = [];
  if (!sameCols) diffs.push(`Column count differs: the learner's result has ${got.columns?.length} (${got.columns?.join(", ")}), the expected has ${want.columns?.length} (${want.columns?.join(", ")}).`);
  else {
    const missing = multisetMinus(wk, gk), extra = multisetMinus(gk, wk);
    if (missing.length) diffs.push(`Rows expected but missing (${missing.length}): ${missing.slice(0, 5).join("; ")}${missing.length > 5 ? "; …" : ""}`);
    if (extra.length) diffs.push(`Rows returned but not expected (${extra.length}): ${extra.slice(0, 5).join("; ")}${extra.length > 5 ? "; …" : ""}`);
    const cut = Math.max(got.total ?? 0, want.total ?? 0) > Math.min(g.length, w.length);
    if (!missing.length && !extra.length) diffs.push(cut ? "The first rows agree; a difference lies past the rows shown here." : "Same rows, different order; the prompt asks for a specific order.");
  }
  return { match: false, note: "", evidence: `${head}\n\nThey differ.\n${diffs.map((d) => `- ${d}`).join("\n")}\n\nLearner's result:\n${table(got)}\n\nExpected result:\n${table(want)}\n\nColumn names and aliases are not compared. The result decides correctness: a query whose result differs is not correct, however close the code looks; it may be partial when it gets part of the task right.` };
}

function multisetMinus(a: string[], b: string[]) {
  const left = new Map<string, number>();
  for (const k of b) left.set(k, (left.get(k) ?? 0) + 1);
  return a.filter((k) => { const n = left.get(k) ?? 0; if (n) { left.set(k, n - 1); return false; } return true; });
}
const count = (o: SqlOutput) => { const n = o.total ?? o.rows?.length ?? 0; return `${n} ${n === 1 ? "row" : "rows"}`; };
// A short plain-text table for the grader's prompt.
function table(o: SqlOutput, max = 12) {
  const rows = o.rows ?? [];
  const lines = [(o.columns ?? []).join(" | "), ...rows.slice(0, max).map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join(" | "))];
  if ((o.total ?? rows.length) > max) lines.push(`… ${(o.total ?? rows.length) - max} more rows`);
  return `(${count(o)})\n${lines.join("\n")}`;
}
