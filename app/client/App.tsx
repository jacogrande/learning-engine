import { useEffect, useRef, useState, type ReactNode } from "react";
import { post, put, useLive, useJobs, type Course, type Doc, type QuizState, type Sheet, type Grade, type Job, type SyncStatus } from "./api";
import { Markdown } from "./Markdown";
import { RichField } from "./Editor";
import { QuizForm, QuizReview } from "./Quiz";
import { JobBar } from "./JobBar";
import { Reader } from "./Reader";
import { ReviewPage } from "./Review";
import { SessionPage } from "./History";
import { StatsPage } from "./Stats";
import { CardsPage } from "./Cards";
import { NotebookPage } from "./Notebook";
import { VocabCapture, VocabPage } from "./Vocab";
import { Browser } from "./Library";
import { TrainPage } from "./Train";

// A server started before the client was updated still sends objectives as strings.
export const objectiveText = (o: { text?: string } | string) => (typeof o === "string" ? o : o.text ?? "");

// --- tiny router ---------------------------------------------------------
function usePath() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => { const on = () => setPath(location.pathname + location.search); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  return path.split("?")[0];
}
export function navigate(to: string) { history.pushState(null, "", to); dispatchEvent(new PopStateEvent("popstate")); }
// A plain left click routes in place; a modified click or middle click is left to the browser,
// so cmd/ctrl-click opens a new tab and shift-click a new window, as on any link.
export const Link = ({ to, children, className, title }: { to: string; children: ReactNode; className?: string; title?: string }) => (
  <a href={to} className={className} title={title} onClick={(e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); navigate(to);
  }}>{children}</a>
);

export function App() {
  const path = usePath();
  const sp = new URLSearchParams(location.search);
  const mode = (sp.get("mode") as any) ?? undefined, scope = sp.get("scope") ?? undefined;
  const m = /^\/c\/([^/]+)(?:\/(baseline|review|notebook)|\/m\/([^/]+)(?:\/(.+))?)?$/.exec(path);
  const page =
    path === "/" ? <Courses />
    : path === "/review/stats" ? <StatsPage />
    : path === "/review/cards" ? <CardsPage />
    : path.startsWith("/review/history/") ? <SessionPage id={path.slice("/review/history/".length)} />
    : path === "/vocab" ? <VocabPage />
    : path === "/vocab/train" ? <TrainPage />
    : path === "/review" ? <ReviewPage key={location.search} mode={mode} scope={scope} />
    : !m ? <NotFound />
    : m[3] ? <Reader slug={m[1]} moduleId={m[3]} file={m[4]} />
    : m[2] === "review" ? <ReviewPage key={location.search} slug={m[1]} mode={mode} scope={scope} />
    : m[2] === "notebook" ? <NotebookPage slug={m[1]} />
    : <CoursePage slug={m[1]} tab={m[2] ? "baseline" : "outline"} />;
  return <>{page}<VocabCapture /><JobBar /></>;
}

export function NotFound({ crumbs = [], what = "page" }: { crumbs?: Crumb[]; what?: string }) {
  return (
    <Shell crumbs={[...crumbs, { label: "Not found" }]} className="page">
      <h1>No such {what}</h1>
      <p className="muted empty">It may have been renamed or removed. <Link to={crumbs.at(-1)?.to ?? "/"}>Back to {crumbs.at(-1)?.label ?? "courses"} →</Link></p>
    </Shell>
  );
}

// --- shell: top bar with breadcrumbs, theme ------------------------------
type Crumb = { label: string; to?: string };

// The tab title follows the page: the page's own name first, then the course or area it sits in,
// then the app. "Courses" is the root, so it is left out. Pages whose heading is not their last
// crumb (a section inside a module) pass `title`.
export function useTitle(...parts: (string | undefined)[]) {
  const text = [...new Set(parts.filter((p): p is string => !!p && p !== "Courses")), "Learning"].join(" · ");
  useEffect(() => { document.title = text; return () => { document.title = "Learning"; }; }, [text]);
}

