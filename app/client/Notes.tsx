// Notes for one module: an editor whose document is a markdown file on disk. Saves carry the text
// they were based on; if the file moved on underneath (a pull brought another machine's notes),
// the save is refused and the learner picks a version instead of one silently overwriting the other.
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Editor, esc, type EditorHandle } from "./Editor";
import { get, useEvent } from "./api";

export type NotesHandle = { addQuote: (quote: string, source: string, href: string) => void };
type Status = "saved" | "saving" | "unsaved" | "error" | { conflict: string };

export const Notes = forwardRef<NotesHandle, { slug: string; moduleId: string }>(function Notes({ slug, moduleId }, ref) {
  const url = `/api/courses/${slug}/notes/${moduleId}`;
  const [initial, setInitial] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("saved");
  const editor = useRef<EditorHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const base = useRef<string>("");          // the file as this editor last saw it
  const dirty = useRef(false);
  const latest = useRef<string>("");        // the editor's text at the last change

  useEffect(() => {
    setInitial(null); setStatus("saved"); dirty.current = false;
    get<{ markdown: string }>(url).then(({ markdown }) => { base.current = markdown; setInitial(markdown); });
  }, [url]);

  const save = useCallback(async (md: string, force = false) => {
    setStatus("saving");
    const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: md, base: base.current, force }), keepalive: true }).catch(() => null);
    if (r?.status === 409) { const { markdown } = await r.json(); setStatus({ conflict: markdown }); return; }
    if (!r?.ok) { setStatus("error"); return; }
    base.current = md; dirty.current = false; setStatus("saved");
  }, [url]);

  // Files changed on disk (a pull, another tab): adopt them when nothing here is unsaved.
  useEvent(["content", "sync"], useCallback(() => {
    if (dirty.current) return;
    get<{ markdown: string }>(url).then(({ markdown }) => {
      if (dirty.current || markdown === base.current) return;
      base.current = markdown; editor.current?.replace(markdown);
    });
  }, [url]));

  // Leaving the module with a save pending: send it now rather than dropping it.
  useEffect(() => () => { if (dirty.current) { clearTimeout(timer.current); save(latest.current); } }, [url]);

  useImperativeHandle(ref, () => ({
    addQuote(quote, source, href) { editor.current?.insertHtml(`<blockquote><p>${esc(quote)}</p></blockquote><p><em>— <a href="${esc(href)}">${esc(source)}</a></em></p><p></p>`); },
  }), []);

  const conflict = typeof status === "object" ? status.conflict : null;
  return (
    <>
      <Editor
        key={url} ref={editor} value={initial}
        placeholder="Notes for this module. Select text in the lesson and choose Note to quote it."
        onChange={(md) => { latest.current = md; dirty.current = true; setStatus("unsaved"); clearTimeout(timer.current); timer.current = setTimeout(() => save(md), 600); }}
      />
      {conflict !== null ? (
        <div className="notes-conflict">
          <p>These notes changed on another device since you opened them.</p>
          <details><summary>Show the other version</summary><pre>{conflict}</pre></details>
          <div className="actions">
            <button onClick={() => save(editor.current?.getMarkdown() ?? "", true)}>Keep mine</button>
            <button onClick={() => { base.current = conflict; dirty.current = false; editor.current?.replace(conflict); setStatus("saved"); }}>Use the other version</button>
            <button onClick={() => { const mine = editor.current?.getMarkdown() ?? ""; const both = `${conflict.trimEnd()}\n\n---\n\n${mine}`; base.current = conflict; editor.current?.replace(both); save(both); }}>Keep both</button>
          </div>
        </div>
      ) : (
        <p className="notes-status muted">{status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : status === "error" ? "Not saved: the server did not answer. Keep typing to retry." : initial !== null ? "Saved" : ""}</p>
      )}
    </>
  );
});
