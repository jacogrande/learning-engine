// The lesson view: section nav · article with selection menu and highlights · notes/chat pane.
// Two pseudo-pages live under a module: `test` (modules/<id>/quiz.md) and `wrap` (the wrap-up).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { post, put, del, useLive, useJobs, type Course, type Doc, type Answer, type Annotation } from "./api";
import { Markdown } from "./Markdown";
import { Quiz, QuizGrade, type QuizSpec } from "./Quiz";
import { Notes, type NotesHandle } from "./Notes";
import { ChatPane } from "./Chat";
import { Wrap } from "./Wrap";
import { describe, paint, scrollToRange, type Quote } from "./selection";
import { Link, NotFound, Shell } from "./App";

type Sel = Quote & { x: number; y: number };

export function Reader({ slug, moduleId, file }: { slug: string; moduleId: string; file?: string }) {
  const { data: course, error: courseError } = useLive<Course>(`/api/courses/${slug}`);
  const { data: progress } = useLive<{ read?: Record<string, string>; completedAt?: string }>(`/api/courses/${slug}/progress/${moduleId}`, ["progress"]);
  const mod = course?.modules.find((m) => m.id === moduleId);
  // No section in the URL: the first one not yet read (the first, once all are), after progress loads.
  const current = file ?? (progress ? (mod?.sections.find((s) => !progress.read?.[s.file]) ?? mod?.sections[0])?.file : undefined);
  const isWrap = current === "wrap", isTest = current === "test";
  const docFile = isTest ? "quiz.md" : isWrap ? null : current;
  const docPath = docFile ? `modules/${moduleId}/${docFile}` : null;
  const { data: doc, error: docError } = useLive<Doc>(docPath && mod ? `/api/courses/${slug}/doc?path=${docPath}` : null);
  const { data: answers, reload: reloadAnswers } = useLive<Answer[]>(docPath ? `/api/courses/${slug}/answers?doc=${docPath}` : null, ["answer"]);
  const { data: annotations, reload: reloadAnnotations } = useLive<Annotation[]>(docPath ? `/api/courses/${slug}/annotations?doc=${docPath}` : null);
  const jobs = useJobs();

  const article = useRef<HTMLElement>(null);
  const notes = useRef<NotesHandle>(null);
  const [pane, setPane] = useState<"notes" | "chat">("notes");
  const [sel, setSel] = useState<Sel | null>(null);
  const [ask, setAsk] = useState<Quote | null>(null);          // drill-down guidance prompt
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, Range>>({});      // highlights that still match the text
  const [drawer, setDrawer] = useState<"nav" | "pane" | null>(null);   // narrow screens: which column is open as a drawer
  // Pane width: drag its left edge; remembered per browser.
  const [paneW, setPaneW] = useState<number | null>(() => { try { return Number(localStorage.getItem("paneWidth")) || null; } catch { return null; } });
  const [resizing, setResizing] = useState(false);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pane = (e.currentTarget.parentElement as HTMLElement), startX = e.clientX, startW = pane.offsetWidth;
    setResizing(true);
    const move = (ev: PointerEvent) => setPaneW(Math.min(760, Math.max(320, startW + (startX - ev.clientX))));
    const up = () => { setResizing(false); removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  useEffect(() => { if (paneW) try { localStorage.setItem("paneWidth", String(paneW)); } catch {} }, [paneW]);

  // ?chat=<id> (from the notebook): open that chat in the pane.
  const openChat = new URLSearchParams(location.search).get("chat");
  useEffect(() => { window.scrollTo(0, 0); setSel(null); setDrawer(null); if (openChat) { setPane("chat"); setDrawer("pane"); } }, [current, openChat]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);
  // Opened without a section: pin the chosen one into the URL first. Otherwise marking it read would
  // make the next one "first unread", and so on down the module.
  useEffect(() => {
    if (file || !current || !mod?.sections.some((s) => s.file === current)) return;
    history.replaceState(null, "", `/c/${slug}/m/${moduleId}/${current}${location.search}${location.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, [file, current]);
  // Mark a section read when it is opened (by its URL).
  useEffect(() => {
    if (!file || !progress || !current || isWrap || isTest || !mod?.sections.some((s) => s.file === current) || progress.read?.[current]) return;
    put(`/api/courses/${slug}/progress/${moduleId}`, { read: { [current]: new Date().toISOString() } });   // the server merges `read`
  }, [file, current, progress]);

  // Selection menu: appears above any selection inside the article. Touch screens select by long
  // press, which fires no mouseup, so there the menu follows selectionchange instead.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const d = article.current && describe(article.current);
      setSel(d ? { quote: d.quote, prefix: d.prefix, suffix: d.suffix, x: d.rect.left + d.rect.width / 2, y: d.rect.top } : null);
    };
    const onUp = () => setTimeout(show, 0);
    const onChange = () => { clearTimeout(t); t = setTimeout(show, 400); };
    const touch = matchMedia("(pointer: coarse)").matches;
    const onDown = (e: Event) => { if (!(e.target as HTMLElement).closest(".selmenu")) setSel(null); };
    document.addEventListener("mouseup", onUp); document.addEventListener("keyup", onUp); document.addEventListener("pointerdown", onDown);
    if (touch) document.addEventListener("selectionchange", onChange);
    return () => { clearTimeout(t); document.removeEventListener("mouseup", onUp); document.removeEventListener("keyup", onUp); document.removeEventListener("pointerdown", onDown); document.removeEventListener("selectionchange", onChange); };
  }, []);

  // Re-anchor saved highlights after every render of the article; then honour a #hl-<id> link once.
  const jumped = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!article.current || !annotations) return;
    const f = paint(article.current, annotations);
    setFound(f);
    const want = /^#hl-(.+)$/.exec(location.hash)?.[1];
    if (want && f[want] && jumped.current !== `${current}#${want}`) { jumped.current = `${current}#${want}`; requestAnimationFrame(() => scrollToRange(f[want])); }
  }, [doc, annotations]);

  const saved = Object.fromEntries((answers ?? []).map((a) => [a.question, a]));
  const submit = useCallback((spec: QuizSpec, answer: string, confidence: number) => {
    const result = spec.type === "mcq" ? (answer === String(spec.answer) ? "correct" : "wrong") : undefined;
    post(`/api/courses/${slug}/answers`, { question: spec.id, doc: docPath, answer, type: spec.type, result, confidence }).then(reloadAnswers);
  }, [slug, docPath, reloadAnswers]);

  const crumbs = [{ label: "Courses", to: "/" }, { label: course?.title ?? slug, to: `/c/${slug}` }];
  if (courseError) return <NotFound crumbs={[{ label: "Courses", to: "/" }]} what="course" />;
  if (course && !mod) return <NotFound crumbs={crumbs} what="module" />;
  if (course && mod && progress && !current) return <NotFound crumbs={crumbs} what="section" />;   // a module with no sections yet
  if (!course || !mod || !current) return null;
  const sections = mod.sections, i = sections.findIndex((s) => s.file === current);
  const isSection = i >= 0;
  const prev = sections[i - 1], next = sections[i + 1];
  const extra = mod.extras.find((e) => e.file === current);
  // Extras whose `section` names nothing in the sidebar still need a home there.
  const loose = mod.extras.filter((e) => e.section !== "quiz.md" && !sections.some((s) => s.file === e.section));
  const fromTest = mod.extras.filter((e) => e.section === "quiz.md");
  const unknownFile = !isWrap && !isTest && !isSection && !extra;
  const sourceTitle = extra && (extra.section === "quiz.md" ? "Module test" : sections.find((s) => s.file === extra.section)?.title);
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
      notes.current?.addQuote(q.quote, title, `${here}/${current}`); setPane("notes"); setDrawer("pane");
    }
    if (what === "reading") post(`/api/courses/${slug}/reading`, { doc: docPath, quote: q.quote });
    if (what === "drill") setAsk(q);
    if (what === "chat") { setChatDraft(q.quote); setPane("chat"); setDrawer("pane"); }
    setSel(null); getSelection()?.removeAllRanges();
  };

  // Test score, once every question has an answer.
  const testSpecs = isTest && doc ? [...doc.body.matchAll(/```quiz\n([\s\S]*?)```/g)].map((m) => /^id:\s*(\S+)/m.exec(m[1])?.[1]).filter((x): x is string => !!x) : [];
  const testDone = testSpecs.length > 0 && testSpecs.every((id) => saved[id]?.result);
  const tally = testSpecs.reduce((t, id) => { const r = saved[id]?.result; if (r) t[r] = (t[r] ?? 0) + 1; return t; }, {} as Record<string, number>);

  return (
    <Shell crumbs={[...crumbs, { label: mod.title }]} className={`reader ${drawer ? `drawer-${drawer}` : ""}`}>
      <nav className="side" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setDrawer(null); }}>
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
        {loose.length > 0 && <>
          <div className="side-title muted">More from this module</div>
          <ul className="side-extras side-loose">{loose.map((e) => <li key={e.file}><Link to={`${here}/${e.file}`} className={e.file === current ? "active" : ""}><span className="tag">{e.kind === "drilldown" ? "↓" : "≡"}</span>{e.title}</Link></li>)}</ul>
        </>}
        <div className="side-title muted">Finish</div>
        <ul className="side-steps">
          <li>{mod.test ? <Link to={`${here}/test`} className={isTest ? "active" : ""}>Module test</Link>
                        : <button className="link" disabled={testRunning} onClick={() => post(`/api/courses/${slug}/modules/${moduleId}/test`)}>{testRunning ? "Writing test…" : "Generate module test"}</button>}
            {fromTest.length > 0 && <ul className="side-extras">{fromTest.map((e) => <li key={e.file}><Link to={`${here}/${e.file}`} className={e.file === current ? "active" : ""}><span className="tag">{e.kind === "drilldown" ? "↓" : "≡"}</span>{e.title}</Link></li>)}</ul>}</li>
          <li><Link to={`${here}/wrap`} className={`${isWrap ? "active" : ""} ${progress?.completedAt ? "is-read" : ""}`}>{progress?.completedAt ? "Understanding" : "Wrap up"}</Link></li>
          <li><Link to={`/c/${slug}/notebook`}>Course notebook</Link></li>
        </ul>
        <div className="side-title muted">Modules</div>
        <ol className="side-modules">
          {course.modules.map((m) => (
            <li key={m.id}>{m.status === "ready" ? <Link to={`/c/${slug}/m/${m.id}`} className={`${m.id === moduleId ? "active" : ""} ${m.understanding ? "is-read" : ""}`}>{m.title}</Link> : <span className="muted dim">{m.title}</span>}</li>
          ))}
        </ol>
      </nav>

      <main className="content">
        <div className="reader-tools">
          <button className="nav-toggle" onClick={() => setDrawer("nav")}>Contents</button>
          <span className="spacer" />
          <button onClick={() => { setPane("notes"); setDrawer("pane"); }}>Notes</button>
          <button onClick={() => { setPane("chat"); setDrawer("pane"); }}>Chat</button>
        </div>
        {(unknownFile || docError) && !isWrap ? (
          <article><h1>Not found</h1><p className="muted">This page is no longer in the module. It may have been renamed when the module was regenerated. <Link to={here}>Open the module →</Link></p></article>
        ) : isWrap ? <Wrap slug={slug} course={course} mod={mod} /> : doc && (
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
              {isSection ? (next ? <Link to={`${here}/${next.file}`} className="btn primary">{next.title} →</Link> : <Link to={afterSections.to} className="btn primary">{afterSections.label} →</Link>)
               : isTest ? <Link to={`${here}/wrap`} className="btn primary">Wrap up →</Link>
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

      <div className="scrim" onClick={() => setDrawer(null)} />
      <aside className={`pane ${resizing ? "is-resizing" : ""}`} style={paneW ? { width: paneW } : undefined}>
        <div className="pane-resizer" onPointerDown={startResize} title="Drag to resize" />
        <div className="pane-tabs">
          <button aria-pressed={pane === "notes"} onClick={() => setPane("notes")}>Notes</button>
          <button aria-pressed={pane === "chat"} onClick={() => setPane("chat")}>Chat</button>
          <button className="pane-close" aria-label="Close" onClick={() => setDrawer(null)}>×</button>
        </div>
        <div className="pane-body" hidden={pane !== "notes"}>
          {annotations && annotations.length > 0 && <>
            <div className="pane-label">Highlights in this section</div>
            <ul className="highlights">
              {annotations.map((a) => (
                <li key={a.id} className={found[a.id] ? "" : "is-lost"}>
                  {found[a.id] ? <button className="link hl-jump" title="Show in the text" onClick={() => { scrollToRange(found[a.id]); setDrawer(null); }}>{a.quote}</button>
                               : <span title="This passage is no longer in the section">{a.quote}<small className="muted"> · no longer in the text</small></span>}
                  <button className="link" title="Remove highlight (your notes keep the quote)" onClick={() => del(`/api/annotations/${a.id}`).then(reloadAnnotations)}>×</button>
                </li>
              ))}
            </ul>
          </>}
          <div className="pane-label">Notes for this module</div>
          <Notes ref={notes} slug={slug} moduleId={moduleId} />
        </div>
        <div className="pane-body pane-chat" hidden={pane !== "chat"}>
          {docPath ? <ChatPane key={docPath} slug={slug} doc={docPath} draft={chatDraft} onDraftUsed={() => setChatDraft(null)} open={openChat} /> : <p className="muted">The wrap-up discussion is in the main column.</p>}
        </div>
      </aside>
    </Shell>
  );
}