export function Shell({ crumbs, children, className, title }: { crumbs: Crumb[]; children: ReactNode; className?: string; title?: string }) {
  const labels = crumbs.map((c) => c.label).filter((l) => l !== "Courses");
  useTitle(title ?? labels.at(-1), labels[0]);
  return (
    <>
      <header className="top">
        <nav className="crumbs">
          <Link to="/" className="brand">Learning</Link>
          {crumbs.map((c, i) => (
            <span key={i}><span className="sep">/</span>{c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current">{c.label}</span>}</span>
          ))}
        </nav>
        <div className="top-right"><Link to="/vocab" className="top-review" >Vocab</Link><ReviewLink /><Sync /><ReadingMenu /></div>
      </header>
      <div className={className}>{children}</div>
    </>
  );
}

// Always one click from review, wherever you are.
function ReviewLink() {
  const { data: rv } = useLive<{ dueCount: number }>("/api/review/summary", ["answer", "card"]);
  return <Link to="/review" className={`top-review ${rv?.dueCount ? "has-due" : ""}`}>Review{rv?.dueCount ? <span className="level due">{rv.dueCount}</span> : null}</Link>;
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

// The Aa menu: reading settings for lesson text, and the theme. Each is a data-* attribute on <html>
// that styles.css reads, kept in localStorage (index.html applies them before the first paint).
const READING = {
  size: { label: "Size", options: [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]], fallback: "m" },
  font: { label: "Font", options: [["sans", "Sans"], ["serif", "Serif"], ["atkinson", "Atkinson"]], fallback: "sans" },
  spacing: { label: "Line spacing", options: [["normal", "Normal"], ["roomy", "Roomy"]], fallback: "normal" },
  theme: { label: "Theme", options: [["system", "System"], ["light", "Light"], ["sepia", "Sepia"], ["dark", "Dark"]], fallback: "system" },
} as const;
type Setting = keyof typeof READING;
const stored = (k: Setting) => { try { return localStorage.getItem(k === "theme" ? "theme" : `read-${k}`); } catch { return null; } };

function ReadingMenu() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => Object.fromEntries((Object.keys(READING) as Setting[]).map((k) => [k, stored(k) ?? READING[k].fallback])) as Record<Setting, string>);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); (box.current?.firstElementChild as HTMLElement)?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (k: Setting, x: string) => {
    const key = k === "theme" ? "theme" : `read-${k}`, attr = k === "theme" ? "theme" : `read${k[0].toUpperCase()}${k.slice(1)}`;
    const ds = document.documentElement.dataset as Record<string, string | undefined>;
    try { x === READING[k].fallback ? localStorage.removeItem(key) : localStorage.setItem(key, x); } catch {}
    if (x === READING[k].fallback) delete ds[attr]; else ds[attr] = x;
    setV((p) => ({ ...p, [k]: x }));
    if (k === "theme") dispatchEvent(new Event("themechange"));   // diagrams re-render in the new palette
  };
  return (
    <div className="reading-menu" ref={box}>
      <button className="reading-toggle" aria-expanded={open} aria-haspopup="dialog" title="Reading settings" aria-label="Reading settings" onClick={() => setOpen(!open)}>Aa</button>
      {open && (
        <div className="reading-pop" role="dialog" aria-label="Reading settings">
          {(Object.keys(READING) as Setting[]).map((k) => (
            <div key={k} className="reading-row">
              <span className="muted">{READING[k].label}</span>
              <div className="theme" role="group" aria-label={READING[k].label}>
                {READING[k].options.map(([x, label]) => <button key={x} aria-pressed={v[k] === x} onClick={() => pick(k, x)} className={k === "font" ? `font-${x}` : undefined}>{label}</button>)}
              </div>
            </div>
          ))}
          <p className="meta">Size, font and spacing apply to lessons.</p>
        </div>
      )}
    </div>
  );
}

