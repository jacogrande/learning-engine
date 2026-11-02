// Cards that left the queue or need a look: suspended (by hand or as leeches), flagged grades, and
// orphans whose question no longer exists in the course files.
import { post, useLive } from "./api";
import { Link, Shell } from "./App";

type Row = { course: string; courseTitle: string; question: string; doc: string; module: string | null; moduleTitle: string; sectionTitle: string; prompt: string | null; flag: string | null; reviews: number; lapses: number; leech: boolean; updatedAt: string };
type Lists = { suspended: Row[]; flagged: Row[]; orphaned: Row[] };

const sectionLink = (r: Row) => `/c/${r.course}/m/${r.module}/${r.doc.split("/").slice(2).join("/")}`;

export function CardsPage() {
  const { data: l, reload } = useLive<Lists>("/api/review/cards", ["card"]);
  const crumbs = [{ label: "Courses", to: "/" }, { label: "Review", to: "/review" }, { label: "Cards" }];
  if (!l) return <Shell crumbs={crumbs} className="page"><h1>Cards</h1></Shell>;
  const act = (r: Row, path: string, body: unknown) => post(`/api/review/cards/${r.course}/${r.question}/${path}`, body).then(reload);
  const where = (r: Row) => <span className="muted">{r.courseTitle} · {r.module ? <Link to={sectionLink(r)}>{r.sectionTitle}</Link> : r.sectionTitle} · {r.question}</span>;

  return (
    <Shell crumbs={crumbs} className="page">
      <h1>Cards</h1>
      <p className="meta">{l.suspended.length} suspended · {l.flagged.length} flagged · {l.orphaned.length} orphaned</p>

      <h2>Suspended</h2>
      {l.suspended.length ? (
        <ul className="card-rows">
          {l.suspended.map((r) => (
            <li key={`${r.course}:${r.question}`}>
              <p>{r.prompt ?? <span className="muted">Question no longer in the course</span>}</p>
              <div className="card-row-meta">{where(r)}<span className="muted">{r.leech ? `leech · ${r.lapses} lapses` : "suspended by you"} · {r.reviews} reviews</span>
                <button onClick={() => act(r, "suspend", { suspended: false })} title="Back into the queue, due now, with a fresh leech count">Unsuspend</button></div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">None. Cards you suspend, and cards that lapse six times, appear here.</p>}

      <h2>Flagged grades</h2>
      {l.flagged.length ? (
        <ul className="card-rows">
          {l.flagged.map((r) => (
            <li key={`${r.course}:${r.question}`}>
              <p>{r.prompt ?? <span className="muted">Question no longer in the course</span>}</p>
              <blockquote>{r.flag}</blockquote>
              <div className="card-row-meta">{where(r)}<span className="muted">The grader reads this note each time it grades this card.</span>
                <button onClick={() => act(r, "flag", { note: null })}>Clear flag</button></div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">None. Use “Flag grade” on a review card when a grade looks wrong.</p>}

      <h2>Orphaned</h2>
      {l.orphaned.length ? (
        <ul className="card-rows">
          {l.orphaned.map((r) => (
            <li key={`${r.course}:${r.question}`}>
              <p className="muted">{r.question} was in {r.doc}, which no longer has that question.</p>
              <div className="card-row-meta">{where(r)}<span className="muted">{r.reviews} reviews</span>
                <button onClick={() => { if (confirm(`Remove the card for ${r.question} and its review history?`)) act(r, "delete", {}); }}>Remove</button></div>
            </li>
          ))}
        </ul>
      ) : <p className="muted">None. A card becomes orphaned when regenerating a module drops its question; it comes back on its own if the question returns.</p>}

      <p className="actions"><Link to="/review" className="btn">← Review</Link><Link to="/review/stats" className="btn">Stats</Link></p>
    </Shell>
  );
}
