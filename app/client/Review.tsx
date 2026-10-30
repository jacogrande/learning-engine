// Daily review: due cards across every course, interleaved, one at a time, graded like a lesson.
// A soft cap ends the session; "+10 more" continues. Per-course review is the same page, scoped.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, put, useLive, type Answer, type Course } from "./api";
import { Quiz, QuizGrade, type QuizSpec } from "./Quiz";
import { Link, Shell } from "./App";

type Item = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; due: string; streak: number; state: string; reviews: number; sureWrong: boolean; spec: QuizSpec };
type Summary = { dueCount: number; total: number; learned: number; suspended: number; seeded: number; streak: number; next: string | null };
type Session = { id: string; kind: string; scope: string | null; startedAt: string; endedAt: string | null; reviewed: number; correct: number; sureWrong: number };
type Queue = { items: Item[]; dueCount: number; remaining: number; topped: number; next: string | null; summary: Summary; last: Session | null };

const relTime = (iso: string | null) => {
  if (!iso) return "";
  const h = Math.round((+new Date(iso) - Date.now()) / 36e5);
  if (h < 1) return "now"; if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24); return d === 1 ? "tomorrow" : d < 30 ? `in ${d} days` : `in ${Math.round(d / 30)} months`;
};

export function ReviewPage({ slug }: { slug?: string }) {
  const { data: course } = useLive<Course>(slug ? `/api/courses/${slug}` : null);
  const [q, setQ] = useState<Queue | null>(null);
  const [i, setI] = useState(0);
  const [saved, setSaved] = useState<Record<string, Answer>>({});
  const [session, setSession] = useState<Session | null>(null);
  const served = useRef<string[]>([]);
  const tally = useRef({ reviewed: 0, correct: 0, sureWrong: 0, pending: new Set<string>() });
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const load = useCallback(async (more = false) => {
    const params = new URLSearchParams();
    if (slug) params.set("course", slug);
    if (more) { params.set("cap", "10"); params.set("exclude", served.current.join(",")); }
    const r = await get<Queue>(`/api/review?${params}`);
    served.current.push(...r.items.map((it) => `${it.course}:${it.question}`));
    setQ((prev) => (more && prev ? { ...r, items: [...prev.items, ...r.items] } : r));
    if (!more) setI(0);
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearInterval(t); }, []);

  // One session per visit; counts update as grades arrive.
  const sessionRef = useRef<Session | null>(null);
  const ensureSession = async (): Promise<Session> => {
    if (sessionRef.current) return sessionRef.current;
    const s = await post<Session>("/api/review/sessions", { kind: slug ? "course" : "daily", scope: slug ?? null });
    sessionRef.current = s; setSession(s); return s;
  };
  const syncSession = async (end = false) => { const s = await ensureSession(); const t = tally.current; put(`/api/review/sessions/${s.id}`, { reviewed: t.reviewed, correct: t.correct, sureWrong: t.sureWrong, end }); };

  const item = q?.items[i];
  const key = (it: Item) => `${it.course}:${it.question}`;

  const record = (it: Item, a: Answer) => {
    const t = tally.current;
    if (a.result && t.pending.has(key(it))) { t.pending.delete(key(it)); if (a.result === "correct") t.correct++; if (a.result === "wrong" && a.confidence === 3) t.sureWrong++; }
    setSaved((s) => ({ ...s, [it.question]: a }));
    syncSession();
  };
  const submit = useCallback((spec: QuizSpec, answer: string, confidence: number) => {
    if (!item) return;
    const it = item, t = tally.current;
    t.reviewed++; t.pending.add(key(it));
    const result = spec.type === "mcq" ? (answer === String(spec.answer) ? "correct" : "wrong") : undefined;
    setSaved((s) => ({ ...s, [spec.id]: { question: spec.id, answer, result: result ?? null, note: null, job: null, confidence, gradedAt: null } }));
    post(`/api/courses/${it.course}/answers`, { question: spec.id, doc: it.doc, answer, type: spec.type, result, confidence }).then(() => {
      // Grading is async for short answers; poll this doc until the note (and the new due date) lands, bounded.
      let tries = 0;
      clearInterval(timers.current[key(it)]);
      timers.current[key(it)] = setInterval(() => get<(Answer & { due?: string })[]>(`/api/courses/${it.course}/answers?doc=${it.doc}`).then((as) => {
        const a = as.find((x) => x.question === it.question);
        const done = a && (spec.type === "mcq" ? !!a.due : !!a.note);
        if (done || ++tries > 80) { clearInterval(timers.current[key(it)]); if (a) record(it, a); }
      }), spec.type === "mcq" ? 300 : 1500);
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
  const head = <p className="meta">{s.dueCount} due · {s.total} cards · {s.learned} learned{s.streak ? ` · ${s.streak}-day streak` : ""}{s.suspended ? ` · ${s.suspended} suspended` : ""}</p>;

  // Finished, or nothing to do.
  if (!item) {
    const t = tally.current;
    return (
      <Shell crumbs={crumbs} className="page">
        <h1>Review</h1>{head}
        {t.reviewed > 0 ? (
          <div className="analysis">
            <div className="analysis-head"><span className="level">done</span><span className="muted">{t.reviewed} reviewed · {t.correct} right{t.sureWrong ? ` · ${t.sureWrong} sure-and-wrong` : ""}{t.pending.size ? ` · ${t.pending.size} still grading` : ""}</span></div>
            <p>{q.remaining > 0 ? `${q.remaining} more due now.` : s.next ? `Nothing else due. Next ${relTime(s.next)}.` : "Nothing else scheduled."}</p>
          </div>
        ) : (
          <p className="muted empty">{s.total === 0 ? "No cards yet. Answer questions in a lesson and they come back here on a schedule." : s.next ? `Nothing due. Next ${relTime(s.next)}.` : "Nothing due."}</p>
        )}
        <div className="actions">
          {q.remaining > 0 && <button className="primary" onClick={() => load(true)}>+10 more</button>}
          <button onClick={async () => { served.current = []; const r = await post<{ added: number }>("/api/review/seed", { course: slug }); if (r.added) load(); else alert("Every question already has a card."); }} title="One card per quiz question in your modules, due now, so you can try review before answering lessons">
            Add dummy cards
          </button>
          {s.seeded > 0 && <button className="link" onClick={async () => { await post("/api/review/seed/clear", { course: slug }); served.current = []; load(); }}>Remove {s.seeded} unreviewed dummy card{s.seeded === 1 ? "" : "s"}</button>}
          {q.last && q.last.id !== session?.id && <span className="muted">Last session: {q.last.reviewed} reviewed, {q.last.correct} right · {new Date(q.last.startedAt).toLocaleDateString()}</span>}
          <Link to={slug ? `/c/${slug}` : "/"} className="btn">{slug ? "Outline" : "Courses"} →</Link>
        </div>
      </Shell>
    );
  }

  const answered = saved[item.spec.id];
  const graded = answered && (answered.result || answered.note);
  const due = (answered as Answer & { due?: string } | undefined)?.due;
  const sectionLink = `/c/${item.course}/m/${item.module}/${item.doc.split("/").slice(2).join("/")}`;
  return (
    <Shell crumbs={crumbs} className="page">
      <h1>Review</h1>{head}
      <p className="meta review-kicker">
        <span>{i + 1} of {q.items.length}{q.topped && i >= q.items.length - q.topped ? " · recent, not yet due" : item.reviews === 0 ? " · dummy" : ""}</span>
        <span>{!slug && `${item.courseTitle} · `}<Link to={sectionLink}>{item.sectionTitle}</Link>{item.streak > 0 ? ` · ${item.streak} in a row` : ""}{item.sureWrong ? " · sure and wrong last time" : ""}</span>
      </p>
      <QuizGrade value={{ saved, submit }}>
        <Quiz key={item.question} spec={item.spec} />
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
