// The lesson view: section nav · article with selection menu and highlights · notes/chat pane.
// Two pseudo-pages live under a module: `test` (modules/<id>/quiz.md) and `wrap` (the wrap-up).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { post, put, del, useLive, useJobs, type Course, type Doc, type Answer, type Annotation } from "./api";
import { Markdown } from "./Markdown";
import { Quiz, QuizGrade, type QuizSpec } from "./Quiz";
import { Notes, type NotesHandle } from "./Notes";
import { ChatPane } from "./Chat";
import { Wrap } from "./Wrap";
import { describe, paint, type Quote } from "./selection";
import { Link, Shell } from "./App";

type Sel = Quote & { x: number; y: number };

export function Reader({ slug, moduleId, file }: { slug: string; moduleId: string; file?: string }) {
  const { data: course } = useLive<Course>(`/api/courses/${slug}`);
  const mod = course?.modules.find((m) => m.id === moduleId);
  const current = file ?? mod?.sections[0]?.file;
  const isWrap = current === "wrap", isTest = current === "test";
  const docFile = isTest ? "quiz.md" : isWrap ? null : current;
  const docPath = docFile ? `modules/${moduleId}/${docFile}` : null;
  const { data: doc } = useLive<Doc>(docPath && mod ? `/api/courses/${slug}/doc?path=${docPath}` : null);
  const { data: answers, reload: reloadAnswers } = useLive<Answer[]>(docPath ? `/api/courses/${slug}/answers?doc=${docPath}` : null, ["answer"]);
  const { data: annotations, reload: reloadAnnotations } = useLive<Annotation[]>(docPath ? `/api/courses/${slug}/annotations?doc=${docPath}` : null);
  const { data: progress } = useLive<{ read?: Record<string, string>; completedAt?: string }>(`/api/courses/${slug}/progress/${moduleId}`);
  const jobs = useJobs();

  const article = useRef<HTMLElement>(null);
  const notes = useRef<NotesHandle>(null);
  const [pane, setPane] = useState<"notes" | "chat">("notes");
  const [sel, setSel] = useState<Sel | null>(null);
  const [ask, setAsk] = useState<Quote | null>(null);          // drill-down guidance prompt
  const [chatDraft, setChatDraft] = useState<string | null>(null);

  useEffect(() => { window.scrollTo(0, 0); setSel(null); }, [current]);
  // Mark a section read when it is opened.
  useEffect(() => {
    if (!current || isWrap || isTest || !mod?.sections.some((s) => s.file === current) || progress?.read?.[current]) return;
    put(`/api/courses/${slug}/progress/${moduleId}`, { read: { ...(progress?.read ?? {}), [current]: new Date().toISOString() } });
  }, [current, progress]);

  // Selection menu: appears above any selection inside the article.
  useEffect(() => {
    const onUp = () => setTimeout(() => {
      const d = article.current && describe(article.current);
      setSel(d ? { quote: d.quote, prefix: d.prefix, suffix: d.suffix, x: d.rect.left + d.rect.width / 2, y: d.rect.top } : null);
    }, 0);
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".selmenu")) setSel(null); };
    document.addEventListener("mouseup", onUp); document.addEventListener("keyup", onUp); document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("mouseup", onUp); document.removeEventListener("keyup", onUp); document.removeEventListener("mousedown", onDown); };
  }, []);

  // Re-anchor saved highlights after every render of the article.
  useLayoutEffect(() => { if (article.current) paint(article.current, annotations ?? []); }, [doc, annotations]);

  const saved = Object.fromEntries((answers ?? []).map((a) => [a.question, a]));
  const submit = useCallback((spec: QuizSpec, answer: string, confidence: number) => {
    const result = spec.type === "mcq" ? (answer === String(spec.answer) ? "correct" : "wrong") : undefined;
    post(`/api/courses/${slug}/answers`, { question: spec.id, doc: docPath, answer, type: spec.type, result, confidence }).then(reloadAnswers);
  }, [slug, docPath, reloadAnswers]);

  if (!course || !mod || !current) return null;
  const sections = mod.sections, i = sections.findIndex((s) => s.file === current);
  const isSection = i >= 0;
  const prev = sections[i - 1], next = sections[i + 1];
  const extra = mod.extras.find((e) => e.file === current);
  const sourceTitle = extra && sections.find((s) => s.file === extra.section)?.title;
  const n = course.modules.findIndex((m) => m.id === moduleId);
  const here = `/c/${slug}/m/${moduleId}`;
  const title = isTest ? "Module test" : (doc?.frontmatter.title ?? sections[i]?.title ?? extra?.title ?? "");
  const testRunning = jobs.some((j) => j.course === slug && j.ref === `${moduleId}/test`);
  const afterSections = mod.test ? { to: `${here}/test`, label: "Module test" } : { to: `${here}/wrap`, label: "Wrap up" };
  const read = (f: string) => !!progress?.read?.[f];

  const act = (what: "note" | "drill" | "reading" | "chat") => {
    if (!sel || !docPath) return;
    const q: Quote = { quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix };
    if (what === "note") {
      post(`/api/courses/${slug}/annotations`, { doc: docPath, ...q }).then(reloadAnnotations);
      notes.current?.addQuote(q.quote, title); setPane("notes");
    }
    if (what === "reading") post(`/api/courses/${slug}/reading`, { doc: docPath, quote: q.quote });
    if (what === "drill") setAsk(q);
    if (what === "chat") { setChatDraft(q.quote); setPane("chat"); }
    setSel(null); getSelection()?.removeAllRanges();
  };

  // Test score, once every question has an answer.
  const testSpecs = isTest && doc ? [...doc.body.matchAll(/```quiz\n[\s\S]*?\nid:\s*(\S+)/g)].map((m) => m[1]) : [];
  const testDone = testSpecs.length > 0 && testSpecs.every((id) => saved[id]?.result);
  const tally = testSpecs.reduce((t, id) => { const r = saved[id]?.result; if (r) t[r] = (t[r] ?? 0) + 1; return t; }, {} as Record<string, number>);

  return (
    <Shell crumbs={[{ label: "Courses", to: "/" }, { label: course.title, to: `/c/${slug}` }, { label: mod.title }]} className="reader">
      <nav className="side">
        <div className="side-title">{mod.title}</div>
        <ul>
          {sections.map((s) => {
            const subs = mod.extras.filter((e) => e.section === s.file);
            return (
              <li key={s.file}>
                <Link to={`${here}/${s.file}`} className={`${s.file === current ? "active" : ""} ${read(s.file) ? "is-read" : ""}`}>{s.title}</Link>
                {subs.length > 0 && <ul className="side-extras">{subs.map((e) => <li key={e.file}><Link to={`${here}/${e.file}`} className={e.file === current ? "active" : ""}><span className="tag">{e.kind === "drilldown" ? "↓" : "≡"}</span>{e.title}</Link></li>)}</ul>}
              </li>
            );
          })}
        </ul>
        <div className="side-title muted">Finish</div>
        <ul className="side-steps">
          <li>{mod.test ? <Link to={`${here}/test`} className={isTest ? "active" : ""}>Module test</Link>
                        : <button className="link" disabled={testRunning} onClick={() => post(`/api/courses/${slug}/modules/${moduleId}/test`)}>{testRunning ? "Writing test…" : "Generate module test"}</button>}</li>
          <li><Link to={`${here}/wrap`} className={`${isWrap ? "active" : ""} ${progress?.completedAt ? "is-read" : ""}`}>{progress?.completedAt ? "Understanding" : "Wrap up"}</Link></li>
        </ul>
        <div className="side-title muted">Modules</div>
        <ol className="side-modules">
          {course.modules.map((m) => (
            <li key={m.id}>{m.status === "ready" ? <Link to={`/c/${slug}/m/${m.id}`} className={`${m.id === moduleId ? "active" : ""} ${m.understanding ? "is-read" : ""}`}>{m.title}</Link> : <span className="muted dim">{m.title}</span>}</li>
          ))}
        </ol>
      </nav>

      <main className="content">
        {isWrap ? <Wrap slug={slug} course={course} mod={mod} /> : doc && (
          <article ref={article}>
            <p className="kicker">
              {isSection ? `Module ${String(n + 1).padStart(2, "0")} · ${i + 1} of ${sections.length}`
               : isTest ? `Module ${String(n + 1).padStart(2, "0")} · test`
               : `${extra?.kind === "drilldown" ? "Drill-down" : "Reading"}${sourceTitle ? ` · from “${sourceTitle}”` : ""}`}
            </p>
            <h1>{title}</h1>
            {doc.frontmatter.quote && <blockquote className="source-quote">{doc.frontmatter.quote}</blockquote>}
            {isTest && testDone && (
              <div className="analysis">
                <div className="analysis-head"><span className="level">done</span><span className="muted">{["correct", "partial", "wrong"].filter((k) => tally[k]).map((k) => `${tally[k]} ${k}`).join(" · ")}</span></div>
                <p>Every question is answered. The wrap-up asks you to explain the module from memory, then discuss it.</p>
              </div>
            )}
            <QuizGrade value={{ saved, submit }}>
              <Markdown body={doc.body} />
            </QuizGrade>
            <footer className="article-foot">
              {isSection && prev ? <Link to={`${here}/${prev.file}`} className="btn">← {prev.title}</Link> : isTest && sections.at(-1) ? <Link to={`${here}/${sections.at(-1)!.file}`} className="btn">← {sections.at(-1)!.title}</Link> : <span />}
              {isSection ? (next ? <Link to={`${here}/${next.file}`} className="btn">{next.title} →</Link> : <Link to={afterSections.to} className="btn">{afterSections.label} →</Link>)
               : isTest ? <Link to={`${here}/wrap`} className="btn">Wrap up →</Link>
               : extra?.section ? <Link to={`${here}/${extra.section}`} className="btn">Back to “{sourceTitle}” →</Link> : null}
            </footer>
          </article>
        )}
        {sel && (
          <div className="selmenu" style={{ left: sel.x, top: sel.y }}>
            <button onClick={() => act("note")}>Note</button>
            <button onClick={() => act("drill")}>Drill down</button>
            <button onClick={() => act("reading")}>Reading</button>
            <button onClick={() => act("chat")}>Chat</button>
          </div>
        )}
        {ask && (
          <form className="selmenu ask" onSubmit={(e) => { e.preventDefault(); const g = (e.currentTarget.elements.namedItem("g") as HTMLInputElement).value; post(`/api/courses/${slug}/drilldown`, { doc: docPath, quote: ask.quote, guidance: g || undefined }); setAsk(null); }}>
            <blockquote>{ask.quote.slice(0, 140)}{ask.quote.length > 140 ? "…" : ""}</blockquote>
            <input name="g" autoFocus placeholder="What do you want to go deeper on? (optional)" />
            <div><button type="submit" className="primary">Drill down</button><button type="button" onClick={() => setAsk(null)}>Cancel</button></div>
          </form>
        )}
      </main>

      <aside className="pane">
        <div className="pane-tabs">
          <button aria-pressed={pane === "notes"} onClick={() => setPane("notes")}>Notes</button>
          <button aria-pressed={pane === "chat"} onClick={() => setPane("chat")}>Chat</button>
        </div>
        <div className="pane-body" hidden={pane !== "notes"}>
          {annotations && annotations.length > 0 && (
            <ul className="highlights">
              {annotations.map((a) => <li key={a.id}><span>{a.quote}</span><button className="link" title="Remove highlight" onClick={() => del(`/api/annotations/${a.id}`).then(reloadAnnotations)}>×</button></li>)}
            </ul>
          )}
          <Notes ref={notes} slug={slug} moduleId={moduleId} />
        </div>
        <div className="pane-body pane-chat" hidden={pane !== "chat"}>
          {docPath ? <ChatPane slug={slug} doc={docPath} draft={chatDraft} onDraftUsed={() => setChatDraft(null)} /> : <p className="muted">The wrap-up discussion is in the main column.</p>}
        </div>
      </aside>
    </Shell>
  );
}
