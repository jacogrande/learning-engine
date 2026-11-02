// A Tiptap editor whose document is markdown. Used for notes and the end-of-module explanation.
// Selecting text raises a toolbar: bold, italic, underline, strikethrough, code, link, and a
// background colour.
import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, useEditorState, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { Markdown } from "@tiptap/markdown";

// Background colours are names, not values: each theme gives them its own shade (styles.css, .hl-*).
export const HIGHLIGHTS = ["yellow", "green", "blue", "pink", "orange"] as const;

// Highlight with a colour that survives the round trip through markdown. Markdown has no coloured
// highlight, so it is written as <mark data-color="green">…</mark>; plain ==text== still reads as yellow.
const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el) => el.getAttribute("data-color") || "yellow",
        renderHTML: (a) => ({ "data-color": a.color, class: `hl hl-${a.color}` }),
      },
    };
  },
  renderMarkdown: (node: any, h: any) => `<mark data-color="${node.attrs?.color ?? "yellow"}">${h.renderChildren(node)}</mark>`,
  parseMarkdown: (token: any, h: any) => h.applyMark("highlight", h.parseInline(token.tokens || []), { color: token.color }),
  markdownTokenizer: {
    name: "highlight",
    level: "inline",
    start: (src: string) => { const i = [src.indexOf("<mark"), src.indexOf("==")].filter((x) => x >= 0); return i.length ? Math.min(...i) : -1; },
    tokenize(src: string, _: unknown, h: any) {
      const mark = /^<mark(?:\s+data-color="([a-z]+)")?>([\s\S]*?)<\/mark>/.exec(src), eq = mark ? null : /^==(?!\s)([^=]*[^=\s])==/.exec(src);
      const [raw, color, text] = mark ? [mark[0], mark[1], mark[2]] : eq ? [eq[0], undefined, eq[1]] : [];
      if (!raw || !text) return;
      return { type: "highlight", raw, text, color: HIGHLIGHTS.includes(color as any) ? color : "yellow", tokens: h.inlineTokens(text) };
    },
  },
}).configure({ multicolor: true });

export type EditorHandle = { insertHtml: (html: string) => void; getMarkdown: () => string; replace: (markdown: string) => void };

export const Editor = forwardRef<EditorHandle, { value: string | null; onChange: (markdown: string) => void; placeholder: string; className?: string }>(
  function Editor({ value, onChange, placeholder, className }, ref) {
    const loaded = useRef(false);
    const placed = useRef(false);   // the learner has put the cursor somewhere: insert there, not at the end
    const editor = useEditor({
      extensions: [StarterKit.configure({ link: { openOnClick: true, autolink: true } }), ColorHighlight, Markdown, Placeholder.configure({ placeholder })],
      editorProps: { attributes: { class: `notes-editor ${className ?? ""}` } },
      onFocus() { placed.current = true; },
      onUpdate({ editor }) { if (loaded.current) onChange(editor.getMarkdown().replace(/^\s+/, "")); },
    });
    // `value` is the initial document (null while loading); later edits flow out through onChange only.
    useEffect(() => {
      if (!editor || value === null || loaded.current) return;
      editor.commands.setContent(value, { contentType: "markdown" });
      loaded.current = true;
    }, [editor, value]);
    useImperativeHandle(ref, () => ({
      insertHtml(html) {
        if (!editor) return;
        if (placed.current) editor.chain().focus().insertContent(html).run();
        else editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run();
      },
      getMarkdown: () => editor?.getMarkdown().replace(/^\s+/, "") ?? "",
      replace(markdown) { editor?.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false }); },
    }), [editor]);
    return (
      <>
        {editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} className="notes" />
      </>
    );
  },
);

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

// The floating toolbar over a selection. Buttons act on mousedown with the default prevented, so
// the selection stays put; the keyboard shortcuts are Tiptap's own, named in each title.
function Toolbar({ editor }: { editor: TiptapEditor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      code: e.isActive("code"), link: e.isActive("link"), color: e.isActive("highlight") ? (e.getAttributes("highlight").color as string) : null,
    }),
  });
  const run = (fn: () => void) => (ev: React.MouseEvent) => { ev.preventDefault(); fn(); };
  const c = () => editor.chain().focus();
  const link = () => {
    if (s.link) return c().extendMarkRange("link").unsetLink().run();
    const href = prompt("Link to", "https://")?.trim();
    if (href && href !== "https://") c().extendMarkRange("link").setLink({ href }).run();
  };
  const marks: [keyof typeof s, string, string, () => void][] = [
    ["bold", "B", `Bold (${MOD}B)`, () => c().toggleBold().run()],
    ["italic", "I", `Italic (${MOD}I)`, () => c().toggleItalic().run()],
    ["underline", "U", `Underline (${MOD}U)`, () => c().toggleUnderline().run()],
    ["strike", "S", `Strikethrough (${MOD}Shift+S)`, () => c().toggleStrike().run()],
    ["code", "</>", `Code (${MOD}E)`, () => c().toggleCode().run()],
    ["link", "Link", s.link ? "Remove link" : "Link", link],
  ];
  return (
    <BubbleMenu editor={editor} options={{ placement: "top", offset: 8 }} className="format-bar" role="toolbar" aria-label="Format">
      {marks.map(([k, label, title, fn]) => (
        <button key={k} type="button" className={`fmt fmt-${k}`} aria-pressed={!!s[k]} title={title} aria-label={title} onMouseDown={run(fn)}>{label}</button>
      ))}
      <span className="format-sep" aria-hidden />
      {HIGHLIGHTS.map((color) => (
        <button key={color} type="button" className={`swatch hl-${color}`} aria-pressed={s.color === color} title={`${color} background (${MOD}Shift+H for yellow)`} aria-label={`${color} background`}
          onMouseDown={run(() => (s.color === color ? c().unsetHighlight().run() : c().setHighlight({ color }).run()))} />
      ))}
      <button type="button" className="fmt" title="Clear formatting" aria-label="Clear formatting" onMouseDown={run(() => c().unsetAllMarks().run())}>⌫</button>
    </BubbleMenu>
  );
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
