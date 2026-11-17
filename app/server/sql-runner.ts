// Runs one SQL exercise in a fresh in-memory SQLite database. A child process, not a worker: a
// runaway query (a recursive CTE with no stop) sits in SQLite's native loop, which only killing the
// process can stop. Reads a SqlJob as JSON on stdin; writes a SqlOutput as JSON on stdout.
import { Database } from "bun:sqlite";
import { splitSql, type SqlJob, type SqlOutput } from "./code";

const MAX_ROWS = 500;

function run({ setup, code, check }: SqlJob): SqlOutput {
  const db = new Database(":memory:");
  try { if (setup?.trim()) db.run(setup); } catch (err) { return { error: `The exercise's setup failed: ${msg(err)}` }; }
  const stmts = splitSql(code);
  if (!stmts.length) return { error: "Nothing to run." };
  try {
    let last: SqlOutput = { columns: [], rows: [], total: 0 };
    // Every statement runs; the last one's rows (or the check query's) are the result.
    for (const [i, s] of stmts.entries()) {
      const q = db.prepare(s);
      if (i < stmts.length - 1 || check?.trim()) q.run(); else last = read(q);
    }
    return check?.trim() ? read(db.prepare(check)) : last;
  } catch (err) { return { error: msg(err) }; }
}

function read(q: ReturnType<Database["prepare"]>): SqlOutput {
  const rows = q.values() as unknown[][];
  return { columns: q.columnNames, rows: rows.slice(0, MAX_ROWS).map((r) => r.map(cell)), total: rows.length };
}
// JSON-safe cells: blobs as hex, bigints as numbers or strings.
const cell = (v: unknown) =>
  v instanceof Uint8Array ? `x'${Buffer.from(v).toString("hex")}'`
  : typeof v === "bigint" ? (Number.isSafeInteger(Number(v)) ? Number(v) : String(v))
  : v;
const msg = (e: unknown) => String((e as Error)?.message ?? e);

process.stdout.write(JSON.stringify(run(JSON.parse(await Bun.stdin.text()))));
