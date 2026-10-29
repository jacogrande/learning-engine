import { useEffect, useRef, useState, type ReactNode } from "react";
import { post, put, useLive, useJobs, type Course, type Doc, type QuizState, type Grade, type Job, type SyncStatus } from "./api";
import { Markdown } from "./Markdown";
import { QuizForm, QuizReview } from "./Quiz";
import { JobBar } from "./JobBar";
import { Reader } from "./Reader";
import { ReviewPage } from "./Review";

// A server started before the client was updated still sends objectives as strings.
export const objectiveText = (o: { text?: string } | string) => (typeof o === "string" ? o : o.text ?? "");

// --- tiny router ---------------------------------------------------------
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  return path;
}
export function navigate(to: string) { history.pushState(null, "", to); dispatchEvent(new PopStateEvent("popstate")); }
export const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
  <a href={to} className={className} onClick={(e) => { e.preventDefault(); navigate(to); }}>{children}</a>
);

export function App() {
  const path = usePath();
  const m = /^\/c\/([^/]+)(?:\/(baseline|review)|\/m\/([^/]+)(?:\/(.+))?)?$/.exec(path);
  return (
    <>
      {!m ? <Courses /> : m[3] ? <Reader slug={m[1]} moduleId={m[3]} file={m[4]} /> : m[2] === "review" ? <ReviewPage slug={m[1]} /> : <CoursePage slug={m[1]} tab={m[2] ? "baseline" : "outline"} />}
      <JobBar />
    </>
  );
}

// --- shell: top bar with breadcrumbs, theme ------------------------------
type Crumb = { label: string; to?: string };

export function Shell({ crumbs, children, className }: { crumbs: Crumb[]; children: ReactNode; className?: string }) {
  return (
    <>
      <header className="top">
        <nav className="crumbs">
          <Link to="/" className="brand">Learning</Link>
          {crumbs.map((c, i) => (
            <span key={i}><span className="sep">/</span>{c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}</span>
          ))}
        </nav>
        <div className="top-right"><Sync /><Theme /></div>
      </header>
      <div className={className}>{children}</div>
    </>
  );
}

// Library sync state. Click to pull and push now.
function Sync() {
  const { data: s } = useLive<SyncStatus>("/api/sync", ["sync"]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (!s?.repo) return null;
  const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - +new Date(iso)) / 60_000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
  const label = !s.remote ? "local only" : s.busy ? `${s.busy}…` : s.error ? "sync error" : s.dirty ? "unsaved changes" : `synced ${ago(s.lastPush ?? s.lastPull)}`;
  return (
    <button className={`sync ${s.error ? "is-error" : s.remote && !s.dirty && !s.busy ? "is-synced" : ""}`} title={s.error ?? (s.remote ? `${s.remote}\nclick to sync now` : "No remote configured for the library")} onClick={() => post("/api/sync")} disabled={!!s.busy}>
      <span className={`dot ${s.busy ? "pulse" : ""}`} />{label}
    </button>
  );
}

function Theme() {
  const [t, setT] = useState(localStorage.getItem("theme") ?? "system");
  const pick = (v: string) => {
    if (v === "system") { localStorage.removeItem("theme"); delete document.documentElement.dataset.theme; }
    else { localStorage.setItem("theme", v); document.documentElement.dataset.theme = v; }
    setT(v);
  };
  return (
    <div className="theme">{["system", "light", "dark"].map((v) => <button key={v} aria-pressed={t === v} onClick={() => pick(v)}>{v}</button>)}</div>
  );
}

