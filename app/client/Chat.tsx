// Chats scoped to one section. A new chat starts from a selection (its context) or from nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { del, get, post, put, useEvent, useLive, useJobs, type Chat as ChatRow, type ChatAction, type Message } from "./api";
import { Markdown } from "./Markdown";
import { Link } from "./App";

// While a reply streams, hide an ```action block the tutor is still writing: the server acts on it
// and the outcome shows under the message instead.
const visible = (s: string) => s.replace(/```action[\s\S]*$/, "").trimEnd();

export function ChatPane({ slug, doc, draft, onDraftUsed, open }: { slug: string; doc: string; draft: string | null; onDraftUsed: () => void; open?: string | null }) {
  const { data: chats, reload } = useLive<ChatRow[]>(`/api/courses/${slug}/chats?doc=${encodeURIComponent(doc)}`);
  const [active, setActive] = useState<string | null>(open ?? null);
  useEffect(() => { if (open) setActive(open); }, [open]);
  useEffect(() => { if (draft) setActive(null); }, [draft]);

  if (active) return <Thread id={active} onBack={() => { setActive(null); reload(); }} />;
  return (
    <div className="chat">
      <Composer
        context={draft}
        placeholder={draft ? "Ask about the selected passage" : "Ask about this section"}
        onSend={async (message) => {
          const { chat } = await post<{ chat: ChatRow }>(`/api/courses/${slug}/chats`, { doc, context: draft ?? undefined, message });
          onDraftUsed(); setActive(chat.id);
        }}
      />
      {chats && chats.length > 0 && (
        <ul className="chat-list">
          {chats.map((c) => (
            <li key={c.id}>
              <button className="link" onClick={() => setActive(c.id)}>{c.title}</button><span className="muted"> · {new Date(c.createdAt).toLocaleDateString()}</span>
              <span className="chat-row-actions"><ChatActions chat={c} onChange={reload} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Rename or delete a section chat.
export function ChatActions({ chat, onChange }: { chat: ChatRow; onChange: () => void }) {
  return (
    <>
      <button className="link" title="Rename" onClick={async () => { const t = prompt("Name this chat", chat.title); if (t?.trim()) { await put(`/api/chats/${chat.id}`, { title: t }); onChange(); } }}>rename</button>
      <button className="link" title="Delete" onClick={async () => { if (confirm(`Delete “${chat.title}”? This cannot be undone.`)) { await del(`/api/chats/${chat.id}`); onChange(); } }}>delete</button>
    </>
  );
}

// A thread. `onTurns` reports how many assistant replies exist (the wrap-up gates on it). `readOnly`
// drops the composer: a finished wrap-up discussion, or a chat shown in the notebook.
export function Thread({ id, onBack, onTurns, hideContext, readOnly }: { id: string; onBack?: () => void; onTurns?: (n: number) => void; hideContext?: boolean; readOnly?: boolean }) {
  const [chat, setChat] = useState<ChatRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<string | null>(null);   // assistant text streaming in
  const thread = useRef<HTMLDivElement>(null);
  const jobs = useJobs();
  const replying = jobs.some((j) => j.kind === "chat" && j.ref === id);

  useEffect(() => { get<{ chat: ChatRow; messages: Message[] }>(`/api/chats/${id}`).then((r) => { setChat(r.chat); setMessages(r.messages); setPending(null); }); }, [id]);
  // Waiting only while a reply job exists; a thread that ends on a user turn with no job is sendable again.
  useEffect(() => { if (!replying) setPending((p) => (p ? p : null)); else setPending((p) => p ?? ""); }, [replying]);
  useEvent("chat", useCallback((ev: any) => {
    if (ev.chat !== id) return;
    if (ev.done) { setMessages((m) => [...m, ev.message]); setPending(null); }
    else if (ev.reset) setPending("");
    else setPending((p) => (p ?? "") + ev.delta);
  }, [id]));
  // Follow the newest message inside the thread's own scroll box. Not scrollIntoView: it also scrolls
  // the page, so sending a message would move the lesson the learner was reading. A reply can grow
  // after it renders (a score engraving, a diagram): while the reader is at the bottom, stay there.
  const atBottom = useRef(true);
  useEffect(() => {
    const t = thread.current; if (!t || readOnly) return;
    const onScroll = () => { atBottom.current = t.scrollHeight - t.scrollTop - t.clientHeight < 24; };
    const ro = new ResizeObserver(() => { if (atBottom.current) t.scrollTop = t.scrollHeight; });
    for (const c of Array.from(t.children)) ro.observe(c);
    const mo = new MutationObserver(() => { ro.disconnect(); for (const c of Array.from(t.children)) ro.observe(c); });
    mo.observe(t, { childList: true });
    t.addEventListener("scroll", onScroll);
    return () => { ro.disconnect(); mo.disconnect(); t.removeEventListener("scroll", onScroll); };
  }, [readOnly]);
  useEffect(() => { const t = thread.current; if (!readOnly && t) { t.scrollTop = t.scrollHeight; atBottom.current = true; } onTurns?.(messages.filter((m) => m.role === "assistant").length); }, [messages, pending]);

  return (
    <div className="chat">
      {onBack && <button className="link" onClick={onBack}>← All chats</button>}
      {chat?.context && !hideContext && <blockquote className="chat-context">{chat.context}</blockquote>}
      <div className="chat-thread" ref={thread}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.role === "assistant" ? <Markdown body={m.content} /> : m.content}
            {m.actions?.map((a, k) => <ActionResult key={k} chat={id} message={m.id} k={k} a={a} onChange={(actions) => setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, actions } : x)))} />)}
          </div>
        ))}
        {pending !== null && <div className="msg msg-assistant">{visible(pending) ? <Markdown body={visible(pending)} /> : <span className="muted">Thinking…</span>}</div>}
      </div>
      {!readOnly && <Composer placeholder="Reply" disabled={pending !== null} onSend={async (content) => { setMessages((m) => [...m, { id: "tmp" + Date.now(), role: "user", content }]); setPending(""); await post(`/api/chats/${id}/messages`, { content }); }} />}
    </div>
  );
}

// What a turn did: a line with a link, and Undo for flashcards and new words.
function ActionResult({ chat, message, k, a, onChange }: { chat: string; message: string; k: number; a: ChatAction; onChange: (actions: ChatAction[]) => void }) {
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    setBusy(true);
    try { const r = await post<{ actions: ChatAction[] }>(`/api/chats/${chat}/messages/${message}/actions/${k}/undo`); onChange(r.actions); }
    catch { alert("That did not undo. Try again."); }
    setBusy(false);
  };
  return (
    <p className={`chat-action ${a.ok ? "" : "is-bad"}`} role="status">
      <span>{a.undone ? <s>{a.text}</s> : a.text}</span>
      {a.undone ? <span className="muted"> Undone.</span> : <>
        {a.ok && a.to && <> <Link to={a.to}>Open</Link></>}
        {a.ok && !!a.undo && <> · <button className="link" disabled={busy} onClick={undo}>Undo</button></>}
      </>}
    </p>
  );
}

function Composer({ context, placeholder, disabled, onSend }: { context?: string | null; placeholder: string; disabled?: boolean; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const send = async () => { const t = text.trim(); if (!t || disabled) return; setText(""); await onSend(t); };
  return (
    <div className="composer">
      {context && <blockquote className="chat-context">{context}</blockquote>}
      <textarea rows={2} value={text} placeholder={placeholder} disabled={disabled} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <button className="primary" onClick={send} disabled={disabled || !text.trim()}>Send</button>
    </div>
  );
}
