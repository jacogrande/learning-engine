// Review: due cards across every course (daily), or an ad hoc set (course, module, weak spots,
// burst, cram). One card at a time, graded like a lesson; a soft cap ends the daily session and
// "+10 more" continues. From the second review on, a card may be asked as a variant.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, put, useLive, type Answer, type Course } from "./api";
import { Quiz, QuizGrade, type QuizSpec } from "./Quiz";
import { Link, Shell, navigate } from "./App";

type Item = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; due: string; streak: number; state: string; reviews: number; sureWrong: boolean; variant: number | null; variantCount: number; original: QuizSpec; spec: QuizSpec };
type Summary = { dueCount: number; total: number; learned: number; suspended: number; seeded: number; streak: number; next: string | null };
type Session = { id: string; kind: string; scope: string | null; startedAt: string; endedAt: string | null; reviewed: number; correct: number; sureWrong: number };
type Mode = "daily" | "course" | "module" | "weak" | "burst" | "cram";
type Queue = { mode: Mode; scope: string | null; items: Item[]; dueCount: number; remaining: number; topped: number; next: string | null; summary: Summary; last: Session | null };
type CardStatus = { due: string; streak: number; state: string; reviews: number; last: { result: Answer["result"]; note: string | null; confidence: number | null; variant: number | null; review: string | null } | null };
type Saved = Answer & { due?: string };

const relTime = (iso: string | null) => {
  if (!iso) return "";
  const h = Math.round((+new Date(iso) - Date.now()) / 36e5);
  if (h < 1) return "now"; if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24); return d === 1 ? "tomorrow" : d < 30 ? `in ${d} days` : `in ${Math.round(d / 30)} months`;
};
const MODE_LABEL: Record<Mode, string> = { daily: "Due today", course: "Course", module: "Module", weak: "Weak spots", burst: "Burst", cram: "Cram" };