// --- / -------------------------------------------------------------------
function Courses() {
  const { data } = useLive<Course[]>("/api/courses");
  const jobs = useJobs();
  const starting = jobs.filter((j) => j.kind === "start" || j.kind === "brief");
  // The New course dialog: closed (undefined), or open for a folder (null is the top level).
  const [newIn, setNewIn] = useState<string | null | undefined>(undefined);
  const { data: folders } = useLive<string[]>("/api/folders");
  const { data: rv } = useLive<{ dueCount: number; total: number; streak: number; next: string | null }>("/api/review/summary", ["answer", "card"]);
  return (
    <Shell crumbs={[{ label: "Courses" }]} className="page page-wide">
      <div className="page-head"><h1>Courses</h1><button className="primary" onClick={() => setNewIn(null)}>New course</button></div>
      {newIn !== undefined && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewIn(undefined); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="New course" onKeyDown={(e) => { if (e.key === "Escape") setNewIn(undefined); }}>
            <h2>New course{newIn ? <span className="muted"> in {newIn.split("/").join(" › ")}</span> : null}</h2>
            <NewCourse folder={newIn} onDone={() => setNewIn(undefined)} />
          </div>
        </div>
      )}
      {rv && rv.total > 0 && (
        <p className="due-line">
          <Link to="/review">{rv.dueCount > 0 ? `Due today: ${rv.dueCount}` : "Nothing due today"}</Link>
          {rv.streak > 0 && <span className="muted"> · {rv.streak}-day streak</span>}
          {rv.dueCount === 0 && rv.next && <span className="muted"> · next {new Date(rv.next).toLocaleDateString()}</span>}
        </p>
      )}
      {starting.map((j) => <p key={j.id} className="muted starting">Starting “{j.ref}” — {j.kind === "brief" ? "researching the topic and planning the brief; the module writes itself after" : "researching the subject and writing the baseline"}. It appears in the browser below when ready ({j.activity ?? "queued"}).</p>)}
      {data?.length === 0 && starting.length === 0 && newIn === undefined && !folders?.length && (
        <p className="muted">No courses yet. Start one above, or in a terminal run <code>claude</code> here and type <code>/start-course &lt;topic&gt;</code>.</p>
      )}
      {data && (data.length > 0 || !!folders?.length) && <Browser courses={data} folders={folders ?? []} onNewCourse={setNewIn} />}
    </Shell>
  );
}

