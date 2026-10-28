import { useEffect, useRef, useState } from "react";
import { get, post, put, useLive, useJobs, type Course, type Doc, type QuizState, type Grade } from "./api";
import { Markdown } from "./Markdown";
import { QuizForm, QuizReview } from "./Quiz";
import { JobBar } from "./JobBar";

// --- tiny router ---------------------------------------------------------
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  return path;
}
export function navigate(to: string) { history.pushState(null, "", to); dispatchEvent(new PopStateEvent("popstate")); }
const Link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <a href={to} className={className} onClick={(e) => { e.preventDefault(); navigate(to); }}>{children}</a>
);

export function App() {
  const path = usePath();
  const m = /^\/c\/([^/]+)(?:\/(baseline)|\/m\/([^/]+)(?:\/([^/]+))?)?/.exec(path);
  return (
    <>
      {!m ? <Courses /> : m[2] ? <BaselineReview slug={m[1]} /> : m[3] ? <Reader slug={m[1]} moduleId={m[3]} file={m[4]} /> : <CoursePage slug={m[1]} />}
      <JobBar />
    </>
  );
}

// --- theme ---------------------------------------------------------------
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
  return (
    <main className="page">
      <header className="page-head"><h1>Courses</h1><Theme /></header>
      {data?.length === 0 && (
        <p className="muted">No courses yet. In a terminal, run <code>claude</code> here and type <code>/start-course &lt;topic&gt;</code>.</p>
      )}
      <ul className="cards">
        {data?.map((c) => (
          <li key={c.slug}>
            <Link to={`/c/${c.slug}`}>
              <h2>{c.title}</h2>
              <p className="muted">{c.stage === "baseline" ? "Baseline test waiting" : c.stage === "assessed" ? "Outline pending" : `${c.modules.filter((m) => m.status === "ready").length}/${c.modules.length} modules generated`}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

// --- /c/:slug ------------------------------------------------------------
function CoursePage({ slug }: { slug: string }) {
  const { data: course, error } = useLive<Course>(`/api/courses/${slug}`);
  if (error) return <main className="page"><p>Course not found.</p></main>;
  if (!course) return null;
  return (
    <main className="page">
      <header className="page-head">
        <div><Link to="/" className="crumb">Courses</Link><h1>{course.title}</h1></div>
        <Theme />
      </header>
      {course.description && <p className="lede">{course.description}</p>}
      {course.stage === "baseline" ? <Baseline slug={slug} /> : <Outline course={course} />}
    </main>
  );
}

// Answers are drafted to the server as you type, so nothing is lost on reload.
function Baseline({ slug }: { slug: string }) {
  const { data: doc } = useLive<Doc>(`/api/courses/${slug}/doc?path=quizzes/baseline.md`);
  const [state, setState] = useState<QuizState | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const jobs = useJobs();
  const busy = jobs.some((j) => j.course === slug);

  useEffect(() => { get<QuizState>(`/api/courses/${slug}/quiz/baseline`).then((s) => { setState(s); if (s.draft) setAnswers(s.draft); }); }, [slug]);

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
    setState((s) => ({ draft: null, attempt: { id: "", answers, grade: null, createdAt: new Date().toISOString() } }));
  };

  if (!doc || !state) return <p className="muted">{doc ? "" : "Baseline test not written yet."}</p>;

  if (state.attempt)
    return (
      <section className="actions">
        <p className="muted">Submitted {new Date(state.attempt.createdAt).toLocaleString()}. {busy ? "Assessing…" : "Assessment did not finish."}</p>
        {!busy && <button onClick={() => post(`/api/courses/${slug}/baseline/assess`)}>Retry assessment</button>}
        <Link to={`/c/${slug}/baseline`} className="btn">Your answers</Link>
      </section>
    );

  const n = Object.values(answers).filter(Boolean).length;
  return (
    <section>
      <h2>Baseline</h2>
      <QuizForm value={{ answers, set: update }}>
        <Markdown body={doc.body} />
      </QuizForm>
      <div className="actions">
        <button className="primary" disabled={n === 0} onClick={submit}>Submit {n} answers</button>
        <span className="muted">{saved ? (n ? "Draft saved" : "") : "Saving…"}</span>
      </div>
    </section>
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

// /c/:slug/baseline — the test as you answered it, with the grader's notes.
function BaselineReview({ slug }: { slug: string }) {
  const { data: course } = useLive<Course>(`/api/courses/${slug}`);
  const { data: doc } = useLive<Doc>(`/api/courses/${slug}/doc?path=quizzes/baseline.md`);
  const { data: state } = useLive<QuizState>(`/api/courses/${slug}/quiz/baseline`);
  if (!course || !doc || !state) return null;
  const attempt = state.attempt;
  if (!attempt) return <main className="page"><p className="muted">Not taken yet.</p></main>;
  const results = Object.fromEntries((attempt.grade?.questions ?? []).map((q) => [q.id, q]));
  return (
    <main className="page">
      <header className="page-head">
        <div><Link to={`/c/${slug}`} className="crumb">← {course.title}</Link><h1>Baseline</h1></div>
        <Theme />
      </header>
      <p className="muted">Taken {new Date(attempt.createdAt).toLocaleString()}</p>
      {attempt.grade ? <Analysis grade={attempt.grade} /> : <p className="muted">Not assessed yet.</p>}
      <QuizReview value={{ answers: attempt.answers, results }}>
        <Markdown body={doc.body.replace(/^[^\n`]+\n/, "")} />
      </QuizReview>
    </main>
  );
}

function Outline({ course }: { course: Course }) {
  const jobs = useJobs();
  const { data: state } = useLive<QuizState>(`/api/courses/${course.slug}/quiz/baseline`);
  const running = (ref?: string) => jobs.some((j) => j.course === course.slug && (ref ? j.ref === ref : j.kind === "outline"));
  const grade = state?.attempt?.grade;
  const card = grade && (
    <div className="baseline-card">
      <div><span className="level">{grade.level}</span> {grade.summary}</div>
      <Link to={`/c/${course.slug}/baseline`} className="btn">Your baseline</Link>
    </div>
  );
  if (course.stage === "assessed")
    return (
      <section>
        {card}
        <div className="actions">
          <button className="primary" disabled={running()} onClick={() => post(`/api/courses/${course.slug}/outline`)}>{running() ? "Building outline…" : "Build outline"}</button>
        </div>
      </section>
    );
  return (
    <section>
      {card}
      <ol className="modules">
        {course.modules.map((m) => (
          <li key={m.id}>
            <div className="module-head">
              <h3>{m.status === "ready" ? <Link to={`/c/${course.slug}/m/${m.id}`}>{m.title}</Link> : m.title}</h3>
              {m.status === "ready" ? (
                <Link to={`/c/${course.slug}/m/${m.id}`} className="btn">Open</Link>
              ) : (
                <button disabled={running(m.id)} onClick={() => post(`/api/courses/${course.slug}/modules/${m.id}/generate`)}>{running(m.id) ? "Generating…" : "Generate"}</button>
              )}
            </div>
            {m.summary && <p className="muted">{m.summary}</p>}
            {m.objectives && <ul className="objectives">{m.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- /c/:slug/m/:id/:file ------------------------------------------------
function Reader({ slug, moduleId, file }: { slug: string; moduleId: string; file?: string }) {
  const { data: course } = useLive<Course>(`/api/courses/${slug}`);
  const mod = course?.modules.find((m) => m.id === moduleId);
  const current = file ?? mod?.sections[0]?.file;
  const { data: doc } = useLive<Doc>(mod && current ? `/api/courses/${slug}/doc?path=modules/${moduleId}/${current}` : null);
  useEffect(() => { window.scrollTo(0, 0); }, [current]);
  if (!course || !mod) return null;

  const i = mod.sections.findIndex((s) => s.file === current);
  const next = mod.sections[i + 1];
  return (
    <div className="reader">
      <nav className="side">
        <Link to={`/c/${slug}`} className="crumb">← {course.title}</Link>
        <div className="side-title">{mod.title}</div>
        <ul>
          {mod.sections.map((s) => (
            <li key={s.file}><Link to={`/c/${slug}/m/${moduleId}/${s.file}`} className={s.file === current ? "active" : ""}>{s.title}</Link></li>
          ))}
        </ul>
        <div className="side-title muted">Modules</div>
        <ul>
          {course.modules.map((m) => (
            <li key={m.id}>
              {m.status === "ready" ? <Link to={`/c/${slug}/m/${m.id}`} className={m.id === moduleId ? "active" : ""}>{m.title}</Link> : <span className="muted dim">{m.title}</span>}
            </li>
          ))}
        </ul>
        <div className="side-foot"><Theme /></div>
      </nav>
      <main className="content">
        {doc ? (
          <article>
            <h1>{doc.frontmatter.title ?? mod.sections[i]?.title}</h1>
            <Markdown body={doc.body} />
            <footer className="article-foot">
              {next ? <Link to={`/c/${slug}/m/${moduleId}/${next.file}`} className="btn">Next: {next.title} →</Link> : <Link to={`/c/${slug}`} className="btn">Back to outline</Link>}
            </footer>
          </article>
        ) : null}
      </main>
    </div>
  );
}
