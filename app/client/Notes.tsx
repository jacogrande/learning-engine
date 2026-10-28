// Notes for one module: a Tiptap editor whose document is a markdown file on disk.
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { get, put } from "./api";

export type NotesHandle = { addQuote: (quote: string, source: string) => void };

export const Notes = forwardRef<NotesHandle, { slug: string; moduleId: string }>(function Notes({ slug, moduleId }, ref) {
  const url = `/api/courses/${slug}/notes/${moduleId}`;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loaded = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown, Placeholder.configure({ placeholder: "Notes for this module. Select text in the lesson and choose Note to quote it." })],
    editorProps: { attributes: { class: "notes-editor" } },
    onUpdate({ editor }) {
      if (!loaded.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => put(url, { markdown: editor.getMarkdown().replace(/^\s+/, "") }), 600);
    },
  });

  useEffect(() => {
    if (!editor) return;
    loaded.current = false;
    get<{ markdown: string }>(url).then(({ markdown }) => {
      editor.commands.setContent(markdown, { contentType: "markdown" });
      loaded.current = true;
    });
  }, [editor, url]);

  useImperativeHandle(ref, () => ({
    addQuote(quote, source) {
      if (!editor) return;
      const end = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(end, `<blockquote><p>${esc(quote)}</p></blockquote><p><em>— ${esc(source)}</em></p><p></p>`).run();
    },
  }), [editor]);

  return <EditorContent editor={editor} className="notes" />;
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
