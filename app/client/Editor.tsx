// A Tiptap editor whose document is markdown. Used for notes and the end-of-module explanation.
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";

export type EditorHandle = { insertHtml: (html: string) => void; getMarkdown: () => string };

export const Editor = forwardRef<EditorHandle, { value: string | null; onChange: (markdown: string) => void; placeholder: string; className?: string }>(
  function Editor({ value, onChange, placeholder, className }, ref) {
    const loaded = useRef(false);
    const editor = useEditor({
      extensions: [StarterKit, Markdown, Placeholder.configure({ placeholder })],
      editorProps: { attributes: { class: `notes-editor ${className ?? ""}` } },
      onUpdate({ editor }) { if (loaded.current) onChange(editor.getMarkdown().replace(/^\s+/, "")); },
    });
    // `value` is the initial document (null while loading); later edits flow out through onChange only.
    useEffect(() => {
      if (!editor || value === null || loaded.current) return;
      editor.commands.setContent(value, { contentType: "markdown" });
      loaded.current = true;
    }, [editor, value]);
    useImperativeHandle(ref, () => ({
      insertHtml(html) { if (editor) editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run(); },
      getMarkdown: () => editor?.getMarkdown().replace(/^\s+/, "") ?? "",
    }), [editor]);
    return <EditorContent editor={editor} className="notes" />;
  },
);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
