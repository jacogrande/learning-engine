// Review history: a year of daily reviews as a calendar, every session, and one session's answers
// with their grades. Grades that landed after the learner left the review show up here.
import { useState } from "react";
import { Markdown } from "./Markdown";
import { useLive, type Result } from "./api";
import { Link, Shell } from "./App";

type Tally = Partial<Record<Result, number>>;
type SessionRow = { id: string; kind: string; scope: string | null; startedAt: string; endedAt: string | null; reviewed: number; day: string; tally: Tally; graded: number; pending: number };
type HistoryData = { streak: number; today: string; days: Record<string, { reviewed: number; correct: number }>; sessions: SessionRow[] };
type Item = { course: string; question: string; courseTitle: string; where: string; to: string; prompt: string; type: "mcq" | "short" | "code"; answer: string; correct: string | null; result: Result | null; note: string | null; confidence: number | null; at: string; variant: number | null };
type Detail = SessionRow & { items: Item[] };

const KIND: Record<string, string> = { daily: "Daily review", course: "Course", module: "Module", weak: "Weak spots", burst: "Burst", cram: "Cram" };
const CONFIDENCE = ["Guessing", "Fairly sure", "Sure"];
const WEEKS = 52;

// `YYYY-MM-DD` as a local date, and back.
const parse = (k: string) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const longDay = (k: string) => parse(k).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: parse(k).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const level = (n: number) => (n === 0 ? 0 : n < 4 ? 1 : n < 8 ? 2 : n < 15 ? 3 : 4);
const tallyText = (t: Tally) => (["correct", "partial", "wrong"] as const).filter((k) => t[k]).map((k) => `${t[k]} ${k === "correct" ? "right" : k}`).join(" · ");

export function History({ course }: { course?: string }) {
  const { data: h } = useLive<HistoryData>(`/api/review/history${course ? `?course=${encodeURIComponent(course)}` : ""}`, ["card"]);
  const [day, setDay] = useState<string | null>(null);
  if (!h) return null;
  const sessions = day ? h.sessions.filter((s) => s.day === day) : h.sessions;
  const active = Object.values(h.days).filter((d) => d.reviewed).length;
  return (
    <section className="history" aria-label="Review history">
      <h2>History</h2>
      <p className="meta">{h.streak ? `${h.streak}-day streak` : "No current streak"} · reviewed on {active} {active === 1 ? "day" : "days"} in the last year</p>
      <Calendar h={h} day={day} setDay={setDay} />
      {h.sessions.length === 0 ? <p className="muted">No sessions yet. Each review you finish appears here with its answers and grades.</p> : (
        <>
          {day && <p className="meta">{longDay(day)} · <button className="link" onClick={() => setDay(null)}>show every day</button></p>}
          {sessions.length === 0 ? <p className="muted">No session on {longDay(day!)}.</p> : (
            <ul className="history-list">
              {sessions.slice(0, day ? undefined : 30).map((s) => (
                <li key={s.id}>
                  <Link to={`/review/history/${s.id}`}>
                    <span className="history-day">{longDay(s.day)}</span>
                    <span className="history-kind">{KIND[s.kind] ?? s.kind}</span>
                    <span className="muted">{s.reviewed} reviewed{tallyText(s.tally) ? ` · ${tallyText(s.tally)}` : ""}{s.pending ? ` · ${s.pending} not graded` : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// A year of days, one column per week (Sunday on top), shaded by how many cards were reviewed.
function Calendar({ h, day, setDay }: { h: HistoryData; day: string | null; setDay: (d: string | null) => void }) {
  const today = parse(h.today);
  const start = new Date(today); start.setDate(start.getDate() - today.getDay() - 7 * (WEEKS - 1));
  const weeks: Date[][] = [];
  for (let w = 0; w < WEEKS; w++) weeks.push(Array.from({ length: 7 }, (_, d) => { const x = new Date(start); x.setDate(start.getDate() + 7 * w + d); return x; }));
  const withSessions = new Set(h.sessions.map((s) => s.day));
  return (
    <div className="cal-wrap" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
      <div className="cal" role="grid" aria-label="Reviews per day, last year">
        <div className="cal-months" aria-hidden="true">
          {weeks.map((w, i) => <span key={i}>{w[0].getDate() <= 7 ? w[0].toLocaleDateString(undefined, { month: "short" }) : ""}</span>)}
        </div>
        <div className="cal-body">
          <div className="cal-wd" aria-hidden="true"><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
          {weeks.map((w, i) => (
            <div key={i} className="cal-week" role="row">
              {w.map((d) => {
                const k = keyOf(d), r = h.days[k], future = d > today;
                const label = `${longDay(k)}: ${r ? `${r.reviewed} reviewed, ${r.correct} right` : "no review"}`;
                return future ? <span key={k} className="cal-day is-future" /> : (
                  <button key={k} role="gridcell" className={`cal-day l${level(r?.reviewed ?? 0)} ${k === h.today ? "is-today" : ""} ${k === day ? "is-picked" : ""}`}
                    title={label} aria-label={label} aria-pressed={k === day} disabled={!withSessions.has(k)} onClick={() => setDay(k === day ? null : k)} />
                );
              })}
            </div>
          ))}
        </div>
        <div className="cal-legend" aria-hidden="true">Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`cal-day l${l}`} />)} More</div>
      </div>
    </div>
  );
}

export function SessionPage({ id }: { id: string }) {
  const { data: s, error } = useLive<Detail>(`/api/review/sessions/${id}`, ["card"]);
  const crumbs = [{ label: "Courses", to: "/" }, { label: "Review", to: "/review" }, { label: s ? longDay(s.day) : "Session" }];
  if (error) return <Shell crumbs={crumbs} className="page"><h1>Session not found</h1><p className="muted"><Link to="/review">Back to review →</Link></p></Shell>;
  if (!s) return <Shell crumbs={crumbs} className="page"><h1>Session</h1></Shell>;
  const time = new Date(s.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <Shell crumbs={crumbs} className="page">
      <h1>{KIND[s.kind] ?? s.kind}, {longDay(s.day)}</h1>
      <p className="meta">Started {time} · {s.reviewed} reviewed{tallyText(s.tally) ? ` · ${tallyText(s.tally)}` : ""}</p>
      {s.pending > 0 && <p className="muted">{s.pending} {s.pending === 1 ? "answer has" : "answers have"} no grade. A grade still running appears here when it lands; one that failed is not recorded, and the card comes back in a later review.</p>}
      {s.items.map((it, i) => (
        <div key={i} className={`quiz quiz-review is-${it.result ?? "pending"}`}>
          <p className="meta history-where">
            <span>{i + 1} · <Link to={it.to}>{it.where}</Link>{it.variant !== null ? " · variant" : ""}</span>
            <span className="quiz-status">{it.result ?? "grading"}</span>
          </p>
          <div className="quiz-prompt quiz-prompt-block"><Markdown body={it.prompt} /></div>
          {it.type === "code" && it.answer ? <pre className="quiz-code"><code>{it.answer}</code></pre>
            : <blockquote className="quiz-answer">{it.answer || <span className="muted">No answer</span>}</blockquote>}
          {it.confidence ? <p className="quiz-remark muted">{CONFIDENCE[it.confidence - 1]}</p> : null}
          {it.correct && it.result !== "correct" && <p className="quiz-explain">Answer: {it.correct}</p>}
          {it.note && <div className="quiz-explain"><Markdown body={it.note} /></div>}
        </div>
      ))}
      <div className="actions"><Link to="/review" className="btn">← Review</Link></div>
    </Shell>
  );
}
