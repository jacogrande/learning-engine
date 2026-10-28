// Slim strip at the bottom while Claude is working. Click to see the log.
import { useEffect, useState } from "react";
import { get, post, useJobs, type Job } from "./api";

const label = (j: Job) => ({ assess: "Assessing baseline", outline: "Building outline", module: `Generating module ${j.ref}` }[j.kind]);

export function JobBar() {
  const jobs = useJobs();
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const job = jobs.find((j) => j.status === "running") ?? jobs[0];
  const [, tick] = useState(0);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!open || !job) return;
    const load = () => get<string[]>(`/api/jobs/${job.id}/log`).then(setLog);
    load(); const t = setInterval(load, 1500); return () => clearInterval(t);
  }, [open, job?.id, job?.activity]);

  if (!job) return null;
  const secs = job.startedAt ? Math.floor((Date.now() - +new Date(job.startedAt)) / 1000) : 0;
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className={`jobbar ${open ? "open" : ""}`}>
      <div className="jobbar-row" onClick={() => setOpen(!open)}>
        <span className="pulse" />
        <span>{label(job)}{jobs.length > 1 ? ` · ${jobs.length - 1} queued` : ""}</span>
        <span className="muted">{job.status === "running" ? `${job.activity ?? ""} · ${elapsed}` : job.status}</span>
        <button className="link" onClick={(e) => { e.stopPropagation(); post(`/api/jobs/${job.id}/cancel`); }}>cancel</button>
      </div>
      {open && <pre className="jobbar-log">{log.join("\n") || "…"}</pre>}
    </div>
  );
}
