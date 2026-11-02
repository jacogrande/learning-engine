// Everything the learner wrote or kept in one course, in one place: module notes, highlights,
// section chats, and the wrap-up (explanation, discussion, understanding). Searchable.
import { useState } from "react";
import { useLive, type Chat, type Course, type Module } from "./api";
import { Markdown } from "./Markdown";
import { Thread, ChatActions } from "./Chat";
import { Link, NotFound, Shell } from "./App";

type Highlight = { id: string; doc: string; quote: string; createdAt: string };
type NChat = Chat & { body?: string };
type Book = { notes: Record<string, string>; progress: Record<string, { summary?: string; chat?: string; completedAt?: string }>; highlights: Highlight[]; chats: NChat[] };

const moduleOf = (doc: string) => /^modules\/([^/]+)/.exec(doc)?.[1] ?? "";
const fileOf = (doc: string) => doc.split("/").slice(2).join("/");

export function NotebookPage({ slug }: { slug: string }) {
  const { data: course, error } = useLive<Course>(`/api/courses/${slug}`);
  const { data: book, reload } = useLive<Book>(`/api/courses/${slug}/notebook`, ["progress"]);
  const [q, setQ] = useState("");
  if (error) return <NotFound crumbs={[{ label: "Courses", to: "/" }]} what="course" />;
  const crumbs = [{ label: "Courses", to: "/" }, { label: course?.title ?? slug, to: `/c/${slug}` }, { label: "Notebook" }];
  if (!course || !book) return <Shell crumbs={crumbs} className="page"><h1>Notebook</h1></Shell>;

  const needle = q.trim().toLowerCase();
  const hit = (...texts: (string | null | undefined)[]) => !needle || texts.some((t) => t?.toLowerCase().includes(needle));
  const known = new Set(course.modules.map((m) => m.id));
  const strays = Object.keys(book.notes).filter((id) => !known.has(id) && book.notes[id].trim() && hit(book.notes[id]));
  const sections = course.modules.map((m) => <ModuleEntry key={m.id} slug={slug} mod={m} book={book} hit={hit} reload={reload} />);
  const empty = !book.highlights.length && !book.chats.length && !Object.values(book.notes).some((n) => n.trim()) && !Object.values(book.progress).some((p) => p.summary);

  return (
    <Shell crumbs={crumbs} className="page notebook">
      <div className="page-head"><h1>Notebook</h1><input className="field notebook-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, highlights, chats" /></div>
      {empty ? <p className="muted empty">Nothing yet. Notes, highlights and chats you make in a lesson collect here.</p> : <>
        {sections}
        {strays.length > 0 && (
          <section className="nb-module">
            <h2>Notes from modules no longer in the outline</h2>
            {strays.map((id) => <div key={id} className="nb-block"><h3>{id}</h3><div className="nb-notes"><Markdown body={book.notes[id]} /></div></div>)}
          </section>
        )}
      </>}
    </Shell>
  );
}

function ModuleEntry({ slug, mod, book, hit, reload }: { slug: string; mod: Module; book: Book; hit: (...t: (string | null | undefined)[]) => boolean; reload: () => void }) {
  const here = `/c/${slug}/m/${mod.id}`;
  const title = (file: string) => file === "quiz.md" ? "Module test" : mod.sections.find((s) => s.file === file)?.title ?? mod.extras.find((e) => e.file === file)?.title ?? file;
  const notes = book.notes[mod.id]?.trim() ? book.notes[mod.id] : "";
  const highlights = book.highlights.filter((h) => moduleOf(h.doc) === mod.id && hit(h.quote));
  const chats = book.chats.filter((c) => moduleOf(c.doc) === mod.id && c.kind !== "summary" && hit(c.title, c.context, c.body));
  const p = book.progress[mod.id] ?? {};
  const wrap = p.summary || p.chat || mod.understanding;
  const showWrap = wrap && hit(p.summary, mod.understanding?.summary, book.chats.find((c) => c.id === p.chat)?.body);
  const showNotes = notes && hit(notes);
  if (!showNotes && !highlights.length && !chats.length && !showWrap) return null;

  const byDoc = highlights.reduce((m, h) => ((m[h.doc] ??= []).push(h), m), {} as Record<string, Highlight[]>);
  return (
    <section className="nb-module">
      <div className="module-head"><h2>{mod.title}</h2>{mod.status === "ready" && <Link to={here} className="btn">Open module</Link>}</div>

      {showNotes && <div className="nb-block"><h3>Notes</h3><div className="nb-notes"><Markdown body={notes} /></div><p className="meta">Edit them in the module's Notes pane.</p></div>}

      {highlights.length > 0 && (
        <div className="nb-block">
          <h3>Highlights</h3>
          {Object.entries(byDoc).map(([doc, hs]) => (
            <div key={doc}>
              <p className="meta">{title(fileOf(doc))}</p>
              <ul className="highlights">{hs.map((h) => <li key={h.id}><Link to={`${here}/${fileOf(doc)}#hl-${h.id}`}>{h.quote}</Link></li>)}</ul>
            </div>
          ))}
        </div>
      )}

      {chats.length > 0 && (
        <div className="nb-block">
          <h3>Chats</h3>
          <ul className="nb-chats">{chats.map((c) => <ChatEntry key={c.id} chat={c} where={title(fileOf(c.doc))} to={`${here}/${fileOf(c.doc)}`} reload={reload} />)}</ul>
        </div>
      )}

      {showWrap && (
        <div className="nb-block">
          <h3>Wrap-up</h3>
          {mod.understanding?.summary && <p>{mod.understanding.summary} <Link to={`${here}/wrap`}>Understanding →</Link></p>}
          {p.summary && <details className="wrap-summary"><summary>Your explanation</summary><Markdown body={p.summary} /></details>}
          {p.chat && <details className="wrap-summary"><summary>The discussion</summary><div className="wrap-chat"><Thread id={p.chat} hideContext readOnly /></div></details>}
        </div>
      )}
    </section>
  );
}

function ChatEntry({ chat, where, to, reload }: { chat: NChat; where: string; to: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="nb-chat-head">
        <button className="link" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {chat.title}</button>
        <span className="muted">{where} · {new Date(chat.updatedAt ?? chat.createdAt).toLocaleDateString()} · {chat.messages ?? 0} messages</span>
        <span className="chat-row-actions"><Link to={`${to}?chat=${chat.id}`}>continue</Link><ChatActions chat={chat} onChange={reload} /></span>
      </div>
      {open && <div className="nb-chat">{chat.context && <blockquote className="chat-context">{chat.context}</blockquote>}<Thread id={chat.id} hideContext readOnly /></div>}
    </li>
  );
}
