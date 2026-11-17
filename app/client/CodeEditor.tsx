// A small code editor for `type: code` questions: CodeMirror with the language's highlighting,
// coloured from the page theme (styles.css, `.tok-*`), Tab to indent and Mod-Enter to run.
import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { sql, SQLite, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";

const LANGS: Record<string, () => Extension> = {
  sql: () => sql({ dialect: SQLite, upperCaseKeywords: true }),
  sqlite: () => sql({ dialect: SQLite, upperCaseKeywords: true }),
  postgres: () => sql({ dialect: PostgreSQL }), postgresql: () => sql({ dialect: PostgreSQL }),
  mysql: () => sql({ dialect: MySQL }),
  python: () => python(), py: () => python(),
  javascript: () => javascript(), js: () => javascript(),
  typescript: () => javascript({ typescript: true }), ts: () => javascript({ typescript: true }),
};
const lang = (name?: string) => LANGS[(name ?? "").toLowerCase()]?.() ?? [];

export function CodeEditor({ value, onChange, language, onRun, readOnly, label }: {
  value: string; onChange?: (v: string) => void; language?: string; onRun?: () => void; readOnly?: boolean; label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, read by the editor's listeners without rebuilding it.
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };
  const ro = useRef(new Compartment());

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), indentOnInput(), bracketMatching(), highlightActiveLine(), EditorView.lineWrapping,
          syntaxHighlighting(classHighlighter), lang(language), EditorState.tabSize.of(2),
          placeholder(language ? `Your ${language.toUpperCase() === "SQL" ? "SQL" : language}` : "Your code"),
          keymap.of([{ key: "Mod-Enter", run: () => { cb.current.onRun?.(); return !!cb.current.onRun; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          ro.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ "aria-label": label ?? "Code answer", spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, [language]);

  // A value set from outside (a saved answer arriving, a reset): replace the text, keep the history.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  return <div ref={host} className="code-editor" data-noquote />;
}
