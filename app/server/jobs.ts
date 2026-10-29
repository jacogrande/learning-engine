// Runs Claude Code headlessly. Two lanes: heavy (generation, minutes) and light (grading, chat,
// seconds), one job at a time per lane so a chat never waits behind a module build.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, id, now } from "./db";
import { ROOT } from "./content";
import { broadcast } from "./events";
import { commit as syncCommit, flush } from "./sync";

export type JobKind = "assess" | "outline" | "module" | "test" | "wrap" | "drilldown" | "reading" | "grade" | "chat";
type Lane = "heavy" | "light";
export type Job = {
  id: string; course: string; kind: JobKind; ref?: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
  activity?: string; startedAt?: string; finishedAt?: string; result?: unknown; error?: string; sessionId?: string;
};
type Opts = {
  ref?: string; schema?: object; resume?: string;
  stream?: (text: string, reset?: boolean) => void;   // text deltas, for chat; reset at each new assistant turn
  then?: (result: unknown, job: Job) => void;
  fail?: (job: Job) => void;
};
type Queued = Job & { _prompt: string; _opts: Opts };

const LANE: Record<JobKind, Lane> = { assess: "heavy", outline: "heavy", module: "heavy", test: "heavy", wrap: "heavy", drilldown: "heavy", reading: "heavy", grade: "light", chat: "light" };
const TOOLS: Record<JobKind, string> = {
  assess: "Read,Glob,Write",
  outline: "Read,Glob,Write",
  module: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch",
  test: "Read,Glob,Write",
  wrap: "Read,Glob,Write",
  drilldown: "Read,Glob,Grep,Write,Agent,WebSearch,WebFetch",
  reading: "Read,Glob,Write,WebSearch,WebFetch",
  grade: "Read",
  chat: "Read,Glob,Grep",
};
const COMMITS: Partial<Record<JobKind, true>> = { assess: true, outline: true, module: true, test: true, wrap: true, drilldown: true, reading: true };

const LOG_DIR = join(ROOT, "data/jobs");
mkdirSync(LOG_DIR, { recursive: true });

const queues: Record<Lane, Queued[]> = { heavy: [], light: [] };
const current: Record<Lane, { job: Queued; child: ChildProcess } | null> = { heavy: null, light: null };
const cancelled = new Set<string>();

// Anything still marked running/queued when the server starts did not survive the last process.
db.run("UPDATE jobs SET status='interrupted', finished_at=? WHERE status IN ('running','queued')", [now()]);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    for (const lane of ["heavy", "light"] as Lane[]) {
      const c = current[lane];
      if (c) { killTree(c.child); finish(c.job, "interrupted"); c.job._opts.fail?.(c.job); }
      for (const j of queues[lane]) { finish(j, "interrupted"); j._opts.fail?.(j); }
    }
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 8000))]);   // push pending state, briefly
    process.exit(0);
  });

export const jobs = () => (["heavy", "light"] as Lane[]).flatMap((l) => [...(current[l] ? [current[l]!.job] : []), ...queues[l]]).map(pub);
export const jobLog = (jobId: string) => { try { return readFileSync(join(LOG_DIR, `${jobId}.log`), "utf8").split("\n").filter(Boolean); } catch { return []; } };
const log = (jobId: string, line: string) => appendFileSync(join(LOG_DIR, `${jobId}.log`), line + "\n");

// Last job per (kind, ref) for a course, from the DB.
export const history = (course: string): Job[] =>
  (db.query(`SELECT id, course, kind, ref, status, started_at startedAt, finished_at finishedAt, error FROM jobs
             WHERE course=? ORDER BY COALESCE(started_at, '') DESC`).all(course) as Job[])
    .filter((j, i, all) => all.findIndex((k) => k.kind === j.kind && (k.ref ?? "") === (j.ref ?? "")) === i);

export function enqueue(course: string, kind: JobKind, prompt: string, opts: Opts = {}): Job {
  const job: Queued = { id: id(), course, kind, ref: opts.ref, status: "queued", _prompt: prompt, _opts: opts };
  db.run("INSERT INTO jobs (id, course, kind, ref, status) VALUES (?,?,?,?,?)", [job.id, course, kind, opts.ref ?? null, "queued"]);
  queues[LANE[kind]].push(job);
  broadcast({ type: "job", job: pub(job) });
  pump(LANE[kind]);
  return pub(job);
}