// The clarifying questions /start-course (or /start-brief) would ask in a terminal, asked here instead.
function NewCourse({ onDone, folder = null }: { onDone: () => void; folder?: string | null }) {
  const [f, setF] = useState({ format: "course", subject: "", depth: "practitioner", know: "", goals: "", produce: "", angle: "", folder: folder ?? "" });
  const [review, setReview] = useState(true);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  // Rich fields hand back markdown; the prompt takes it as written.
  const setRich = (k: keyof typeof f) => (md: string) => setF((p) => ({ ...p, [k]: md }));
  const setFormat = (format: string) => {
    // A brief is usually work: file it there and keep it out of the daily review, unless changed.
    // Unless it was opened inside a folder, which keeps that folder.
    setF({ ...f, format, folder: folder ? f.folder : format === "brief" && !f.folder ? "Work" : format === "course" && f.folder === "Work" ? "" : f.folder });
    setReview(format !== "brief");
  };
  const [busy, setBusy] = useState(false);
  const brief = f.format === "brief";
  const filing = (
    <>
      <label>Folder <span className="muted">(optional; a path like Work/Clients nests it)</span><input value={f.folder} onChange={set("folder")} placeholder="e.g. Work" /></label>
      <label className="check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Include in the daily review <span className="muted">(its own review page works either way)</span></label>
    </>
  );
  return (
    <form className="new-course" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await post("/api/courses", { ...f, review }); onDone(); }}>
      <div className="segmented" role="radiogroup" aria-label="Format">
        <button type="button" role="radio" aria-checked={!brief} className={!brief ? "active" : ""} onClick={() => setFormat("course")}>Course <span className="muted">baseline, outline, several modules</span></button>
        <button type="button" role="radio" aria-checked={brief} className={brief ? "active" : ""} onClick={() => setFormat("brief")}>Brief <span className="muted">one module, fast, no baseline</span></button>
      </div>
      {brief ? (
        <>
          <label>Topic<input autoFocus required value={f.subject} onChange={set("subject")} placeholder="e.g. campsite availability rules for admins" /></label>
          <RichField label="What are you building or deciding?" hint="(examples come from here)" value={f.produce} onChange={setRich("produce")} placeholder="e.g. a feature letting park admins set booking windows, minimum stays and blackout dates" />
          <RichField label="What do you need to be able to do or discuss?" hint="(optional)" value={f.goals} onChange={setRich("goals")} placeholder="e.g. hold my own in a spec review; know which patterns competitors ship" />
          <RichField label="What do you already know?" hint="(optional)" value={f.know} onChange={setRich("know")} />
          <label>Anything to emphasize or avoid? <span className="muted">(optional)</span><input value={f.angle} onChange={set("angle")} /></label>
          {filing}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || !f.subject.trim()}>{busy ? "Starting…" : "Start brief"}</button>
            <button type="button" onClick={onDone}>Cancel</button>
            <span className="muted">Research, then the module: about fifteen minutes.</span>
          </div>
        </>
      ) : (
      <>
      <label>Subject<input autoFocus required value={f.subject} onChange={set("subject")} placeholder="e.g. lean methodology in business" /></label>
      <label>Depth
        <select value={f.depth} onChange={set("depth")}>
          <option value="entry">Entry level — start from the basics</option>
          <option value="practitioner">Working practitioner — I use this; make me better at it</option>
          <option value="expert">Expert — theory, debates, the edges</option>
        </select>
      </label>
      <RichField label="What do you already know or have done?" value={f.know} onChange={setRich("know")} />
      <RichField label="What do you want to be able to do afterward?" value={f.goals} onChange={setRich("goals")} />
      <RichField label="What are you producing with it right now?" hint="(examples come from here)" value={f.produce} onChange={setRich("produce")} placeholder="e.g. weekly status emails, product specs, short fiction" />
      <label>Anything to emphasize or avoid? <span className="muted">(optional)</span><input value={f.angle} onChange={set("angle")} /></label>
      {filing}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !f.subject.trim()}>{busy ? "Starting…" : "Start course"}</button>
        <button type="button" onClick={onDone}>Cancel</button>
        <span className="muted">Research and the baseline take about five minutes.</span>
      </div>
      </>
      )}
    </form>
  );
}

// --- /c/:slug and /c/:slug/baseline --------------------------------------
function CoursePage({ slug, tab }: { slug: string; tab: "outline" | "baseline" }) {
  const { data: course, error } = useLive<Course>(`/api/courses/${slug}`);
  const { data: state, reload } = useLive<QuizState>(`/api/courses/${slug}/quiz/baseline`);
  const { data: review } = useLive<{ dueCount: number; total: number }>(`/api/courses/${slug}/review`, ["answer", "card"]);
  if (error) return <NotFound crumbs={[{ label: "Courses", to: "/" }]} what="course" />;
  if (!course || !state) return null;
  return (
    <Shell crumbs={[{ label: "Courses", to: "/" }, { label: course.title }]} className="page">
      <h1>{course.title}</h1>
      {course.description && <p className="lede">{course.description}</p>}
      <nav className="tabs">
        <Link to={`/c/${slug}`} className={tab === "outline" ? "active" : ""}>Outline</Link>
        {course.format !== "brief" && (
          <Link to={`/c/${slug}/baseline`} className={tab === "baseline" ? "active" : ""}>
            Baseline{state.attempt?.grade ? <span className="level">{state.attempt.grade.level}</span> : null}
          </Link>
        )}
        {review && review.total > 0 && (
          <Link to={`/c/${slug}/review`}>Review{review.dueCount > 0 ? <span className="level due">{review.dueCount} due</span> : null}</Link>
        )}
        {course.stage === "ready" && <Link to={`/c/${slug}/notebook`}>Notebook</Link>}
      </nav>
      {tab === "outline" ? <Outline course={course} /> : <Baseline slug={slug} state={state} reload={reload} />}
      <Filing course={course} />
    </Shell>
  );
}