export function ReviewPage({ slug, mode: modeProp, scope: scopeProp }: { slug?: string; mode?: Mode; scope?: string }) {
  const mode: Mode = modeProp ?? "daily";
  const scope = scopeProp ?? slug;
  // The course this page is about, if any: what the header counts and the dummy-card buttons act on.
  const courseScope = slug ?? (mode === "daily" || mode === "course" ? scope : mode === "module" || mode === "cram" ? scope?.split("/")[0] : undefined);
  const { data: course } = useLive<Course>(slug ? `/api/courses/${slug}` : null);
  const { data: courses } = useLive<Course[]>("/api/courses");
  const [q, setQ] = useState<Queue | null>(null);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState<Record<string, Saved>>({});   // keyed by course:question — two courses may share question ids
  const [showOriginal, setShowOriginal] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const served = useRef<string[]>([]);
  const tally = useRef({ reviewed: 0, correct: 0, sureWrong: 0, pending: new Set<string>() });
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const load = useCallback(async (more = false) => {
    const params = new URLSearchParams({ mode });
    if (scope) params.set("scope", scope);
    if (more) { params.set("cap", "10"); params.set("exclude", served.current.join(",")); }
    const r = await get<Queue>(`/api/review?${params}`);
    served.current.push(...r.items.map((it) => `${it.course}:${it.question}`));
    setQ((prev) => (more && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
    if (!more) setI(0);
  }, [mode, scope]);
  const restart = useCallback(() => { for (const t of Object.values(timers.current)) clearInterval(t); timers.current = {}; served.current = []; tally.current = { reviewed: 0, correct: 0, sureWrong: 0, pending: new Set() }; sessionRef.current = null; setSession(null); setSaved({}); setQ(null); load(); }, [load]);
  useEffect(() => { restart(); }, [restart]);
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearInterval(t); }, []);
  useEffect(() => { setShowOriginal(false); }, [i]);

  // One session per visit; counts update as grades arrive.
  const ensureSession = async (): Promise<Session> => {
    if (sessionRef.current) return sessionRef.current;
    const s = await post<Session>("/api/review/sessions", { kind: mode, scope: scope ?? null });
    sessionRef.current = s; setSession(s); return s;
  };
  const syncSession = async (end = false) => { const s = await ensureSession(); const t = tally.current; put(`/api/review/sessions/${s.id}`, { reviewed: t.reviewed, correct: t.correct, sureWrong: t.sureWrong, end }); };

  const item = q?.items[i];
  const key = (it: Item) => `${it.course}:${it.question}`;

  const record = (it: Item, a: Saved) => {
    const t = tally.current;
    if (a.result && t.pending.has(key(it))) { t.pending.delete(key(it)); if (a.result === "correct") t.correct++; if (a.result === "wrong" && a.confidence === 3) t.sureWrong++; }
    setSaved((s) => ({ ...s, [key(it)]: a }));
    syncSession();
  };
  const submit = useCallback((spec: QuizSpec, answer: string, confidence: number) => {
    if (!item) return;
    const it = item, t = tally.current;
    t.reviewed++; t.pending.add(key(it));
    const result = spec.type === "mcq" ? (answer === String(spec.answer) ? "correct" : "wrong") : undefined;
    const pending: Saved = { question: spec.id, answer, result: result ?? null, note: null, job: null, confidence, gradedAt: null };
    setSaved((s) => ({ ...s, [key(it)]: pending }));
    post<{ review: { due: string } | null }>("/api/review/answer", { course: it.course, question: it.question, doc: it.doc, answer, type: spec.type, result, confidence, variant: it.variant }).then((r) => {
      if (r.review) return record(it, { ...pending, gradedAt: new Date().toISOString(), due: r.review.due });   // MCQ: rated at once
      // Short answers grade in a job; poll the card until a new log entry lands, bounded. On timeout the
      // card stays "grading" in the tally rather than being counted as answered with no result.
      let tries = 0;
      clearInterval(timers.current[key(it)]);
      timers.current[key(it)] = setInterval(() => get<CardStatus>(`/api/review/cards/${it.course}/${it.question}`).then((c) => {
        if (c.reviews > it.reviews && c.last) { clearInterval(timers.current[key(it)]); record(it, { ...pending, result: c.last.result, note: c.last.note, gradedAt: c.last.review, due: c.due }); }
        else if (++tries > 80) clearInterval(timers.current[key(it)]);
      }, () => { if (++tries > 80) clearInterval(timers.current[key(it)]); }), 1500);
    });
  }, [item]);

  const next = () => { if (i + 1 >= (q?.items.length ?? 0)) syncSession(true); setI(i + 1); };
  const suspend = async () => { if (!item) return; await post(`/api/review/cards/${item.course}/${item.question}/suspend`, { suspended: true }); next(); };
  const flag = async () => { if (!item) return; const note = prompt("What was wrong with the grade? The grader sees this next time."); if (note) await post(`/api/review/cards/${item.course}/${item.question}/flag`, { note }); };

  // Keyboard: 1/2/3 confidence · Enter = Check, then Next.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" && e.key !== "Enter") return;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type === "text") return;
      if (tag === "SELECT") return;
      if (/^[123]$/.test(e.key)) { (document.querySelector(`.quiz .confidence button:nth-child(${e.key})`) as HTMLButtonElement)?.click(); e.preventDefault(); }
      if (e.key === "Enter" && !e.shiftKey) {
        const check = document.querySelector(".quiz .quiz-actions > button") as HTMLButtonElement | null;
        const nextBtn = document.querySelector(".review-next") as HTMLButtonElement | null;
        if (check && !check.disabled) { check.click(); e.preventDefault(); } else if (nextBtn && !nextBtn.disabled) { nextBtn.click(); e.preventDefault(); }
      }
    };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  const crumbs = slug && course ? [{ label: "Courses", to: "/" }, { label: course.title, to: `/c/${slug}` }, { label: "Review" }] : [{ label: "Courses", to: "/" }, { label: "Review" }];
  if (!q) return <Shell crumbs={crumbs} className="page"><h1>Review</h1></Shell>;
  const s = q.summary;
  const head = (
    <p className="meta review-head">
      <span>{s.dueCount} due · {s.total} cards · {s.learned} learned{s.streak ? ` · ${s.streak}-day streak` : ""}{s.suspended ? ` · ${s.suspended} suspended` : ""}</span>
      <Link to="/review/stats">Stats</Link>
    </p>
  );
  const title = mode === "daily" ? "Review" : `Review · ${MODE_LABEL[mode]}`;

  // Finished, or nothing to do: summary and the ad hoc menu.
  if (!item) {
    const t = tally.current;
    return (
      <Shell crumbs={crumbs} className="page">
        <h1>{title}</h1>{head}
        {t.reviewed > 0 ? (
          <div className="analysis">
            <div className="analysis-head"><span className="level">done</span><span className="muted">{t.reviewed} reviewed · {t.correct} right{t.sureWrong ? ` · ${t.sureWrong} sure-and-wrong` : ""}{t.pending.size ? ` · ${t.pending.size} still grading` : ""}</span></div>
            <p>{mode === "daily" ? (q.remaining > 0 ? `${q.remaining} more due now.` : s.next ? `Nothing else due. Next ${relTime(s.next)}.` : "Nothing else scheduled.") : "Done with this set."}</p>
          </div>
        ) : (
          <p className="muted empty">{s.total === 0 ? "No cards yet. Answer questions in a lesson and they come back here on a schedule, or add dummy cards below." : mode === "daily" ? (s.next ? `Nothing due. Next ${relTime(s.next)}.` : "Nothing due.") : "Nothing in this set."}</p>
        )}
        <div className="actions">
          {mode === "daily" && q.remaining > 0 && <button className="primary" onClick={() => load(true)}>+10 more</button>}
          {mode !== "daily" && <Link to={slug ? `/c/${slug}/review` : "/review"} className="btn">Due today</Link>}
          {q.last && q.last.id !== session?.id && <span className="muted">Last session: {q.last.reviewed} reviewed, {q.last.correct} right · {new Date(q.last.startedAt).toLocaleDateString()}</span>}
        </div>
        <ModeMenu courses={courses ?? []} current={{ mode, scope: scope ?? null }} restart={restart} />
        <div className="actions">
          <button onClick={async () => { const r = await post<{ added: number }>("/api/review/seed", { course: courseScope }); if (r.added) restart(); else alert("Every question already has a card."); }} title={`One card per quiz question in ${courseScope ? "this course's" : "your"} modules, due now, so you can try review before answering lessons`}>Add dummy cards</button>
          {s.seeded > 0 && <button className="link" onClick={async () => { await post("/api/review/seed/clear", { course: courseScope }); restart(); }}>Remove {s.seeded} unreviewed dummy card{s.seeded === 1 ? "" : "s"}</button>}
          <Link to={slug ? `/c/${slug}` : "/"} className="btn">{slug ? "Outline" : "Courses"} →</Link>
        </div>
      </Shell>
    );
  }

  const answered = saved[key(item)];
  const graded = answered && (answered.result || answered.note);
  const due = answered?.due;
  const sectionLink = `/c/${item.course}/m/${item.module}/${item.doc.split("/").slice(2).join("/")}`;
  const tag = q.topped && i >= q.items.length - q.topped ? " · recent, not yet due" : item.reviews === 0 ? " · dummy" : "";
  return (
    <Shell crumbs={crumbs} className="page">
      <h1>{title}</h1>{head}
      <p className="meta review-kicker">
        <span>{i + 1} of {q.items.length}{tag}{item.variant !== null && <> · <span className="level">variant</span> <button className="link" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? "hide original" : "show original"}</button></>}</span>
        <span>{!slug && `${item.courseTitle} · `}<Link to={sectionLink}>{item.sectionTitle}</Link>{item.streak > 0 ? ` · ${item.streak} in a row` : ""}{item.sureWrong ? " · sure and wrong last time" : ""}</span>
      </p>
      {showOriginal && <blockquote className="source-quote">{item.original.prompt}</blockquote>}
      <QuizGrade value={{ saved: answered ? { [item.spec.id]: answered } : {}, submit }}>
        <Quiz key={`${key(item)}:${item.variant ?? "o"}`} spec={item.spec} />
      </QuizGrade>
      <div className="actions">
        <button className="primary review-next" disabled={!answered} onClick={next}>{i + 1 < q.items.length ? "Next →" : "Finish"}</button>
        {answered && !graded && <span className="muted">Grading… you can move on.</span>}
        {graded && due && <span className="muted">Next {relTime(due)}</span>}
        <span className="spacer" />
        {graded && <button className="link" onClick={flag}>Flag grade</button>}
        <button className="link" title="Stop asking this question" onClick={suspend}>Suspend</button>
      </div>
      <p className="meta keys">1 · 2 · 3 confidence &nbsp; Enter check / next</p>
    </Shell>
  );
}

