// Runs one SQL exercise in a fresh in-memory SQLite database. A child process, not a worker: a
// runaway query (a recursive CTE with no stop) sits in SQLite's native loop, which only killing the
// process can stop. Reads a SqlJob as JSON on stdin; writes a SqlOutput as JSON on stdout.
import { Database, type Statement } from "bun:sqlite";
import { rowKey, splitSql, type SqlJob, type SqlOutput } from "./code";

const SHOWN = 500;              // rows sent back for display and the grader's evidence
const MAX_ROWS = 10_000;        // rows read at all: a query past this is stopped, not compared
const MAX_BYTES = 32 << 20;     // text and blob bytes read, so wide rows cannot fill memory either
const HEAP = 256 << 20;         // SQLite's own memory: tables, sorts, CTEs

function run({ setup, code, check }: SqlJob): SqlOutput {
  const db = new Database(":memory:");
  db.run(`PRAGMA hard_heap_limit=${HEAP}`);
  try { if (setup?.trim()) db.run(setup); } catch (err) { return { error: `The exercise's setup failed: ${msg(err)}` }; }
  const stmts = splitSql(code);
  if (!stmts.length) return { error: "Nothing to run." };
  try {
    let last: SqlOutput = read(null);
    // Every statement runs; the last one's rows (or the check query's) are the result.
    for (const [i, s] of stmts.entries()) {
      const q = db.prepare(s);
      if (i < stmts.length - 1 || check?.trim()) q.run(); else last = read(q);
    }
    return check?.trim() ? read(db.prepare(check)) : last;
  } catch (err) { return { error: msg(err) }; }
}

// Rows read one at a time and stopped at a cap; every row goes into the digests the comparison uses,
// the first SHOWN come back to look at.
function read(q: Statement | null): SqlOutput {
  const columns = q?.columnNames ?? [];
  if (!q || !columns.length) { q?.run(); return { columns: [], rows: [], total: 0, ordered: digest([]), unordered: digest([]) }; }
  const rows: unknown[][] = [];
  let bytes = 0;
  const take = (r: unknown[]) => {
    if (rows.length >= MAX_ROWS) throw new Error(`The query returns more than ${MAX_ROWS.toLocaleString()} rows; an exercise's answer is never that long.`);
    for (const v of r) bytes += typeof v === "string" ? v.length : v instanceof Uint8Array ? v.byteLength : 8;
    if (bytes > MAX_BYTES) throw new Error("The result is too large to show (over 32 MB).");
    rows.push(r.map(cell));
  };
  // iterate() keys rows by name, so two columns with one name would collapse; values() keeps them.
  if (new Set(columns).size < columns.length) for (const r of (q.values() ?? []) as unknown[][]) take(r);
  else for (const o of q.iterate() as Iterable<Record<string, unknown>>) take(columns.map((c) => o[c]));
  const keys = rows.map(rowKey);
  return { columns, rows: rows.slice(0, SHOWN), total: rows.length, ordered: digest(keys), unordered: digest([...keys].sort()) };
}
const digest = (keys: string[]) => String(Bun.hash(keys.join("\n")));
// JSON-safe cells: blobs as hex, bigints as numbers or strings.
const cell = (v: unknown) =>
  v instanceof Uint8Array ? `x'${Buffer.from(v).toString("hex")}'`
  : typeof v === "bigint" ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v))
  : v;
const msg = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  return m === "out of memory" ? `The query needs more memory than an exercise allows (${HEAP >> 20} MB).` : m;
};

process.stdout.write(JSON.stringify(run(JSON.parse(await Bun.stdin.text()))));
