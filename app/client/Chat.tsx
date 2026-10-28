// Chats scoped to one section. A new chat starts from a selection (its context) or from nothing.
import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, useEvent, useLive, type Chat as ChatRow, type Message } from "./api";
import { Markdown } from "./Markdown";

export function ChatPane({ slug, doc, draft, onDraftUsed }: { slug: string; doc: string; draft: string | null; onDraftUsed: () => void }) {
  const { data: chats, reload } = useLive<ChatRow[]>(`/api/courses/${slug}/chats?doc=${encodeURIComponent(doc)}`);
  const [active, setActive] = useState<string | null>(null);
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
          {chats.map((c) => <li key={c.id}><button className="link" onClick={() => setActive(c.id)}>{c.title}</button><span className="muted"> · {new Date(c.createdAt).toLocaleDateString()}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function Thread({ id, onBack }: { id: string; onBack: () => void }) {
  const [chat, setChat] = useState<ChatRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<string | null>(null);   // assistant text streaming in
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { get<{ chat: ChatRow; messages: Message[] }>(`/api/chats/${id}`).then((r) => { setChat(r.chat); setMessages(r.messages); setPending(r.messages.at(-1)?.role === "user" ? "" : null); }); }, [id]);
  useEvent("chat", useCallback((ev: any) => {
    if (ev.chat !== id) return;
    if (ev.done) { setMessages((m) => [...m, ev.message]); setPending(null); }
    else setPending((p) => (p ?? "") + ev.delta);
  }, [id]));
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending]);

  return (
    <div className="chat">
      <button className="link" onClick={onBack}>← All chats</button>
      {chat?.context && <blockquote className="chat-context">{chat.context}</blockquote>}
      <div className="chat-thread">
        {messages.map((m) => <div key={m.id} className={`msg msg-${m.role}`}>{m.role === "assistant" ? <Markdown body={m.content} /> : m.content}</div>)}
        {pending !== null && <div className="msg msg-assistant">{pending ? <Markdown body={pending} /> : <span className="muted">Thinking…</span>}</div>}
        <div ref={end} />
      </div>
      <Composer placeholder="Reply" disabled={pending !== null} onSend={async (content) => { setMessages((m) => [...m, { id: "tmp" + Date.now(), role: "user", content }]); setPending(""); await post(`/api/chats/${id}/messages`, { content }); }} />
    </div>
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
