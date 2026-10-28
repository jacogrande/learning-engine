// Runs Claude Code headlessly, one job at a time. Each job is one `claude -p` process.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, id, now } from "./db";
import { ROOT } from "./content";
import { broadcast } from "./events";

export type JobKind = "assess" | "outline" | "module";
export type Job = {
  id: string; course: string; kind: JobKind; ref?: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
  activity?: string; startedAt?: string; finishedAt?: string; result?: unknown; error?: string;
};

// Logs go to disk so they survive a server restart; the DB row is the source of truth for status.
const LOG_DIR = join(ROOT, "data/jobs");
mkdirSync(LOG_DIR, { recursive: true });

// Anything still marked running/queued when the server starts did not survive the last process.
db.run("UPDATE jobs SET status='interrupted', finished_at=? WHERE status IN ('running','queued')", [now()]);

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    if (current) { killTree(current.child); finish(current.job, "interrupted"); }
    for (const j of queue) finish(j, "interrupted");
    process.exit(0);
  });

const TOOLS: Record<JobKind, string> = {
  assess: "Read,Glob,Write",
  outline: "Read,Glob,Write",
  module: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch",
};

const queue: Job[] = [];
let current: { job: Job; child: ChildProcess } | null = null;

export const jobs = () => [...(current ? [current.job] : []), ...queue].map(pub);
export const jobLog = (jobId: string) => { try { return readFileSync(join(LOG_DIR, `${jobId}.log`), "utf8").split("\n").filter(Boolean); } catch { return []; } };
const log = (jobId: string, line: string) => appendFileSync(join(LOG_DIR, `${jobId}.log`), line + "\n");

// Last job per module ref (and per kind for course-level jobs), from the DB.
export const history = (course: string): Job[] =>
  (db.query(`SELECT id, course, kind, ref, status, started_at startedAt, finished_at finishedAt, error FROM jobs
             WHERE course=? ORDER BY COALESCE(started_at, '') DESC`).all(course) as Job[])
    .filter((j, i, all) => all.findIndex((k) => k.kind === j.kind && (k.ref ?? "") === (j.ref ?? "")) === i);

export function enqueue(course: string, kind: JobKind, prompt: string, opts: { ref?: string; schema?: object; then?: (result: unknown) => void } = {}) {
  const job: Job = { id: id(), course, kind, ref: opts.ref, status: "queued" };
  db.run("INSERT INTO jobs (id, course, kind, ref, status) VALUES (?,?,?,?,?)", [job.id, course, kind, opts.ref ?? null, "queued"]);
  queue.push(Object.assign(job, { _prompt: prompt, _opts: opts }));
  broadcast({ type: "job", job: pub(job) });
  pump();
  return pub(job);
}

const killTree = (child: ChildProcess) => { try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); } };

const cancelled = new Set<string>();
export function cancel(jobId: string) {
  if (current?.job.id === jobId) { cancelled.add(jobId); killTree(current.child); }
  const i = queue.findIndex((j) => j.id === jobId);
  if (i >= 0) finish(queue.splice(i, 1)[0], "cancelled");
}

const pub = ({ _prompt, _opts, ...j }: any): Job => j;

function finish(job: Job, status: Job["status"], extra: Partial<Job> = {}) {
  Object.assign(job, extra, { status, finishedAt: now(), activity: undefined });
  db.run("UPDATE jobs SET status=?, finished_at=?, result=?, error=? WHERE id=?",
    [status, job.finishedAt!, job.result ? JSON.stringify(job.result) : null, job.error ?? null, job.id]);
  log(job.id, `= ${status}${job.error ? `: ${job.error}` : ""}`);
  broadcast({ type: "job", job: pub(job) });
  broadcast({ type: "content" });   // status is part of what pages show
}

// Strip nested-session vars (present when launched from inside Claude Code) and any API key:
// runs must go through the subscription login.
function env() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k === "CLAUDECODE" || k === "CLAUDE_PID" || k.startsWith("CLAUDE_CODE_")) delete e[k];
  delete e.ANTHROPIC_API_KEY;
  e.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "3";
  return e;
}

function pump() {
  if (current || !queue.length) return;
  const job = queue.shift() as Job & { _prompt: string; _opts: { schema?: object; then?: (r: unknown) => void } };
  const args = [
    "-p", job._prompt,
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", TOOLS[job.kind],
    "--max-turns", "80",
    ...(job._opts.schema ? ["--json-schema", JSON.stringify(job._opts.schema)] : []),
  ];
  // Own process group, so cancelling kills claude *and* the subagents it spawned.
  const child = spawn("claude", args, { cwd: ROOT, env: env(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  current = { job, child };
  Object.assign(job, { status: "running", startedAt: now(), activity: "starting" });
  db.run("UPDATE jobs SET status='running', started_at=? WHERE id=?", [job.startedAt!, job.id]);
  log(job.id, `$ claude ${args.slice(2).join(" ").slice(0, 200)}`);
  broadcast({ type: "job", job: pub(job) });

  let buf = "";
  child.stdout!.on("data", (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) handle(job, line);
    }
  });
  child.stderr!.on("data", (c) => log(job.id, `! ${c.toString().trim()}`));
  child.on("close", (code) => {
    current = null;
    if (job.status === "running") {
      if (cancelled.delete(job.id) || code === null) finish(job, "cancelled");
      else if (code === 0 && !job.error) { finish(job, "done"); job._opts.then?.(job.result); }
      else finish(job, "failed", { error: job.error ?? `exit ${code}` });
    }
    pump();
  });
}

function handle(job: Job, line: string) {
  let ev: any;
  try { ev = JSON.parse(line); } catch { return; }
  const act = (a: string) => { job.activity = a; log(job.id, a); broadcast({ type: "job", job: pub(job) }); };

  if (ev.type === "system" && ev.subtype === "init") {
    db.run("UPDATE jobs SET session_id=? WHERE id=?", [ev.session_id, job.id]);
    act(`started (${ev.model})`);
  } else if (ev.type === "assistant") {
    for (const c of ev.message?.content ?? []) {
      if (c.type === "text" && c.text.trim()) log(job.id, `> ${c.text.trim()}`);
      if (c.type === "tool_use") act(describe(c.name, c.input));
    }
  } else if (ev.type === "result") {
    if (ev.is_error) job.error = ev.result || ev.subtype;
    job.result = ev.structured_output ?? ev.result;
    log(job.id, `${ev.num_turns} turns`);
  }
}

function describe(tool: string, input: any): string {
  const rel = (p: string) => p?.replace(ROOT + "/", "");
  switch (tool) {
    case "Write": case "Edit": return `writing ${rel(input.file_path)}`;
    case "Read": return `reading ${rel(input.file_path)}`;
    case "Agent": return `research: ${input.description ?? input.subagent_type}`;
    case "WebSearch": return `searching: ${input.query}`;
    case "WebFetch": return `fetching ${new URL(input.url).hostname}`;
    default: return tool.toLowerCase();
  }
}
