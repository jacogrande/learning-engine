import { useEffect, useState, useCallback, useSyncExternalStore } from "react";

export type Section = { file: string; title: string };
export type Extra = { file: string; title: string; kind: "drilldown" | "reading"; section?: string };
export type Objective = { id: string; text: string; status?: "met" | "partial" | "unmet"; evidence?: string };
export type Understanding = { level?: string; summary?: string; calibration?: string; carry?: string[] };
export type Module = { id: string; title: string; summary?: string; objectives: Objective[]; status: "planned" | "ready"; sections: Section[]; extras: Extra[]; test: boolean; understanding: Understanding | null };
export type Resume = { module: string; moduleTitle: string; file: string; title: string };
export type Course = { slug: string; title: string; depth?: string; description: string; stage: "baseline" | "assessed" | "ready"; modules: Module[]; progress?: { done: number; resume: Resume | null; nextToGenerate: string | null } };
export type Doc = { frontmatter: Record<string, any>; body: string };
export type Result = "correct" | "partial" | "wrong" | "skipped";
export type Grade = { level: string; summary: string; strengths: string[]; gaps: string[]; questions: { id: string; result: Result; note: string }[] };
export type Attempt = { id: string; answers: Record<string, string>; grade: Grade | null; createdAt: string };
export type QuizState = { draft: Record<string, string> | null; attempt: Attempt | null };
export type PastAnswer = { answer: string; result: Result | null; note: string | null; confidence: number | null; gradedAt: string | null };
export type Answer = { question: string; answer: string; result: Result | null; note: string | null; job: string | null; confidence?: number | null; gradedAt: string | null; history?: PastAnswer[] };
export type Annotation = { id: string; doc: string; quote: string; prefix: string; suffix: string; createdAt: string };
export type Chat = { id: string; doc: string; kind?: "section" | "summary"; module?: string | null; context: string | null; title: string; createdAt: string; updatedAt?: string; messages?: number };
export type Message = { id: string; role: "user" | "assistant"; content: string };
export type SyncStatus = { repo: boolean; remote: string | null; branch: string | null; busy: string | null; dirty: boolean; lastPull: string | null; lastPush: string | null; error: string | null };
export type Job = { id: string; course: string; kind: "start" | "assess" | "outline" | "module" | "test" | "wrap" | "drilldown" | "reading" | "grade" | "chat" | "variant"; ref?: string; status: string; activity?: string; startedAt?: string; error?: string };

export const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
const send = (method: string) => <T,>(url: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, keepalive: true }).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
export const post = send("POST"), put = send("PUT"), del = send("DELETE");

// One EventSource for the app; listeners subscribe by event type.
type Listener = (ev: any) => void;
const listeners = new Set<Listener>();
let es: EventSource | undefined;
function connect() {
  if (es) return;
  es = new EventSource("/api/events");
  es.onmessage = (m) => { const ev = JSON.parse(m.data); for (const l of listeners) l(ev); };
  // After a dropped connection (server restart, sleep), anything may have changed: refetch.
  let opened = false;
  es.onopen = () => { if (opened) for (const l of listeners) l({ type: "content", reconnect: true }); opened = true; };
}
export function useEvent(type: string | string[], fn: Listener) {
  const key = Array.isArray(type) ? type.join(",") : type;
  useEffect(() => {
    connect();
    const types = key.split(",");
    const l: Listener = (ev) => { if (types.includes(ev.type)) fn(ev); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [key, fn]);
}

// Fetch + refetch whenever content changes on disk (or a job finishes).
export function useLive<T>(url: string | null, also: string[] = []) {
  const [state, setState] = useState<{ url: string | null; data: T | null }>({ url: null, data: null });
  const [error, setError] = useState<number | null>(null);
  const load = useCallback(() => { if (url) get<T>(url).then((data) => setState({ url, data }), setError); else setState({ url: null, data: null }); }, [url]);
  useEffect(load, [load]);
  useEvent(["content", ...also], load);
  // Never hand back data fetched for a previous url (navigating between modules reuses this hook).
  return { data: state.url === url ? state.data : null, error, reload: load };
}

// Live jobs: one store for the whole page, however many components ask. Fetched once, kept current
// by job events, refetched after a dropped connection.
let jobList: Job[] = [];
const jobSubs = new Set<() => void>();
let jobsWired = false;
const setJobList = (js: Job[]) => { jobList = js; for (const f of jobSubs) f(); };
const loadJobs = () => get<Job[]>("/api/jobs").then(setJobList, () => {});
function wireJobs() {
  if (jobsWired) return;
  jobsWired = true; connect(); loadJobs();
  listeners.add((ev) => {
    if (ev.type === "job") {
      const rest = jobList.filter((j) => j.id !== ev.job.id);
      setJobList(["queued", "running"].includes(ev.job.status) ? [...rest, ev.job] : rest);
    } else if (ev.type === "content" && ev.reconnect) loadJobs();
  });
}
const subscribeJobs = (f: () => void) => { wireJobs(); jobSubs.add(f); return () => { jobSubs.delete(f); }; };
export const useJobs = () => useSyncExternalStore(subscribeJobs, () => jobList);