// --- / -------------------------------------------------------------------
function Courses() {
  const { data } = useLive<Course[]>("/api/courses");
  const jobs = useJobs();
  const starting = jobs.filter((j) => j.kind === "start");
  const [open, setOpen] = useState(false);
  const status = (c: Course) =>
    c.stage === "baseline" ? "Baseline waiting" : c.stage === "assessed" ? "Outline pending" : `${c.modules.filter((m) => m.status === "ready").length} of ${c.modules.length} modules generated`;
  return (
    <Shell crumbs={[{ label: "Courses" }]} className="page">
      <div className="page-head"><h1>Courses</h1>{!open && <button className="primary" onClick={() => setOpen(true)}>New course</button>}</div>
      {open && <NewCourse onDone={() => setOpen(false)} />}
      {starting.map((j) => <p key={j.id} className="muted starting">Starting “{j.ref}” — researching the subject and writing the baseline. It appears below when ready ({j.activity ?? "queued"}).</p>)}
      {data?.length === 0 && starting.length === 0 && !open && (
        <p className="muted">No courses yet. Start one above, or in a terminal run <code>claude</code> here and type <code>/start-course &lt;topic&gt;</code>.</p>
      )}
      <ul className="cards">
        {data?.map((c) => (
          <li key={c.slug}>
            <Link to={c.stage === "baseline" ? `/c/${c.slug}/baseline` : `/c/${c.slug}`}>
              <h2>{c.title}</h2>
              <p className="muted">{status(c)}{c.depth ? ` · ${c.depth}` : ""}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

// The clarifying questions /start-course would ask in a terminal, asked here instead.
function NewCourse({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ subject: "", depth: "practitioner", know: "", goals: "", produce: "", angle: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const [busy, setBusy] = useState(false);
  return (
    <form className="new-course" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await post("/api/courses", f); onDone(); }}>
      <label>Subject<input autoFocus required value={f.subject} onChange={set("subject")} placeholder="e.g. lean methodology in business" /></label>
      <label>Depth
        <select value={f.depth} onChange={set("depth")}>
          <option value="entry">Entry level — start from the basics</option>
          <option value="practitioner">Working practitioner — I use this; make me better at it</option>
          <option value="expert">Expert — theory, debates, the edges</option>
        </select>
      </label>
      <label>What do you already know or have done?<textarea rows={2} value={f.know} onChange={set("know")} /></label>
      <label>What do you want to be able to do afterward?<textarea rows={2} value={f.goals} onChange={set("goals")} /></label>
      <label>What are you producing with it right now? <span className="muted">(examples come from here)</span><textarea rows={2} value={f.produce} onChange={set("produce")} placeholder="e.g. weekly status emails, product specs, short fiction" /></label>
      <label>Anything to emphasize or avoid? <span className="muted">(optional)</span><input value={f.angle} onChange={set("angle")} /></label>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !f.subject.trim()}>{busy ? "Starting…" : "Start course"}</button>
        <button type="button" onClick={onDone}>Cancel</button>
        <span className="muted">Research and the baseline take about five minutes.</span>
      </div>
    </form>
  );
}

// --- /c/:slug and /c/:slug/baseline --------------------------------------
function CoursePage({ slug, tab }: { slug: string; tab: "outline" | "baseline" }) {
  const { data: course, error } = useLive<Course>(`/api/courses/${slug}`);
  const { data: state, reload } = useLive<QuizState>(`/api/courses/${slug}/quiz/baseline`);
  const { data: review } = useLive<{ dueCount: number; total: number }>(`/api/courses/${slug}/review`, ["answer"]);
  if (error) return <Shell crumbs={[{ label: "Courses", to: "/" }, { label: slug }]} className="page"><p>Course not found.</p></Shell>;
  if (!course || !state) return null;
  return (
    <Shell crumbs={[{ label: "Courses", to: "/" }, { label: course.title }]} className="page">
      <h1>{course.title}</h1>
      {course.description && <p className="lede">{course.description}</p>}
      <nav className="tabs">
        <Link to={`/c/${slug}`} className={tab === "outline" ? "active" : ""}>Outline</Link>
        <Link to={`/c/${slug}/baseline`} className={tab === "baseline" ? "active" : ""}>
          Baseline{state.attempt?.grade ? <span className="level">{state.attempt.grade.level}</span> : null}
        </Link>
        {review && review.total > 0 && (
          <Link to={`/c/${slug}/review`}>Review{review.dueCount > 0 ? <span className="level due">{review.dueCount} due</span> : null}</Link>
        )}
      </nav>
      {tab === "outline" ? <Outline course={course} /> : <Baseline slug={slug} state={state} reload={reload} />}
    </Shell>
  );
}

function Outline({ course }: { course: Course }) {
  const jobs = useJobs();
  const { data: past } = useLive<Job[]>(`/api/courses/${course.slug}/jobs`);
  const running = (ref?: string) => jobs.some((j) => j.course === course.slug && (ref ? j.ref === ref : j.kind === "outline"));
  // The last run for a module, if it did not finish: shown so a Generate click reads as "resume".
  const broken = (ref: string) => past?.find((j) => j.ref === ref && ["interrupted", "failed", "cancelled"].includes(j.status));

  if (course.stage === "baseline")
    return <p className="muted empty">The outline is built from your baseline. <Link to={`/c/${course.slug}/baseline`}>Take it first →</Link></p>;
  if (course.stage === "assessed")
    return (
      <div className="actions">
        <button className="primary" disabled={running()} onClick={() => post(`/api/courses/${course.slug}/outline`)}>{running() ? "Building outline…" : "Build outline"}</button>
      </div>
    );
  return (
    <ol className="modules">
      {course.modules.map((m) => {
        const gen = running(m.id), n = m.sections.length, b = !gen && broken(m.id), done = !!m.understanding;
        const met = m.objectives.filter((o) => o.status === "met").length;
        return (
          <li key={m.id} className={done ? "is-done" : ""}>
            <div className="module-head">
              <h3>{n ? <Link to={`/c/${course.slug}/m/${m.id}`}>{m.title}</Link> : m.title}</h3>
              <div className="module-actions">
                {gen && <span className="muted">Generating{n ? ` · ${n} section${n > 1 ? "s" : ""} so far` : "…"}</span>}
                {done && <Link to={`/c/${course.slug}/m/${m.id}/wrap`} className="level">{met}/{m.objectives.length} met</Link>}
                {n > 0 && <Link to={`/c/${course.slug}/m/${m.id}`} className="btn">{done ? "Reopen" : "Open"}</Link>}
                {!gen && (n === 0 || b) && (
                  <button onClick={() => post(`/api/courses/${course.slug}/modules/${m.id}/generate`)}>{b ? "Resume" : "Generate"}</button>
                )}
              </div>
            </div>
            {b && <p className="muted note">Last run {b.status}{b.error ? ` — ${b.error}` : ""}.{n > 0 && ` Resume keeps the ${n} section${n === 1 ? "" : "s"} already written.`}</p>}
            {m.summary && <p className="muted">{m.summary}</p>}
            {m.understanding?.summary && <p className="muted">{m.understanding.summary}</p>}
            <ul className="objectives">{m.objectives.map((o, i) => <li key={o.id ?? i} className={o.status ? `is-${o.status}` : ""}>{o.status && <span className="quiz-status">{o.status}</span>}{objectiveText(o)}</li>)}</ul>
          </li>
        );
      })}
    </ol>
  );
}

// Baseline tab: form → submitted/assessing → review. Answers draft to the server as you type.
function Baseline({ slug, state, reload }: { slug: string; state: QuizState; reload: () => void }) {
  const { data: doc } = useLive<Doc>(`/api/courses/${slug}/doc?path=quizzes/baseline.md`);
  const jobs = useJobs();
  const busy = jobs.some((j) => j.course === slug && j.kind === "assess");
  useEffect(() => { if (!busy) reload(); }, [busy]);   // pick up the grade when the job ends

  if (!doc) return <p className="muted empty">Baseline test not written yet.</p>;
  const { attempt } = state;
  if (!attempt) return <BaselineForm slug={slug} doc={doc} draft={state.draft} onSubmit={reload} />;

  const results = Object.fromEntries((attempt.grade?.questions ?? []).map((q) => [q.id, q]));
  return (
    <>
      <p className="meta">Taken {new Date(attempt.createdAt).toLocaleString()}</p>
      {attempt.grade ? (
        <Analysis grade={attempt.grade} />
      ) : (
        <div className="actions">
          <span className="muted">{busy ? "Assessing…" : "Assessment did not finish."}</span>
          {!busy && <button onClick={() => post(`/api/courses/${slug}/baseline/assess`)}>Retry assessment</button>}
        </div>
      )}
      <QuizReview value={{ answers: attempt.answers, results }}>
        <Markdown body={doc.body.replace(/^[^\n`]+\n/, "")} />
      </QuizReview>
    </>
  );
}

function BaselineForm({ slug, doc, draft, onSubmit }: { slug: string; doc: Doc; draft: Record<string, string> | null; onSubmit: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(draft ?? {});
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const update = (id: string, v: string) => {
    const next = { ...answers, [id]: v };
    setAnswers(next); setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => put(`/api/courses/${slug}/quiz/baseline/draft`, { answers: next }).then(() => setSaved(true)), 400);
  };
  const submit = async () => {
    clearTimeout(timer.current);
    await put(`/api/courses/${slug}/quiz/baseline/draft`, { answers });
    await post(`/api/courses/${slug}/baseline`, { answers });
    onSubmit();
  };
  const n = Object.values(answers).filter(Boolean).length;
  return (
    <>
      <QuizForm value={{ answers, set: update }}>
        <Markdown body={doc.body} />
      </QuizForm>
      <div className="actions">
        <button className="primary" disabled={n === 0} onClick={submit}>Submit {n} answers</button>
        <span className="muted">{saved ? (n ? "Draft saved" : "") : "Saving…"}</span>
      </div>
    </>
  );
}

// Compact "where you are" from the structured grade.
function Analysis({ grade }: { grade: Grade }) {
  const tally = grade.questions.reduce((t, q) => ({ ...t, [q.result]: (t[q.result] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <div className="analysis">
      <div className="analysis-head">
        <span className="level">{grade.level}</span>
        <span className="muted">{["correct", "partial", "wrong", "skipped"].filter((k) => tally[k]).map((k) => `${tally[k]} ${k}`).join(" · ")}</span>
      </div>
      <p>{grade.summary}</p>
      <div className="analysis-cols">
        <div><h4>Have</h4><ul>{grade.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        <div><h4>Missing</h4><ul>{grade.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      </div>
    </div>
  );
}
