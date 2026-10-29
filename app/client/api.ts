import { useEffect, useState, useCallback } from "react";

export type Section = { file: string; title: string };
export type Extra = { file: string; title: string; kind: "drilldown" | "reading"; section?: string };
export type Module = { id: string; title: string; summary?: string; objectives?: string[]; status: "planned" | "ready"; sections: Section[]; extras: Extra[] };
export type Course = { slug: string; title: string; depth?: string; description: string; stage: "baseline" | "assessed" | "ready"; modules: Module[] };
export type Doc = { frontmatter: Record<string, any>; body: string };
export type Result = "correct" | "partial" | "wrong" | "skipped";
export type Grade = { level: string; summary: string; strengths: string[]; gaps: string[]; questions: { id: string; result: Result; note: string }[] };
export type Attempt = { id: string; answers: Record<string, string>; grade: Grade | null; createdAt: string };
export type QuizState = { draft: Record<string, string> | null; attempt: Attempt | null };
export type Answer = { question: string; answer: string; result: Result | null; note: string | null; job: string | null; gradedAt: string | null };
export type Annotation = { id: string; doc: string; quote: string; prefix: string; suffix: string; createdAt: string };
export type Chat = { id: string; doc: string; context: string | null; title: string; createdAt: string };
export type Message = { id: string; role: "user" | "assistant"; content: string };
export type SyncStatus = { repo: boolean; remote: string | null; branch: string | null; busy: string | null; dirty: boolean; lastPull: string | null; lastPush: string | null; error: string | null };
export type Job = { id: string; course: string; kind: "assess" | "outline" | "module" | "drilldown" | "reading" | "grade" | "chat"; ref?: string; status: string; activity?: string; startedAt?: string; error?: string };

export const get = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
const send = (method: string) => <T,>(url: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, keepalive: true }).then((r) => r.json() as Promise<T>);
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
  es.onopen = () => { if (opened) for (const l of listeners) l({ type: "content" }); opened = true; };
}
export function useEvent(type: string, fn: Listener) {
  useEffect(() => {
    connect();
    const l: Listener = (ev) => { if (ev.type === type) fn(ev); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [type, fn]);
}

// Fetch + refetch whenever content changes on disk (or a job finishes).
export function useLive<T>(url: string | null, also: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<number | null>(null);
  const load = useCallback(() => { if (url) get<T>(url).then(setData, setError); else setData(null); }, [url]);
  useEffect(load, [load]);
  useEvent("content", load);
  useEvent(also[0] ?? "none", load);
  return { data, error, reload: load };
}

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const load = useCallback(() => { get<Job[]>("/api/jobs").then(setJobs); }, []);
  useEffect(load, [load]);
  useEvent("content", load);
  useEvent("job", useCallback((ev: { job: Job }) => {
    setJobs((js) => {
      const rest = js.filter((j) => j.id !== ev.job.id);
      return ["queued", "running"].includes(ev.job.status) ? [...rest, ev.job] : rest;
    });
  }, []));
  return jobs;
}
