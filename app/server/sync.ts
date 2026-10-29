// The repo is the sync layer. Pull on start, push after each commit, commit the library after a
// minute of quiet and on shutdown. Only the library path is ever staged, so app code you are
// editing is never swept into a state commit. Everything here is best-effort: shown, never thrown.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { LIBRARY } from "./content";
import { broadcast } from "./events";

export type SyncStatus = { repo: boolean; remote: string | null; branch: string | null; busy: string | null; dirty: boolean; lastPull: string | null; lastPush: string | null; error: string | null };
export const status: SyncStatus = { repo: false, remote: null, branch: null, busy: null, dirty: false, lastPull: null, lastPush: null, error: null };

let repo = LIBRARY;        // top level of the repo that contains the library
let path = ".";            // the library, relative to that repo

function git(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) => execFile("git", args, { cwd: repo }, (e, out, err) => res({ ok: !e, out: (out || err || "").trim() })));
}
const emit = () => broadcast({ type: "sync", status });

// Serialize git operations.
let chain = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => (chain = chain.then(fn, fn) as any) as Promise<T>;

export async function init() {
  if (!existsSync(LIBRARY)) return;
  const top = await new Promise<string>((res) => execFile("git", ["rev-parse", "--show-toplevel"], { cwd: LIBRARY }, (e, out) => res(e ? "" : out.trim())));
  if (!top) return;   // the library is not inside a git repo: nothing to sync
  repo = top; path = relative(top, LIBRARY) || ".";
  status.repo = true;
  const r = await git(["remote", "get-url", "origin"]);
  status.remote = r.ok ? r.out : null;
  status.branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out || null;
  status.dirty = !!(await git(["status", "--porcelain", "--", path])).out;
  emit();
  if (status.remote) await pull();
}

let onPulled: () => void = () => {};
export const afterPull = (fn: () => void) => { onPulled = fn; };

export const pull = () => serial(async () => {
  if (!status.remote) return;
  status.busy = "pulling"; status.error = null; emit();
  const r = await git(["pull", "--rebase", "--autostash", "-q"]);
  if (!r.ok) { await git(["rebase", "--abort"]); status.error = `pull: ${r.out.split("\n").pop()}`; }
  else { status.lastPull = new Date().toISOString(); onPulled(); }
  status.busy = null; emit();
});

export const commit = (message: string) => serial(async () => {
  if (!status.repo) return;
  status.busy = "committing"; emit();
  await git(["add", "-A", "--", path]);
  const staged = await git(["diff", "--cached", "--quiet", "--", path]);
  if (!staged.ok) {   // non-zero exit = something staged
    const c = await git(["commit", "-q", "-m", message, "--", path]);
    if (!c.ok) status.error = `commit: ${c.out.split("\n").pop()}`;
  }
  status.dirty = false; status.busy = null; emit();
  if (status.remote) await pushNow();
});

async function pushNow() {
  status.busy = "pushing"; status.error = null; emit();
  let r = await git(["push", "-q"]);
  if (!r.ok) {   // behind the remote: integrate, then try once more
    const p = await git(["pull", "--rebase", "--autostash", "-q"]);
    if (!p.ok) await git(["rebase", "--abort"]); else onPulled();
    r = await git(["push", "-q"]);
  }
  if (r.ok) status.lastPush = new Date().toISOString();
  else status.error = `push: ${r.out.split("\n").pop()}`;
  status.busy = null; emit();
}

// Library files changed: commit after a minute of quiet.
let timer: ReturnType<typeof setTimeout> | undefined;
export function touch() {
  status.dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => commit("state: answers, notes, highlights, chats"), 60_000);
}
export const flush = () => { clearTimeout(timer); return status.dirty ? commit("state: answers, notes, highlights, chats") : Promise.resolve(); };
