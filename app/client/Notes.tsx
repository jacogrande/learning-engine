// Notes for one module: an editor whose document is a markdown file on disk.
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Editor, esc, type EditorHandle } from "./Editor";
import { get, put } from "./api";

export type NotesHandle = { addQuote: (quote: string, source: string) => void };

export const Notes = forwardRef<NotesHandle, { slug: string; moduleId: string }>(function Notes({ slug, moduleId }, ref) {
  const url = `/api/courses/${slug}/notes/${moduleId}`;
  const [initial, setInitial] = useState<string | null>(null);
  const editor = useRef<EditorHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setInitial(null); get<{ markdown: string }>(url).then(({ markdown }) => setInitial(markdown)); }, [url]);

  useImperativeHandle(ref, () => ({
    addQuote(quote, source) { editor.current?.insertHtml(`<blockquote><p>${esc(quote)}</p></blockquote><p><em>— ${esc(source)}</em></p><p></p>`); },
  }), []);

  return (
    <Editor
      key={url} ref={editor} value={initial}
      placeholder="Notes for this module. Select text in the lesson and choose Note to quote it."
      onChange={(md) => { clearTimeout(timer.current); timer.current = setTimeout(() => put(url, { markdown: md }), 600); }}
    />
  );
});
