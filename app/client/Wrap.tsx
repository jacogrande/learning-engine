// End of module: explain it to a colleague → discuss with a sharp student → finish → the
// understanding summary that later modules build on.
import { useEffect, useRef, useState } from "react";
import { get, post, put, useJobs, useLive, type Course, type Doc, type Module } from "./api";
import { Editor, type EditorHandle } from "./Editor";
import { Thread } from "./Chat";
import { Markdown } from "./Markdown";
import { Link, objectiveText } from "./App";

type Progress = { summary?: string; chat?: string; discussedAt?: string; completedAt?: string; read?: Record<string, string> };

export function Wrap({ slug, course, mod }: { slug: string; course: Course; mod: Module }) {
  const url = `/api/courses/${slug}/progress/${mod.id}`;
  const { data: p, reload } = useLive<Progress>(url, ["progress"]);
  const jobs = useJobs();
  const wrapping = jobs.some((j) => j.course === slug && j.kind === "wrap" && j.ref === `${mod.id}/wrap`);
  const [turns, setTurns] = useState(0);
  const editor = useRef<EditorHandle>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (p && draft === null) setDraft(p.summary ?? ""); }, [p]);
  if (!p) return null;

  const n = course.modules.findIndex((m) => m.id === mod.id);
  const next = course.modules[n + 1];

  // 3. Finished: show the understanding summary.
  if (p.completedAt && mod.understanding) return <Understanding slug={slug} mod={mod} next={next} progress={p} />;

  // 2. Discussing.
  if (p.chat) return (
    <article className="wrap">
      <p className="kicker">Wrap-up · discussion</p>
      <h1>{mod.title}</h1>
      <details className="wrap-summary"><summary>Your explanation</summary><Markdown body={p.summary ?? ""} /></details>
      <div className="wrap-chat"><Thread id={p.chat} onTurns={setTurns} hideContext /></div>
      <footer className="article-foot">
        <span className="muted">{wrapping ? "Writing your understanding summary…" : turns < 2 ? "Answer at least two of the questions before finishing." : "Finish when the discussion stops."}</span>
        <button className="primary" disabled={turns < 2 || wrapping} onClick={() => post(`/api/courses/${slug}/modules/${mod.id}/finish`)}>{wrapping ? "Finishing…" : "Finish module"}</button>
      </footer>
    </article>
  );

  // 1. Writing.
  const save = (md: string) => { setDraft(md); clearTimeout(timer.current); timer.current = setTimeout(() => put(url, { summary: md }), 800); };
  const words = (draft ?? "").split(/\s+/).filter(Boolean).length;
  return (
    <article className="wrap">
      <p className="kicker">Wrap-up · teach it</p>
      <h1>{mod.title}</h1>
      <p className="lede">Explain this module to a smart colleague who missed it. Cover what it claims, how it works, one worked example of your own, and where it stops applying. Write it from memory; the sections stay closed.</p>
      <ul className="objectives wrap-objectives">{mod.objectives.map((o, i) => <li key={o.id ?? i}>{objectiveText(o)}</li>)}</ul>
      <Editor ref={editor} value={p.summary ?? ""} placeholder="Start with the main claim." className="wrap-editor" onChange={save} />
      <p className="muted cram">Want a warm-up first? <Link to={`/c/${slug}/review?mode=cram&scope=${slug}/${mod.id}`}>Cram this module's questions</Link> (variants preferred), then come back and write.</p>
      <footer className="article-foot">
        <span className="muted">{words} words{words > 0 && words < 120 ? " · aim for 150–400" : ""}</span>
        <button className="primary" disabled={words < 60} onClick={async () => { clearTimeout(timer.current); await put(url, { summary: draft }); await post(`/api/courses/${slug}/modules/${mod.id}/discuss`, { summary: draft }); reload(); }}>Start discussion</button>
      </footer>
    </article>
  );
}

function Understanding({ slug, mod, next, progress }: { slug: string; mod: Module; next?: Module; progress: Progress }) {
  const { data: doc } = useLive<Doc>(`/api/courses/${slug}/doc?path=modules/${mod.id}/understanding.md`);
  const u = mod.understanding!;
  return (
    <article className="wrap">
      <p className="kicker">Module done · understanding</p>
      <h1>{mod.title}</h1>
      <div className="analysis">
        <div className="analysis-head"><span className="level">{u.level}</span><span className="muted">{mod.objectives.filter((o) => o.status === "met").length} of {mod.objectives.length} objectives met</span></div>
        {u.summary && <p>{u.summary}</p>}
        <ul className="objective-status">
          {mod.objectives.map((o, i) => <li key={o.id ?? i} className={`is-${o.status ?? "unmet"}`}><span className="quiz-status">{o.status ?? "unmet"}</span><span>{objectiveText(o)}</span>{o.evidence && <small className="muted">{o.evidence}</small>}</li>)}
        </ul>
        {u.calibration && <p className="muted"><strong>Calibration.</strong> {u.calibration}</p>}
      </div>
      {doc && <Markdown body={doc.body} />}
      {progress.summary && <details className="wrap-summary"><summary>Your explanation</summary><Markdown body={progress.summary} /></details>}
      {progress.chat && <details className="wrap-summary"><summary>The discussion</summary><div className="wrap-chat"><Thread id={progress.chat} hideContext readOnly /></div></details>}
      <footer className="article-foot">
        <Link to={`/c/${slug}`} className="btn">← Outline</Link>
        {next ? (next.status === "ready" ? <Link to={`/c/${slug}/m/${next.id}`} className="btn">{next.title} →</Link> : <GenerateNext slug={slug} next={next} />) : <span className="muted">Last module.</span>}
      </footer>
    </article>
  );
}

function GenerateNext({ slug, next }: { slug: string; next: Module }) {
  const jobs = useJobs();
  const running = jobs.some((j) => j.course === slug && j.ref === next.id);
  return <button className="primary" disabled={running} onClick={() => post(`/api/courses/${slug}/modules/${next.id}/generate`)}>{running ? "Generating…" : `Generate “${next.title}” →`}</button>;
}