// Ad hoc modes. Each starts a fresh set; grading and scheduling work as in the daily queue. Picking
// the mode already on screen (another burst, say) restarts it in place: navigating to the same URL is a no-op.
function ModeMenu({ courses, current, restart }: { courses: Course[]; current: { mode: Mode; scope: string | null }; restart: () => void }) {
  const [courseSel, setCourseSel] = useState(courses[0]?.slug ?? "");
  const [moduleSel, setModuleSel] = useState("");
  const mods = courses.find((c) => c.slug === (courseSel || courses[0]?.slug))?.modules.filter((m) => m.status === "ready") ?? [];
  const go = (mode: Mode, scope?: string) => {
    if (mode === current.mode && (scope ?? null) === current.scope) return restart();
    navigate(`/review?mode=${mode}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`);
  };
  return (
    <div className="modes">
      <h2>More practice</h2>
      <div className="mode-row">
        <button onClick={() => go("weak")}>Weak spots</button>
        <span className="muted">Lapsed in the last month, partial or unmet objectives, or recorded error patterns. Up to 20.</span>
      </div>
      <div className="mode-row">
        <button onClick={() => go("burst")}>Burst</button>
        <span className="muted">Ten random cards across every course.</span>
      </div>
      <div className="mode-row">
        <select value={courseSel || courses[0]?.slug} onChange={(e) => { setCourseSel(e.target.value); setModuleSel(""); }}>{courses.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}</select>
        <button onClick={() => go("course", courseSel || courses[0]?.slug)} disabled={!courses.length}>Whole course</button>
        <select value={moduleSel} onChange={(e) => setModuleSel(e.target.value)}><option value="">module…</option>{mods.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
        <button onClick={() => go("module", `${courseSel || courses[0]?.slug}/${moduleSel}`)} disabled={!moduleSel}>Module</button>
      </div>
    </div>
  );
}