// Folder and daily-review membership, written to course.md.
function Filing({ course }: { course: Course }) {
  const [folder, setFolder] = useState(course.folder ?? "");
  useEffect(() => setFolder(course.folder ?? ""), [course.folder]);
  const save = (b: { folder?: string; review?: boolean }) => put(`/api/courses/${course.slug}/meta`, b);
  return (
    <div className="filing muted">
      <label>Folder <input value={folder} placeholder="none" onChange={(e) => setFolder(e.target.value)}
        onBlur={() => folder.trim() !== (course.folder ?? "") && save({ folder: folder.trim() })}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} /></label>
      <label className="check"><input type="checkbox" checked={course.review} onChange={(e) => save({ review: e.target.checked })} /> In the daily review</label>
    </div>
  );
}

function Outline({ course }: { course: Course }) {
  const jobs = useJobs();
  const { data: past } = useLive<Job[]>(`/api/courses/${course.slug}/jobs`);
  const running = (ref?: string) => jobs.some((j) => j.course === course.slug && (ref ? j.ref === ref : j.kind === "outline"));
  // The last run for a module, if it did not finish: shown so a Generate click reads as "resume".
  const broken = (ref: string) => past?.find((j) => j.ref === ref && ["interrupted", "failed", "cancelled"].includes(j.status));

  if (course.format === "brief" && course.stage !== "ready")
    return <p className="muted empty">Researching the topic. The module plan appears here when the research is done, and the module starts writing itself right after.</p>;
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
      <QuizReview value={{ sheet: { answers: attempt.answers, confidence: attempt.confidence ?? {}, notes: attempt.notes ?? {} }, results }}>
        <Markdown body={doc.body.replace(/^[^\n`]+\n/, "")} />
      </QuizReview>
    </>
  );
}

// Every answered question needs a confidence rating before the sheet goes in; notes are optional.
function BaselineForm({ slug, doc, draft, onSubmit }: { slug: string; doc: Doc; draft: Sheet | null; onSubmit: () => void }) {
  const [sheet, setSheet] = useState<Sheet>(() => ({ answers: {}, confidence: {}, notes: {}, ...draft }));
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const update = (field: keyof Sheet, id: string, v: string | number) => {
    const next = { ...sheet, [field]: { ...sheet[field], [id]: v } };
    setSheet(next); setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => put(`/api/courses/${slug}/quiz/baseline/draft`, next).then(() => setSaved(true)), 400);
  };
  const submit = async () => {
    clearTimeout(timer.current);
    await put(`/api/courses/${slug}/quiz/baseline/draft`, sheet);
    await post(`/api/courses/${slug}/baseline`, sheet);
    onSubmit();
  };
  const answered = Object.keys(sheet.answers).filter((id) => sheet.answers[id]);
  const unrated = answered.filter((id) => !sheet.confidence[id]).length;
  const n = answered.length;
  return (
    <>
      <QuizForm value={{ sheet, set: update }}>
        <Markdown body={doc.body} />
      </QuizForm>
      <div className="actions">
        <button className="primary" disabled={n === 0 || unrated > 0} onClick={submit}>Submit {n} answers</button>
        <span className="muted">{unrated ? `${unrated} ${unrated === 1 ? "answer needs" : "answers need"} a rating of how sure you are` : saved ? (n ? "Draft saved" : "") : "Saving…"}</span>
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
