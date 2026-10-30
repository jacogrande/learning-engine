// Review stats: cards by state, reviews per day, retention by week, scheduler settings.
import { useState } from "react";
import { post, put, useLive } from "./api";
import { Link, Shell } from "./App";

type Stats = {
  byState: Record<string, number>; total: number;
  days: { day: string; reviews: number; good: number }[];
  weeks: { week: string; reviews: number; good: number; retention: number | null }[];
  sessions: { n: number; reviewed: number };
  settings: { retention: number; dailyCap: number; weights: number[] | null; optimizedAt: string | null };
  streak: number;
};

export function StatsPage() {
  const { data: s, reload } = useLive<Stats>("/api/review/stats");
  const [msg, setMsg] = useState<string | null>(null);
  if (!s) return <Shell crumbs={[{ label: "Courses", to: "/" }, { label: "Review", to: "/review" }, { label: "Stats" }]} className="page"><h1>Stats</h1></Shell>;
  const maxDay = Math.max(1, ...s.days.map((d) => d.reviews));
  const states = ["new", "learning", "review", "learned", "suspended", "orphaned"];
  return (
    <Shell crumbs={[{ label: "Courses", to: "/" }, { label: "Review", to: "/review" }, { label: "Stats" }]} className="page">
      <h1>Stats</h1>
      <p className="meta">{s.total} cards · {s.sessions.n} sessions · {s.sessions.reviewed} reviews{s.streak ? ` · ${s.streak}-day streak` : ""}</p>

      <h2>Cards</h2>
      <ul className="stat-rows">
        {states.filter((k) => s.byState[k]).map((k) => (
          <li key={k}><span className="stat-label">{k}</span><span className="stat-bar"><i style={{ width: `${(100 * s.byState[k]) / s.total}%` }} /></span><span className="stat-n">{s.byState[k]}</span></li>
        ))}
      </ul>

      <h2>Reviews, last 30 days</h2>
      <div className="spark">
        {s.days.map((d) => <span key={d.day} title={`${d.day}: ${d.reviews} reviews, ${d.good} good`} style={{ height: `${(100 * d.reviews) / maxDay}%` }} className={d.reviews ? "" : "zero"} />)}
      </div>
      <p className="meta">{s.days.reduce((n, d) => n + d.reviews, 0)} reviews in 30 days</p>

      <h2>Retention by week</h2>
      {s.weeks.length ? (
        <ul className="stat-rows">
          {s.weeks.map((w) => <li key={w.week}><span className="stat-label">{w.week}</span><span className="stat-bar"><i style={{ width: `${w.retention ?? 0}%` }} /></span><span className="stat-n">{w.retention != null ? `${w.retention}%` : "–"} · {w.reviews}</span></li>)}
        </ul>
      ) : <p className="muted">No reviews yet.</p>}

      <h2>Scheduler</h2>
      <div className="settings">
        <label>Target retention
          <select value={String(s.settings.retention)} onChange={async (e) => { await put("/api/review/settings", { retention: Number(e.target.value) }); reload(); }}>
            {[0.85, 0.88, 0.9, 0.92, 0.95].map((r) => <option key={r} value={String(r)}>{Math.round(r * 100)}%{r === 0.9 ? " (default)" : ""}</option>)}
          </select>
          <small className="muted">Lower means fewer reviews and more forgetting. Changing it reschedules every card.</small>
        </label>
        <label>Daily cap
          <select value={String(s.settings.dailyCap)} onChange={async (e) => { await put("/api/review/settings", { dailyCap: Number(e.target.value) }); reload(); }}>
            {[10, 15, 20, 30, 50].map((n) => <option key={n} value={String(n)}>{n}</option>)}
          </select>
        </label>
        <div>
          <button onClick={async () => { setMsg("Fitting…"); try { const r = await post<{ ok: boolean; message: string }>("/api/review/optimize"); setMsg(r.message); } catch (e) { setMsg(`Optimizer failed (${String(e)}). See the server log.`); } reload(); }}>Fit weights to my reviews</button>
          <small className="muted">{s.settings.weights ? `Fitted ${new Date(s.settings.optimizedAt!).toLocaleDateString()}.` : "Using default FSRS weights."} Needs about 400 reviews.</small>
          {msg && <p className="muted">{msg}</p>}
        </div>
      </div>
      <p className="actions"><Link to="/review" className="btn">← Review</Link></p>
    </Shell>
  );
}