const killTree = (child: ChildProcess) => { try { process.kill(-child.pid!, "SIGTERM"); } catch { child.kill("SIGTERM"); } };

export function cancel(jobId: string) {
  for (const lane of ["heavy", "light"] as Lane[]) {
    if (current[lane]?.job.id === jobId) { cancelled.add(jobId); killTree(current[lane]!.child); }
    const i = queues[lane].findIndex((j) => j.id === jobId);
    if (i >= 0) finish(queues[lane].splice(i, 1)[0], "cancelled");
  }
}

const pub = ({ _prompt, _opts, ...j }: any): Job => j;

function finish(job: Job, status: Job["status"], extra: Partial<Job> = {}) {
  Object.assign(job, extra, { status, finishedAt: now(), activity: undefined });
  db.run("UPDATE jobs SET status=?, finished_at=?, result=?, error=? WHERE id=?",
    [status, job.finishedAt!, job.result ? JSON.stringify(job.result) : null, job.error ?? null, job.id]);
  log(job.id, `= ${status}${job.error ? `: ${job.error}` : ""}`);
  broadcast({ type: "job", job: pub(job) });
  broadcast({ type: "content" });   // status is part of what pages show
  // Each generation step becomes a commit of the library, tagged with the job id.
  if (status === "done" && COMMITS[job.kind]) syncCommit(`gen(${job.kind}): ${job.course}${job.ref ? ` ${job.ref}` : ""}\n\nRun-Id: ${job.id}`);
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

function pump(lane: Lane) {
  if (current[lane] || !queues[lane].length) return;
  const job = queues[lane].shift()!;
  const o = job._opts;
  const args = [
    "-p", job._prompt,
    "--output-format", "stream-json", "--verbose",
    ...(o.stream ? ["--include-partial-messages"] : []),
    "--permission-mode", "acceptEdits",
    "--allowedTools", TOOLS[job.kind],
    "--max-turns", lane === "heavy" ? "80" : "15",
    ...(o.schema ? ["--json-schema", JSON.stringify(o.schema)] : []),
    ...(o.resume ? ["--resume", o.resume] : []),
  ];
  // Own process group, so cancelling kills claude *and* the subagents it spawned.
  const child = spawn("claude", args, { cwd: ROOT, env: env(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  current[lane] = { job, child };
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
  child.on("error", (e) => {   // e.g. `claude` not on PATH: fail the job, never the server
    log(job.id, `! spawn: ${e.message}`);
    current[lane] = null;
    if (job.status === "running") { finish(job, "failed", { error: e.message }); o.fail?.(job); }
    pump(lane);
  });
  child.on("close", (code) => {
    if (!current[lane] || current[lane]!.job !== job) return;   // already handled by 'error'
    current[lane] = null;
    if (job.status === "running") {
      if (cancelled.delete(job.id) || code === null) { finish(job, "cancelled"); o.fail?.(job); }
      else if (code === 0 && !job.error) { finish(job, "done"); o.then?.(job.result, job); }
      else { finish(job, "failed", { error: job.error ?? `exit ${code}` }); o.fail?.(job); }
    }
    pump(lane);
  });
}

function handle(job: Queued, line: string) {
  let ev: any;
  try { ev = JSON.parse(line); } catch { return; }
  const act = (a: string) => { job.activity = a; log(job.id, a); broadcast({ type: "job", job: pub(job) }); };

  if (ev.type === "system" && ev.subtype === "init") {
    job.sessionId = ev.session_id;
    db.run("UPDATE jobs SET session_id=? WHERE id=?", [ev.session_id, job.id]);
    act(`started (${ev.model})`);
  } else if (ev.type === "stream_event") {
    const d = ev.event?.delta;
    if (ev.event?.type === "message_start") job._opts.stream?.("", true);   // a new turn: drop narration from the last one
    if (d?.type === "text_delta" && d.text) job._opts.stream?.(d.text);
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
    case "WebFetch": { try { return `fetching ${new URL(input.url).hostname}`; } catch { return `fetching ${String(input.url).slice(0, 60)}`; } }
    default: return tool.toLowerCase();
  }
}
