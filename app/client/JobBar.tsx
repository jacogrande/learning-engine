// Slim strip at the bottom while Claude is working. Click to see the log.
import { useCallback, useEffect, useState } from "react";
import { get, post, useEvent, useJobs, type Job } from "./api";
import { Link } from "./App";

const label = (j: Job) => ({
  start: `Starting course: ${j.ref}`, brief: `Researching brief: ${j.ref}`, assess: "Assessing baseline", outline: "Building outline", module: `Generating module ${j.ref}`,
  test: `Writing module test ${j.ref?.split("/")[0]}`, wrap: `Wrapping up ${j.ref?.split("/")[0]}`,
  drilldown: "Drilling down", reading: "Finding reading", grade: "Grading", chat: "Replying", variant: "Writing a review variant", vocab: "Writing a vocab entry", lesson: "Writing a new lesson", worksheet: "Writing a worksheet",
}[j.kind]);

export function JobBar() {
  const jobs = useJobs();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // Chat and grading show their progress in place; the bar is for the long jobs.
  const shown = jobs.filter((j) => !["chat", "grade", "variant", "vocab"].includes(j.kind));
  const job = shown.find((j) => j.status === "running") ?? shown[0];
  const [, tick] = useState(0);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open || !job) return;
    const load = () => get<string[]>(`/api/jobs/${job.id}/log`).then(setLog);
    load(); const t = setInterval(load, 1500); return () => clearInterval(t);
  }, [open, job?.id, job?.activity]);

  // Toasts stays mounted in the same place whether or not a job is showing, or its messages would reset.
  if (!job) return <><Toasts /></>;
  const secs = job.startedAt ? Math.floor((Date.now() - +new Date(job.startedAt)) / 1000) : 0;
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <>
    <Toasts />
    <div className={`jobbar ${open ? "open" : ""}`}>
      <div className="jobbar-row" onClick={() => setOpen(!open)}>
        <span className="pulse" />
        <span>{label(job)}{shown.length > 1 ? ` · ${shown.length - 1} queued` : ""}</span>
        <span className="muted">{job.status === "running" ? `${job.activity ?? ""} · ${elapsed}` : job.status}</span>
        <button className="link" onClick={(e) => { e.stopPropagation(); post(`/api/jobs/${job.id}/cancel`); }}>cancel</button>
      </div>
      {open && <pre className="jobbar-log">{log.join("\n") || "…"}</pre>}
    </div>
    </>
  );
}

// What finished while you were reading: a drill-down or reading ready to open, or a long job that
// failed. Stays until dismissed or opened, so it is not missed in another tab.
type Toast = { id: number; text: string; to?: string | null; bad?: boolean };
const NOUN: Partial<Record<Job["kind"], string>> = { start: "Starting the course", assess: "The baseline assessment", outline: "The outline", module: "Generating the module", test: "Writing the module test", wrap: "The wrap-up", drilldown: "The drill-down", reading: "The reading list", lesson: "Writing the new lesson", worksheet: "Writing the worksheet" };
let seq = 0;
function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id"> & { fade?: boolean }) => {
    const id = ++seq;
    setList((l) => [...l.slice(-3), { ...t, id }]);
    if (t.fade) setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 6000);
  };
  useEvent("notice", useCallback((ev: any) => {
    // Vocab entries come often and are not urgent: a ready one fades; a failed one stays.
    if (ev.kind === "vocab") {
      if (ev.ok) push({ text: ev.merged ? `“${ev.title}” was already in your list; the new sentence was added to it.` : `Vocab entry ready: ${ev.title}`, to: ev.to, fade: true });
      else push({ text: ev.kept ? `Rewriting “${ev.title}” failed; the old entry is kept.` : `The entry for “${ev.title}” could not be written. Try again from Vocabulary.`, to: ev.to, bad: true });
      return;
    }
    const what = ev.kind === "drilldown" ? "Drill-down" : ev.kind === "lesson" ? "New lesson" : ev.kind === "worksheet" ? "Worksheet" : "Reading list";
    if (ev.ok) push({ text: `${what} ready: ${ev.title}`, to: ev.to });
    else push({ text: `${what} finished, but no new page turned up. Check the module's sidebar.`, bad: true });
  }, []));
  // Messages from this page (a word added), not the server.
  useEffect(() => {
    const on = (e: Event) => push({ ...(e as CustomEvent).detail, fade: true });
    addEventListener("toast", on); return () => removeEventListener("toast", on);
  }, []);
  useEvent("job", useCallback((ev: { job: Job }) => {
    const j = ev.job, noun = NOUN[j.kind];
    if (noun && j.status === "failed") push({ text: `${noun} failed${j.error ? `: ${j.error.slice(0, 140)}` : "."}`, bad: true });
  }, []));
  if (!list.length) return null;
  const close = (id: number) => setList((l) => l.filter((t) => t.id !== id));
  return (
    <div className="toasts" role="status">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.bad ? "is-bad" : ""}`}>
          <span>{t.text}</span>
          {t.to && <span onClick={() => close(t.id)}><Link to={t.to} className="btn primary">Open</Link></span>}
          <button className="link" aria-label="Dismiss" onClick={() => close(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
